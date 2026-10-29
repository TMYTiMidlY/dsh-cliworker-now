import { afterEach, describe, expect, it, vi } from 'vitest'
import { PassThrough, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { createNativeIO } from '../src/host/native-transport.mjs'
import { projectCursorStatus, cursorExecutable, assertCursorNativeRoute, readCursorAccount } from '../src/host/cursor-accounts.ts'
import { queryCursorAcpModels, discoverCursorModels } from '../src/host/cursor-models.ts'
import { cursorState } from '../src/host/cursor-state.mjs'
import { cursorAcpArgv, runNativeCursor } from '../src/host/native-cursor.mjs'
import { resolveCliName } from '../src/host/routing.ts'
import { executableFor, workerArguments, catalogFor } from '../src/host/adapters.ts'
import { readCliAccountBinding } from '../src/host/cli-account-binding.ts'
import { AccountManager } from '../src/host/accounts.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'
import { CLI_IDS, CLI_LABELS } from '../src/shared/types.ts'
import { nativeAttachmentCapability } from '../src/host/native-attachments.mjs'
import { nativeHarnessToolCapability } from '../src/host/native-harness-injection.mjs'
import { supportsNativeSteering } from '../src/shared/running-message.ts'
import { bridgedFeatureSupport } from '../src/shared/conversation-features.ts'
import { transportFor } from '../src/host/native-worker.ts'

// Synthetic Cursor status and ACP v1 metadata. No real CLI, credentials, network or model.
const opaque = 'grok-4.7[context=256k,reasoning_effort=high,fast=true]'
const status = (userId = 101) => ({ status: 'authenticated', isAuthenticated: true,
  hasAccessToken: true, hasRefreshToken: true, userInfo: { email: 'test@example.invalid', userId,
    firstName: 'PRIVATE_NAME', createdAt: 'PRIVATE_DATE', accessToken: 'PRIVATE_ACCESS' },
  token: 'PRIVATE_TOKEN', endpoint: 'PRIVATE_ENDPOINT' })
const state = () => ({ sessionId: 'synthetic-cursor-session',
  modes: { currentModeId: 'ask', availableModes: ['agent', 'plan', 'ask'].map(id => ({ id, name: id })) },
  configOptions: [
    { id: 'model', type: 'select', currentValue: 'default[]', options: [
      { value: 'default[]', name: 'Auto' }, { value: opaque, name: 'Grok synthetic' }, { value: 'kimi-k3[reasoning=max]', name: 'Kimi synthetic' }] },
    { id: 'mode', type: 'select', currentValue: 'ask', options: ['agent', 'plan', 'ask'].map(value => ({ value, name: value })) },
  ] })
const signal = () => new AbortController().signal
const config = { ...DEFAULT_CONFIG, cursorExecutable: '/synthetic/cursor-agent', timeoutMs: 1000 }
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

function backendFixture(options: { scenario?: string; statuses?: unknown[]; cleanup?: boolean } = {}) {
  const calls: any[] = [], frames: any[] = []
  let statusIndex = 0, stopped = 0, waits = 0
  const backend: ProcessBackend = {
    resolveExecutable: vi.fn(async name => name),
    spawn(spec) {
      calls.push(spec)
      const stdout = new PassThrough(), stderr = new PassThrough()
      let resolveDone: (v: any) => void
      const done = new Promise<any>(resolve => { resolveDone = resolve })
      const end = (code = 0, sig: string | null = null) => { stdout.end(); stderr.end(); resolveDone!({ exitCode: code, signal: sig }) }
      const stdin = new Writable({ write(chunk, _encoding, next) {
        const request = JSON.parse(String(chunk)); frames.push(request)
        queueMicrotask(() => {
          if (!request.method) return
          if (options.scenario === 'hang') return
          if (options.scenario === 'malformed') { stdout.write('not-json\n'); return }
          if (options.scenario === 'oversized') { stdout.write('x'.repeat(config.maxLineBytes + 1)); return }
          if (options.scenario === 'partial') { stdout.write('{'); end(); return }
          if (options.scenario === 'early-exit') { end(1); return }
          if (options.scenario === 'rpc-error') { stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -1, message: 'PRIVATE_ERROR' } }) + '\n'); return }
          if (options.scenario === 'request-permission') stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 'permission', method: 'session/request_permission', params: {} }) + '\n')
          const initialized = { protocolVersion: options.scenario === 'version' ? 2 : 1, agentCapabilities: { loadSession: true }, authMethods: [{ id: 'cursor_login', name: 'Cursor login' }] }
          const data = state()
          if (options.scenario === 'missing-mode') data.configOptions = data.configOptions.slice(0, 1)
          stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: request.method === 'initialize' ? initialized : data }) + '\n')
        })
        next()
      } })
      if (spec.argv.includes('status')) queueMicrotask(() => {
        stdout.write(JSON.stringify(options.statuses?.[Math.min(statusIndex++, (options.statuses?.length ?? 1) - 1)] ?? status()))
        end()
      })
      return { stdin, stdout, stderr, done,
        terminate: () => { stopped++; end(options.scenario === 'exit1' ? 1 : options.scenario === 'exit143' ? 143 : 0,
          options.scenario === 'bad-signal' ? 'SIGSEGV' : options.scenario === 'sigterm' ? 'SIGTERM' : null) },
        waitForExit: async () => { waits++; return options.cleanup !== false },
      } as any
    },
  }
  return { backend, calls, frames, stopped: () => stopped, waits: () => waits }
}

describe('Cursor independent routing, configuration and status', () => {
  it.each(['cursor', 'cursor-agent', 'cursor agent', 'cursor CLI'])('resolves %s without generic agent', name => {
    expect(resolveCliName(name)).toMatchObject({ status: 'resolved', cli: 'cursor' })
    expect(resolveCliName('agent').status).toBe('unknown')
  })
  it('uses the stable CLI path and fails closed for Windows IDE or generic entries', () => {
    expect(CLI_IDS).toContain('cursor'); expect(CLI_LABELS.cursor).toBe('Cursor Agent')
    expect(cursorExecutable(undefined, 'linux', '/synthetic')).toBe('/synthetic/.local/bin/cursor-agent')
    expect(executableFor('cursor', config)).toBe('/synthetic/cursor-agent')
    expect(cursorExecutable('C:\\bin\\cursor-agent.cmd', 'win32')).toBe('C:\\bin\\cursor-agent.cmd')
    for (const path of [undefined, 'cursor', 'C:\\Cursor.exe', 'C:\\agent.exe']) expect(() => cursorExecutable(path, 'win32')).toThrow()
    expect(transportFor('cursor')).toBe('cursor-acp-v1')
    expect(workerArguments('/synthetic/cursor-agent', '/project', { cli: 'cursor', model: opaque, effort: 'default' }, 'plan', 'text', 1000, undefined, true)).toEqual(['/synthetic/cursor-agent', 'acp'])
    expect(() => workerArguments('/synthetic/cursor-agent', '/project', { cli: 'cursor', model: opaque, effort: 'high' }, 'plan', 'text', 1000, undefined, true)).toThrow('默认')
  })
  it('projects only email and private stable principal, not arbitrary identity or credentials', () => {
    const projection = projectCursorStatus(status())
    expect(projection.identity).toMatchObject({ state: 'authenticated', verification: 'cli', accountLabel: 'test@example.invalid' })
    expect(JSON.stringify(projection)).not.toMatch(/PRIVATE_|synthetic-user|createdAt|firstName|endpoint|accessToken/)
    expect(projection.principal).toMatch(/^[a-f0-9]{64}$/)
    expect(projectCursorStatus({ ...status(), userInfo: { ...status().userInfo, email: '<bad>@example.invalid' } }).identity.accountLabel).toBeUndefined()
  })
  it.each([101, 2147483647])('accepts native positive int32 userId %s without exposing it', userId => {
    const projected = projectCursorStatus(status(userId))
    expect(projected.identity.state).toBe('authenticated')
    expect(projected.principal).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(projected)).not.toContain('userId')
    expect(projectCursorStatus(status(userId)).principal).toBe(projected.principal)
    expect(projectCursorStatus(status(userId === 101 ? 202 : 101)).principal).not.toBe(projected.principal)
  })
  it.each([0, -1, 1.5, 2147483648, Number.MAX_SAFE_INTEGER, NaN, Infinity, '101', undefined, null])('does not coerce invalid native userId %s', userId => {
    const projected = projectCursorStatus({ ...status(), userInfo: { ...status().userInfo, userId } })
    expect(projected.identity.state).toBe('configured')
    expect(projected.principal).toBeUndefined()
  })
  it('never calls stored tokens remote entitlement or missing identity logged out', () => {
    expect(projectCursorStatus({ ...status(), userInfo: undefined }).identity).toMatchObject({ state: 'configured', verification: 'local' })
    expect(projectCursorStatus({ ...status(), userInfo: undefined }).principal).toBeUndefined()
    expect(projectCursorStatus({ status: 'unauthenticated', isAuthenticated: false, hasAccessToken: false, hasRefreshToken: false }).identity.state).toBe('unconfigured')
    expect(() => projectCursorStatus({ status: 'authenticated' })).toThrow('格式')
  })
  it.each(['CURSOR_API_KEY', 'CURSOR_API_ENDPOINT'])('rejects %s without exposing its value', async name => {
    vi.stubEnv(name, 'PRIVATE_ROUTE')
    expect(() => assertCursorNativeRoute()).toThrow('暂未支持')
    expect(() => assertCursorNativeRoute({ [name]: ' ' })).toThrow('暂未支持')
    const f = backendFixture()
    await expect(readCursorAccount(f.backend, config, config.cursorExecutable, '/project', signal())).rejects.not.toThrow('PRIVATE_ROUTE')
    expect(f.calls).toHaveLength(0)
  })
  it('uses native status and exposes no raw metadata through AccountManager', async () => {
    const f = backendFixture()
    const manager = new AccountManager(f.backend, config)
    // AccountManager validates a real project directory, but never invokes a real CLI here.
    const result = await manager.status('cursor', process.cwd(), signal())
    expect(result).toMatchObject({ cli: 'cursor', installed: true, state: 'authenticated' })
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|synthetic-user/)
    await manager.close()
  })
  it('binds identity across token rotation but rejects logout and changes identity across account switches', async () => {
    const f = backendFixture({ statuses: [status(101), status(101), status(202), { status: 'unauthenticated', isAuthenticated: false, hasAccessToken: false, hasRefreshToken: false }] })
    const binding = () => readCliAccountBinding('cursor', f.backend, config, '/project', signal())
    const first = await binding()
    expect(await binding()).toBe(first)
    expect(await binding()).not.toBe(first)
    await expect(binding()).rejects.toThrow('身份无法确认')
  })
})

describe('Cursor zero-prompt ACP catalog with lifecycle safety', () => {
  it.each(['exit1', 'bad-signal'])('rejects complete metadata followed by unexpected %s even after owned terminate', async scenario => {
    const f = backendFixture({ scenario })
    await expect(queryCursorAcpModels(f.backend, config, config.cursorExecutable, '/project', signal())).rejects.toThrow()
    expect(f.waits()).toBe(1)
  })
  it.each(['sigterm', 'exit143'])('accepts complete metadata with proven owned %s termination', async scenario => {
    const f = backendFixture({ scenario })
    expect(await queryCursorAcpModels(f.backend, config, config.cursorExecutable, '/project', signal())).toHaveLength(3)
  })
  it('keeps exact parameterized IDs and only default effort, never sends prompts or deletes histories', async () => {
    const f = backendFixture()
    const catalog = await catalogFor('cursor', f.backend, config, '/project', signal())
    expect(catalog.models.map(m => m.id)).toEqual(['default[]', opaque, 'kimi-k3[reasoning=max]'])
    expect(catalog.models.every(m => JSON.stringify(m.efforts) === '["default"]')).toBe(true)
    expect(f.frames.map(f => f.method)).toEqual(['initialize', 'session/new'])
    expect(f.frames[1].params).toEqual({ cwd: '/project', mcpServers: [] })
    expect(f.stopped()).toBe(3); expect(f.waits()).toBe(3)
  })
  it('rejects a changed account after the metadata child has fully exited', async () => {
    const f = backendFixture({ statuses: [status(101), status(202)] })
    await expect(discoverCursorModels(f.backend, config, config.cursorExecutable, '/project', signal())).rejects.toThrow('已变更')
    expect(f.waits()).toBe(3)
    expect(f.frames.some(f => f.method === 'session/prompt')).toBe(false)
  })
  it.each(['malformed', 'oversized', 'partial', 'early-exit', 'rpc-error', 'version', 'missing-mode'])('fails safely for %s metadata', async scenario => {
    const f = backendFixture({ scenario })
    await expect(queryCursorAcpModels(f.backend, config, config.cursorExecutable, '/project', signal())).rejects.not.toThrow('PRIVATE_ERROR')
    expect(f.waits()).toBe(1)
  })
  it('refuses unsupported client requests, does not grant permission, and still never prompts', async () => {
    const f = backendFixture({ scenario: 'request-permission' })
    await queryCursorAcpModels(f.backend, config, config.cursorExecutable, '/project', signal())
    expect(f.frames.filter(x => x.id === 'permission').every(x => x.error?.code === -32601)).toBe(true)
    expect(f.frames.some(x => x.method === 'session/prompt')).toBe(false)
  })
  it('retains cleanup failure as a blocker', async () => {
    const f = backendFixture({ cleanup: false })
    await expect(queryCursorAcpModels(f.backend, config, config.cursorExecutable, '/project', signal())).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
  })
  it('bounds hanging metadata by its own timeout, not only user cancellation', async () => {
    const f = backendFixture({ scenario: 'hang' })
    await expect(queryCursorAcpModels(f.backend, { ...config, timeoutMs: 20 }, config.cursorExecutable, '/project', signal())).rejects.toThrow()
    expect(f.waits()).toBe(1)
  })
  it('cancels hanging metadata and waits for range exit', async () => {
    const f = backendFixture({ scenario: 'hang' }), controller = new AbortController()
    const pending = queryCursorAcpModels(f.backend, config, config.cursorExecutable, '/project', controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(f.waits()).toBe(1)
  })
  it.each(['duplicate', 'object-value', 'missing-current', 'unknown-mode'])('rejects unknown model selection schema %s', kind => {
    const data: any = state()
    if (kind === 'duplicate') data.configOptions.push(data.configOptions[0])
    if (kind === 'object-value') data.configOptions[0].options[0].value = { value: 'default[]' }
    if (kind === 'missing-current') delete data.configOptions[0].currentValue
    if (kind === 'unknown-mode') data.configOptions[1].options.push({ value: 'yolo', name: 'Yolo' })
    expect(() => cursorState(data)).toThrow()
  })
})

async function runtimeFixture(scenario = 'success', continuation = false, mode = 'plan') {
  const data: any = state(), calls: any[] = [], events: any[] = [], sends: any[] = []
  const controller = new AbortController()
  let receive: (v: any) => Promise<void>, terminal: any, closed = false
  const params = { cli: 'cursor', argv: ['/synthetic/cursor-agent', 'acp'], project: '/project', prompt: 'SYNTHETIC PROMPT', preference: { model: opaque, effort: 'default' }, mode, timeoutMs: 500,
    ...(continuation ? { conversationId: data.sessionId } : {}) }
  const peer = {
    async request(method: string, input: any) {
      calls.push({ method, params: input })
      if (method === 'initialize') return { protocolVersion: scenario === 'version' ? 2 : 1, agentCapabilities: { loadSession: scenario !== 'no-resume' } }
      if (method === 'session/new' || method === 'session/load') {
        if (scenario === 'session-error') throw new Error('Synthetic session error')
        if (scenario === 'missing-mode') data.configOptions.pop()
        if (scenario === 'wrong-session') return { ...data, sessionId: 'different' }
        if (continuation) await receive({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: data.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'OLD HISTORY' } } } })
        return structuredClone(data)
      }
      if (method === 'session/set_config_option') {
        const item = data.configOptions.find((x: any) => x.id === input.configId)
        item.currentValue = scenario === `unconfirmed-${input.configId}` ? 'wrong' : input.value
        return { configOptions: structuredClone(data.configOptions) }
      }
      if (method === 'session/prompt') {
        if (scenario === 'bad-envelope') await receive({ method: 'session/update' })
        if (scenario === 'permission') await receive({ jsonrpc: '2.0', method: 'session/request_permission', id: 'permission', params: { sessionId: data.sessionId, options: [{ kind: 'allow_once', optionId: 'allow' }, { kind: 'reject_once', optionId: 'reject' }] } })
        if (scenario === 'unknown-request') await receive({ jsonrpc: '2.0', method: 'fs/read_text_file', id: 'unknown', params: { sessionId: data.sessionId } })
        if (scenario === 'changed-mode') await receive({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: data.sessionId, update: { sessionUpdate: 'config_option_update', configOptions: [{ id: 'mode', currentValue: 'agent' }] } } })
        if (scenario !== 'empty') await receive({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: data.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'HELLO' } } } })
        if (scenario === 'cancel') controller.abort()
        return { stopReason: scenario === 'missing-terminal' ? undefined : scenario === 'cancel' ? 'cancelled' : 'end_turn' }
      }
      throw new Error('Synthetic unrecognized request')
    },
    send: async (value: any) => { sends.push(value) }, end: vi.fn(),
    close: async () => { closed = true; if (scenario === 'cleanup') throw new Error('Synthetic cleanup failure') },
  }
  const io: any = { signal: controller.signal, openStdio: async (_argv: any, options: any) => { receive = options.onMessage; return peer }, native: vi.fn(), session: vi.fn(), event: (v: any) => events.push(v), result: (...values: any[]) => { terminal = values } }
  let error: any
  try { await runNativeCursor(params, io) } catch (e) { error = e }
  return { calls, events, sends, terminal, closed, error }
}

describe('Cursor dedicated ACP runner (synthetic peer; not native acceptance)', () => {
  it.each(['plan', 'accept-edits'])('confirms exact model and scalar %s mode before any prompt', async mode => {
    const f = await runtimeFixture('success', false, mode)
    expect(f.error).toBeUndefined(); expect(f.terminal).toEqual(['SUCCESS', 'HELLO', undefined, 'run'])
    expect(f.calls.filter(c => c.method === 'session/set_config_option').map(c => c.params)).toEqual([
      { sessionId: 'synthetic-cursor-session', configId: 'model', value: opaque },
      { sessionId: 'synthetic-cursor-session', configId: 'mode', value: mode === 'plan' ? 'plan' : 'agent' },
    ])
    expect(f.calls.at(-1).method).toBe('session/prompt'); expect(f.closed).toBe(true)
  })
  it('loads only the exact native session and excludes replayed history', async () => {
    const f = await runtimeFixture('success', true)
    expect(f.calls.find(c => c.method === 'session/load').params.sessionId).toBe('synthetic-cursor-session')
    expect(f.calls.some(c => c.method === 'session/new')).toBe(false)
    expect(f.terminal[1]).toBe('HELLO')
    expect(JSON.stringify(f.events)).not.toContain('OLD HISTORY')
  })
  it.each(['version', 'session-error', 'missing-mode', 'unconfirmed-model', 'unconfirmed-mode', 'no-resume', 'wrong-session'])('does not prompt when %s', async scenario => {
    const f = await runtimeFixture(scenario, scenario === 'no-resume' || scenario === 'wrong-session')
    expect(f.error).toBeDefined(); expect(f.calls.some(c => c.method === 'session/prompt')).toBe(false); expect(f.closed).toBe(true)
  })
  it('denies permission rather than sending --force or using the MCP approval path', async () => {
    const f = await runtimeFixture('permission')
    expect(f.sends.find(s => s.id === 'permission').result.outcome).toEqual({ outcome: 'selected', optionId: 'reject' })
    expect(f.terminal[0]).toBe('ERROR'); expect(f.closed).toBe(true)
  })
  it('fails unknown native client requests instead of continuing to end_turn success', async () => {
    const f = await runtimeFixture('unknown-request')
    expect(f.sends.find(s => s.id === 'unknown').error).toMatchObject({ code: -32601 })
    expect(f.terminal[0]).toBe('ERROR'); expect(f.closed).toBe(true)
  })
  it.each(['cancel', 'changed-mode'])('sends native cancel for %s and closes owned peer', async scenario => {
    const f = await runtimeFixture(scenario)
    expect(f.sends.some(s => s.method === 'session/cancel')).toBe(true)
    expect(f.terminal[0]).toBe('ERROR'); expect(f.closed).toBe(true)
  })
  it.each(['missing-terminal', 'empty', 'bad-envelope', 'cleanup'])('does not claim success on %s', async scenario => {
    const f = await runtimeFixture(scenario)
    expect(f.error || f.terminal[0] !== 'SUCCESS').toBeTruthy()
    expect(f.closed).toBe(true)
  })
  it.each(['success', 'cancel', 'malformed', 'rpc-error', 'nonzero'])('owns a real synthetic subprocess through %s and confirms exit', async scenario => {
    const controller = new AbortController(), frames: any[] = [], pids: number[] = []
    const params = { cli: 'cursor', project: process.cwd(), argv: ['/synthetic/cursor-agent', 'acp'], prompt: 'SYNTHETIC',
      preference: { model: 'kimi-k3[reasoning=max]', effort: 'default' }, mode: 'plan', timeoutMs: 1000,
      maxLineBytes: 1024 * 1024, maxRunBytes: 4 * 1024 * 1024, env: { CURSOR_SYNTHETIC_SCENARIO: scenario } }
    const io = createNativeIO(params, (line: string) => {
      const frame = JSON.parse(line); frames.push(frame)
      if (scenario === 'cancel' && frame.event?.kind === 'assistant') controller.abort()
    }, controller.signal)
    const open = io.openStdio.bind(io)
    io.openStdio = async (_argv: string[], options: any) => {
      const peer = await open([process.execPath, fileURLToPath(new URL('./fixtures/cursor-acp.mjs', import.meta.url)), 'acp'], options)
      pids.push(peer.process.pid)
      return peer
    }
    let error: unknown
    try { await runNativeCursor(params, io) } catch (e) { error = e }
    await io.close(error)
    expect(frames.at(-1).status).toBe(scenario === 'success' ? 'SUCCESS' : 'ERROR')
    expect(JSON.stringify(frames.filter(f => f.type === 'result'))).not.toContain('SYNTHETIC_PRIVATE_AUTH')
    expect(pids).toHaveLength(1)
    for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow()
  })
  it('closes unverified capability paths and rejects bypass inputs', () => {
    const basic = { argv: ['/synthetic/cursor-agent', 'acp'], preference: { effort: 'default' } }
    expect(nativeAttachmentCapability('cursor')).toBe(false)
    expect(nativeHarnessToolCapability('cursor').transport).toBe(false)
    expect(supportsNativeSteering('cursor')).toBe(false)
    expect(bridgedFeatureSupport({ preference: { cli: 'cursor', model: opaque, effort: 'default' }, transport: 'cursor-acp-v1' }).fork.supported).toBe(false)
    for (const extra of [{ attachments: [{}] }, { harnessTools: {} }, { forkSource: {} }, { preference: { effort: 'high' } }, { argv: ['cursor', '--force', 'acp'] }]) expect(() => cursorAcpArgv({ ...basic, ...extra })).toThrow()
  })
})
