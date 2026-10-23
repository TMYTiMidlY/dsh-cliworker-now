import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, linkSync, chmodSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { PassThrough, Writable } from 'node:stream'
import { minimaxDataRoot, minimaxSource, readMiniMaxAccount, readMiniMaxBindingMaterial, minimaxExecutable, assertMiniMaxRoute } from '../src/host/minimax-accounts.ts'
import { minimaxState, configureMiniMax, validMiniMaxModel } from '../src/host/minimax-state.mjs'
import { queryMiniMaxAcpModels, discoverMiniMaxModels } from '../src/host/minimax-models.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'
import { minimaxAcpArgv, runNativeMiniMax } from '../src/host/native-minimax.mjs'
import { resolveCliName } from '../src/host/routing.ts'
import { executableFor, workerArguments } from '../src/host/adapters.ts'
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
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); fileRace.afterRead = undefined })
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
  if (options.cache) {
    const dir = join(root, `cli-auth/prod/${region}`); mkdirSync(dir, { recursive: true, mode: 0o700 })
    write(join(dir, 'account-identity.json'), { version: 1, status: 'verified', region, buildEnv: 'prod', tokenFingerprint: `sha256:${hash(options.cache === 'current' ? token.accessToken : 'old-token')}`, realUserID: 'synthetic-real-user', updatedAtMs: Date.now(), userEmail: 'PRIVATE_EMAIL' })
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
    expect(await readMiniMaxBindingMaterial(f.config, signal())).not.toEqual(before)
    let changed = false
    const b = backendFixture('success', () => { if (!changed) { changed = true; f.write(path, { minimaxModelSource: 'minimax_api_key' }); f.write(path, { minimaxModelSource: 'token_plan', defaultModel: 'minimax/synthetic-a' }) } })
    await expect(discoverMiniMaxModels(b.backend, f.config, config.minimaxExecutable, '/project', signal())).rejects.toThrow('已改变')
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
  it('keeps exact encoded model IDs and learns effort AFTER each model selection', async () => {
    const f = backendFixture(), source = { root: '/synthetic', region: 'cn' as const, env: {} }
    const models = await queryMiniMaxAcpModels(f.backend, config, config.minimaxExecutable, '/project', source, signal())
    expect(models).toMatchObject([{ id: modelA, efforts: ['default', 'low', 'high'] }, { id: modelB, efforts: ['default', 'max'] }])
    expect(f.frames.map(q => q.method)).toEqual(['initialize', 'session/new', 'session/set_config_option', 'session/set_config_option'])
    expect(f.frames[1].params).toEqual({ cwd: '/project', mcpServers: [] }); expect(f.exits()).toBe(1)
  })
  it('roundtrips native empty variants and excludes custom provider models', async () => {
    for (const scenario of ['empty-variant', 'custom-model']) {
      const f = backendFixture(scenario)
      const models = await queryMiniMaxAcpModels(f.backend, config, config.minimaxExecutable, '/project', { root: '/synthetic', region: 'cn', env: {} }, signal())
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
    expect(await queryMiniMaxAcpModels(f.backend, config, config.minimaxExecutable, '/project', { root: '/synthetic', region: 'cn', env: {} }, signal())).toHaveLength(2)
  })
  it('reports the actual native login gate without raw RPC payload', async () => {
    const f = backendFixture('login')
    await expect(queryMiniMaxAcpModels(f.backend, config, config.minimaxExecutable, '/project', { root: '/synthetic', region: 'cn', env: {} }, signal())).rejects.toThrow('需要登录')
  })
  it('rejects changed current identity after metadata and preserves other CLI sources', async () => {
    const account = fixture(); let changed = false
    const f = backendFixture('success', () => { if (!changed) { changed = true; account.write(join(account.directory, 'auth.json'), { schemaVersion: 1, records: { [account.key]: { ...account.token, subject: 'different-user' } } }) } })
    await expect(discoverMiniMaxModels(f.backend, account.config, config.minimaxExecutable, '/project', signal())).rejects.toThrow('已改变')
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
