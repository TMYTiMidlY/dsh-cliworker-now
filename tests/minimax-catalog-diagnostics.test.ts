import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PassThrough, Writable } from 'node:stream'
import { queryMiniMaxAcpModels } from '../src/host/minimax-models.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'

// Synthetic wire/process peers only. No executable, credentials or network are used.
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No network in synthetic metadata tests') })) })
afterEach(() => { vi.unstubAllGlobals() })
const a = 'm:minimax:PRIVATE_MODEL_A:u', b = 'm:minimax:PRIVATE_MODEL_B:v:'
const data = () => ({ sessionId: 'PRIVATE_SESSION', modes: { currentModeId: 'default' }, configOptions: [
  { id: 'model', type: 'select', category: 'model', currentValue: a, options: [{ value: a, name: 'PRIVATE_LABEL_A' }, { value: b, name: 'PRIVATE_LABEL_B' }] },
  { id: 'permissionMode', type: 'select', category: '_permission', currentValue: 'auto', options: ['default', 'auto', 'bypassPermissions'].map(value => ({ value, name: value })), _meta: { 'minimax-code/scope': 'process' } },
  { id: 'thinkingEffort', type: 'select', category: 'thought_level', currentValue: 'low', options: [{ value: 'low', name: 'Low' }] },
], _meta: { token: 'PRIVATE_TOKEN', email: 'PRIVATE_EMAIL', url: 'https://PRIVATE_NATIVE_ENDPOINT', sourcePath: '/PRIVATE_SOURCE', originalStack: 'PRIVATE_ORIGINAL_STACK' } })
function peer(scenario = 'success', rpcAt = 'initialize', rpcCode: unknown = -32603, controller?: AbortController, nativeData?: unknown) {
  const requests: any[] = [], state: any = data(); let stops = 0, spawns = 0, finished = false
  const stdout = new PassThrough(), stderr = new PassThrough()
  let settle!: (value: any) => void
  const done = new Promise<any>(resolve => { settle = resolve })
  const finish = (code: any = 0, signal: any = null) => { if (finished) return; finished = true; stdout.end(); stderr.end(); settle({ exitCode: code, signal }) }
  const backend: ProcessBackend = { resolveExecutable: async () => '/PRIVATE_EXECUTABLE', spawn() {
    spawns++
    if (scenario === 'spawn') throw new Error('PRIVATE_SPAWN_ERROR https://PRIVATE_URL')
    const stdin = new Writable({ write(chunk, _encoding, next) {
      const q = JSON.parse(String(chunk)); requests.push(q); next()
      queueMicrotask(() => {
        if (scenario === 'cancel' && q.method === rpcAt) { controller!.abort(new Error('PRIVATE_CANCEL_REASON', { cause: new Error('PRIVATE_CANCEL_CAUSE') })); return }
        if (scenario === 'timeout' && q.method === rpcAt) return
        if (scenario === 'early') { finish(rpcCode); return }
        if (scenario === 'non-json') { stdout.write('PRIVATE_NOT_JSON https://PRIVATE_URL\n'); return }
        if (scenario === 'invalid-jsonrpc') { stdout.write(JSON.stringify({ jsonrpc: 'PRIVATE_VERSION', id: q.id, token: 'PRIVATE_TOKEN' }) + '\n'); return }
        if (scenario === 'unmatched') { stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 'PRIVATE_WRONG_REQUEST', result: {} }) + '\n'); return }
        if (scenario === 'missing-result') { stdout.write(JSON.stringify({ jsonrpc: '2.0', id: q.id, token: 'PRIVATE_TOKEN' }) + '\n'); return }
        if (scenario === 'partial') { stdout.write('{PRIVATE_PARTIAL'); finish(); return }
        if (scenario === 'line') { stdout.write('PRIVATE_' + 'x'.repeat(100)); return }
        if (scenario === 'bytes') { stderr.write('PRIVATE_' + 'x'.repeat(100)); return }
        if (['rpc', 'rpc-cleanup', 'rpc-absent'].includes(scenario) && q.method === rpcAt) { stdout.write(JSON.stringify({ jsonrpc: '2.0', id: q.id, error: { code: rpcCode, message: 'PRIVATE_RPC_ERROR https://PRIVATE_URL', ...scenario === 'rpc-absent' ? {} : { data: nativeData === undefined ? { token: 'PRIVATE_TOKEN', headers: 'PRIVATE_HEADER', cause: 'PRIVATE_CAUSE', stack: 'PRIVATE_STACK' } : nativeData } } }) + '\n'); return }
        let result: any
        if (q.method === 'initialize') result = { protocolVersion: scenario === 'version' ? 9 : 1, agentInfo: { name: scenario === 'agent' ? 'PRIVATE_AGENT' : 'minimax-code' }, agentCapabilities: { loadSession: scenario !== 'load' } }
        else {
          if (q.method === 'session/new') {
            if (scenario === 'session') state.sessionId = ''
            if (scenario === 'no-model') state.configOptions = state.configOptions.filter((v: any) => v.id !== 'model')
            if (scenario === 'no-permission') state.configOptions = state.configOptions.filter((v: any) => v.id !== 'permissionMode')
            if (scenario === 'contract') state.modes.currentModeId = 'PRIVATE_MODE'
            if (scenario === 'no-provider') { state.configOptions[0].currentValue = 'm:custom:PRIVATE_CUSTOM:u'; state.configOptions[0].options = [{ value: 'm:custom:PRIVATE_CUSTOM:u', name: 'PRIVATE_CUSTOM_LABEL' }] }
          }
          if (q.method === 'session/set_config_option') {
            state.configOptions[0].currentValue = scenario === 'mismatch' ? a : q.params.value
            if (q.params.value === b) state.configOptions[2] = { id: 'thinkingEffort', type: 'select', category: 'thought_level', currentValue: 'max', options: [{ value: 'max', name: 'Max' }] }
            if (scenario === 'selected-missing') state.configOptions = state.configOptions.filter((v: any) => v.id !== 'permissionMode')
          }
          result = state
        }
        stdout.write(JSON.stringify({ jsonrpc: '2.0', id: q.id, result }) + '\n')
      })
    } })
    if (scenario === 'stdin') (stdin as any).write = (_line: string, callback: (e: Error) => void) => { callback(new Error('PRIVATE_STDIN_ERROR')); return false }
    return { stdin, stdout, stderr, done,
      terminate() { stops++; finish(scenario === 'exit1' ? 1 : scenario === 'exit-other' ? 987654321 : scenario === 'exit143' ? 143 : 0, scenario === 'signal' ? 'PRIVATE_SIGNAL' : scenario === 'sigterm' ? 'SIGTERM' : null); if (scenario === 'stop') throw new Error('PRIVATE_STOP_ERROR') },
      waitForExit: async () => !['cleanup', 'rpc-cleanup'].includes(scenario),
    } as any
  } }
  const config = { ...DEFAULT_CONFIG, timeoutMs: scenario === 'timeout' ? 20 : 1000, maxLineBytes: scenario === 'line' ? 64 : DEFAULT_CONFIG.maxLineBytes, maxRunBytes: scenario === 'bytes' ? 64 : DEFAULT_CONFIG.maxRunBytes }
  const run = () => queryMiniMaxAcpModels(backend, config, '/PRIVATE_EXECUTABLE', '/PRIVATE_CWD', { root: '/PRIVATE_SOURCE', region: 'cn', env: {} }, controller?.signal ?? new AbortController().signal)
  return { run, requests, stops: () => stops, spawns: () => spawns }
}
function safe(error: any) {
  expect(error).toBeInstanceOf(Error)
  expect(error.cause).toBeUndefined()
  expect(String(error) + error.stack + JSON.stringify(error)).not.toMatch(/PRIVATE_|https:|Bearer|sourcePath|originalStack/)
  expect(Object.isFrozen(error.diagnostic)).toBe(true)
  expect(Object.isFrozen(error.diagnostic.checks)).toBe(true)
  expect(error.diagnostic.rowIndex).toBeGreaterThanOrEqual(0); expect(error.diagnostic.rowIndex).toBeLessThanOrEqual(1024)
  expect(error.diagnostic.rowCount).toBeGreaterThanOrEqual(0); expect(error.diagnostic.rowCount).toBeLessThanOrEqual(1024)
  expect(Object.values(error.diagnostic.checks).every(value => typeof value === 'boolean')).toBe(true)
  expect(globalThis.fetch).not.toHaveBeenCalled()
}

describe('MiniMax catalog safe stage diagnostics (synthetic)', () => {
  it.each([
    ['spawn', 'spawn', 'spawn_failed'], ['stdin', 'initialize', 'stdin_io'],
    ['version', 'initialize', 'init_contract'], ['agent', 'initialize', 'init_contract'], ['load', 'initialize', 'init_contract'],
    ['session', 'session_new', 'session_shape'], ['no-model', 'initial_state', 'model_control_missing'], ['no-permission', 'initial_state', 'permission_control_missing'],
    ['contract', 'initial_state', 'state_contract'], ['no-provider', 'initial_state', 'no_supported_provider'],
    ['mismatch', 'selected_state', 'selected_model_mismatch'], ['selected-missing', 'selected_state', 'permission_control_missing'],
    ['non-json', 'initialize', 'non_json_stdout'], ['invalid-jsonrpc', 'initialize', 'invalid_jsonrpc'], ['unmatched', 'initialize', 'unexpected_reply'],
    ['missing-result', 'initialize', 'invalid_jsonrpc'], ['partial', 'initialize', 'partial_line'], ['line', 'initialize', 'line_limit'], ['bytes', 'initialize', 'byte_limit'],
    ['exit1', 'exit', 'unexpected_exit'], ['exit-other', 'exit', 'unexpected_exit'], ['signal', 'exit', 'unexpected_exit'], ['stop', 'stop', 'stop_failed'], ['cleanup', 'cleanup', 'cleanup_unconfirmed'],
  ])('projects %s as %s/%s without native data', async (scenario, phase, reason) => {
    const p = peer(scenario), error = await p.run().catch(e => e); safe(error)
    expect(error.diagnostic).toMatchObject({ phase, reason })
    expect(error.message).toContain(`[${phase}/${reason}]`)
    expect(p.spawns()).toBe(1); expect(p.requests.some(v => v.method === 'session/prompt')).toBe(false)
    if (scenario !== 'spawn') expect(p.stops()).toBeGreaterThan(0)
    if (['stop', 'cleanup'].includes(scenario)) expect(error).toBeInstanceOf(ProcessCleanupUnconfirmedError)
  })
  it.each(['initialize', 'session/new', 'session/set_config_option'])('attributes RPC failure during %s', async method => {
    const p = peer('rpc', method), error = await p.run().catch(e => e); safe(error)
    expect(error.diagnostic).toMatchObject({ phase: method === 'initialize' ? 'initialize' : method === 'session/new' ? 'session_new' : 'select_model', reason: 'rpc_error', rpcCode: -32603, cleanupConfirmed: true })
  })
  it.each([-32700, -32600, -32601, -32602, -32603, -32000, -32800, 123456789, 'PRIVATE_CODE'])('allowlists only fixed RPC code %s', async code => {
    const p = peer('rpc', 'initialize', code), error = await p.run().catch(e => e); safe(error)
    expect(error.diagnostic.rpcCode).toBe(typeof code === 'number' && code < 0 ? code : 'other')
    expect(error.message).not.toContain('123456789')
  })
  it.each(['initialize', 'session/new', 'session/set_config_option'])('keeps first timeout phase during %s', async method => {
    const p = peer('timeout', method), error = await p.run().catch(e => e); safe(error)
    expect(error.diagnostic.reason).toBe('timeout')
    expect(error.diagnostic.phase).toBe(method === 'initialize' ? 'initialize' : method === 'session/new' ? 'session_new' : 'select_model')
    expect(error.diagnostic.protocolComplete).toBe(false); expect(error.diagnostic.cleanupConfirmed).toBe(true)
  })
  it('keeps cancellation cause private while still confirming cleanup', async () => {
    const p = peer('cancel', 'initialize', -32603, new AbortController()), error = await p.run().catch(e => e); safe(error)
    expect(error.diagnostic).toMatchObject({ phase: 'initialize', reason: 'caller_cancel', ownedStopRequested: true, cleanupConfirmed: true })
  })
  it.each([0, 127])('distinguishes early exit %i from a complete catalog', async code => {
    const p = peer('early', 'initialize', code), error = await p.run().catch(e => e); safe(error)
    expect(error.diagnostic).toMatchObject({ phase: 'initialize', reason: 'early_exit', exitCode: code, exitBeforeComplete: true, protocolComplete: false })
  })
  it('preserves first RPC failure when cleanup is also unconfirmed', async () => {
    const p = peer('rpc-cleanup'), error = await p.run().catch(e => e); safe(error)
    expect(error).toBeInstanceOf(ProcessCleanupUnconfirmedError)
    expect(error.diagnostic).toMatchObject({ phase: 'initialize', reason: 'rpc_error', rpcCode: -32603, cleanupConfirmed: false })
    expect(error.message).toContain('cleanup did not reach quiescence')
  })
  it('projects init and sparse state as booleans only', async () => {
    const init = await peer('agent').run().catch(e => e), sparse = await peer('no-permission').run().catch(e => e)
    safe(init); safe(sparse)
    expect(init.diagnostic.checks).toEqual({ protocolIs1: true, agentMatches: false, loadSessionTrue: true })
    expect(sparse.diagnostic.checks).toMatchObject({ hasModel: true, hasPermission: false, hasEffort: true, currentModelAdvertised: true, modeSupported: true })
  })
  it.each([
    ['Invalid model reasoning', 'param_reasoning'], ['Invalid model variant', 'param_variant'],
    ['Invalid model reasoning/variant conflict', 'param_reasoning_variant_conflict'], ['Invalid model reasoning/effort conflict', 'param_reasoning_effort_conflict'],
    ['Invalid model thinking.effort', 'param_effort'], ['Invalid model context_limit', 'param_context'],
    ['Session not found', 'session_not_found'], ['provider_id and model_id are required', 'selection_required'],
    ['Runtime does not expose Model Application.', 'model_application_missing'], ['Desktop model provider service is not configured', 'model_provider_unavailable'],
  ])('maps exact native details %s to only %s', async (literal, expected) => {
    const p = peer('rpc', 'session/set_config_option', -32603, undefined, { details: literal }), error = await p.run().catch(e => e)
    if (expected === 'param_reasoning') {
      expect(error.models.map((v: any) => v.id)).toEqual([a]); expect(error.notice).toContain('已验证 1 项')
      expect(error.notice).not.toMatch(/PRIVATE_|Invalid model|https:/); return
    }
    safe(error)
    expect(error.diagnostic).toMatchObject({ phase: 'select_model', reason: 'rpc_error', nativeError: expected, envelopeKind: 'details', cleanupConfirmed: true })
    expect(error.message).toContain(`native_error=${expected} envelope_kind=details`); expect(error.message).not.toContain(literal)
  })
  it.each([
    { name: 'specific code', value: { code: 'SESSION_NOT_FOUND', message: 'PRIVATE_MESSAGE' }, expected: 'session_not_found' },
    { name: 'specific key', value: { key: 'MODEL_PROVIDER_UNAVAILABLE', marker: 'PRIVATE_KEY' }, expected: 'model_provider_unavailable' },
    { name: 'exact message plus generic code', value: { code: 'VALIDATION_ERROR', message: 'Invalid model thinking.effort' }, expected: 'param_effort' },
    { name: 'exact message only', value: { message: 'Invalid model variant', token: 'PRIVATE_TOKEN' }, expected: 'param_variant' },
    { name: 'consistent known fields', value: { code: 'SESSION_NOT_FOUND', key: 'SESSION_NOT_FOUND', message: 'Session not found' }, expected: 'session_not_found' },
    { name: 'conflicting known fields', value: { code: 'SESSION_NOT_FOUND', message: 'Invalid model variant' }, expected: 'native_error_other' },
    { name: 'generic validation cannot infer', value: { code: 'VALIDATION_ERROR', message: 'PRIVATE_INVALID' }, expected: 'native_error_other' },
    { name: 'unknown nested fields', value: { error: { message: 'Invalid model variant' }, metadata: { token: 'PRIVATE_TOKEN', url: 'https://PRIVATE_URL' } }, expected: 'native_error_other' },
    { name: 'nested details not recursive', value: { details: { message: 'Invalid model variant', secret: 'PRIVATE_SECRET' } }, expected: 'native_error_other' },
    { name: 'unknown codes not emitted', value: { code: 'PRIVATE_CODE', key: 'PRIVATE_KEY', message: 'PRIVATE_MESSAGE' }, expected: 'native_error_other' },
  ])('projects structured envelope $name without raw fields', async ({ value, expected }) => {
    const error = await peer('rpc', 'session/set_config_option', -32603, undefined, value).run().catch(e => e); safe(error)
    expect(error.diagnostic).toMatchObject({ nativeError: expected, envelopeKind: 'structured' })
  })
  it.each(['Invalid model variant PRIVATE_SUFFIX', 'prefix Invalid model variant', ' Invalid model variant', 'Invalid model variant\nPRIVATE_STACK'])('never substring/trim matches native details case %#', async details => {
    const error = await peer('rpc', 'session/set_config_option', -32603, undefined, { details, message: 'Session not found' }).run().catch(e => e); safe(error)
    expect(error.diagnostic).toMatchObject({ nativeError: 'native_error_other', envelopeKind: 'details' })
  })
  it.each([null, 'PRIVATE_DATA', [{ message: 'Invalid model variant', token: 'PRIVATE_TOKEN' }]])('treats unsupported envelope shape %# as absent', async value => {
    const error = await peer('rpc', 'session/set_config_option', -32603, undefined, value).run().catch(e => e); safe(error)
    expect(error.diagnostic).toMatchObject({ nativeError: 'native_error_other', envelopeKind: 'absent' })
  })
  it('handles an omitted Native data field without adding raw fallback', async () => {
    const error = await peer('rpc-absent', 'session/set_config_option').run().catch(e => e); safe(error)
    expect(error.diagnostic).toMatchObject({ nativeError: 'native_error_other', envelopeKind: 'absent' })
  })
  it.each([['initialize', -32603], ['session/new', -32603], ['session/set_config_option', -32602], ['session/set_config_option', '-32603'], ['session/set_config_option', 123456789]] as const)('does not extract outside select/-32603: %s/%s', async (method, code) => {
    const error = await peer('rpc', method, code, undefined, { details: 'Invalid model variant', token: 'PRIVATE_TOKEN' }).run().catch(e => e); safe(error)
    expect(error.diagnostic.nativeError).toBeUndefined(); expect(error.diagnostic.envelopeKind).toBeUndefined()
    expect(error.message).not.toContain('native_error='); expect(error.message).not.toContain('envelope_kind=')
  })
  it.each(['timeout', 'cancel'])('never classifies dormant data during %s', async scenario => {
    const error = await peer(scenario, 'session/set_config_option', -32603, new AbortController(), { details: 'Invalid model variant' }).run().catch(e => e); safe(error)
    expect(error.diagnostic.reason).toBe(scenario === 'timeout' ? 'timeout' : 'caller_cancel')
    expect(error.diagnostic.nativeError).toBeUndefined(); expect(error.message).not.toContain('native_error=')
  })
  it('keeps the select native classification frozen across unconfirmed cleanup', async () => {
    const error = await peer('rpc-cleanup', 'session/set_config_option', -32603, undefined, { details: 'Invalid model context_limit', token: 'PRIVATE_TOKEN' }).run().catch(e => e); safe(error)
    expect(error).toBeInstanceOf(ProcessCleanupUnconfirmedError)
    expect(error.diagnostic).toMatchObject({ phase: 'select_model', reason: 'rpc_error', nativeError: 'param_context', envelopeKind: 'details', cleanupConfirmed: false })
    expect(error.message).toContain('native_error=param_context envelope_kind=details')
  })
  it.each(['success', 'sigterm', 'exit143'])('retains successful exact models/max effort on %s', async scenario => {
    const p = peer(scenario), { models } = await p.run()
    expect(models.map(v => v.id)).toEqual([a, b]); expect(models[1].efforts).toEqual(['default', 'max'])
    expect(p.spawns()).toBe(1); expect(p.requests.map(v => v.method)).toEqual(['initialize', 'session/new', 'session/set_config_option'])
    expect(p.requests.some(v => v.method === 'session/prompt')).toBe(false)
  })
})
