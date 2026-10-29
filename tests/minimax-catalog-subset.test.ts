import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PassThrough, Writable } from 'node:stream'
import { queryMiniMaxAcpModels } from '../src/host/minimax-models.ts'
import { configureMiniMax } from '../src/host/minimax-state.mjs'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'

// Synthetic protocol peers only: never launch a CLI, import Native code, or use real credentials/network.
beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('PRIVATE_OFFLINE') })))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const a = 'm:minimax:synthetic:v:', b = 'm:minimax:synthetic:v:thinking', c = 'm:minimax:other:u', custom = 'm:custom:synthetic:u'
function state(current = c, id = 'synthetic-session') {
  const efforts = current === b ? ['max', 'ultra'] : current === a ? ['low'] : ['high']
  return { sessionId: id, modes: { currentModeId: 'default' }, configOptions: [
    { id: 'model', type: 'select', category: 'model', currentValue: current, options: [a, b, c, ...(current === custom ? [custom] : [])].map(value => ({ value, name: value })) },
    { id: 'permissionMode', type: 'select', category: '_permission', currentValue: 'auto', options: ['default', 'auto', 'bypassPermissions'].map(value => ({ value, name: value })), _meta: { 'minimax-code/scope': 'process' } },
    { id: 'thinkingEffort', type: 'select', category: 'thought_level', currentValue: efforts[0], options: efforts.map(value => ({ value, name: value })) },
  ] }
}
function fixture(options: { scenario?: string; current?: string; rejects?: string[]; code?: unknown; details?: string; controller?: AbortController; environment?: Record<string, string>; mutateEnvironment?: boolean } = {}) {
  const scenario = options.scenario ?? 'partial', requests: any[] = [], sessions = new Map<string, any>(), poisoned = new Set<string>()
  const stdout = new PassThrough(), stderr = new PassThrough(); let spawns = 0, stops = 0, count = 0, doneResolve!: (v: any) => void, finished = false, rejectedId: string | undefined
  const done = new Promise<any>(r => { doneResolve = r })
  const out = (v: any) => { if (!finished) stdout.write(JSON.stringify(v) + '\n') }
  const error = (id: string, code: unknown, details: string) => out({ jsonrpc: '2.0', id, error: { code, message: 'PRIVATE_NATIVE_MESSAGE', data: { details, token: 'PRIVATE_TOKEN', nested: { url: 'https://PRIVATE_URL', stack: 'PRIVATE_STACK' } } }, ...scenario === 'mixed-frame' ? { result: { configOptions: [] } } : {} })
  const backend: ProcessBackend = { resolveExecutable: async () => '/synthetic/mcode', spawn(spec) {
    if (options.mutateEnvironment) Object.assign(spec.env!, { TERM: 'synthetic-owned-terminal', SYNTHETIC_BACKEND_MARKER: 'owned' })
    spawns++
    const stdin = new Writable({ write(chunk, _enc, next) {
      const q = JSON.parse(String(chunk)); requests.push(q); next()
      queueMicrotask(() => {
        if (finished) return
        if (q.method === 'initialize') { if (scenario === 'wrong-phase') error(q.id, -32603, 'Invalid model reasoning'); else out({ jsonrpc: '2.0', id: q.id, result: { protocolVersion: 1, agentInfo: { name: 'minimax-code' }, agentCapabilities: { loadSession: true } } }); return }
        if (q.method === 'session/new') {
          count++
          if (count > 1 && scenario === 'fresh-timeout') return
          if (count > 1 && scenario === 'fresh-rpc-reasoning') { error(q.id, -32603, 'Invalid model reasoning'); return }
          if (count > 1 && scenario === 'fresh-json') { stdout.write('PRIVATE_NOT_JSON\n'); return }
          if (count > 1 && scenario === 'fresh-cancel') { options.controller!.abort(new Error('PRIVATE_CANCEL_REASON')); return }
          if (count > 1 && scenario === 'late-reply') { error(rejectedId!, -32603, 'Invalid model reasoning'); return }
          const id = scenario === 'reused-session' ? 'synthetic-1' : `synthetic-${count}`, data: any = state(options.current ?? c, id)
          if (count > 1 && scenario === 'fresh-extra') data.configOptions[0].options.push({ value: 'm:minimax:new:u', name: 'New' })
          if (count > 1 && scenario === 'fresh-missing') data.configOptions[0].options = data.configOptions[0].options.filter((v: any) => v.value !== a)
          if (count > 1 && scenario === 'fresh-labels-order') data.configOptions[0].options.reverse().forEach((v: any) => { v.name = 'Different label' })
          if (count > 1 && scenario === 'fresh-state') data.configOptions[1].category = 'PRIVATE_CATEGORY'
          sessions.set(id, data); out({ jsonrpc: '2.0', id: q.id, result: data }); return
        }
        if (q.method === 'session/set_config_option') {
          const data = sessions.get(q.params.sessionId)
          if (!data || poisoned.has(q.params.sessionId)) { error(q.id, -32603, 'PRIVATE_DIRTY_SESSION_REUSED'); return }
          if ((options.rejects ?? [a]).includes(q.params.value)) {
            poisoned.add(q.params.sessionId); data.configOptions[0].currentValue = 'PRIVATE_PARTIAL_MUTATION'; rejectedId = q.id
            error(scenario === 'wrong-id' ? 'PRIVATE_FOREIGN_ID' : q.id, options.code ?? -32603, options.details ?? 'Invalid model reasoning'); return
          }
          if (scenario === 'fatal-rpc' && count > 1) { error(q.id, -32602, 'PRIVATE_FATAL_RPC'); return }
          const selected = state(q.params.value, q.params.sessionId)
          if (scenario === 'late-model') selected.configOptions[0]!.currentValue = a
          if (scenario === 'late-session') selected.sessionId = 'PRIVATE_FOREIGN_SESSION'
          if (scenario === 'late-effort') selected.configOptions[2]!.currentValue = 'PRIVATE_UNADVERTISED_EFFORT'
          sessions.set(q.params.sessionId, selected); out({ jsonrpc: '2.0', id: q.id, result: selected })
        }
      })
    } })
    return { stdin, stdout, stderr, done, terminate() { stops++; if (!finished) { finished = true; stdout.end(); stderr.end(); doneResolve({ exitCode: scenario === 'exit1' ? 1 : 0, signal: null }) } }, waitForExit: async () => scenario !== 'cleanup' } as any
  } }
  const run = (timeoutMs = 1000) => queryMiniMaxAcpModels(backend, { ...DEFAULT_CONFIG, timeoutMs }, '/synthetic/mcode', '/synthetic-project', { root: '/synthetic', region: 'cn', env: options.environment ?? {} }, options.controller?.signal ?? new AbortController().signal)
  return { run, requests, spawns: () => spawns, stops: () => stops, sessions: () => count }
}
function safeFatal(error: any) {
  expect(error).toBeInstanceOf(Error)
  expect(String(error) + error.stack + JSON.stringify(error)).not.toMatch(/PRIVATE_|https:|Invalid model/)
  expect(error.cause).toBeUndefined(); expect(Object.isFrozen(error.diagnostic)).toBe(true)
  expect(globalThis.fetch).not.toHaveBeenCalled()
}

describe('MiniMax verified exact configuration subsets (synthetic)', () => {
  it('does not lend the verified source environment to a mutating process backend', async () => {
    const environment = Object.freeze({ MINIMAX_DATA_DIR: '/synthetic', MAVIS_DATA_DIR: '/synthetic', MAVIS_REGION: 'cn', MAVIS_BUILD_ENV: 'prod' })
    const result = await fixture({ environment, mutateEnvironment: true }).run()
    expect(result.models.map(value => value.id)).toEqual([b, c])
    expect(environment).toEqual({ MINIMAX_DATA_DIR: '/synthetic', MAVIS_DATA_DIR: '/synthetic', MAVIS_REGION: 'cn', MAVIS_BUILD_ENV: 'prod' })
    expect(Object.keys(environment)).not.toContain('SYNTHETIC_BACKEND_MARKER')
  })
  it('rejects one configuration, opens a clean session and retains the same-model thinking variant/max', async () => {
    const f = fixture(), result = await f.run()
    expect(result.models.map(v => v.id)).toEqual([b, c]); expect(result.models[0].efforts).toEqual(['default', 'max', 'ultra'])
    expect(result.models[1].efforts).toEqual(['default', 'high'])
    expect(result.notice).toContain('广告配置 3 项；已验证 2 项；精确 reasoning 配置拒绝 1 项')
    expect(result.notice).toContain('不代表整个模型不可用'); expect(result.notice).not.toMatch(/PRIVATE_|Invalid model|https:/)
    expect(f.sessions()).toBe(2); expect(f.spawns()).toBe(1); expect(f.stops()).toBe(1)
    const attempts = f.requests.filter(q => q.method === 'session/set_config_option')
    expect(attempts.map(q => q.params.value)).toEqual([a, b, c]); expect(attempts[0].params.sessionId).not.toBe(attempts[1].params.sessionId)
    expect(f.requests.some(q => q.method === 'session/prompt')).toBe(false)
  })
  it('uses exact current model receipt without a redundant setter or guessing efforts', async () => {
    const f = fixture({ current: a, rejects: [] }), result = await f.run()
    expect(result.models[0]).toMatchObject({ id: a, efforts: ['default', 'low'] }); expect(result.notice).toBeUndefined()
    expect(f.requests.filter(q => q.method === 'session/set_config_option').map(q => q.params.value)).toEqual([b, c])
  })
  it('does not treat order or labels as advertisement authority', async () => {
    const result = await fixture({ scenario: 'fresh-labels-order' }).run()
    expect(result.models.map(v => v.id)).toEqual([b, c]); expect(result.notice).toContain('已验证 2 项')
  })
  it('fails if every supported advertised configuration is rejected, rather than fabricating defaults', async () => {
    const f = fixture({ current: custom, rejects: [a, b, c] }), error = await f.run().catch(e => e); safeFatal(error)
    expect(error.diagnostic.reason).toBe('no_verified_configurations'); expect(error.diagnostic.rpcCode).toBe('none'); expect(error.diagnostic.nativeError).toBeUndefined()
    expect(f.sessions()).toBe(3); expect(f.requests.filter(q => q.method === 'session/set_config_option').map(q => q.params.value)).toEqual([a, b, c])
  })
  it.each([
    ['fresh-extra', 'advertisement_changed'], ['fresh-missing', 'advertisement_changed'], ['fresh-state', 'state_contract'], ['reused-session', 'session_shape'],
    ['fresh-json', 'non_json_stdout'], ['late-reply', 'unexpected_reply'], ['wrong-id', 'unexpected_reply'], ['late-model', 'selected_model_mismatch'], ['late-session', 'session_shape'], ['late-effort', 'state_contract'],
  ])('invalidates the entire subset on %s', async (scenario, reason) => {
    const error = await fixture({ scenario }).run().catch(e => e); safeFatal(error)
    expect(error.diagnostic.reason).toBe(reason); expect(error.diagnostic.rpcCode).toBe('none'); expect(error.diagnostic.nativeError).toBeUndefined()
  })
  it('rejects mixed result/error frames even after already collecting a verified tuple', async () => {
    const error = await fixture({ scenario: 'mixed-frame', current: a, rejects: [b] }).run().catch(e => e); safeFatal(error)
    expect(error.diagnostic.reason).toBe('invalid_jsonrpc'); expect(error.diagnostic.rpcCode).toBe('none'); expect(error.diagnostic.nativeError).toBeUndefined()
  })
  it('never treats the same native reasoning error in fresh session/new as a local configuration rejection', async () => {
    const error = await fixture({ scenario: 'fresh-rpc-reasoning' }).run().catch(e => e); safeFatal(error)
    expect(error.diagnostic).toMatchObject({ phase: 'session_new', reason: 'rpc_error', rpcCode: -32603 }); expect(error.diagnostic.nativeError).toBeUndefined()
  })
  it('keeps an unexpected exit fatal after successfully collecting a partial subset', async () => {
    const error = await fixture({ scenario: 'exit1' }).run().catch(e => e); safeFatal(error)
    expect(error.diagnostic).toMatchObject({ phase: 'exit', reason: 'unexpected_exit', exitCode: 1 }); expect(error.diagnostic.nativeError).toBeUndefined()
  })
  it('does not poison a later fatal RPC snapshot with the locally rejected native reason', async () => {
    const error = await fixture({ scenario: 'fatal-rpc' }).run().catch(e => e); safeFatal(error)
    expect(error.diagnostic).toMatchObject({ reason: 'rpc_error', rpcCode: -32602 }); expect(error.diagnostic.nativeError).toBeUndefined()
  })
  it.each([
    { name: 'wrong numeric code', code: -32602, details: 'Invalid model reasoning' },
    { name: 'string code', code: '-32603', details: 'Invalid model reasoning' },
    { name: 'unknown code', code: 123456, details: 'Invalid model reasoning' },
    { name: 'different parameter', code: -32603, details: 'Invalid model variant' },
    { name: 'approximate text', code: -32603, details: 'Invalid model reasoning PRIVATE_SUFFIX' },
    { name: 'generic validation', code: -32603, details: 'VALIDATION_ERROR' },
  ])('never localizes a non-exact refusal: $name', async ({ code, details }) => {
    const f = fixture({ code, details }), error = await f.run().catch(e => e); safeFatal(error)
    expect(error.diagnostic.reason).toBe('rpc_error'); expect(f.sessions()).toBe(1)
  })
  it('never localizes the same literal in a non-model pending phase', async () => {
    const error = await fixture({ scenario: 'wrong-phase' }).run().catch(e => e); safeFatal(error)
    expect(error.diagnostic).toMatchObject({ phase: 'initialize', reason: 'rpc_error', rpcCode: -32603 }); expect(error.diagnostic.nativeError).toBeUndefined()
  })
  it('retains the global cleanup gate even after a useful verified subset', async () => {
    const error = await fixture({ scenario: 'cleanup' }).run().catch(e => e); safeFatal(error)
    expect(error).toBeInstanceOf(ProcessCleanupUnconfirmedError); expect(error.diagnostic.reason).toBe('cleanup_unconfirmed'); expect(error.diagnostic.nativeError).toBeUndefined()
  })
  it('keeps caller cancellation fatal during clean-session recovery', async () => {
    const error = await fixture({ scenario: 'fresh-cancel', controller: new AbortController() }).run().catch(e => e); safeFatal(error)
    expect(error.diagnostic.reason).toBe('caller_cancel'); expect(error.diagnostic.nativeError).toBeUndefined()
  })
  it('keeps one original hard 15s deadline, not a fresh deadline per session', async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal), budgets: number[] = []
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { budgets.push(ms); return timeout(25) })
    const error = await fixture({ scenario: 'fresh-timeout' }).run(60000).catch(e => e); safeFatal(error)
    expect(budgets).toEqual([15000]); expect(error.diagnostic).toMatchObject({ phase: 'session_new', reason: 'timeout' }); expect(error.diagnostic.nativeError).toBeUndefined()
  })
})

describe('MiniMax exact-current configure no-op (synthetic)', () => {
  function peer(current = c, drift?: string) {
    let data: any = state(current); const calls: any[] = []
    return { data, calls, peer: { async request(method: string, p: any) {
      calls.push({ method, ...p })
      if (p.configId === 'model') data = state(p.value, data.sessionId)
      else data.configOptions.find((v: any) => v.id === p.configId).currentValue = p.value
      if (p.configId === 'permissionMode') {
        if (drift === 'model') data.configOptions[0].currentValue = a
        if (drift === 'effort') data.configOptions[2].currentValue = 'ultra'
        if (drift === 'mode') data.modes.currentModeId = 'plan'
      }
      return { configOptions: data.configOptions, modes: data.modes }
    } } }
  }
  it('preserves exact current max with only the required fresh Ask receipt', async () => {
    const f = peer(b); await configureMiniMax(f.peer, f.data.sessionId, f.data, { model: b, effort: 'max' })
    expect(f.calls.map(q => q.configId)).toEqual(['permissionMode']); expect(f.calls[0].value).toBe('default')
  })
  it('does not send an effort override for default', async () => {
    const f = peer(b); await configureMiniMax(f.peer, f.data.sessionId, f.data, { model: b, effort: 'default' })
    expect(f.calls.map(q => q.configId)).toEqual(['permissionMode'])
  })
  it('still sets a different variant of the same model, then validates that model effort', async () => {
    const f = peer(a); await configureMiniMax(f.peer, f.data.sessionId, f.data, { model: b, effort: 'max' })
    expect(f.calls.map(q => q.configId)).toEqual(['model', 'permissionMode']); expect(f.calls[0].value).toBe(b)
  })
  it('still sets a different supported effort and validates its receipt', async () => {
    const f = peer(b); await configureMiniMax(f.peer, f.data.sessionId, f.data, { model: b, effort: 'ultra' })
    expect(f.calls.map(q => q.configId)).toEqual(['thinkingEffort', 'permissionMode'])
  })
  it('does not inherit old effort support across a model change', async () => {
    const f = peer(b); await expect(configureMiniMax(f.peer, f.data.sessionId, f.data, { model: c, effort: 'max' })).rejects.toThrow()
    expect(f.calls.map(q => q.configId)).toEqual(['model'])
  })
  it('does not no-op an unadvertised model', async () => {
    const f = peer(); await expect(configureMiniMax(f.peer, f.data.sessionId, f.data, { model: 'm:minimax:unadvertised:u', effort: 'default' })).rejects.toThrow()
    expect(f.calls).toEqual([])
  })
  it.each(['model', 'effort', 'mode'])('still rejects fresh Ask receipt %s drift after no-op', async drift => {
    const f = peer(b, drift); await expect(configureMiniMax(f.peer, f.data.sessionId, f.data, { model: b, effort: 'max' })).rejects.toThrow()
  })
})
