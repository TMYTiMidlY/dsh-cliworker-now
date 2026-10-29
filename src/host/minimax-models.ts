import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { minimaxState } from './minimax-state.mjs'
import { assertMiniMaxIdentityActive } from './minimax-identity.ts'
import { MiniMaxAccountError, ensureMiniMaxVerifiedAccount, readMiniMaxAccount, sameMiniMaxAccountSnapshot, miniMaxAccountSnapshotDifference, type MiniMaxSource } from './minimax-accounts.ts'
import { ProcessCleanupUnconfirmedError, type ProcessBackend, type RuntimeConfig } from './process.ts'
import type { Effort, ModelChoice } from '../shared/types.ts'
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
type Phase = 'spawn' | 'initialize' | 'session_new' | 'initial_state' | 'select_model' | 'selected_state' | 'stop' | 'exit' | 'cleanup'
type Reason = 'spawn_failed' | 'stdin_io' | 'stream_io' | 'non_json_stdout' | 'invalid_jsonrpc' | 'unexpected_reply' | 'rpc_error' | 'rpc_auth_required' |
  'init_contract' | 'session_shape' | 'model_control_missing' | 'permission_control_missing' | 'state_contract' | 'no_supported_provider' |
  'selected_model_mismatch' | 'advertisement_changed' | 'no_verified_configurations' | 'timeout' | 'caller_cancel' | 'byte_limit' | 'line_limit' | 'partial_line' | 'early_exit' | 'unexpected_exit' | 'stop_failed' | 'cleanup_unconfirmed'
type Checks = Partial<Record<'protocolIs1' | 'agentMatches' | 'loadSessionTrue' | 'sessionIdValid' | 'hasModel' | 'hasPermission' | 'hasEffort' |
  'currentModelAdvertised' | 'categoriesMatch' | 'modeSupported' | 'hasSupportedProviderRows' | 'selectedModelMatches', boolean>>
const RPC_CODES = [-32700, -32600, -32601, -32602, -32603, -32000, -32800] as const
const EXIT_CODES = [0, 1, 2, 126, 127, 130, 137, 143] as const
const EXIT_SIGNALS = ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP'] as const
type RpcCode = typeof RPC_CODES[number] | 'other' | 'none'
type ExitCode = typeof EXIT_CODES[number] | 'other' | 'none'
type ExitSignal = typeof EXIT_SIGNALS[number] | 'other' | 'none'
type NativeError = 'param_reasoning' | 'param_variant' | 'param_reasoning_variant_conflict' | 'param_reasoning_effort_conflict' | 'param_effort' | 'param_context' |
  'session_not_found' | 'selection_required' | 'model_application_missing' | 'model_provider_unavailable' | 'native_error_other'
type EnvelopeKind = 'details' | 'structured' | 'absent'
interface NativeErrorProjection { nativeError: NativeError; envelopeKind: EnvelopeKind }
// Exact public Native 0.6.12 literals only; never carry the input text/code into diagnostics.
const NATIVE_LITERALS = new Map<string, NativeError>([
  ['Invalid model reasoning', 'param_reasoning'], ['Invalid model variant', 'param_variant'],
  ['Invalid model reasoning/variant conflict', 'param_reasoning_variant_conflict'], ['Invalid model reasoning/effort conflict', 'param_reasoning_effort_conflict'],
  ['Invalid model thinking.effort', 'param_effort'], ['Invalid model context_limit', 'param_context'],
  ['Session not found', 'session_not_found'], ['provider_id and model_id are required', 'selection_required'],
  ['Runtime does not expose Model Application.', 'model_application_missing'], ['Desktop model provider service is not configured', 'model_provider_unavailable'],
])
const NATIVE_CODES = new Map<string, NativeError>([['SESSION_NOT_FOUND', 'session_not_found'], ['MODEL_PROVIDER_UNAVAILABLE', 'model_provider_unavailable']])
function nativeErrorProjection(data: unknown): NativeErrorProjection {
  if (!record(data)) return { nativeError: 'native_error_other', envelopeKind: 'absent' }
  if (typeof data.details === 'string') return { nativeError: NATIVE_LITERALS.get(data.details) ?? 'native_error_other', envelopeKind: 'details' }
  const kinds = [typeof data.message === 'string' ? NATIVE_LITERALS.get(data.message) : undefined,
    typeof data.code === 'string' ? NATIVE_CODES.get(data.code) : undefined, typeof data.key === 'string' ? NATIVE_CODES.get(data.key) : undefined].filter((kind): kind is NativeError => kind !== undefined)
  return { nativeError: kinds.length && kinds.every(kind => kind === kinds[0]) ? kinds[0]! : 'native_error_other', envelopeKind: 'structured' }
}
interface FirstFailure extends Partial<NativeErrorProjection> { phase: Phase; reason: Reason; checks: Readonly<Checks>; rpcCode: RpcCode; rowIndex: number; rowCount: number }
export interface MiniMaxCatalogDiagnostic extends FirstFailure {
  exitCode: ExitCode; exitSignal: ExitSignal; protocolComplete: boolean; ownedStopRequested: boolean
  exitBeforeComplete: boolean; cleanupConfirmed: boolean; stdoutSeen: boolean; stderrSeen: boolean
}
const bound = (n: number) => Math.max(0, Math.min(1024, Math.trunc(n)))
function diagnosticToken(d: MiniMaxCatalogDiagnostic): string {
  const checks = Object.entries(d.checks).map(([key, value]) => `${key}=${value ? 1 : 0}`).join(',')
  const native = d.nativeError ? ` native_error=${d.nativeError} envelope_kind=${d.envelopeKind}` : ''
  return `[${d.phase}/${d.reason}] rpc=${d.rpcCode}${native} exit=${d.exitCode} signal=${d.exitSignal} row=${d.rowIndex}/${d.rowCount} complete=${+d.protocolComplete} stop=${+d.ownedStopRequested} early=${+d.exitBeforeComplete} cleanup=${+d.cleanupConfirmed} stdout=${+d.stdoutSeen} stderr=${+d.stderrSeen}${checks ? ' ' + checks : ''}`
}
class MiniMaxCatalogError extends MiniMaxAccountError {
  constructor(readonly diagnostic: Readonly<MiniMaxCatalogDiagnostic>) {
    super((diagnostic.reason === 'rpc_auth_required' ? 'MiniMax Code 当前原生来源需要登录，请运行 mcode login' : 'MiniMax ACP 目录读取失败；尚未确认原因，未发布目录') + ' ' + diagnosticToken(diagnostic))
    this.name = 'MiniMaxCatalogError'
  }
}
class MiniMaxCatalogCleanupError extends ProcessCleanupUnconfirmedError {
  constructor(readonly diagnostic: Readonly<MiniMaxCatalogDiagnostic>) { super(); this.message += ' ' + diagnosticToken(diagnostic) }
}
/** Project booleans only. Keep the execution parser and all of its strict checks unchanged. */
function stateChecks(state: any): Checks {
  const controls = record(state) && Array.isArray(state.configOptions) && state.configOptions.length <= 32 ? state.configOptions : []
  const model = controls.find((v: any) => v?.id === 'model'), permission = controls.find((v: any) => v?.id === 'permissionMode'), effort = controls.find((v: any) => v?.id === 'thinkingEffort')
  const options = Array.isArray(model?.options) && model.options.length <= 1024 ? model.options.flatMap((v: any) => record(v) && Array.isArray(v.options) ? v.options.slice(0, 1024) : [v]) : []
  return { hasModel: !!model, hasPermission: !!permission, hasEffort: !!effort,
    currentModelAdvertised: options.length <= 1024 && options.some((v: any) => v?.value === model?.currentValue),
    categoriesMatch: model?.category === 'model' && permission?.category === '_permission' && (!effort || effort.category === 'thought_level'),
    modeSupported: ['default', 'plan'].includes(state?.modes?.currentModeId) }
}
class MiniMaxConfigurationRejected extends Error {
  constructor() { super('MiniMax advertised configuration rejected by native reasoning policy'); this.name = 'MiniMaxConfigurationRejected' }
}
export interface MiniMaxModelCatalog { models: ModelChoice[]; notice?: string }
/** Bounded metadata only. Diagnostics never include raw wire, native errors or caller reasons. */
export async function queryMiniMaxAcpModels(backend: ProcessBackend, config: RuntimeConfig, executable: string, cwd: string, source: MiniMaxSource, signal: AbortSignal): Promise<MiniMaxModelCatalog> {
  assertMiniMaxIdentityActive(signal)
  const deadline = AbortSignal.timeout(Math.min(config.timeoutMs, 15000)), control = AbortSignal.any([signal, deadline])
  let phase: Phase = 'spawn', first: Readonly<FirstFailure> | undefined, checks: Checks = {}, rpcCode: RpcCode = 'none', rowIndex = 0, rowCount = 0
  let exitCode: ExitCode = 'none', exitSignal: ExitSignal = 'none', exited = false, ownedStop = false, stopRequested = false, completed = false, cleanupConfirmed = false, exitBeforeComplete = false, stdoutSeen = false, stderrSeen = false
  const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; method: string; model?: { sessionId: string; configId: 'model'; value: string } }>()
  const advertised = new Set<string>(), rejected = new Set<string>(), sessions = new Set<string>()
  let sessionId: string | undefined, targetModel: string | undefined
  const diagnostic = (): Readonly<MiniMaxCatalogDiagnostic> => Object.freeze({ ...(first ?? { phase, reason: 'stream_io' as Reason, checks: Object.freeze({ ...checks }), rpcCode, rowIndex, rowCount }),
    exitCode, exitSignal, protocolComplete: completed, ownedStopRequested: stopRequested, exitBeforeComplete, cleanupConfirmed, stdoutSeen, stderrSeen })
  const failure = () => new MiniMaxCatalogError(diagnostic())
  let native: NativeErrorProjection | undefined
  const fail = (reason: Reason, at = phase) => {
    first ??= Object.freeze({ phase: at, reason, checks: Object.freeze({ ...checks }), rpcCode, rowIndex: bound(rowIndex), rowCount: bound(rowCount), ...native })
    const error = failure(); for (const p of pending.values()) p.reject(error); pending.clear(); return error
  }
  const active = () => { if (control.aborted) throw fail(signal.aborted ? 'caller_cancel' : 'timeout') }
  active()
  let child: ReturnType<ProcessBackend['spawn']>
  try { child = backend.spawn({ argv: [executable, 'acp'], env: { ...source.env }, cwd, signal: control, graceMs: config.graceMs, stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' } }) }
  catch { fail('spawn_failed'); throw failure() }
  let bytes = 0, buffer = ''
  const terminate = () => { stopRequested = true; child.terminate() }
  const cancel = () => { fail(signal.aborted ? 'caller_cancel' : 'timeout'); try { terminate() } catch { /* range checked below */ } }
  const inputError = () => { fail('stdin_io') }
  child.stdin?.on('error', inputError); control.addEventListener('abort', cancel, { once: true })
  const send = (v: unknown) => {
    if (!child.stdin?.writable || child.stdin.destroyed) { fail('stdin_io'); return }
    try { child.stdin.write(JSON.stringify(v) + '\n', e => { if (e) fail('stdin_io') }) } catch { fail('stdin_io') }
  }
  const request = (method: string, params: unknown): Promise<any> => {
    active()
    if (first || exited) return Promise.reject(first ? failure() : fail('early_exit'))
    const model = method === 'session/set_config_option' && record(params) && params.configId === 'model' && typeof params.sessionId === 'string' && typeof params.value === 'string'
      ? { sessionId: params.sessionId, configId: 'model' as const, value: params.value } : undefined
    return new Promise((resolve, reject) => { const id = randomUUID(); pending.set(id, { resolve, reject, method, model }); send({ jsonrpc: '2.0', id, method, params }) })
  }
  const consume = async (stream: typeof child.stdout, stdout: boolean) => {
    const decoder = new StringDecoder('utf8')
    if (stream) for await (const chunk of stream) {
      if (stdout) stdoutSeen = true; else stderrSeen = true
      bytes += Buffer.byteLength(chunk)
      if (bytes > Math.min(config.maxRunBytes, 4 * 1024 * 1024)) throw fail('byte_limit')
      if (!stdout) continue
      buffer += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      if (!buffer.includes('\n') && Buffer.byteLength(buffer) > config.maxLineBytes) throw fail('line_limit')
      let i: number
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1)
        if (!line.trim()) continue
        if (Buffer.byteLength(line) > config.maxLineBytes) throw fail('line_limit')
        let v: any
        try { v = JSON.parse(line) } catch { throw fail('non_json_stdout') }
        if (!record(v) || v.jsonrpc !== '2.0') throw fail('invalid_jsonrpc')
        if (v.method !== undefined) { if (v.id !== undefined) send({ jsonrpc: '2.0', id: v.id, error: { code: -32601, message: 'Client capability unavailable' } }); continue }
        const p = pending.get(v.id)
        if (!p) throw fail('unexpected_reply')
        if (Object.hasOwn(v, 'error') && Object.hasOwn(v, 'result')) throw fail('invalid_jsonrpc')
        if (v.error) {
          const projection = phase === 'select_model' && v.error.code === -32603 ? nativeErrorProjection(v.error.data) : undefined
          if (!first && !control.aborted && !exited && projection?.nativeError === 'param_reasoning' &&
              p.method === 'session/set_config_option' && p.model?.configId === 'model' && p.model.sessionId === sessionId &&
              p.model.value === targetModel && advertised.has(p.model.value)) {
            // Only this exact advertised configuration is rejected. A later fatal keeps its own clean snapshot.
            pending.delete(v.id); p.reject(new MiniMaxConfigurationRejected()); continue
          }
          rpcCode = RPC_CODES.includes(v.error.code) ? v.error.code : 'other'
          native = projection
          const login = v.error.code === -32000 && typeof v.error.message === 'string' && /Run `mcode login` and try again\./.test(v.error.message)
          const error = fail(login ? 'rpc_auth_required' : 'rpc_error'); p.reject(error); continue
        }
        // Do not remove the waiter before validating a reply: malformed frames must reject it, not hang.
        if (!Object.hasOwn(v, 'result')) throw fail('invalid_jsonrpc')
        pending.delete(v.id); p.resolve(v.result)
      }
    }
    if (stdout && (buffer + decoder.end()).trim()) throw fail('partial_line')
  }
  const readers = [consume(child.stdout, true), consume(child.stderr, false)]
  for (const reader of readers) void reader.catch(() => { fail('stream_io'); try { terminate() } catch { /* range checked below */ } })
  const completion = child.done.then(async outcome => {
    exited = true; const terminatedHere = ownedStop
    exitBeforeComplete = !completed
    exitCode = outcome.exitCode == null ? 'none' : EXIT_CODES.includes(outcome.exitCode as any) ? outcome.exitCode as ExitCode : 'other'
    exitSignal = outcome.signal == null ? 'none' : EXIT_SIGNALS.includes(outcome.signal as any) ? outcome.signal as ExitSignal : 'other'
    await Promise.allSettled(readers)
    const expectedStop = terminatedHere && (['SIGTERM', 'SIGKILL'].includes(outcome.signal ?? '') || outcome.signal == null && [143, 137].includes(outcome.exitCode ?? -1))
    if (!completed || pending.size) fail('early_exit')
    else if (outcome.exitCode !== 0 && !expectedStop || outcome.signal != null && !expectedStop) fail('unexpected_exit', 'exit')
    if (control.aborted) fail(signal.aborted ? 'caller_cancel' : 'timeout')
  }, () => { exited = true; exitBeforeComplete = !completed; fail('unexpected_exit', 'exit') })
  const parseState = (state: any) => {
    if (sessionId && state?.sessionId !== sessionId) throw fail('session_shape')
    checks = { ...checks, ...stateChecks(state) }
    if (record(state) && Array.isArray(state.configOptions) && state.configOptions.length <= 32) {
      if (!checks.hasModel) throw fail('model_control_missing')
      if (!checks.hasPermission) throw fail('permission_control_missing')
    }
    try { return minimaxState(state) } catch { throw fail('state_contract') }
  }
  const openSession = async () => {
    active()
    if (rowCount && sessions.size >= rowCount) throw fail('session_shape', 'session_new')
    phase = 'session_new'
    const state = await request('session/new', { cwd, mcpServers: [] })
    checks.sessionIdValid = record(state) && typeof state.sessionId === 'string' && !!state.sessionId.trim() && state.sessionId.length <= 8192 && !/[\x00-\x1f]/.test(state.sessionId) && !sessions.has(state.sessionId)
    if (!checks.sessionIdValid) throw fail('session_shape')
    sessionId = state.sessionId; sessions.add(state.sessionId)
    phase = 'initial_state'
    return { state, observed: parseState(state) }
  }
  const models: ModelChoice[] = []
  try {
    if (control.aborted) cancel()
    phase = 'initialize'
    const init = await request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'dsh-cliworker-now', version: '0.8.2' } })
    checks = { protocolIs1: init?.protocolVersion === 1, agentMatches: init?.agentInfo?.name === 'minimax-code', loadSessionTrue: init?.agentCapabilities?.loadSession === true }
    if (!checks.protocolIs1 || !checks.agentMatches || !checks.loadSessionTrue) throw fail('init_contract')
    let { state, observed } = await openSession()
    const baseline = new Set(observed.models.map(row => row.id))
    const rows = observed.models.filter(row => row.id.startsWith('m:minimax:'))
    rowCount = bound(rows.length); checks.hasSupportedProviderRows = rows.length > 0
    if (!rows.length) throw fail('no_supported_provider')
    for (const row of rows) advertised.add(row.id)
    let dirty = false
    for (const row of rows) {
      rowIndex++; targetModel = row.id
      if (dirty) {
        ({ state, observed } = await openSession())
        if (observed.models.length !== baseline.size || observed.models.some(choice => !baseline.has(choice.id))) throw fail('advertisement_changed')
        dirty = false
      }
      if (observed.model !== row.id) {
        phase = 'select_model'
        try { state = { ...state, ...await request('session/set_config_option', { sessionId, configId: 'model', value: row.id }) } }
        catch (error) {
          if (!(error instanceof MiniMaxConfigurationRejected) || first || control.aborted || exited) throw error
          rejected.add(row.id); dirty = true; continue
        }
      }
      phase = 'selected_state'
      observed = parseState(state)
      checks.selectedModelMatches = observed.model === row.id
      if (!checks.selectedModelMatches) throw fail('selected_model_mismatch')
      models.push({ ...row, efforts: ['default', ...observed.efforts as Effort[]] })
    }
    if (!models.length) throw fail('no_verified_configurations')
    active(); if (first) throw failure()
    completed = true
  } catch { if (!first) fail(control.aborted ? signal.aborted ? 'caller_cancel' : 'timeout' : 'stream_io') }
  finally {
    control.removeEventListener('abort', cancel)
    phase = 'stop'; ownedStop = completed && !first && !control.aborted && !exited
    try { terminate(); cleanupConfirmed = await child.waitForExit() }
    catch { fail('stop_failed', 'stop'); cleanupConfirmed = false }
    try {
      if (!cleanupConfirmed) { fail('cleanup_unconfirmed', 'cleanup'); throw new MiniMaxCatalogCleanupError(diagnostic()) }
      const results = await Promise.allSettled([child.done, completion, ...readers])
      if (control.aborted) fail(signal.aborted ? 'caller_cancel' : 'timeout')
      if (results.some(r => r.status === 'rejected')) fail('stream_io')
    } finally { buffer = ''; child.stdin?.removeListener('error', inputError) }
  }
  if (first) throw failure()
  return { models, notice: rejected.size ? `MiniMax 原生广告配置 ${rowCount} 项；已验证 ${models.length} 项；精确 reasoning 配置拒绝 ${rejected.size} 项。仅提供已验证子集，不代表整个模型不可用。` : undefined }
}
export async function discoverMiniMaxModels(backend: ProcessBackend, config: RuntimeConfig, executable: string, cwd: string, signal: AbortSignal) {
  const before = await ensureMiniMaxVerifiedAccount(config, signal)
  if (!before.principal) throw new MiniMaxAccountError(before.identity.summary)
  const models = await queryMiniMaxAcpModels(backend, config, executable, cwd, before.source, signal)
  const after = await readMiniMaxAccount(config, signal)
  if (!sameMiniMaxAccountSnapshot(before, after)) throw new MiniMaxAccountError(`MiniMax Code 账号快照后验未通过 [snapshot=${miniMaxAccountSnapshotDifference(before, after)}]；未发布目录`)
  return models
}
