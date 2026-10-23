import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { cursorState } from './cursor-state.mjs'
import { assertCursorNativeRoute, CursorAccountError, readCursorAccount } from './cursor-accounts.ts'
import { ProcessCleanupUnconfirmedError, type ProcessBackend, type RuntimeConfig } from './process.ts'
import type { ModelChoice } from '../shared/types.ts'

const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const failed = () => new CursorAccountError('Cursor ACP 模型目录查询失败，请检查原生 CLI 后刷新')
/** Zero prompt discovery. Native session/new may leave an empty native history;
 * no guessed end/delete RPC is sent and no user history is removed. */
export async function queryCursorAcpModels(backend: ProcessBackend, config: RuntimeConfig, executable: string, cwd: string, signal: AbortSignal): Promise<ModelChoice[]> {
  assertCursorNativeRoute()
  const control = AbortSignal.any([signal, AbortSignal.timeout(Math.min(config.timeoutMs, 15000))])
  control.throwIfAborted()
  const child = backend.spawn({ argv: [executable, 'acp'], cwd, signal: control, graceMs: config.graceMs,
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' } })
  const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  let issue: Error | undefined, bytes = 0, buffer = '', exited = false, ownStop = false, completed = false
  const fail = () => {
    issue ??= failed()
    for (const item of pending.values()) item.reject(issue)
    pending.clear()
  }
  const cancel = () => { fail(); try { child.terminate() } catch { /* finally verifies range exit */ } }
  const inputError = () => fail()
  child.stdin?.on('error', inputError)
  control.addEventListener('abort', cancel, { once: true })
  const send = (value: unknown) => {
    if (!child.stdin?.writable || child.stdin.destroyed) { fail(); return }
    child.stdin.write(JSON.stringify(value) + '\n', error => { if (error) fail() })
  }
  const request = (method: string, params: unknown): Promise<any> => {
    control.throwIfAborted()
    if (issue || exited) return Promise.reject(issue ?? failed())
    return new Promise((resolve, reject) => {
      const id = randomUUID()
      pending.set(id, { resolve, reject })
      send({ jsonrpc: '2.0', id, method, params })
    })
  }
  const consume = async (stream: typeof child.stdout, stdout: boolean) => {
    const decoder = new StringDecoder('utf8')
    if (stream) for await (const chunk of stream) {
      bytes += Buffer.byteLength(chunk)
      if (bytes > Math.min(config.maxRunBytes, 4 * 1024 * 1024)) throw failed()
      if (!stdout) continue
      buffer += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      if (Buffer.byteLength(buffer) > config.maxLineBytes && !buffer.includes('\n')) throw failed()
      let index: number
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1)
        if (!line.trim()) continue
        if (Buffer.byteLength(line) > config.maxLineBytes) throw failed()
        const value: unknown = JSON.parse(line)
        if (!record(value) || value.jsonrpc !== '2.0') throw failed()
        if (value.method !== undefined) {
          // No metadata permission can be approved. No client capabilities were advertised.
          if (value.id !== undefined) send({ jsonrpc: '2.0', id: value.id, error: { code: -32601, message: 'Client capability unavailable' } })
          continue
        }
        const item = pending.get(value.id)
        if (!item || !Object.hasOwn(value, 'result') || Object.hasOwn(value, 'error')) throw failed()
        pending.delete(value.id)
        item.resolve(value.result)
      }
    }
    if (stdout && (buffer + decoder.end()).trim()) throw failed()
  }
  const readers = [consume(child.stdout, true), consume(child.stderr, false)]
  for (const reader of readers) void reader.catch(cancel)
  const completion = child.done.then(async outcome => {
    exited = true
    const owned = ownStop
    await Promise.allSettled(readers)
    const expectedStop = owned && (outcome.signal === 'SIGTERM' || outcome.signal === 'SIGKILL' ||
      outcome.signal == null && [143, 137].includes(outcome.exitCode ?? -1))
    if (!completed || control.aborted || outcome.exitCode !== 0 && !expectedStop || outcome.signal != null && !expectedStop) fail()
    if (pending.size) fail()
  }, () => { exited = true; fail() })
  try {
    const initialized = await request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'dsh-cliworker-now', version: '0.8.2' } })
    if (!record(initialized) || initialized.protocolVersion !== 1 || initialized.agentCapabilities?.loadSession !== true) throw failed()
    const state = await request('session/new', { cwd, mcpServers: [] })
    if (!record(state) || typeof state.sessionId !== 'string' || !state.sessionId.trim() || state.sessionId.length > 8192 || /[\x00-\x1f]/.test(state.sessionId)) throw failed()
    const result = cursorState(state).models
    control.throwIfAborted()
    if (issue) throw issue
    completed = true
    return result
  } catch (error) {
    if (error instanceof ProcessCleanupUnconfirmedError) throw error
    throw failed()
  } finally {
    control.removeEventListener('abort', cancel)
    ownStop = completed && !issue && !control.aborted && !exited
    try {
      child.terminate()
      if (!(await child.waitForExit())) throw new ProcessCleanupUnconfirmedError()
    } catch { throw new ProcessCleanupUnconfirmedError() }
    try {
      const settled = await Promise.allSettled([child.done, completion, ...readers])
      if (issue || control.aborted || settled.some(value => value.status === 'rejected')) throw failed()
    } finally { child.stdin?.removeListener('error', inputError); buffer = '' }
  }
}

export async function discoverCursorModels(backend: ProcessBackend, config: RuntimeConfig, executable: string, cwd: string, signal: AbortSignal): Promise<ModelChoice[]> {
  const before = await readCursorAccount(backend, config, executable, cwd, signal)
  if (!before.principal) throw new CursorAccountError()
  const models = await queryCursorAcpModels(backend, config, executable, cwd, signal)
  const after = await readCursorAccount(backend, config, executable, cwd, signal)
  if (before.principal !== after.principal) throw new CursorAccountError('Cursor 账号已变更，请刷新目录并重新选择')
  return models
}
