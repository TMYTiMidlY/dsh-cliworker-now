import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type ServerResponse } from 'node:http'
import { PassThrough, Readable } from 'node:stream'
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseOpenCodeVersion, readOpenCodeVersion, readOpenCodeV2Metadata, openCodeV2ModelRef, OPENCODE_V2_EXECUTION_UNAVAILABLE } from '../src/host/opencode-v2.ts'
import { catalogFor, validatePreference, resolveCliExecutable } from '../src/host/adapters.ts'
import { readCliAccountBinding } from '../src/host/cli-account-binding.ts'
import { authorizedCatalog, authorizeSelection } from '../src/host/authorized-catalog.ts'
import { extendedCatalog, extendedLaunch } from '../src/host/extended-adapters.ts'
import { AccountManager } from '../src/host/accounts.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'

// Synthetic OpenCode 2.0.31 HTTP/CLI contracts only. No native CLI, DB, credentials or model.
// Private fixture directories remain in ignored .cache; this suite never deletes user files.
const nativeRace = vi.hoisted(() => ({ afterRead: undefined as undefined | ((path: string) => void), home: undefined as string | undefined }))
vi.mock('node:os', async load => { const os = await load<typeof import('node:os')>(); return { ...os, homedir: () => nativeRace.home ?? os.homedir() } })
vi.mock('node:fs/promises', async load => {
  const fs = await load<typeof import('node:fs/promises')>()
  return { ...fs, open: async (...args: Parameters<typeof fs.open>) => {
    const handle = await fs.open(...args), read = handle.read.bind(handle)
    handle.read = (async (...params: unknown[]) => { const result = await (read as Function)(...params); nativeRace.afterRead?.(String(args[0])); return result }) as typeof handle.read
    return handle
  } }
})
const stops: Array<() => Promise<void>> = []
afterEach(async () => { nativeRace.afterRead = undefined; nativeRace.home = undefined; for (const stop of stops.splice(0)) await stop(); vi.restoreAllMocks(); vi.unstubAllEnvs() })
const signal = () => new AbortController().signal
function privateRoot() { const root = mkdtempSync(join(process.cwd(), '.cache/opencode-v2-synthetic-')); chmodSync(root, 0o700); return root }
const overrides = ['OPENCODE_DB', 'OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG_CONTENT', 'OPENCODE_SERVER', 'OPENCODE_SERVER_URL', 'OPENCODE_PASSWORD', 'OPENCODE_SERVER_PASSWORD', 'OPENCODE_HOME', 'OPENCODE_DATA_DIR']
async function fixture() {
  const root = privateRoot(), project = join(root, 'project'), state = join(root, 'native-state'), registry = join(state, 'opencode/service.json')
  mkdirSync(project, { mode: 0o700 }); mkdirSync(join(state, 'opencode'), { recursive: true, mode: 0o700 })
  for (const key of overrides) vi.stubEnv(key, '')
  vi.stubEnv('XDG_STATE_HOME', state)
  const native = {
    integrations: [{ id: 'own', name: 'Synthetic', metadata: { PRIVATE_METADATA: 'PRIVATE_TOKEN' }, methods: [{ data: 'PRIVATE_METHOD' }], connections: [{ type: 'credential', id: 'synthetic-record-A', method: 'oauth', label: 'PRIVATE_ACCOUNT_LABEL' }] }] as any[],
    providers: [{ id: 'own-provider', integrationID: 'own', name: 'Synthetic provider', activation: 'auto', package: 'synthetic-package' }] as any[],
    models: [{ id: 'exact:model/#[]', modelID: 'upstream:model-id', providerID: 'own-provider', name: 'Synthetic model', variants: [{ id: 'high' }, { id: '' }, { id: 'custom variant/#' }], enabled: true }] as any[],
    agents: [{ id: 'synthetic-native-default', name: 'Synthetic', mode: 'primary', hidden: false, request: {}, permissions: [] }],
    version: '2.0.31', pid: process.pid,
  }
  const requests: Array<{ path: string; method: string; scope: string | null; authMatches: boolean }> = []
  let intercept: undefined | ((path: string, response: ServerResponse) => boolean)
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://127.0.0.1')
    requests.push({ path: url.pathname, method: req.method!, scope: url.searchParams.get('location[directory]'), authMatches: req.headers.authorization === `Basic ${Buffer.from('opencode:PRIVATE_SYNTHETIC_PASSWORD').toString('base64')}` })
    if (intercept?.(url.pathname, res)) return
    res.setHeader('content-type', 'application/json')
    if (url.pathname === '/api/info') res.end(JSON.stringify({ version: native.version, pid: native.pid, urls: [base], paths: { tmp: '/synthetic/tmp' } }))
    else if (url.pathname === '/api/integration') res.end(JSON.stringify({ location: { directory: project }, data: native.integrations }))
    else if (url.pathname === '/api/provider') res.end(JSON.stringify({ location: { directory: project }, data: native.providers }))
    else if (url.pathname === '/api/model') res.end(JSON.stringify({ location: { directory: project }, data: native.models }))
    else if (url.pathname === '/api/agent') res.end(JSON.stringify({ location: { directory: project }, data: native.agents }))
    else { res.statusCode = 500; res.end('PRIVATE_FORBIDDEN_ENDPOINT') }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as any).port}`
  stops.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const record = { version: native.version, url: base, pid: process.pid, password: 'PRIVATE_SYNTHETIC_PASSWORD' }
  const save = () => writeFileSync(registry, JSON.stringify(record), { mode: 0o600 })
  save()
  const calls: any[] = [], terminalCalls: any[] = [], output = new PassThrough()
  let finishTerminal: (v: any) => void
  const terminalDone = new Promise<any>(resolve => { finishTerminal = resolve })
  const backend: ProcessBackend = { resolveExecutable: vi.fn(async name => name), spawn(spec) {
    calls.push(spec)
    if (JSON.stringify(spec.argv) !== JSON.stringify([process.execPath, '--version'])) throw new Error('Synthetic: unexpected native invocation')
    return { stdout: Readable.from(['2.0.31\n']), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0, signal: null }), collected: {}, terminate() {}, async waitForExit() { return true } } as any
  }, async spawnTerminal(spec) { terminalCalls.push(spec); return { output, done: terminalDone, async write() {}, async resize() {}, async terminate() { output.end(); finishTerminal!({ exitCode: 0, signal: null }) } } as any } }
  const config = { ...DEFAULT_CONFIG, opencodeExecutable: process.execPath, stateDirectory: join(root, 'plugin-state') }
  const read = (options: any = {}) => readOpenCodeV2Metadata(process.execPath, { major: 2, version: '2.0.31' }, project, signal(), options)
  return { root, project, registry, record, save, native, requests, backend, config, calls, terminalCalls, read, intercept: (fn: typeof intercept) => { intercept = fn } }
}

describe('OpenCode version and explicit execution boundary', () => {
  it.each(['1.2.3', 'opencode 1.2.3\n', '2.0.31', 'opencode version 2.0.31-beta.1'])('accepts exact native semver %s', raw => expect(parseOpenCodeVersion(raw).major).toBe(raw.includes('1.2.3') ? 1 : 2))
  it.each(['', '{}', 'PRIVATE_AUTH_ERROR', '3.0.0', '2.0.31\nPRIVATE', 'version 2'])('never infers v1 from unsupported output %s', raw => expect(() => parseOpenCodeVersion(raw)).toThrow('不会回退'))
  it('rejects malformed, noncanonical and invalid UTF8 model tuple encodings', () => {
    const tuple = ['provider', 'model', null], encoded = Buffer.from(JSON.stringify(tuple)).toString('base64url')
    expect(openCodeV2ModelRef('opencode-v2:' + encoded)).toEqual({ providerID: 'provider', id: 'model' })
    for (const bad of [encoded + '=', encoded + '!junk', Buffer.from('["provider", "model", null]').toString('base64url'), Buffer.from([91, 34, 255, 34, 44, 34, 109, 34, 44, 110, 117, 108, 108, 93]).toString('base64url')]) expect(() => openCodeV2ModelRef('opencode-v2:' + bad)).toThrow()
  })
  it('preserves unconfirmed native version-process cleanup', async () => { const error = new ProcessCleanupUnconfirmedError(); await expect(readOpenCodeVersion('synthetic', async () => { throw error })).rejects.toBe(error) })
  it('version-gates old catalog and new/resumed launch before ANY private state', async () => {
    const f = await fixture(), capture = vi.fn(async () => '2.0.31'), state = join(f.root, 'must-not-exist')
    await expect(extendedCatalog('opencode', process.execPath, capture, state, f.config, signal())).rejects.toThrow(OPENCODE_V2_EXECUTION_UNAVAILABLE)
    for (const conversation of [undefined, 'ses_old_v1']) await expect(extendedLaunch('opencode', process.execPath, f.project, { cli: 'opencode', model: 'own-provider/exact', effort: 'default' }, 'plan', 'PRIVATE_PROMPT', state, f.config, conversation, capture)).rejects.toThrow(OPENCODE_V2_EXECUTION_UNAVAILABLE)
    expect(existsSync(state)).toBe(false); expect(f.requests).toHaveLength(0)
    expect(capture.mock.calls.every(call => JSON.stringify(call[0]) === JSON.stringify([process.execPath, '--version']))).toBe(true)
    await expect(extendedLaunch('opencode', process.execPath, f.project, { cli: 'opencode', model: 'own/model', effort: 'default' }, 'accept-edits', 'private', state, f.config)).rejects.toThrow('缺少原生版本核验')
  })
  it('uses official default fallback only after PATH absence, never after a manual failure', async () => {
    const root = privateRoot(), official = join(root, '.opencode/bin/opencode')
    mkdirSync(join(root, '.opencode/bin'), { recursive: true }); writeFileSync(official, 'SYNTHETIC_NOT_EXECUTED', { mode: 0o700 })
    nativeRace.home = root
    const backend = { resolveExecutable: vi.fn(async name => { if (name === 'opencode' || name === '/manual/missing') throw Object.assign(new Error('absent'), { code: 'ENOENT' }); return name }), spawn: vi.fn() } as any
    expect(await resolveCliExecutable('opencode', backend, DEFAULT_CONFIG, signal())).toBe(official)
    await expect(resolveCliExecutable('opencode', backend, { ...DEFAULT_CONFIG, opencodeExecutable: '/manual/missing' }, signal())).rejects.toThrow()
    expect(backend.resolveExecutable.mock.calls.filter((x: any) => x[0] === official)).toHaveLength(1)
  })
})

describe('OpenCode v2 native metadata is diagnostics, never credentials or execution', () => {
  it('reads exact wrapped current-source models and array variants with NO prompt/write/global APIs', async () => {
    const f = await fixture(), snapshot = await f.read()
    expect(snapshot.identity).toMatchObject({ state: 'configured', verification: 'cli' })
    expect(snapshot.identity.summary).toContain('只读纯文本通路')
    expect(snapshot.candidates.map(x => openCodeV2ModelRef(x.id))).toEqual([undefined, 'high', '', 'custom variant/#'].map(variant => ({ providerID: 'own-provider', id: 'exact:model/#[]', ...(variant !== undefined ? { variant } : {}) })))
    expect(snapshot.candidates.every(x => x.cost === 'unknown' && JSON.stringify(x.efforts) === '["default"]')).toBe(true)
    expect(JSON.stringify(snapshot)).not.toMatch(/PRIVATE_|synthetic-record|methods|headers|settings|password|accountLabel/)
    expect(f.requests.every(r => r.method === 'GET' && ['/api/info', '/api/integration', '/api/provider', '/api/model'].includes(r.path) && r.authMatches)).toBe(true)
    expect(f.requests.filter(r => r.path !== '/api/info').every(r => r.scope === f.project)).toBe(true)
    expect(readFileSync(f.registry, 'utf8')).toContain('PRIVATE_SYNTHETIC_PASSWORD') // unchanged original synthetic record
  })
  it('shares one byte budget across service attestation and all metadata responses', async () => {
    const f = await fixture()
    f.native.integrations[0].metadata = { padding: 'x'.repeat(850) }
    f.native.providers[0].name = 'y'.repeat(850)
    await expect(f.read({ maxBytes: 2000 })).rejects.toThrow('超过读取限制')
  })
  it('offers exact v2 choices for plan only while rejecting unknown saved models without executing', async () => {
    const f = await fixture(), result = await authorizedCatalog('opencode', f.backend, f.config, f.project, signal())
    expect(result.catalog).toMatchObject({ transport: 'opencode-http-v2', allowedModes: ['plan'] })
    expect(result.catalog.models).toHaveLength(4)
    expect(result.binding).toMatch(/^cli-account-v1:/)
    expect(() => validatePreference({ cli: 'opencode', model: 'saved/model', effort: 'default' }, result.catalog)).toThrow()
    await expect(authorizeSelection({ cli: 'opencode', model: 'saved/model', effort: 'default' }, f.backend, f.config, f.project, signal(), result.binding)).rejects.toThrow()
    const selected = { cli: 'opencode' as const, model: result.catalog.models[0]!.id, effort: 'default' as const }
    expect((await authorizeSelection(selected, f.backend, f.config, f.project, signal(), result.binding)).preference).toEqual(selected)
    expect(f.calls.every(x => x.argv[1] === '--version')).toBe(true)
    expect(existsSync(f.config.stateDirectory)).toBe(false)
  })
  it('invalidates metadata binding on credential switch without claiming a stable user principal', async () => {
    const f = await fixture(), first = await readCliAccountBinding('opencode', f.backend, f.config, f.project, signal())
    f.native.integrations[0].connections[0].id = 'synthetic-record-B'
    expect(await readCliAccountBinding('opencode', f.backend, f.config, f.project, signal())).not.toBe(first)
    expect((await f.read()).identity.state).toBe('configured')
  })
  it.each(['env', 'external', 'needs_auth', 'empty'])('does not authorize alternate source %s or skip to another connection', async kind => {
    const f = await fixture(), good = f.native.integrations[0].connections[0]
    f.native.integrations[0].connections = kind === 'empty' ? [] : [{ ...(kind === 'env' ? { type: 'env', name: 'OPENAI_API_KEY' } : { ...good, method: kind === 'external' ? 'external' : 'oauth', ...(kind === 'needs_auth' ? { status: { status: 'needs_auth', message: 'PRIVATE_FAILURE', url: 'https://PRIVATE' } } : {}) }), }, good]
    const snapshot = await f.read()
    expect(snapshot.candidates).toEqual([]); expect(snapshot.bindingMaterial.entries).toEqual([])
    expect(snapshot.identity.state).toBe(kind === 'empty' ? 'unconfigured' : kind === 'needs_auth' ? 'unauthenticated' : 'configured')
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE')
  })
  it('does not label an unsupported configured source logged out because another source needs auth', async () => {
    const f = await fixture()
    f.native.integrations[0].connections = [{ type: 'credential', id: 'expired-record', method: 'oauth', label: 'PRIVATE', status: { status: 'needs_auth', message: 'PRIVATE' } }]
    f.native.integrations.push({ id: 'other', name: 'Synthetic environment', methods: [], connections: [{ type: 'env', name: 'OTHER_API_KEY' }] })
    const snapshot = await f.read()
    expect(snapshot.identity.state).toBe('configured')
    expect(snapshot.candidates).toEqual([])
  })
  it.each(['provider-headers', 'provider-key', 'model-headers', 'model-endpoint', 'variant-body', 'disabled-provider', 'disabled-model', 'missing-account'])('filters unsupported route %s rather than borrow a generic account', async kind => {
    const f = await fixture()
    if (kind === 'provider-headers') f.native.providers[0].headers = { Authorization: 'PRIVATE_KEY' }
    if (kind === 'provider-key') f.native.providers[0].settings = { apiKey: 'PRIVATE_KEY' }
    if (kind === 'model-headers') f.native.models[0].headers = { Authorization: 'PRIVATE_KEY' }
    if (kind === 'model-endpoint') f.native.models[0].settings = { baseURL: 'https://PRIVATE' }
    if (kind === 'variant-body') for (const v of f.native.models[0].variants) v.body = { private: 'PRIVATE_KEY' }
    if (kind === 'disabled-provider') f.native.providers[0].activation = 'disabled'
    if (kind === 'disabled-model') f.native.models[0].enabled = false
    if (kind === 'missing-account') f.native.providers[0].integrationID = 'not-current'
    const snapshot = await f.read()
    expect(snapshot.candidates).toHaveLength(kind === 'variant-body' ? 1 : 0)
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE')
  })
  it.each(['count', 'bytes'])('caps schema-valid candidate amplification by global %s', async kind => {
    const f = await fixture(), base = f.native.models[0]
    if (kind === 'count') f.native.models = Array.from({ length: 129 }, (_, index) => ({ ...base, id: `model-${index}`, variants: Array.from({ length: 32 }, (_, i) => ({ id: `variant-${i}` })) }))
    else {
      const provider = 'P'.repeat(2048)
      f.native.providers[0].id = provider
      f.native.models = Array.from({ length: 10 }, (_, index) => ({ ...base, providerID: provider, id: 'I'.repeat(2040) + index, name: 'N'.repeat(2048), variants: Array.from({ length: 128 }, (_, i) => ({ id: `variant-${i}` })) }))
    }
    await expect(f.read()).rejects.toThrow('候选展开超过')
  })
  it.each(['account', 'provider', 'registry'])('rejects %s change during query', async kind => {
    const f = await fixture(); let integrations = 0, providers = 0
    f.intercept((path, _res) => {
      if (path === '/api/integration' && ++integrations === 2 && kind === 'account') f.native.integrations[0].connections[0].id = 'changed'
      if (path === '/api/provider' && ++providers === 2 && kind === 'provider') f.native.providers[0].activation = 'disabled'
      if (path === '/api/provider' && providers === 2 && kind === 'registry') { f.record.password = 'CHANGED_SYNTHETIC'; f.save() }
      return false
    })
    await expect(f.read()).rejects.toThrow(/改变|变化/)
  })
  it.each(['variants-object', 'duplicate', 'foreign-project', 'malformed', 'native-auth-error'])('rejects %s schema without raw diagnostics', async kind => {
    const f = await fixture()
    if (kind === 'variants-object') f.native.models[0].variants = { high: {} }
    if (kind === 'duplicate') f.native.models.push({ ...f.native.models[0] })
    f.intercept((path, res) => {
      if (path !== '/api/model' || !['foreign-project', 'malformed', 'native-auth-error'].includes(kind)) return false
      res.setHeader('content-type', 'application/json')
      if (kind === 'native-auth-error') res.statusCode = 401
      res.end(kind === 'foreign-project' ? JSON.stringify({ location: { directory: '/PRIVATE_OTHER_PROJECT' }, data: f.native.models }) : 'PRIVATE_AUTH_DIAGNOSTIC')
      return true
    })
    await expect(f.read()).rejects.not.toThrow('PRIVATE')
  })
})

describe('OpenCode existing service trust and lifecycle', () => {
  it('missing service is unavailable, not logged out, and offers ONLY a native terminal', async () => {
    const f = await fixture(); vi.stubEnv('XDG_STATE_HOME', join(f.root, 'not-created'))
    const manager = new AccountManager(f.backend, f.config)
    try {
      const value = await manager.status('opencode', f.project, signal())
      expect(value).toMatchObject({ installed: true, state: 'unavailable', actions: [{ id: 'manage' }] })
      expect(value.summary).toContain('不表示账号已登出')
      expect(existsSync(f.config.stateDirectory)).toBe(false); expect(f.requests).toHaveLength(0)
    } finally { await manager.close() }
  })
  it('native manage terminal has no v1 DB/XDG snapshot or injected auth command', async () => {
    const f = await fixture(), manager = new AccountManager(f.backend, f.config)
    try {
      for (const action of ['login', 'logout'] as const) await expect(manager.start('synthetic-parent', 'opencode', action, f.project, signal())).rejects.toThrow('自行操作')
      expect(f.terminalCalls).toHaveLength(0)
      await manager.start('synthetic-parent', 'opencode', 'manage', f.project, signal())
      expect(f.terminalCalls).toHaveLength(1)
      expect(f.terminalCalls[0]).toMatchObject({ argv: [process.execPath], cwd: f.project, env: {} })
      expect(existsSync(f.config.stateDirectory)).toBe(false)
    } finally { await manager.close() }
  })
  it.each(['permissions', 'hardlink', 'symlink', 'large'])('rejects unsafe registry %s without repairing or deleting it', async kind => {
    const f = await fixture()
    if (kind === 'permissions') chmodSync(f.registry, 0o644)
    if (kind === 'hardlink') linkSync(f.registry, f.registry + '.link')
    if (kind === 'symlink') { renameSync(f.registry, f.registry + '.original'); symlinkSync(f.registry + '.original', f.registry) }
    if (kind === 'large') writeFileSync(f.registry, ' '.repeat(65537))
    await expect(f.read()).rejects.toThrow()
    expect(f.requests).toHaveLength(0)
    if (kind === 'permissions') expect(statSync(f.registry).mode & 0o777).toBe(0o644)
  })
  it('rejects path replacement during file read', async () => {
    const f = await fixture(); nativeRace.afterRead = path => {
      if (path !== f.registry) return
      nativeRace.afterRead = undefined
      renameSync(f.registry, f.registry + '.old'); f.save()
    }
    await expect(f.read()).rejects.toThrow(); expect(f.requests).toHaveLength(0)
  })
  it.each(['http://localhost:1234', 'http://127.0.0.2:1234', 'https://127.0.0.1:1234', 'http://user:pass@127.0.0.1:1234', 'http://127.0.0.1:1234/path', 'http://127.0.0.1:1234/?secret=PRIVATE'])('rejects untrusted origin %s before sending authentication', async url => {
    const f = await fixture(); f.record.url = url; f.save()
    await expect(f.read()).rejects.not.toThrow('PRIVATE'); expect(f.requests).toHaveLength(0)
  })
  it.each(['registry-version', 'info-version', 'info-pid', 'executable'])('rejects mismatched service %s', async kind => {
    const f = await fixture()
    if (kind === 'registry-version') { f.record.version = '1.9.0'; f.save() }
    if (kind === 'info-version') f.native.version = '2.0.30'
    if (kind === 'info-pid') f.native.pid++
    await expect(kind === 'executable' ? readOpenCodeV2Metadata('/bin/true', { major: 2, version: '2.0.31' }, f.project, signal()) : f.read()).rejects.toThrow()
    if (['registry-version', 'executable'].includes(kind)) expect(f.requests).toHaveLength(0)
  })
  it('rejects redirects, oversized data, unsupported overrides and platforms without leaking payloads', async () => {
    const f = await fixture()
    f.intercept((_path, res) => { res.statusCode = 302; res.setHeader('location', 'https://PRIVATE_INVALID'); res.end('PRIVATE'); return true })
    await expect(f.read()).rejects.not.toThrow('PRIVATE'); expect(f.requests).toHaveLength(1)
    f.intercept(undefined)
    await expect(f.read({ maxBytes: 5 })).rejects.toThrow('超过')
    await expect(f.read({ platform: 'win32' })).rejects.toThrow('Linux')
    for (const key of ['OPENCODE_DB', 'OPENCODE_SERVER', 'OPENCODE_CONFIG_CONTENT']) await expect(f.read({ env: { XDG_STATE_HOME: join(f.root, 'native-state'), [key]: 'PRIVATE_OVERRIDE' } })).rejects.not.toThrow('PRIVATE')
  })
  it.each(['cancel', 'timeout'])('ends native HTTP read on %s, never touching sessions or stopping the shared server', async kind => {
    const f = await fixture(), controller = new AbortController()
    f.intercept((_path, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); if (kind === 'cancel') queueMicrotask(() => controller.abort()); return true })
    await expect(readOpenCodeV2Metadata(process.execPath, { major: 2, version: '2.0.31' }, f.project, controller.signal, { timeoutMs: 30 })).rejects.toThrow()
    expect(f.requests).toHaveLength(1); expect(f.requests[0].path).toBe('/api/info')
  })
})
