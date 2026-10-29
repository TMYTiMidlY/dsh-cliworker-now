import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, linkSync, chmodSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { PassThrough, Writable } from 'node:stream'
import { minimaxDataRoot, minimaxSource, readMiniMaxAccount, readMiniMaxBindingMaterial, minimaxExecutable, assertMiniMaxRoute } from '../src/host/minimax-accounts.ts'
import { minimaxState, configureMiniMax, validMiniMaxModel } from '../src/host/minimax-state.mjs'
import { queryMiniMaxAcpModels, discoverMiniMaxModels } from '../src/host/minimax-models.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'
import { minimaxAcpArgv, runNativeMiniMax } from '../src/host/native-minimax.mjs'
import { resolveCliName } from '../src/host/routing.ts'
import { catalogFor, executableFor, workerArguments } from '../src/host/adapters.ts'
import { transportFor } from '../src/host/native-worker.ts'
import { nativeAttachmentCapability } from '../src/host/native-attachments.mjs'
import { nativeHarnessToolCapability } from '../src/host/native-harness-injection.mjs'
import { bridgedFeatureSupport } from '../src/shared/conversation-features.ts'
import { supportsNativeSteering } from '../src/shared/running-message.ts'

const fileRace = vi.hoisted(() => ({ afterRead: undefined as undefined | (() => void) }))
vi.mock('node:fs/promises', async original => {
  const real = await original<typeof import('node:fs/promises')>()
  return { ...real, open: async (...args: Parameters<typeof real.open>) => {
    const handle = await real.open(...args)
    if (String(args[0]).endsWith('/auth.json') && fileRace.afterRead) {
      const read = handle.read.bind(handle)
      handle.read = (async (...readArgs: any[]) => {
        const result = await (read as any)(...readArgs)
        const change = fileRace.afterRead; fileRace.afterRead = undefined; change?.()
        return result
      }) as typeof handle.read
    }
    return handle
  } }
})
// Entire file uses explicitly synthetic files/process peers; never a real CLI, account or network.
const hash = (s: string, encoding: 'hex' | 'base64url' = 'hex') => createHash('sha256').update(s).digest(encoding)
const signal = () => new AbortController().signal
const modelA = 'm:minimax:MiniMax-M3.1-Flash:u', modelB = 'm:minimax:model%2Fwith%3Acolon:v:reasoning'
const state = () => ({ sessionId: 'minimax-synthetic', modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }] }, configOptions: [
  { id: 'model', category: 'model', type: 'select', currentValue: modelA, options: [{ value: modelA, name: 'M3.1 synthetic' }, { value: modelB, name: 'Synthetic variant' }] },
  { id: 'permissionMode', category: '_permission', type: 'select', currentValue: 'auto', options: ['default', 'auto', 'bypassPermissions'].map(value => ({ value, name: value })), _meta: { 'minimax-code/scope': 'process' } },
  { id: 'thinkingEffort', category: 'thought_level', type: 'select', currentValue: 'low', options: ['low', 'high'].map(value => ({ value, name: value })) },
] })
const config = { ...DEFAULT_CONFIG, minimaxExecutable: '/synthetic/mcode', timeoutMs: 200, maxRunBytes: 4 * 1024 * 1024 }
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('PRIVATE_SYNTHETIC_OFFLINE') })) })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); fileRace.afterRead = undefined })
function fixture(options: { region?: string; subject?: boolean; cache?: string; status?: string; expires?: number; token?: Record<string, any>; currentState?: Record<string, any> } = {}) {
  const root = mkdtempSync(resolve('.cache/minimax-account-test-')), region = options.region ?? 'cn'
  const directory = join(root, `auth/prod/${region}/mcode-public`)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  // Keep fixture ancestry private exactly as the native source requires.
  const source = { schemaVersion: 2, status: options.status ?? 'authenticated', storeKind: 'file', clientId: 'mcode-public', audience: 'agent-backend', scopes: ['agent.default'], generation: 2, buildEnv: 'prod', region, expiresAtMs: options.expires ?? Date.now() + 600000, ...options.currentState }
  const token: Record<string, any> = { schemaVersion: 1, accessToken: 'PRIVATE_SYNTHETIC_ACCESS', refreshToken: 'PRIVATE_SYNTHETIC_REFRESH', tokenType: 'Bearer', clientId: 'mcode-public', audience: 'agent-backend', scopes: ['agent.default'], generation: 2, expiresAtMs: source.expiresAtMs, ...(options.subject === false ? {} : { subject: 'synthetic-user' }), ...options.token }
  const key = `com.minimax.mcode.oauth.prod.${region}\0${hash(join(root, 'auth') + '\0mcode-public', 'base64url')}`
  const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value), { mode: 0o600 })
  write(join(directory, 'auth-state.json'), source)
  write(join(directory, 'auth.json'), { schemaVersion: 1, records: { [key]: token } })
  const cache = options.cache ?? (options.subject === false ? undefined : 'current')
  if (cache) {
    const dir = join(root, `cli-auth/prod/${region}`); mkdirSync(dir, { recursive: true, mode: 0o700 })
    write(join(dir, 'account-identity.json'), { version: 1, status: 'verified', region, buildEnv: 'prod', tokenFingerprint: `sha256:${hash(cache === 'current' ? token.accessToken : 'old-token')}`, realUserID: 'synthetic-real-user', updatedAtMs: Date.now(), userEmail: 'PRIVATE_EMAIL' })
  }
  return { root, directory, source, token, key, write, config: { ...config, minimaxHome: root } }
}
function backendFixture(scenario = 'success', action?: () => void) {
  const frames: any[] = [], calls: any[] = [], data: any = state(); let exits = 0
  if (scenario === 'empty-variant') data.configOptions[0].options[1].value = 'm:minimax:synthetic:v:'
  if (scenario === 'custom-model') data.configOptions[0].options.push({ value: 'm:custom_provider%3Aother:model:u', name: 'PRIVATE_CUSTOM_LABEL' })
  const backend: ProcessBackend = { resolveExecutable: async name => name,
    spawn(spec) {
      calls.push(spec)
      const stdout = new PassThrough(), stderr = new PassThrough(); let doneResolve: (v: any) => void
      const done = new Promise<any>(r => { doneResolve = r })
      const finish = (exitCode = 0, signal: string | null = null) => { stdout.end(); stderr.end(); doneResolve!({ exitCode, signal }) }
      const stdin = new Writable({ write(chunk, _encoding, next) {
        const q = JSON.parse(String(chunk)); frames.push(q)
        queueMicrotask(() => {
          if (scenario === 'hang') return
          if (scenario === 'malformed') { stdout.write('bad-json\n'); return }
          if (scenario === 'oversized') { stdout.write('x'.repeat(config.maxLineBytes + 1)); return }
          if (scenario === 'partial') { stdout.write('{'); finish(); return }
          if (scenario === 'error' || scenario === 'login') { stdout.write(JSON.stringify({ jsonrpc: '2.0', id: q.id, error: { code: -32000, message: scenario === 'login' ? 'Run `mcode login` and try again.' : 'PRIVATE_ERROR' } }) + '\n'); return }
          if (scenario === 'reasoning-reject' && q.method === 'session/set_config_option' && q.params.configId === 'model') {
            action?.(); stdout.write(JSON.stringify({ jsonrpc: '2.0', id: q.id, error: { code: -32603, message: 'PRIVATE_NATIVE_ERROR', data: { details: 'Invalid model reasoning', token: 'PRIVATE_TOKEN' } } }) + '\n'); return
          }
          let result: any
          if (q.method === 'initialize') result = { protocolVersion: scenario === 'version' ? 2 : 1, agentInfo: { name: scenario === 'wrong-agent' ? 'other-agent' : 'minimax-code' }, agentCapabilities: { loadSession: true } }
          else {
            if (q.method === 'session/set_config_option') {
              data.configOptions.find((v: any) => v.id === q.params.configId).currentValue = q.params.value
              if (q.params.configId === 'model' && q.params.value === modelB) data.configOptions[2] = { id: 'thinkingEffort', category: 'thought_level', type: 'select', currentValue: 'max', options: [{ value: 'max', name: 'Max' }] }
              action?.()
            }
            result = data
          }
          stdout.write(JSON.stringify({ jsonrpc: '2.0', id: q.id, result }) + '\n')
        }); next()
      } })
      return { stdin, stdout, stderr, done, terminate() { exits++; finish(scenario === 'exit1' ? 1 : scenario === 'exit143' ? 143 : 0, scenario === 'bad-signal' ? 'SIGSEGV' : scenario === 'sigterm' ? 'SIGTERM' : null) }, waitForExit: async () => scenario !== 'cleanup' } as any
    } }
  return { backend, frames, calls, exits: () => exits }
}

describe('MiniMax independent routing and own account (synthetic)', () => {
  it.each(['minimax', 'minimax code', 'mmx', 'mcode'])('routes %s independently', name => {
    expect(resolveCliName(name)).toMatchObject({ status: 'resolved', cli: 'minimax' })
    expect(resolveCliName('mimo')).toMatchObject({ cli: 'mimo' })
    expect(transportFor('minimax')).toBe('minimax-acp-v1')
    expect(executableFor('minimax', config)).toBe('/synthetic/mcode')
    expect(minimaxExecutable(undefined, 'linux', '/synthetic')).toBe('/synthetic/.minimax-code/bin/mcode')
    expect(() => minimaxExecutable(undefined, 'win32')).toThrow('显式')
    expect(minimaxExecutable('C:\\bin\\mcode.cmd', 'win32')).toBe('C:\\bin\\mcode.cmd')
  })
  it('keeps single explicit source and native environment precedence', async () => {
    vi.stubEnv('MINIMAX_DATA_DIR', '/synthetic/first'); vi.stubEnv('MAVIS_DATA_DIR', '/synthetic/second')
    expect(minimaxDataRoot()).toBe('/synthetic/first'); expect(minimaxDataRoot({ minimaxHome: '/synthetic/explicit' })).toBe('/synthetic/explicit')
    vi.stubEnv('MINIMAX_DATA_DIR', undefined); expect(minimaxDataRoot()).toBe('/synthetic/second')
    vi.stubEnv('MINIMAX_DATA_DIR', '   '); expect(minimaxDataRoot()).toBe('/synthetic/second')
    vi.stubEnv('MAVIS_REGION', '  '); expect(() => assertMiniMaxRoute()).not.toThrow()
    expect(() => minimaxDataRoot({ minimaxHome: 'relative' })).toThrow()
    const f = fixture({ region: 'en' }); expect((await minimaxSource(f.config, signal())).region).toBe('en')
  })
  it('resolves only native region preference and rejects competing account namespaces', async () => {
    const f = fixture(); mkdirSync(join(f.root, 'auth/prod/en/mcode-public'), { recursive: true, mode: 0o700 })
    f.write(join(f.root, 'auth/prod/en/mcode-public/auth-state.json'), { ...f.source, region: 'en' })
    await expect(minimaxSource(f.config, signal())).rejects.toThrow('多个区域')
    mkdirSync(join(f.root, 'preferences'), { mode: 0o700 }); f.write(join(f.root, 'preferences/mcode-region.json'), { version: 1, regions: { prod: 'en' } })
    expect((await minimaxSource(f.config, signal())).region).toBe('en')
    vi.stubEnv('MAVIS_REGION', 'cn'); expect((await minimaxSource(f.config, signal())).region).toBe('cn')
  })
  it('native region fallback ignores anonymous and inactive foreign state files', async () => {
    const anonymous = fixture({ region: 'en', status: 'anonymous' })
    expect((await minimaxSource(anonymous.config, signal())).region).toBe('cn')
    const f = fixture({ region: 'en' }), cn = join(f.root, 'auth/prod/cn/mcode-public')
    mkdirSync(cn, { recursive: true, mode: 0o700 }); f.write(join(cn, 'auth-state.json'), { ...f.source, region: 'cn', status: 'anonymous' })
    expect((await minimaxSource(f.config, signal())).region).toBe('en')
  })
  it.each(['MAVIS_BUILD_ENV', 'MCODE_OAUTH_TOKEN_ENDPOINT', 'MAVIS_REGION'])('refuses unknown route %s safely', key => {
    expect(() => assertMiniMaxRoute({ [key]: 'PRIVATE_ROUTE' })).toThrow()
    try { assertMiniMaxRoute({ [key]: 'PRIVATE_ROUTE' }) } catch(e) { expect(String(e)).not.toContain('PRIVATE_ROUTE') }
  })
  it('binds stable principal across token rotation, not generation or token hash', async () => {
    const f = fixture(), first = await readMiniMaxBindingMaterial(f.config, signal())
    expect((await readMiniMaxAccount(f.config, signal())).identity.state).toBe('authenticated')
    f.write(join(f.directory, 'auth.json'), { schemaVersion: 1, records: { [f.key]: { ...f.token, generation: 3, accessToken: 'PRIVATE_ROTATED' } } })
    f.write(join(f.directory, 'auth-state.json'), { ...f.source, generation: 3 })
    f.write(join(f.root, 'cli-auth/prod/cn/account-identity.json'), { version: 1, status: 'verified', region: 'cn', buildEnv: 'prod', tokenFingerprint: `sha256:${hash('PRIVATE_ROTATED')}`, realUserID: 'synthetic-real-user', updatedAtMs: Date.now() })
    expect(await readMiniMaxBindingMaterial(f.config, signal())).toEqual(first)
    expect(JSON.stringify(first)).not.toMatch(/PRIVATE_|synthetic-user|generation/)
  })
  it.each(['current', 'old'])('uses only exact current verified cache %s', async cache => {
    const f = fixture({ subject: false, cache })
    const account = await readMiniMaxAccount(f.config, signal())
    expect(account.identity.state).toBe(cache === 'current' ? 'authenticated' : 'configured')
    expect(!!account.principal).toBe(cache === 'current')
    expect(JSON.stringify(account.identity)).not.toMatch(/PRIVATE_|realUserID/)
  })
  it('does not use stale cache or provider config as auth proof', async () => {
    const root = mkdtempSync(resolve('.cache/minimax-empty-test-'))
    writeFileSync(join(root, 'config.yaml'), 'provider:\n  minimax:\n    type: oauth\n', { mode: 0o600 })
    const account = await readMiniMaxAccount({ minimaxHome: root }, signal())
    expect(account.identity.state).toBe('unconfigured')
    const f = backendFixture(); await expect(discoverMiniMaxModels(f.backend, { ...config, minimaxHome: root }, config.minimaxExecutable, '/project', signal())).rejects.toThrow('需要登录')
    expect(f.frames).toHaveLength(0)
  })
  it.each(['https://agent.minimaxi.com', 'https://agent.minimax.io', 'https://agent.minimax.cn'])('admits native managed config on %s only through existing OAuth checks', async origin => {
    for (const authMode of [undefined, 'managed-login']) {
      const f = fixture(), path = join(f.root, 'config.yaml')
      f.write(path, { defaultProvider: 'minimax', defaultModel: 'minimax/synthetic-model', provider: { minimax: { npm: '@ai-sdk/anthropic', options: { apiKey: 'sk-xxx', baseURL: origin + '/anthropic', authMode } } } })
      const authPath = join(f.directory, 'auth.json'), before = readFileSync(authPath)
      const account = await readMiniMaxAccount(f.config, signal())
      expect(account.identity.state).toBe('authenticated')
      expect((await readMiniMaxBindingMaterial(f.config, signal())).entries[0].principal.kind).toBe('oauth')
      const b = backendFixture()
      expect((await discoverMiniMaxModels(b.backend, f.config, config.minimaxExecutable, '/project', signal())).models).toHaveLength(2)
      expect(b.frames.some(frame => frame.method === 'session/prompt')).toBe(false)
      expect(JSON.stringify(account)).not.toMatch(/PRIVATE_|sk-xxx|https:\/\//)
      expect(readFileSync(authPath)).toEqual(before)
    }
  })
  it('does not authenticate missing OAuth from a managed placeholder or start metadata', async () => {
    const root = mkdtempSync(resolve('.cache/minimax-placeholder-test-'))
    writeFileSync(join(root, 'config.yaml'), JSON.stringify({ provider: { minimax: { options: { apiKey: 'sk-xxx', baseURL: 'https://agent.minimax.io/anthropic' } } } }), { mode: 0o600 })
    const ownConfig = { ...config, minimaxHome: root }, b = backendFixture()
    expect((await readMiniMaxAccount(ownConfig, signal())).identity.state).toBe('unconfigured')
    await expect(discoverMiniMaxModels(b.backend, ownConfig, config.minimaxExecutable, '/project', signal())).rejects.toThrow('需要登录')
    expect(b.calls).toHaveLength(0)
  })
  it.each([{ subject: false }, { expires: Date.now() + 30000 }, { token: { scopes: [] } }])('preserves stable identity, expiry and scope gates with managed placeholder %j', async options => {
    const f = fixture(options), b = backendFixture()
    f.write(join(f.root, 'config.yaml'), { provider: { minimax: { options: { apiKey: 'sk-xxx', baseURL: 'https://agent.minimax.cn/anthropic' } } } })
    await expect(discoverMiniMaxModels(b.backend, f.config, config.minimaxExecutable, '/project', signal())).rejects.not.toThrow('PRIVATE_')
    expect(b.calls).toHaveLength(0)
  })
  it('preserves region, source and managed config ABA snapshots independently of placeholder', async () => {
    const f = fixture(), path = join(f.root, 'config.yaml')
    const first = { provider: { minimax: { options: { apiKey: 'sk-xxx', baseURL: 'https://agent.minimax.io/anthropic' } } } }
    f.write(path, first)
    const before = await readMiniMaxBindingMaterial(f.config, signal())
    f.write(path, { provider: { minimax: { options: { apiKey: 'sk-xxx', baseURL: 'https://agent.minimax.cn/anthropic' } } } })
    const otherManaged = await readMiniMaxBindingMaterial(f.config, signal())
    expect(otherManaged.entries[0].principal).toEqual(before.entries[0].principal)
    expect(otherManaged.entries[0].route).not.toEqual(before.entries[0].route)
    f.write(path, first)
    const restored = await readMiniMaxBindingMaterial(f.config, signal())
    expect(restored).toEqual(before)
    vi.stubEnv('MAVIS_REGION', 'en')
    await expect(readMiniMaxBindingMaterial(f.config, signal())).rejects.toThrow('需要登录')
    vi.stubEnv('MAVIS_REGION', 'cn')
    expect(await readMiniMaxBindingMaterial(f.config, signal())).toEqual(restored)
    let changed = false
    const b = backendFixture('success', () => {
      if (!changed) { changed = true; f.write(path, { provider: { minimax: { options: { authMode: 'api-key', apiKey: 'PRIVATE_REAL_KEY' } } } }); f.write(path, first) }
    })
    await expect(discoverMiniMaxModels(b.backend, f.config, config.minimaxExecutable, '/project', signal())).rejects.toThrow('后验未通过 [snapshot=')
    expect(await readMiniMaxBindingMaterial(f.config, signal())).toEqual(before)
  })
  it.each(['anonymous', 'authorizing', 'refreshing', 'logging_out', 'logout_pending', 'expired', 'scope_upgrade_required', 'error'])('does not resurrect %s from stored credentials', async status => {
    const f = fixture({ status }); expect((await readMiniMaxAccount(f.config, signal())).principal).toBeUndefined()
    await expect(readMiniMaxBindingMaterial(f.config, signal())).rejects.toThrow()
  })
  it.each([{ minimaxModelSource: 'minimax_api_key' }, { defaultModel: 'custom_provider:other/model' }, { provider: { minimax: { options: { authMode: 'api-key', apiKey: 'PRIVATE_API' } } } }, { provider: { minimax: { options: { baseURL: 'https://PRIVATE_ENDPOINT' } } } }])('does not let retained OAuth authorize a different configured route %j', async value => {
    const f = fixture(); f.write(join(f.root, 'config.yaml'), value)
    await expect(readMiniMaxBindingMaterial(f.config, signal())).rejects.not.toThrow('PRIVATE_')
  })
  it.each([
    { provider: { minimax: { models: { synthetic: { headers: { Authorization: 'PRIVATE_HEADER' } } } } } },
    { agents: { default: { model: { provider: 'minimax', model_id: 'synthetic', api_key: 'PRIVATE_KEY' } } } },
    { agents: { default: { model: { provider: 'minimax', model_id: 'synthetic', base_url: 'https://PRIVATE_ENDPOINT' } } } },
  ])('rejects per-model route overrides without leaking values %j', async value => {
    const f = fixture(); f.write(join(f.root, 'config.yaml'), value)
    await expect(readMiniMaxBindingMaterial(f.config, signal())).rejects.not.toThrow('PRIVATE_')
  })
  it('binds configuration provenance and rejects source A to B to A during metadata', async () => {
    const f = fixture(), path = join(f.root, 'config.yaml')
    f.write(path, { minimaxModelSource: 'token_plan', defaultModel: 'minimax/synthetic-a' })
    const before = await readMiniMaxBindingMaterial(f.config, signal())
    f.write(path, { minimaxModelSource: 'minimax_api_key' })
    await expect(readMiniMaxBindingMaterial(f.config, signal())).rejects.toThrow('暂不支持')
    f.write(path, { minimaxModelSource: 'token_plan', defaultModel: 'minimax/synthetic-a' })
    expect(await readMiniMaxBindingMaterial(f.config, signal())).toEqual(before)
    let changed = false
    const b = backendFixture('success', () => { if (!changed) { changed = true; f.write(path, { minimaxModelSource: 'minimax_api_key' }); f.write(path, { minimaxModelSource: 'token_plan', defaultModel: 'minimax/synthetic-a' }) } })
    await expect(discoverMiniMaxModels(b.backend, f.config, config.minimaxExecutable, '/project', signal())).rejects.toThrow('后验未通过 [snapshot=')
  })
  it('preserves configured state without stable principal and on expired tokens', async () => {
    for (const opts of [{ subject: false }, { expires: 1 }, { expires: Date.now() + 30000 }]) {
      const f = fixture(opts); expect((await readMiniMaxAccount(f.config, signal())).identity.state).toBe('configured')
      await expect(readMiniMaxBindingMaterial(f.config, signal())).rejects.toThrow()
    }
  })
  it.each([{ schemaVersion: 2 }, { scopes: [] }, { clientId: 'foreign' }, { audience: 'foreign' }, { generation: 3 }, { tokenType: 'Other' }])('rejects incompatible credential contract %j', async token => {
    const f = fixture({ token }); await expect(readMiniMaxAccount(f.config, signal())).rejects.toThrow()
  })
  it('rejects credential mutation during the bounded read without exposing either payload', async () => {
    const f = fixture()
    fileRace.afterRead = () => f.write(join(f.directory, 'auth.json'), { schemaVersion: 1, records: { [f.key]: { ...f.token, subject: 'PRIVATE_CHANGED_USER', concurrent: 'changed-length' } } })
    await expect(readMiniMaxAccount(f.config, signal())).rejects.not.toThrow('PRIVATE_')
  })
  it.each(['symlink', 'hardlink', 'public', 'oversized', 'malformed'])('rejects unsafe source %s', async kind => {
    const f = fixture(); const path = join(f.directory, 'auth.json')
    if (kind === 'symlink') { const link = f.root + '-link'; symlinkSync(f.root, link); f.config.minimaxHome = link }
    if (kind === 'hardlink') linkSync(path, join(f.directory, 'linked.json'))
    if (kind === 'public') chmodSync(path, 0o644)
    if (kind === 'oversized') writeFileSync(path, 'x'.repeat(65537))
    if (kind === 'malformed') writeFileSync(path, 'PRIVATE_INVALID_JSON')
    await expect(readMiniMaxAccount(f.config, signal())).rejects.not.toThrow('PRIVATE_')
  })
})

describe('MiniMax state and zero prompt metadata', () => {
  it('requires verified userinfo BEFORE metadata spawn and preserves model-specific max effort', async () => {
    const f = fixture({ subject: false }), b = backendFixture()
    let release!: () => void
    const fetchImpl = vi.fn(() => new Promise<Response>(resolve => { release = () => resolve(new Response(JSON.stringify({ data: { userInfo: { realUserID: 'synthetic-real-user' } } }))) }))
    vi.stubGlobal('fetch', fetchImpl)
    const work = discoverMiniMaxModels(b.backend, f.config, config.minimaxExecutable, '/project', signal())
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1))
    expect(b.calls).toHaveLength(0); release()
    const { models } = await work
    expect(models[1].efforts).toEqual(['default', 'max'])
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect(b.calls).toHaveLength(1)
    expect(b.frames.some(frame => frame.method === 'session/prompt')).toBe(false)
  })
  it('discards a source changed during model metadata without probing the new token identity', async () => {
    const f = fixture({ subject: false }); let changed = false
    const b = backendFixture('success', () => {
      if (!changed) { changed = true; f.write(join(f.directory, 'auth.json'), { schemaVersion: 1, records: { [f.key]: { ...f.token, accessToken: 'PRIVATE_NEW_TOKEN' } } }) }
    })
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: { userInfo: { realUserID: 'synthetic-real-user' } } })))
    vi.stubGlobal('fetch', fetchImpl)
    await expect(discoverMiniMaxModels(b.backend, f.config, config.minimaxExecutable, '/project', signal())).rejects.toThrow('后验未通过 [snapshot=')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(b.frames.some(frame => frame.method === 'session/prompt')).toBe(false)
  })
  it.each([403, 429, 500])('never spawns model metadata after userinfo HTTP %s', async status => {
    const f = fixture({ subject: false }), b = backendFixture()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('PRIVATE_HTTP_BODY', { status })))
    await expect(discoverMiniMaxModels(b.backend, f.config, config.minimaxExecutable, '/project', signal())).rejects.not.toThrow('PRIVATE_')
    expect(b.calls).toHaveLength(0)
  })
  it('keeps exact encoded model IDs and learns effort AFTER each model selection', async () => {
    const f = backendFixture(), source = { root: '/synthetic', region: 'cn' as const, env: {} }
    const { models } = await queryMiniMaxAcpModels(f.backend, config, config.minimaxExecutable, '/project', source, signal())
    expect(models).toMatchObject([{ id: modelA, efforts: ['default', 'low', 'high'] }, { id: modelB, efforts: ['default', 'max'] }])
    expect(f.frames.map(q => q.method)).toEqual(['initialize', 'session/new', 'session/set_config_option'])
    expect(f.frames[1].params).toEqual({ cwd: '/project', mcpServers: [] }); expect(f.exits()).toBe(1)
  })
  it('roundtrips native empty variants and excludes custom provider models', async () => {
    for (const scenario of ['empty-variant', 'custom-model']) {
      const f = backendFixture(scenario)
      const { models } = await queryMiniMaxAcpModels(f.backend, config, config.minimaxExecutable, '/project', { root: '/synthetic', region: 'cn', env: {} }, signal())
      expect(models).toHaveLength(2)
      expect(JSON.stringify(models)).not.toContain('PRIVATE_CUSTOM_LABEL')
      if (scenario === 'empty-variant') {
        expect(models[1].id).toBe('m:minimax:synthetic:v:')
        expect(f.frames.at(-1).params.value).toBe('m:minimax:synthetic:v:')
      }
    }
  })
  it.each(['version', 'wrong-agent', 'malformed', 'oversized', 'partial', 'error', 'exit1', 'bad-signal', 'cleanup', 'hang'])('fails closed on metadata %s', async scenario => {
    const f = backendFixture(scenario)
    const pending = queryMiniMaxAcpModels(f.backend, { ...config, timeoutMs: 30 }, config.minimaxExecutable, '/project', { root: '/synthetic', region: 'cn', env: {} }, signal())
    if (scenario === 'cleanup') await expect(pending).rejects.toBeInstanceOf(ProcessCleanupUnconfirmedError)
    else await expect(pending).rejects.not.toThrow('PRIVATE_')
    expect(f.frames.some(q => ['providers/list', 'session/prompt'].includes(q.method))).toBe(false)
  })
  it.each(['sigterm', 'exit143'])('accepts only proven owned metadata termination %s', async scenario => {
    const f = backendFixture(scenario)
    expect((await queryMiniMaxAcpModels(f.backend, config, config.minimaxExecutable, '/project', { root: '/synthetic', region: 'cn', env: {} }, signal())).models).toHaveLength(2)
  })
  it('reports the actual native login gate without raw RPC payload', async () => {
    const f = backendFixture('login')
    await expect(queryMiniMaxAcpModels(f.backend, config, config.minimaxExecutable, '/project', { root: '/synthetic', region: 'cn', env: {} }, signal())).rejects.toThrow('需要登录')
  })
  it('accepts a Native-like same-content atomic config save during successful metadata', async () => {
    const account = fixture(), path = resolve(account.root, 'config.yaml'), temporary = path + '.synthetic-atomic'
    account.write(path, { minimaxModelSource: 'token_plan', defaultModel: 'minimax/synthetic' })
    const original = readFileSync(path), binding = await readMiniMaxBindingMaterial(account.config, signal())
    const f = backendFixture('success', () => {
      if (!path.startsWith(resolve('.cache') + '/minimax-account-test-') || resolve(temporary) !== path + '.synthetic-atomic') throw new Error('Unsafe synthetic atomic move')
      writeFileSync(temporary, original, { mode: 0o600 }); renameSync(temporary, path)
    })
    const catalog = await discoverMiniMaxModels(f.backend, account.config, config.minimaxExecutable, '/project', signal())
    expect(catalog.models).toHaveLength(2); expect(catalog.models[1].efforts).toEqual(['default', 'max'])
    expect(await readMiniMaxBindingMaterial(account.config, signal())).toEqual(binding); expect(globalThis.fetch).not.toHaveBeenCalled()
  })
  it('passes verified-subset notice through the existing MiniMax catalog adapter', async () => {
    const account = fixture(), f = backendFixture('reasoning-reject')
    const catalog = await catalogFor('minimax', f.backend, account.config, '/project', signal())
    expect(catalog.models.map(v => v.id)).toEqual([modelA]); expect(catalog.models[0].efforts).toEqual(['default', 'low', 'high'])
    expect(catalog.notice).toContain('广告配置 2 项；已验证 1 项；精确 reasoning 配置拒绝 1 项')
    expect(catalog.notice).not.toMatch(/PRIVATE_|Invalid model|https:/)
  })
  it('discards even a verified partial directory after the original source changes', async () => {
    const account = fixture(), f = backendFixture('reasoning-reject', () => account.write(join(account.directory, 'auth.json'), { schemaVersion: 1, records: { [account.key]: { ...account.token, accessToken: 'PRIVATE_CHANGED_TOKEN' } } }))
    await expect(discoverMiniMaxModels(f.backend, account.config, config.minimaxExecutable, '/project', signal())).rejects.toThrow('后验未通过 [snapshot=')
    expect(globalThis.fetch).not.toHaveBeenCalled(); expect(f.frames.some(v => v.method === 'session/prompt')).toBe(false)
  })
  it('rejects changed current identity after metadata and preserves other CLI sources', async () => {
    const account = fixture(); let changed = false
    const f = backendFixture('success', () => { if (!changed) { changed = true; account.write(join(account.directory, 'auth.json'), { schemaVersion: 1, records: { [account.key]: { ...account.token, subject: 'different-user' } } }) } })
    await expect(discoverMiniMaxModels(f.backend, account.config, config.minimaxExecutable, '/project', signal())).rejects.toThrow('后验未通过 [snapshot=')
  })
  it('validates grouped opaque values, permissions and model-specific efforts', async () => {
    const data: any = state(); data.configOptions[0].options = [{ group: 'g', name: 'Models', options: data.configOptions[0].options }]
    expect(minimaxState(data).models).toHaveLength(2)
    expect(validMiniMaxModel('m:minimax:synthetic:v:')).toBe(true)
    for (const v of ['provider/model', 'm:a:b:u:extra', 'm:a:%XX:u', 'm:a:b:v']) expect(validMiniMaxModel(v)).toBe(false)
    const noEffort: any = state(); noEffort.configOptions.pop(); expect(minimaxState(noEffort).efforts).toEqual([])
    const calls: any[] = []; const peer = { async request(_m: string, p: any) { calls.push(p); data.configOptions.find((o: any) => o.id === p.configId).currentValue = p.value; return { configOptions: data.configOptions } } }
    await configureMiniMax(peer, data.sessionId, data, { cli: 'minimax', model: modelB, effort: 'high' })
    expect(calls.map(c => c.configId)).toEqual(['model', 'thinkingEffort', 'permissionMode'])
    expect(calls.at(-1).value).toBe('default')
    expect(() => minimaxState({ ...data, _meta: { 'minimax-code/transition': 'next_prompt' } })).toThrow()
  })
  it('does not open unverified capabilities or bypass native Ask mode', () => {
    const basic = { argv: ['/synthetic/mcode', 'acp'], project: '/project', mode: 'accept-edits', preference: { model: modelA, effort: 'default' } }
    expect(minimaxAcpArgv(basic)).toEqual(basic.argv)
    expect(workerArguments('/synthetic/mcode', '/project', { cli: 'minimax', model: modelA, effort: 'default' }, 'accept-edits', 'prompt', 1000, undefined, true)).toEqual(basic.argv)
    for (const extra of [{ mode: 'plan' }, { attachments: [{}] }, { harnessTools: {} }, { forkOperation: 'fork' }, { controlNonce: 'x' }]) expect(() => minimaxAcpArgv({ ...basic, ...extra })).toThrow()
    expect(nativeAttachmentCapability('minimax')).toBe(false); expect(nativeHarnessToolCapability('minimax').transport).toBe(false); expect(supportsNativeSteering('minimax')).toBe(false)
    expect(bridgedFeatureSupport({ preference: { cli: 'minimax', model: modelA, effort: 'default' }, transport: 'minimax-acp-v1' })).toMatchObject({ plan: { supported: false }, fork: { supported: false } })
  })
})
