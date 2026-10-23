import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { minimaxState } from './minimax-state.mjs'
import { MiniMaxAccountError, readMiniMaxAccount, type MiniMaxSource } from './minimax-accounts.ts'
import { ProcessCleanupUnconfirmedError, type ProcessBackend, type RuntimeConfig } from './process.ts'
import type { Effort, ModelChoice } from '../shared/types.ts'
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const failed = () => new MiniMaxAccountError('MiniMax ACP 目录读取失败或当前版本暂不支持，请在原生 CLI 检查后刷新')
/** Bounded metadata only. Raw output and stderr never leave this function. */
export async function queryMiniMaxAcpModels(backend: ProcessBackend, config: RuntimeConfig, executable: string, cwd: string, source: MiniMaxSource, signal: AbortSignal): Promise<ModelChoice[]> {
  const control = AbortSignal.any([signal, AbortSignal.timeout(Math.min(config.timeoutMs, 15000))])
  control.throwIfAborted()
  const child = backend.spawn({ argv: [executable, 'acp'], env: source.env, cwd, signal: control, graceMs: config.graceMs,
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' } })
  const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  let issue: Error | undefined, bytes = 0, buffer = '', exited = false, ownedStop = false, completed = false
  const fail = (error = failed()) => { issue ??= error; for (const p of pending.values()) p.reject(issue); pending.clear() }
  const cancel = () => { fail(); try { child.terminate() } catch { /* range checked below */ } }
  const inputError = () => fail()
  child.stdin?.on('error', inputError); control.addEventListener('abort', cancel, { once: true })
  const send = (v: unknown) => { if (!child.stdin?.writable || child.stdin.destroyed) return fail(); child.stdin.write(JSON.stringify(v) + '\n', e => { if (e) fail() }) }
  const request = (method: string, params: unknown): Promise<any> => {
    control.throwIfAborted()
    if (issue || exited) return Promise.reject(issue ?? failed())
    return new Promise((resolve, reject) => { const id = randomUUID(); pending.set(id, { resolve, reject }); send({ jsonrpc: '2.0', id, method, params }) })
  }
  const consume = async (stream: typeof child.stdout, stdout: boolean) => {
    const decoder = new StringDecoder('utf8')
    if (stream) for await (const chunk of stream) {
      bytes += Buffer.byteLength(chunk)
      if (bytes > Math.min(config.maxRunBytes, 4 * 1024 * 1024)) throw failed()
      if (!stdout) continue
      buffer += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      if (!buffer.includes('\n') && Buffer.byteLength(buffer) > config.maxLineBytes) throw failed()
      let i: number
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1)
        if (!line.trim()) continue
        if (Buffer.byteLength(line) > config.maxLineBytes) throw failed()
        const v: unknown = JSON.parse(line)
        if (!record(v) || v.jsonrpc !== '2.0') throw failed()
        if (v.method !== undefined) { if (v.id !== undefined) send({ jsonrpc: '2.0', id: v.id, error: { code: -32601, message: 'Client capability unavailable' } }); continue }
        const p = pending.get(v.id)
        if (!p) throw failed()
        pending.delete(v.id)
        if (v.error) {
          // Exact fixed native auth gate; never expose arbitrary error data/message.
          const login = v.error.code === -32000 && typeof v.error.message === 'string' && /Run `mcode login` and try again\./.test(v.error.message)
          const e = login ? new MiniMaxAccountError('MiniMax Code 当前原生来源需要登录，请运行 mcode login') : failed()
          p.reject(e); fail(e); continue
        }
        if (!Object.hasOwn(v, 'result')) throw failed()
        p.resolve(v.result)
      }
    }
    if (stdout && (buffer + decoder.end()).trim()) throw failed()
  }
  const readers = [consume(child.stdout, true), consume(child.stderr, false)]
  for (const reader of readers) void reader.catch(cancel)
  const completion = child.done.then(async outcome => {
    exited = true; const terminatedHere = ownedStop
    await Promise.allSettled(readers)
    const expectedStop = terminatedHere && (['SIGTERM', 'SIGKILL'].includes(outcome.signal ?? '') || outcome.signal == null && [143, 137].includes(outcome.exitCode ?? -1))
    if (!completed || control.aborted || outcome.exitCode !== 0 && !expectedStop || outcome.signal != null && !expectedStop || pending.size) fail()
  }, () => { exited = true; fail() })
  try {
    const init = await request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'dsh-cliworker-now', version: '0.8.2' } })
    if (init?.protocolVersion !== 1 || init?.agentInfo?.name !== 'minimax-code' || init?.agentCapabilities?.loadSession !== true) throw failed()
    let state = await request('session/new', { cwd, mcpServers: [] })
    if (!record(state) || typeof state.sessionId !== 'string' || !state.sessionId.trim() || state.sessionId.length > 8192 || /[\x00-\x1f]/.test(state.sessionId)) throw failed()
    const sessionId = state.sessionId, rows = minimaxState(state).models.filter(row => row.id.startsWith('m:minimax:'))
    if (!rows.length) throw failed()
    const models: ModelChoice[] = []
    for (const row of rows) {
      state = { ...state, ...await request('session/set_config_option', { sessionId, configId: 'model', value: row.id }) }
      const observed = minimaxState(state)
      if (observed.model !== row.id) throw failed()
      models.push({ ...row, efforts: ['default', ...observed.efforts as Effort[]] })
    }
    control.throwIfAborted(); if (issue) throw issue
    completed = true
    return models
  } catch (error) {
    if (error instanceof MiniMaxAccountError || error instanceof ProcessCleanupUnconfirmedError) throw error
    throw failed()
  } finally {
    control.removeEventListener('abort', cancel)
    ownedStop = completed && !issue && !control.aborted && !exited
    try { child.terminate(); if (!(await child.waitForExit())) throw new ProcessCleanupUnconfirmedError() }
    catch { throw new ProcessCleanupUnconfirmedError() }
    try { const results = await Promise.allSettled([child.done, completion, ...readers]); if (issue || control.aborted || results.some(r => r.status === 'rejected')) throw issue ?? failed() }
    finally { buffer = ''; child.stdin?.removeListener('error', inputError) }
  }
}
export async function discoverMiniMaxModels(backend: ProcessBackend, config: RuntimeConfig, executable: string, cwd: string, signal: AbortSignal) {
  const before = await readMiniMaxAccount(config, signal)
  if (!before.principal) throw new MiniMaxAccountError(before.identity.summary)
  const models = await queryMiniMaxAcpModels(backend, config, executable, cwd, before.source, signal)
  const after = await readMiniMaxAccount(config, signal)
  if (before.principal !== after.principal || JSON.stringify(before.source) !== JSON.stringify(after.source)) throw new MiniMaxAccountError('MiniMax Code 账号来源已改变，请重新选择')
  return models
}
