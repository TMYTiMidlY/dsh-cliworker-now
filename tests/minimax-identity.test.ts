import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, renameSync, chmodSync, statSync, openSync, closeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { MiniMaxIdentityError, miniMaxIdentityPrincipal, requestMiniMaxIdentity } from '../src/host/minimax-identity.ts'
import { ensureMiniMaxVerifiedAccount, readMiniMaxAccount, readMiniMaxBindingMaterial, sameMiniMaxAccountSnapshot, miniMaxAccountSnapshotDifference, minimaxSource } from '../src/host/minimax-accounts.ts'
import { readCliAccountBinding } from '../src/host/cli-account-binding.ts'
import { DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'

const proofRace = vi.hoisted(() => ({ afterRead: undefined as undefined | ((path: string) => void) }))
vi.mock('node:fs/promises', async original => {
  const real = await original<typeof import('node:fs/promises')>()
  return { ...real, open: async (...args: Parameters<typeof real.open>) => {
    const handle = await real.open(...args), read = handle.read.bind(handle)
    handle.read = (async (...readArgs: any[]) => {
      const result = await (read as any)(...readArgs)
      proofRace.afterRead?.(String(args[0]))
      return result
    }) as typeof handle.read
    return handle
  } }
})
// Entirely synthetic files, tokens and injected HTTP Responses. No native CLI or real request.
const hash = (value: string, encoding: 'hex' | 'base64url' = 'hex') => createHash('sha256').update(value).digest(encoding)
const md5 = (value: string) => createHash('md5').update(value).digest('hex')
const signal = () => new AbortController().signal
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const identity = (uid = 'PRIVATE_REAL_USER') => ({ statusInfo: { code: 0 }, base_resp: { status_code: 0 }, data: { userInfo: { realUserID: uid, phone: 'PRIVATE_PHONE', email: 'PRIVATE_EMAIL', name: 'PRIVATE_NAME' } } })
beforeEach(() => {
  vi.stubEnv('MAVIS_REGION', 'cn'); vi.stubEnv('MAVIS_BUILD_ENV', 'prod')
  for (const key of ['MCODE_OAUTH_DEVICE_AUTHORIZATION_ENDPOINT', 'MCODE_OAUTH_TOKEN_ENDPOINT', 'MCODE_OAUTH_REVOCATION_ENDPOINT', 'MINIMAX_API_KEY', 'MAVIS_API_KEY']) vi.stubEnv(key, undefined)
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('PRIVATE_OFFLINE_DEFAULT') }))
})
afterEach(() => { proofRace.afterRead = undefined; vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers() })
function fixture() {
  const root = mkdtempSync(resolve('.cache/minimax-identity-synthetic-')), region = 'cn'
  const dir = join(root, 'auth/prod/cn/mcode-public'); mkdirSync(dir, { recursive: true, mode: 0o700 })
  const common = { clientId: 'mcode-public', audience: 'agent-backend', scopes: ['agent.default'], generation: 1, loginEpoch: 'synthetic-login', expiresAtMs: Date.now() + 600000 }
  const state = { schemaVersion: 2, status: 'authenticated', storeKind: 'file', buildEnv: 'prod', region, ...common }
  const token = { schemaVersion: 1, tokenType: 'Bearer', accessToken: 'PRIVATE_ACCESS', refreshToken: 'PRIVATE_REFRESH', subject: 'PRIVATE_UNVERIFIED_SUBJECT', accountId: 'PRIVATE_UNVERIFIED_ACCOUNT', ...common }
  const key = `com.minimax.mcode.oauth.prod.cn\0${hash(join(root, 'auth') + '\0mcode-public', 'base64url')}`
  const statePath = join(dir, 'auth-state.json'), authPath = join(dir, 'auth.json'), configPath = join(root, 'config.yaml')
  const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value), { mode: 0o600 })
  const auth = () => write(authPath, { schemaVersion: 1, records: { [key]: token } })
  write(statePath, state); auth()
  const nativeCache = (patch: Record<string, unknown> = {}) => {
    const directory = join(root, 'cli-auth/prod/cn'); mkdirSync(directory, { recursive: true, mode: 0o700 })
    write(join(directory, 'account-identity.json'), { version: 1, status: 'verified', region, buildEnv: 'prod', tokenFingerprint: `sha256:${hash(token.accessToken)}`, updatedAtMs: Date.now(), realUserID: 'PRIVATE_REAL_USER', ...patch })
  }
  return { root, state, token, statePath, authPath, configPath, write, auth, nativeCache, config: { minimaxHome: root } }
}
function atomicFixtureFile(f: ReturnType<typeof fixture>, path: string, contents = readFileSync(path)) {
  const root = resolve(f.root), target = resolve(path), temporary = target + '.synthetic-atomic'
  if (!root.startsWith(resolve('.cache') + '/minimax-identity-synthetic-') || !target.startsWith(root + '/') || resolve(temporary) !== target + '.synthetic-atomic') throw new Error('Unsafe synthetic atomic target')
  writeFileSync(temporary, contents, { mode: 0o600 }); renameSync(temporary, target)
}
async function unavailable(work: Promise<unknown>, kind = 'unavailable') {
  const error = await work.then(() => undefined, e => e)
  expect(error).toBeInstanceOf(MiniMaxIdentityError)
  expect(error.kind).toBe(kind)
  expect(String(error)).not.toMatch(/PRIVATE_|Bearer|https:|x-signature|phone|email/)
  expect(error.cause).toBeUndefined()
}

describe('bounded native own userinfo HTTP contract (synthetic)', () => {
  it.each(['cn', 'en'] as const)('mirrors fixed native %s URL, query order and GET signatures', async region => {
    const now = 1700000000123, language = region === 'cn' ? 'zh' : 'en'
    const fetchImpl = vi.fn(async () => json(identity()))
    const principal = await requestMiniMaxIdentity(region, ' PRIVATE_ACCESS ', signal(), { fetchImpl, now: () => now, timezoneOffsetSeconds: () => 28800, platform: 'linux' })
    expect(principal).toBe(hash(JSON.stringify({ realUserID: 'PRIVATE_REAL_USER' })))
    expect(principal).not.toMatch(/PRIVATE_|phone|email|name/)
    const [input, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit]
    const path = `/v1/api/user/info?device_platform=mcode&biz_id=3&app_id=3001&version_code=22201&unix=1700000000123&timezone_offset=28800&sys_language=${language}&lang=${language}&device_id=0&os_name=linux&browser_name=mcode&user_id=0&client=mcode`
    expect(input.href).toBe((region === 'cn' ? 'https://agent.minimaxi.com' : 'https://agent.minimax.io') + path)
    expect(input.href).not.toContain('PRIVATE_')
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' }); expect(init.body).toBeUndefined()
    const headers = new Headers(init.headers)
    expect(Object.fromEntries(headers)).toEqual({ accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'MiniMaxCode', authorization: 'Bearer PRIVATE_ACCESS',
      yy: md5(`${encodeURIComponent(path)}_{}${md5(String(now))}ooui`), 'x-timestamp': '1700000000', 'x-signature': md5('1700000000I*7Cf%WZ#S&%1RlZJ&C2') })
    expect((init.signal as AbortSignal).aborted).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it.each([
    { name: 'data camel', value: { data: { userInfo: { realUserID: ' uid ' } } } },
    { name: 'data snake', value: { data: { user_info: { real_user_id: 'uid' } } } },
    { name: 'root camel', value: { userInfo: { realUserID: 'uid' } } },
    { name: 'root snake', value: { user_info: { real_user_id: 'uid' } } },
    { name: 'native alias fallback', value: { data: { userInfo: { realUserID: '', real_user_id: 'uid' } } } },
  ])('projects only the genuine string identity from $name', async ({ value }) => {
    expect(await requestMiniMaxIdentity('cn', 'PRIVATE_ACCESS', signal(), { fetchImpl: vi.fn(async () => json(value)) }))
      .toBe(miniMaxIdentityPrincipal('uid'))
  })
  it.each([
    { name: 'missing', value: {} }, { name: 'numeric ID', value: { data: { userInfo: { realUserID: 123 } } } },
    { name: 'blank ID', value: { userInfo: { realUserID: '  ' } } }, { name: 'control ID', value: { userInfo: { realUserID: 'PRIVATE_\nID' } } },
    { name: 'large ID', value: { userInfo: { realUserID: 'x'.repeat(8193) } } },
    { name: 'string business failure', value: { ...identity(), statusInfo: { code: '0', message: 'PRIVATE_ERROR' } } },
    { name: 'business failure', value: { ...identity(), base_resp: { status_code: 7, status_msg: 'PRIVATE_ERROR' } } },
    { name: 'malformed status', value: { ...identity(), statusInfo: 'PRIVATE_ERROR' } },
    { name: 'flat token is not userinfo', value: { accessToken: 'PRIVATE_ACCESS', realUserID: 'PRIVATE_REAL_USER' } },
  ])('rejects malformed $name without echoing payloads', async ({ value }) => {
    await unavailable(requestMiniMaxIdentity('cn', 'PRIVATE_ACCESS', signal(), { fetchImpl: vi.fn(async () => json(value)) }))
  })
  it.each([401, 403, 429, 500, 302])('classifies HTTP %i without exposing its body or retrying', async status => {
    const fetchImpl = vi.fn(async () => json({ message: 'PRIVATE_HTTP_BODY', token: 'PRIVATE_TOKEN' }, status))
    await unavailable(requestMiniMaxIdentity('cn', 'PRIVATE_ACCESS', signal(), { fetchImpl }), [401, 403].includes(status) ? 'rejected' : 'unavailable')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('classifies the exact native unauthorized business status', async () => {
    await unavailable(requestMiniMaxIdentity('cn', 'PRIVATE_ACCESS', signal(), { fetchImpl: vi.fn(async () => json({ ...identity(), statusInfo: { code: 1000048, message: 'PRIVATE_EXPIRED' } })) }), 'rejected')
  })
  it.each(['json', 'utf8', 'advertised-limit', 'stream-limit', 'redirected', 'wrong-url', 'transport'])('bounds malformed/hostile %s responses', async scenario => {
    const fetchImpl = vi.fn(async () => {
      if (scenario === 'transport') throw new Error('PRIVATE_TRANSPORT_ERROR')
      if (scenario === 'json') return new Response('PRIVATE_INVALID_JSON')
      if (scenario === 'utf8') return new Response(new Uint8Array([0xff]))
      if (scenario === 'advertised-limit') return new Response('PRIVATE_BODY', { headers: { 'content-length': '65537' } })
      if (scenario === 'stream-limit') return new Response('x'.repeat(65537))
      const response = json(identity())
      Object.defineProperty(response, scenario === 'redirected' ? 'redirected' : 'url', { value: scenario === 'redirected' ? true : 'https://PRIVATE_WRONG_HOST/path' })
      return response
    })
    await unavailable(requestMiniMaxIdentity('cn', 'PRIVATE_ACCESS', signal(), { fetchImpl }))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('enforces the native three-second maximum even for a transport ignoring abort', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}))
    const result = requestMiniMaxIdentity('cn', 'PRIVATE_ACCESS', signal(), { fetchImpl, timeoutMs: 100000 }).catch(e => e)
    await vi.advanceTimersByTimeAsync(3000)
    const error = await result
    expect(error).toBeInstanceOf(MiniMaxIdentityError); expect(error.kind).toBe('unavailable')
    expect((fetchImpl.mock.calls[0] as unknown as [URL, RequestInit])[1].signal?.aborted).toBe(true)
  })
  it('bounds a response body that never finishes and cancels the reader', async () => {
    let closed = false
    const response = new Response(new ReadableStream({ cancel() { closed = true } }))
    await unavailable(requestMiniMaxIdentity('cn', 'PRIVATE_ACCESS', signal(), { fetchImpl: vi.fn(async () => response), timeoutMs: 20 }))
    expect(closed).toBe(true)
  })
  it('does not request anything on pre-cancel and never exposes an abort reason', async () => {
    const controller = new AbortController(); controller.abort(new Error('PRIVATE_ABORT_REASON'))
    const fetchImpl = vi.fn()
    const error = await requestMiniMaxIdentity('cn', 'PRIVATE_ACCESS', controller.signal, { fetchImpl }).catch(e => e)
    expect(error.name).toBe('AbortError'); expect(String(error)).not.toContain('PRIVATE_'); expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('private OAuth proof and stable identity admission (synthetic)', () => {
  it.each(['summary', 'ensure', 'material', 'formal'])('sanitizes pre-cancel at the %s admission boundary', async boundary => {
    const f = fixture(), controller = new AbortController()
    const reason = new Error('PRIVATE_CANCEL_REASON', { cause: new Error('PRIVATE_CAUSE') }); controller.abort(reason)
    const backend: ProcessBackend = { resolveExecutable: vi.fn(), spawn: vi.fn() }
    const work = boundary === 'summary' ? readMiniMaxAccount(f.config, controller.signal)
      : boundary === 'ensure' ? ensureMiniMaxVerifiedAccount(f.config, controller.signal)
      : boundary === 'material' ? readMiniMaxBindingMaterial(f.config, controller.signal)
      : readCliAccountBinding('minimax', backend, { ...DEFAULT_CONFIG, ...f.config }, '/synthetic-project', controller.signal)
    const error = await work.catch(e => e)
    expect(error.name).toBe('AbortError'); expect(error).not.toBe(reason); expect(error.cause).toBeUndefined()
    expect(JSON.stringify({ name: error.name, notice: error.message, stack: error.stack, cause: error.cause })).not.toContain('PRIVATE_')
    expect(globalThis.fetch).not.toHaveBeenCalled(); expect(backend.spawn).not.toHaveBeenCalled()
  })
  it.each(['ensure', 'material', 'formal'])('sanitizes cancellation during post-HTTP proof reread at %s', async boundary => {
    const f = fixture(), controller = new AbortController()
    const fetchImpl = vi.fn(async () => {
      proofRace.afterRead = path => {
        if (path.endsWith('/auth.json')) { proofRace.afterRead = undefined; controller.abort(new Error('PRIVATE_POST_HTTP_CANCEL', { cause: new Error('PRIVATE_CAUSE') })) }
      }
      return json(identity())
    })
    vi.stubGlobal('fetch', fetchImpl)
    const backend: ProcessBackend = { resolveExecutable: vi.fn(), spawn: vi.fn() }
    const work = boundary === 'ensure' ? ensureMiniMaxVerifiedAccount(f.config, controller.signal)
      : boundary === 'material' ? readMiniMaxBindingMaterial(f.config, controller.signal)
      : readCliAccountBinding('minimax', backend, { ...DEFAULT_CONFIG, ...f.config }, '/synthetic-project', controller.signal)
    const error = await work.catch(e => e)
    expect(error.name).toBe('AbortError'); expect(error.cause).toBeUndefined()
    expect(JSON.stringify({ notice: error.message, name: error.name, stack: error.stack, cause: error.cause })).not.toContain('PRIVATE_')
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect(backend.spawn).not.toHaveBeenCalled()
    const retry = vi.fn(async () => json(identity()))
    expect((await ensureMiniMaxVerifiedAccount(f.config, signal(), { fetchImpl: retry })).principal).toBeDefined()
    expect(retry).toHaveBeenCalledTimes(1)
  })
  it('sanitizes local-summary cancellation during proof read without HTTP', async () => {
    const f = fixture(), controller = new AbortController()
    proofRace.afterRead = path => { if (path.endsWith('/auth.json')) { proofRace.afterRead = undefined; controller.abort(new Error('PRIVATE_LOCAL_CANCEL')) } }
    const error = await readMiniMaxAccount(f.config, controller.signal).catch(e => e)
    expect(error.name).toBe('AbortError'); expect(String(error)).not.toContain('PRIVATE_'); expect(error.cause).toBeUndefined()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
  it('keeps ordinary summaries local and never treats subject/accountId as a verified realUserID', async () => {
    const f = fixture(), fetchImpl = vi.mocked(globalThis.fetch), before = readFileSync(f.authPath)
    const local = await readMiniMaxAccount(f.config, signal())
    expect(local.identity.state).toBe('configured'); expect(local.principal).toBeUndefined(); expect(fetchImpl).not.toHaveBeenCalled()
    expect(JSON.stringify(local)).not.toMatch(/PRIVATE_|subject|accountId|accessToken|epoch/)
    expect(readFileSync(f.authPath)).toEqual(before)
  })
  it('resolves missing cache before the formal binding path, without writing native records', async () => {
    const f = fixture(), before = readFileSync(f.authPath), state = readFileSync(f.statePath)
    const fetchImpl = vi.fn(async () => json(identity())); vi.stubGlobal('fetch', fetchImpl)
    const binding = await readMiniMaxBindingMaterial(f.config, signal())
    expect(binding.entries[0].principal).toEqual({ kind: 'oauth', subjectHash: miniMaxIdentityPrincipal('PRIVATE_REAL_USER') })
    expect(JSON.stringify(binding)).not.toMatch(/PRIVATE_|accessToken|refreshToken|"subject"|"accountId"|userInfo/)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(readFileSync(f.authPath)).toEqual(before); expect(readFileSync(f.statePath)).toEqual(state)
    expect((await readMiniMaxAccount(f.config, signal())).identity.state).toBe('configured')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('routes formal CLI account admission through userinfo without any subprocess', async () => {
    const f = fixture(), fetchImpl = vi.fn(async () => json(identity()))
    vi.stubGlobal('fetch', fetchImpl)
    const backend: ProcessBackend = { resolveExecutable: vi.fn(async () => '/synthetic/mcode'), spawn: vi.fn(() => { throw new Error('No model may start here') }) }
    const epoch = await readCliAccountBinding('minimax', backend, { ...DEFAULT_CONFIG, ...f.config }, '/synthetic-project', signal())
    expect(epoch).toMatch(/^cli-account-v1:[a-f0-9]{64}$/)
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect(backend.spawn).not.toHaveBeenCalled()
    expect(backend.resolveExecutable).not.toHaveBeenCalled()
  })
  it('uses only a current strictly verified native cache without HTTP', async () => {
    const f = fixture(); f.nativeCache()
    expect((await ensureMiniMaxVerifiedAccount(f.config, signal())).principal).toBe(miniMaxIdentityPrincipal('PRIVATE_REAL_USER'))
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
  it.each([{ version: 2 }, { status: 'rejected' }, { region: 'en' }, { buildEnv: 'test' }, { tokenFingerprint: 'sha256:PRIVATE_OLD' }, { realUserID: 123 }])('does not trust incompatible native cache %j', async patch => {
    const f = fixture(); f.nativeCache(patch)
    expect((await readMiniMaxAccount(f.config, signal())).principal).toBeUndefined()
    const fetchImpl = vi.fn(async () => json(identity())); vi.stubGlobal('fetch', fetchImpl)
    expect((await ensureMiniMaxVerifiedAccount(f.config, signal())).principal).toBe(miniMaxIdentityPrincipal('PRIVATE_REAL_USER'))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it.each(['expired', 'scope', 'logout', 'route'])('does not send userinfo for an invalid %s proof', async kind => {
    const f = fixture()
    if (kind === 'expired') { f.token.expiresAtMs = f.state.expiresAtMs = Date.now() + 30000; f.auth(); f.write(f.statePath, f.state) }
    if (kind === 'scope') { f.token.scopes = []; f.auth() }
    if (kind === 'logout') { f.state.status = 'anonymous'; f.write(f.statePath, f.state) }
    if (kind === 'route') f.write(f.configPath, { minimaxModelSource: 'minimax_api_key' })
    await readMiniMaxBindingMaterial(f.config, signal()).catch(() => {})
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
  it.each(['generation', 'loginEpoch', 'token', 'scope', 'expiry', 'logout', 'region', 'config', 'ABA', 'selection-ABA'])('discards identity when %s changes during HTTP', async kind => {
    const f = fixture()
    if (kind === 'selection-ABA') {
      vi.stubEnv('MAVIS_REGION', undefined); mkdirSync(join(f.root, 'preferences'), { mode: 0o700 })
      f.write(join(f.root, 'preferences/mcode-region.json'), { version: 1, regions: { prod: 'cn' } })
    }
    const fetchImpl = vi.fn(async () => {
      if (kind === 'generation') { f.token.generation++; f.state.generation++; f.auth(); f.write(f.statePath, f.state) }
      if (kind === 'loginEpoch') { f.token.loginEpoch = 'PRIVATE_NEW_LOGIN'; f.auth() }
      if (kind === 'token') { f.token.accessToken = 'PRIVATE_NEW_ACCESS'; f.auth() }
      if (kind === 'scope') { f.token.scopes.push('synthetic.extra'); f.state.scopes.push('synthetic.extra'); f.auth(); f.write(f.statePath, f.state) }
      if (kind === 'expiry') { f.token.expiresAtMs += 60000; f.state.expiresAtMs += 60000; f.auth(); f.write(f.statePath, f.state) }
      if (kind === 'logout') { f.state.status = 'anonymous'; f.write(f.statePath, f.state) }
      if (kind === 'region') vi.stubEnv('MAVIS_REGION', 'en')
      if (kind === 'config') f.write(f.configPath, { defaultModel: 'minimax/different-synthetic-model' })
      if (kind === 'ABA') { const original = readFileSync(f.authPath); f.token.accessToken = 'PRIVATE_NEW_ACCESS'; f.auth(); writeFileSync(f.authPath, original); utimesSync(f.authPath, new Date(), new Date(Date.now() + 2000)) }
      if (kind === 'selection-ABA') { const path = join(f.root, 'preferences/mcode-region.json'); f.write(path, { version: 1, regions: { prod: 'en' } }); f.write(path, { version: 1, regions: { prod: 'cn' } }); utimesSync(path, new Date(), new Date(Date.now() + 2000)) }
      return json(identity())
    })
    const error = await ensureMiniMaxVerifiedAccount(f.config, signal(), { fetchImpl }).catch(e => e)
    expect(error).toBeInstanceOf(Error); expect(String(error)).not.toContain('PRIVATE_')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('does not cache an HTTP result rejected by the post-proof check', async () => {
    const f = fixture(); let first = true
    const fetchImpl = vi.fn(async () => { if (first) { first = false; f.token.loginEpoch = 'new-login'; f.auth() } return json(identity()) })
    await expect(ensureMiniMaxVerifiedAccount(f.config, signal(), { fetchImpl })).rejects.toThrow('来源已变化')
    expect((await ensureMiniMaxVerifiedAccount(f.config, signal(), { fetchImpl })).principal).toBeDefined()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
  it('keeps same UID stable across token renewal, invalidates changed UID and scopes memory by source', async () => {
    const f = fixture(); let uid = 'PRIVATE_UID_A'
    const fetchImpl = vi.fn(async () => json(identity(uid))); vi.stubGlobal('fetch', fetchImpl)
    const first = await readMiniMaxBindingMaterial(f.config, signal())
    f.token.accessToken = 'PRIVATE_NEW_ACCESS'; f.token.generation++; f.state.generation++; f.auth(); f.write(f.statePath, f.state)
    expect(await readMiniMaxBindingMaterial(f.config, signal())).toEqual(first)
    uid = 'PRIVATE_UID_B'; f.token.accessToken = 'PRIVATE_OTHER_ACCESS'; f.auth()
    expect(await readMiniMaxBindingMaterial(f.config, signal())).not.toEqual(first)
    const other = fixture(); await readMiniMaxBindingMaterial(other.config, signal())
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })
  it('expires memory after thirty seconds without sliding TTL on a cache hit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1700000000000)
    const f = fixture(), fetchImpl = vi.fn(async () => json(identity()))
    await ensureMiniMaxVerifiedAccount(f.config, signal(), { fetchImpl })
    vi.setSystemTime(1700000020000); await ensureMiniMaxVerifiedAccount(f.config, signal(), { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    vi.setSystemTime(1700000031000); await ensureMiniMaxVerifiedAccount(f.config, signal(), { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
  it('deduplicates concurrent callers while cancellation remains caller-local', async () => {
    const f = fixture(), first = new AbortController(), second = new AbortController()
    let release!: () => void
    const fetchImpl = vi.fn(() => new Promise<Response>(resolve => { release = () => resolve(json(identity())) }))
    const one = ensureMiniMaxVerifiedAccount(f.config, first.signal, { fetchImpl }).catch(e => e)
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1))
    const listener = vi.spyOn(second.signal, 'addEventListener')
    const two = ensureMiniMaxVerifiedAccount(f.config, second.signal, { fetchImpl })
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true }))
    first.abort(new Error('PRIVATE_CANCEL_REASON')); release()
    const error = await one; expect(error.name).toBe('AbortError'); expect(String(error)).not.toContain('PRIVATE_')
    expect((await two).principal).toBeDefined(); expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('cancels owned metadata when the last waiter leaves and allows later re-entry', async () => {
    const f = fixture(), controller = new AbortController(); let transportSignal: AbortSignal | undefined
    const fetchImpl = vi.fn((_url: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      transportSignal = init!.signal as AbortSignal
      transportSignal.addEventListener('abort', () => reject(new Error('PRIVATE_TRANSPORT_CANCEL')), { once: true })
    }))
    const pending = ensureMiniMaxVerifiedAccount(f.config, controller.signal, { fetchImpl }).catch(e => e)
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1)); controller.abort(new Error('PRIVATE_CANCEL_REASON'))
    expect((await pending).name).toBe('AbortError')
    await vi.waitFor(() => expect(transportSignal?.aborted).toBe(true))
    const next = vi.fn(async () => json(identity()))
    expect((await ensureMiniMaxVerifiedAccount(f.config, signal(), { fetchImpl: next })).principal).toBeDefined()
    expect(next).toHaveBeenCalledTimes(1)
  })
  it('keeps identity rejection configured without login/reset instructions or secrets', async () => {
    const f = fixture(), fetchImpl = vi.fn(async () => json({ message: 'PRIVATE_SERVER_ERROR' }, 403))
    const account = await ensureMiniMaxVerifiedAccount(f.config, signal(), { fetchImpl })
    expect(account.identity.state).toBe('configured'); expect(account.principal).toBeUndefined()
    expect(account.identity.summary).toContain('验证被拒绝'); expect(account.identity.summary).not.toMatch(/PRIVATE_|重新登录|清除|https:/)
  })
})

describe('safe snapshot refusal classification (synthetic, admission unchanged)', () => {
  const verified = async (f: ReturnType<typeof fixture>) => ensureMiniMaxVerifiedAccount(f.config, signal(), { fetchImpl: vi.fn(async () => json(identity())) })
  it('accepts an unchanged snapshot without requiring a persisted principal', async () => {
    const f = fixture(), before = await verified(f), after = await readMiniMaxAccount(f.config, signal())
    expect(after.principal).toBeUndefined(); expect(sameMiniMaxAccountSnapshot(before, after)).toBe(true)
    expect(miniMaxAccountSnapshotDifference(before, after)).toBe('none')
  })
  it.each(['state', 'credential', 'cache'] as const)('keeps %s changes refused and reports only the component enum', async kind => {
    const f = fixture(), before = await verified(f)
    if (kind === 'state') { f.state.loginEpoch = 'PRIVATE_CHANGED'; f.write(f.statePath, f.state) }
    if (kind === 'credential') { f.token.refreshToken = 'PRIVATE_CHANGED_REFRESH'; f.auth() }
    if (kind === 'cache') f.nativeCache()
    const after = await readMiniMaxAccount(f.config, signal()), difference = miniMaxAccountSnapshotDifference(before, after)
    expect(sameMiniMaxAccountSnapshot(before, after)).toBe(false)
    expect(difference).toBe(kind === 'cache' ? 'identity-cache-version' : kind + '-version')
    expect(difference).not.toMatch(/PRIVATE_|\/|[0-9a-f]{32,}|Bearer|https:/)
  })
  it('keeps unregistered clones refused without inventing epochs', async () => {
    const f = fixture(), before = await verified(f), after = await readMiniMaxAccount(f.config, signal())
    expect(miniMaxAccountSnapshotDifference({ ...before }, after)).toBe('untracked-before')
    expect(miniMaxAccountSnapshotDifference(before, { ...after })).toBe('untracked-after')
    expect(sameMiniMaxAccountSnapshot(before, { ...after })).toBe(false)
  })
  it('does not call an expiry-margin refusal an account switch', async () => {
    const f = fixture(), before = await verified(f)
    vi.spyOn(Date, 'now').mockReturnValue(f.token.expiresAtMs - 59999)
    const after = await readMiniMaxAccount(f.config, signal())
    expect(sameMiniMaxAccountSnapshot(before, after)).toBe(false)
    expect(miniMaxAccountSnapshotDifference(before, after)).toBe('renewal-after')
  })
  it('reports environment or principal differences without echoing their values', async () => {
    const f = fixture(), before = await verified(f), after = await readMiniMaxAccount(f.config, signal())
    const environment = { ...after, source: { ...after.source, env: { ...after.source.env, PRIVATE_TOKEN: 'PRIVATE_VALUE' } } }
    const principal = { ...after, principal: 'PRIVATE_OTHER_PRINCIPAL' }
    expect(miniMaxAccountSnapshotDifference(before, environment)).toBe('source-environment')
    expect(miniMaxAccountSnapshotDifference(before, principal)).toBe('principal-changed')
    expect(sameMiniMaxAccountSnapshot(before, environment)).toBe(false)
    expect(sameMiniMaxAccountSnapshot(before, principal)).toBe(false)
  })
})

describe('stable raw configuration binding and private operation versions (synthetic)', () => {
  const setup = () => { const f = fixture(); f.write(f.configPath, { minimaxModelSource: 'token_plan', defaultModel: 'minimax/synthetic' }); f.nativeCache(); return f }
  const verified = (f: ReturnType<typeof fixture>) => ensureMiniMaxVerifiedAccount(f.config, signal())
  it('accepts same-content atomic saves with a stable binding and tracked operation', async () => {
    const f = setup(), before = await verified(f), binding = await readMiniMaxBindingMaterial(f.config, signal()), old = statSync(f.configPath)
    atomicFixtureFile(f, f.configPath)
    expect(statSync(f.configPath).ino).not.toBe(old.ino)
    const after = await readMiniMaxAccount(f.config, signal())
    expect(sameMiniMaxAccountSnapshot(before, after)).toBe(true); expect(miniMaxAccountSnapshotDifference(before, after)).toBe('none')
    expect(await readMiniMaxBindingMaterial(f.config, signal())).toEqual(binding); expect(globalThis.fetch).not.toHaveBeenCalled()
  })
  it('inherits the updated atomic stamp so subsequent in-place changes cannot look atomic', async () => {
    const f = setup(), before = await verified(f); atomicFixtureFile(f, f.configPath)
    expect(sameMiniMaxAccountSnapshot(before, await readMiniMaxAccount(f.config, signal()))).toBe(true)
    writeFileSync(f.configPath, readFileSync(f.configPath)); utimesSync(f.configPath, new Date(), new Date(Date.now() + 2000))
    const after = await readMiniMaxAccount(f.config, signal())
    expect(sameMiniMaxAccountSnapshot(before, after)).toBe(false); expect(miniMaxAccountSnapshotDifference(before, after)).toBe('source-configuration-version')
    expect(after.source.configuration).toBe(before.source.configuration)
  })
  it('rejects an actual atomic content change, including non-route fields', async () => {
    const f = setup(), before = await verified(f)
    atomicFixtureFile(f, f.configPath, Buffer.from(JSON.stringify({ minimaxModelSource: 'token_plan', defaultModel: 'minimax/synthetic', memory: { enabled: false } })))
    const after = await readMiniMaxAccount(f.config, signal())
    expect(sameMiniMaxAccountSnapshot(before, after)).toBe(false); expect(miniMaxAccountSnapshotDifference(before, after)).toBe('source-configuration')
  })
  it('rejects in-place A to API to A during an operation while stable A binding is restored', async () => {
    const f = setup(), original = readFileSync(f.configPath), before = await verified(f), binding = await readMiniMaxBindingMaterial(f.config, signal())
    f.write(f.configPath, { minimaxModelSource: 'minimax_api_key' }); writeFileSync(f.configPath, original); utimesSync(f.configPath, new Date(), new Date(Date.now() + 2000))
    const after = await readMiniMaxAccount(f.config, signal())
    expect(sameMiniMaxAccountSnapshot(before, after)).toBe(false); expect(miniMaxAccountSnapshotDifference(before, after)).toBe('source-configuration-version')
    expect(await readMiniMaxBindingMaterial(f.config, signal())).toEqual(binding)
  })
  it('remembers an observed unsupported route even when restored atomically', async () => {
    const f = setup(), original = readFileSync(f.configPath), before = await verified(f)
    atomicFixtureFile(f, f.configPath, Buffer.from('{"minimaxModelSource":"minimax_api_key"}'))
    await expect(minimaxSource(f.config, signal())).rejects.toThrow('暂不支持')
    atomicFixtureFile(f, f.configPath, original)
    const after = await readMiniMaxAccount(f.config, signal())
    expect(sameMiniMaxAccountSnapshot(before, after)).toBe(false); expect(miniMaxAccountSnapshotDifference(before, after)).toBe('source-configuration-version')
  })
  it('makes no claim to detect an unobserved atomic A to B to A', async () => {
    const f = setup(), original = readFileSync(f.configPath), before = await verified(f)
    // Keep the original inode allocated; otherwise an immediate second rename may reuse it and correctly fail closed as a same-inode touch.
    const old = statSync(f.configPath), pin = openSync(f.configPath, 'r')
    try {
      atomicFixtureFile(f, f.configPath, Buffer.from('{"minimaxModelSource":"minimax_api_key"}')); atomicFixtureFile(f, f.configPath, original)
      expect(statSync(f.configPath).ino).not.toBe(old.ino)
      expect(sameMiniMaxAccountSnapshot(before, await readMiniMaxAccount(f.config, signal()))).toBe(true)
    } finally { closeSync(pin) }
  })
  it('clears the prior ledger when the file is observed missing', async () => {
    const f = setup(), before = await verified(f), path = resolve(f.configPath), backup = path + '.synthetic-missing'
    if (!path.startsWith(resolve('.cache') + '/minimax-identity-synthetic-') || resolve(backup) !== path + '.synthetic-missing') throw new Error('Unsafe synthetic move')
    renameSync(path, backup); await minimaxSource(f.config, signal()); renameSync(backup, path)
    const after = await readMiniMaxAccount(f.config, signal())
    expect(sameMiniMaxAccountSnapshot(before, after)).toBe(false); expect(miniMaxAccountSnapshotDifference(before, after)).toBe('source-configuration-version')
  })
  it('does not normalize safe-but-different permission mode on an atomic replacement', async () => {
    const f = setup(), before = await verified(f), raw = readFileSync(f.configPath)
    const path = f.configPath + '.synthetic-atomic'
    if (resolve(path) !== resolve(f.root, 'config.yaml.synthetic-atomic') || !resolve(f.root).startsWith(resolve('.cache') + '/minimax-identity-synthetic-')) throw new Error('Unsafe synthetic move')
    writeFileSync(path, raw, { mode: 0o400 }); renameSync(path, f.configPath)
    const after = await readMiniMaxAccount(f.config, signal())
    expect(sameMiniMaxAccountSnapshot(before, after)).toBe(false); expect(miniMaxAccountSnapshotDifference(before, after)).toBe('source-configuration-version')
  })
  it('keeps unsafe reads from silently restoring a previous configuration ledger', async () => {
    const f = setup(), before = await verified(f); chmodSync(f.configPath, 0o644)
    await expect(minimaxSource(f.config, signal())).rejects.toThrow('安全读取')
    chmodSync(f.configPath, 0o600); atomicFixtureFile(f, f.configPath)
    expect(sameMiniMaxAccountSnapshot(before, await readMiniMaxAccount(f.config, signal()))).toBe(false)
  })
  it('retains private configuration version through a userinfo projection clone', async () => {
    const f = fixture(); f.write(f.configPath, { minimaxModelSource: 'token_plan' })
    const fetchImpl = vi.fn(async () => { atomicFixtureFile(f, f.configPath); return json(identity()) })
    const before = await ensureMiniMaxVerifiedAccount(f.config, signal(), { fetchImpl }), after = await readMiniMaxAccount(f.config, signal())
    expect(before.principal).toBeTruthy(); expect(after.principal).toBeUndefined(); expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sameMiniMaxAccountSnapshot(before, after)).toBe(true); expect(miniMaxAccountSnapshotDifference(before, after)).toBe('none')
  })
  it.each(['state', 'credential', 'cache'] as const)('never normalizes an identical atomic %s rewrite', async kind => {
    const f = setup(), before = await verified(f), path = kind === 'state' ? f.statePath : kind === 'credential' ? f.authPath : join(f.root, 'cli-auth/prod/cn/account-identity.json')
    atomicFixtureFile(f, path)
    const after = await readMiniMaxAccount(f.config, signal())
    expect(sameMiniMaxAccountSnapshot(before, after)).toBe(false)
    expect(miniMaxAccountSnapshotDifference(before, after)).toBe(kind === 'cache' ? 'identity-cache-version' : kind + '-version')
  })
  it('bounds the root ledger and makes eviction cause safe rejection, not stale authorization', async () => {
    const f = setup(), before = await verified(f), binding = await readMiniMaxBindingMaterial(f.config, signal())
    for (let i = 0; i < 65; i++) { const other = fixture(); other.write(other.configPath, { minimaxModelSource: 'token_plan' }); await minimaxSource(other.config, signal()) }
    const after = await readMiniMaxAccount(f.config, signal())
    expect(sameMiniMaxAccountSnapshot(before, after)).toBe(false); expect(miniMaxAccountSnapshotDifference(before, after)).toBe('source-configuration-version')
    expect(await readMiniMaxBindingMaterial(f.config, signal())).toEqual(binding)
  })
})
