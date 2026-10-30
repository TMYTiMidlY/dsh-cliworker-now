import { beforeAll, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, renameSync, existsSync, symlinkSync, readdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import * as snapshotModule from '../src/host/native-auth-snapshot.ts'
import { buildNativeAuthGuard } from '../scripts/build-native-auth-guard.mjs'
import { NativeAuthStore, miniMaxProfileIdentity, miniMaxAccountProfileIdentity, type NativeAuthContext } from '../src/host/native-auth-store.ts'
import { assertMiniMaxAccountSettings } from '../src/host/native-auth-minimax-settings.ts'
import { AuthDirectory, NativeAuthError } from '../src/host/native-auth-files.ts'
import { ProcessCleanupUnconfirmedError } from '../src/host/process.ts'
import { MiniMaxAuthRefreshGroups } from '../src/host/native-auth-minimax-refresh.ts'
import { MiniMaxNativeProfileImporter, type MiniMaxNativeImporterDependencies } from '../src/host/native-auth-minimax-import.ts'
import { miniMaxIdentityPrincipal } from '../src/host/minimax-identity.ts'

// Real local kernel guard/store, but SYNTHETIC auth/UID HTTP and target verifier.
// No vendor CLI/model, real account, actual Native refresh or GUI is exercised.
let assets = ''
const principal = miniMaxIdentityPrincipal('SYNTHETIC_UID')!
function parent() { mkdirSync('.cache', { recursive: true }); return mkdtempSync(join(process.cwd(), '.cache/auth-minimax-import-synthetic-')) }
beforeAll(() => { const root = parent(); assets = join(root, 'assets'); buildNativeAuthGuard({ root: process.cwd(), outDir: assets }) })
function fixture() {
  const root = parent(), sourceRoot = join(root, 'source'), prefix = 'auth/prod/cn/mcode-public'
  const directory = join(sourceRoot, prefix); mkdirSync(directory, { recursive: true, mode: 0o700 })
  const common = { clientId: 'mcode-public', audience: 'agent-backend', scopes: ['agent.default'], generation: 1, expiresAtMs: Date.now() + 600000 }
  const sourceKey = `com.minimax.mcode.oauth.prod.cn\0${createHash('sha256').update(join(sourceRoot, 'auth') + '\0mcode-public').digest('base64url')}`
  const state = { schemaVersion: 2, status: 'authenticated', storeKind: 'file', buildEnv: 'prod', region: 'cn', ...common }
  const credential = { schemaVersion: 1, accessToken: 'SYNTHETIC_IMPORT_ACCESS', refreshToken: 'SYNTHETIC_IMPORT_REFRESH', tokenType: 'Bearer', ...common }
  const authPath = join(directory, 'auth.json'), statePath = join(directory, 'auth-state.json')
  writeFileSync(authPath, JSON.stringify({ schemaVersion: 1, records: { [sourceKey]: credential } }), { mode: 0o600 })
  writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 })
  const store = NativeAuthStore.initialize(join(root, 'store')), groups = MiniMaxAuthRefreshGroups.initialize(join(root, 'groups'))
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: { userInfo: { realUserID: 'SYNTHETIC_UID' } } })))
  const verifyTarget = vi.fn(async (context: NativeAuthContext, _signal: AbortSignal) => {
    const policy: any = context.identityPolicy
    if (policy?.kind !== 'minimax-native-principal') throw new NativeAuthError('IDENTITY_MISMATCH')
    return miniMaxProfileIdentity(principal, policy.region, policy.configPolicy)
  })
  const dependencies: MiniMaxNativeImporterDependencies & { identity: { fetchImpl: typeof fetch } } = { store, groups, verifyTarget, identity: { fetchImpl }, snapshotBackend: { assetsDirectory: assets, timeoutMs: 3000 } }
  const request = { sourceRoot, region: 'cn' as const, label: 'Synthetic imported MiniMax', requestId: 'mini-import-1' }
  const create = () => new MiniMaxNativeProfileImporter(dependencies)
  return { root, sourceRoot, directory, prefix, sourceKey, authPath, statePath, credential, state, store, groups, fetchImpl, verifyTarget, dependencies, request, create }
}
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(ok => { resolve = ok }); return { promise, resolve } }
function replaceAndRestore(f: ReturnType<typeof fixture>) {
  const p = resolve(f.authPath)
  if (!p.startsWith(resolve(f.root) + sep) || !p.endsWith('/auth.json')) throw new Error('SYNTHETIC_PATH_GUARD')
  renameSync(p, `${p}.retained`); writeFileSync(p, 'SYNTHETIC_INTERLOPER', { mode: 0o600 })
  renameSync(p, `${p}.interloper`); renameSync(`${p}.retained`, p)
}
it('commits a synthetic standard source through the real strict kernel and private store', async () => {
  const f = fixture(), descriptor = await f.create().import(f.request)
  expect(f.store.list()).toEqual([descriptor]); expect(f.verifyTarget).toHaveBeenCalledTimes(1)
  expect(f.fetchImpl).toHaveBeenCalledTimes(1)
})
it('publishes only after guarded source, final-root projection and trusted target verifier settlement', async () => {
  const f = fixture(), original = readFileSync(f.authPath), ready = deferred(), finish = deferred()
  f.dependencies.verifyTarget = vi.fn(async context => {
    expect(f.store.list()).toEqual([])
    const auth = JSON.parse(readFileSync(join(context.nativeRoot, f.prefix, 'auth.json'), 'utf8'))
    const key = `com.minimax.mcode.oauth.prod.cn\0${createHash('sha256').update(join(context.nativeRoot, 'auth') + '\0mcode-public').digest('base64url')}`
    expect(auth.records).toEqual({ [key]: f.credential }); expect(Object.hasOwn(auth.records, f.sourceKey)).toBe(false)
    expect(existsSync(join(context.nativeRoot, 'cli-auth'))).toBe(false)
    ready.resolve(); await finish.promise
    return miniMaxProfileIdentity(principal, 'cn', 'native-default')
  })
  const work = f.create().import(f.request); await ready.promise
  expect(f.store.list()).toEqual([]); finish.resolve()
  const descriptor = await work
  expect(f.store.list()).toEqual([descriptor]); expect(readFileSync(f.authPath)).toEqual(original)
  expect(f.fetchImpl).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(descriptor)).not.toMatch(/SYNTHETIC_IMPORT_ACCESS|sourceRoot|nativeRoot|refreshGroup|identityPolicy/)
})
it.each(['agents', 'permission.json', 'plugin-hook-permissions'])('refuses unimplemented source protection %s before UID or target I/O', async name => {
  const f = fixture(); mkdirSync(join(f.sourceRoot, name), { mode: 0o700 })
  await expect(f.create().import(f.request)).rejects.toMatchObject({ code: 'UNSUPPORTED' })
  expect(f.fetchImpl).not.toHaveBeenCalled(); expect(f.verifyTarget).not.toHaveBeenCalled(); expect(f.store.list()).toEqual([])
})
it('imports account-only settings without migrating an unrelated business-agent directory link', async () => {
  const f = fixture(), business = join(f.root, 'business-agent-definitions')
  mkdirSync(business, { mode: 0o700 }); writeFileSync(join(business, 'SYNTHETIC_BUSINESS_DO_NOT_COPY.md'), 'SYNTHETIC_PRIVATE_BUSINESS', { mode: 0o600 })
  symlinkSync(business, join(f.sourceRoot, 'agents'))
  const config = Buffer.from(JSON.stringify({ permissionMode: 'bypassPermissions', dataContribution: { enabled: false }, memory: { enabled: false } }))
  writeFileSync(join(f.sourceRoot, 'config.yaml'), config, { mode: 0o600 })
  f.dependencies.verifyTarget = vi.fn(async context => {
    const policy = context.identityPolicy
    if (policy?.kind !== 'minimax-native-principal' || policy.configPolicy !== 'account-only' || !policy.configDigest) throw new NativeAuthError('IDENTITY_MISMATCH')
    const targetConfig = readFileSync(join(context.nativeRoot, 'config.yaml'))
    assertMiniMaxAccountSettings(policy.configDigest, targetConfig, policy.region)
    expect(JSON.parse(targetConfig.toString()).permissionMode).toBe('default')
    expect(existsSync(join(context.nativeRoot, 'agents'))).toBe(false)
    expect(readdirSync(context.nativeRoot).sort()).toEqual(['auth', 'config.yaml'])
    return miniMaxAccountProfileIdentity(principal, policy.region, policy.configDigest)
  })
  const descriptor = await f.create().import({ ...f.request, scope: 'account-only' } as any)
  expect(f.store.list()).toEqual([descriptor])
  expect(readFileSync(join(f.sourceRoot, 'config.yaml'))).toEqual(config)
  expect(readFileSync(join(business, 'SYNTHETIC_BUSINESS_DO_NOT_COPY.md'), 'utf8')).toBe('SYNTHETIC_PRIVATE_BUSINESS')
})
it.each(['permission.json', 'plugin-hook-permissions'])('account-only does not silently remove unsupported global protection %s', async name => {
  const f = fixture(); mkdirSync(join(f.sourceRoot, name), { mode: 0o700 })
  await expect(f.create().import({ ...f.request, scope: 'account-only' } as any)).rejects.toMatchObject({ code: 'UNSUPPORTED' })
  expect(f.fetchImpl).not.toHaveBeenCalled(); expect(f.verifyTarget).not.toHaveBeenCalled()
})
it('looks up a committed receipt even when the export directory is now absent', async () => {
  const f = fixture(), importer = f.create(), first = await importer.import(f.request)
  const target = f.sourceRoot + '.retained'; expect(resolve(target)).toBe(join(resolve(f.root), 'source.retained'))
  renameSync(f.sourceRoot, target)
  expect(await importer.import(f.request)).toEqual(first)
  expect(f.fetchImpl).toHaveBeenCalledTimes(1); expect(f.verifyTarget).toHaveBeenCalledTimes(1)
})
it('does not start target verification when the original Native identity is unavailable', async () => {
  const f = fixture(); f.dependencies.identity.fetchImpl = vi.fn(async () => new Response('SYNTHETIC_REJECTED', { status: 401 }))
  await expect(f.create().import(f.request)).rejects.toBeInstanceOf(NativeAuthError)
  expect(f.verifyTarget).not.toHaveBeenCalled(); expect(f.store.list()).toEqual([])
})
it('joins target work after source failure and keeps the refresh group until it settles', async () => {
  const f = fixture(), ready = deferred(), aborted = deferred(), finish = deferred()
  f.dependencies.verifyTarget = vi.fn(async (_context, signal) => {
    signal.addEventListener('abort', aborted.resolve, { once: true }); ready.resolve(); await finish.promise
    return miniMaxProfileIdentity(principal, 'cn', 'native-default')
  })
  let settled = false
  const work = f.create().import(f.request); void work.then(() => { settled = true }, () => { settled = true })
  await ready.promise; replaceAndRestore(f); await aborted.promise
  expect(settled).toBe(false)
  const group = (miniMaxProfileIdentity(principal, 'cn', 'native-default') as any).identityPolicy.refreshGroup
  await expect(f.groups.run(group, async () => 'WRONG')).rejects.toMatchObject({ code: 'BUSY' })
  finish.resolve(); await expect(work).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
  expect(f.store.list()).toEqual([])
  expect(await f.groups.run(group, async () => 'after settled')).toBe('after settled')
})
it('retains a direct target cleanup witness when store finally fails to release its own lease', async () => {
  const f = fixture(), original = AuthDirectory.prototype.releaseLease
  const release = vi.spyOn(AuthDirectory.prototype, 'releaseLease').mockImplementation(function (this: AuthDirectory, lock) {
    if (this.path === join(f.root, 'store')) throw Object.assign(new Error('SYNTHETIC_STORE_RELEASE_FAILURE'), { code: 'EIO' })
    return original.call(this, lock)
  })
  f.dependencies.verifyTarget = vi.fn(async () => { throw new ProcessCleanupUnconfirmedError() })
  try {
    await expect(f.create().import(f.request)).rejects.toMatchObject({ code: 'CLEANUP_UNCONFIRMED' })
    const group = (miniMaxProfileIdentity(principal, 'cn', 'native-default') as any).identityPolicy.refreshGroup
    await expect(MiniMaxAuthRefreshGroups.open(join(f.root, 'groups')).run(group, async () => 'WRONG')).rejects.toMatchObject({ code: 'CLEANUP_UNCONFIRMED' })
    expect(f.store.list()).toEqual([])
  } finally { release.mockRestore() }
})
it('keeps original caller cancellation effective after actual source seal and before publication', async () => {
  const f = fixture(), abort = new AbortController(), original = snapshotModule.withNativeAuthSnapshot
  let realSealCompleted = false, sourceSignalRemainedSeparate = false
  const wrapped = vi.spyOn(snapshotModule, 'withNativeAuthSnapshot').mockImplementation(((input, validate, backend) => original(input, async (files, guard) => validate(files, Object.freeze({
    ...guard, seal: async () => {
      await guard.seal() // Real kernel SEAL/SEALED plus actual helper close0.
      realSealCompleted = true; abort.abort()
      sourceSignalRemainedSeparate = !guard.signal.aborted
    },
  })), backend)) as typeof original)
  try {
    await expect(f.create().import({ ...f.request, signal: abort.signal })).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(realSealCompleted).toBe(true); expect(sourceSignalRemainedSeparate).toBe(true)
    expect(f.store.list()).toEqual([])
  } finally { wrapped.mockRestore() }
})
it('target cleanup uncertainty outranks source failure and persists the group block', async () => {
  const f = fixture(), ready = deferred(), aborted = deferred(), finish = deferred()
  f.dependencies.verifyTarget = vi.fn(async (_context, signal) => {
    signal.addEventListener('abort', aborted.resolve, { once: true }); ready.resolve(); await finish.promise
    throw new ProcessCleanupUnconfirmedError()
  })
  const work = f.create().import(f.request); void work.catch(() => {})
  await ready.promise; replaceAndRestore(f); await aborted.promise; finish.resolve()
  await expect(work).rejects.toMatchObject({ code: 'CLEANUP_UNCONFIRMED' })
  expect(f.store.list()).toEqual([])
  const group = (miniMaxProfileIdentity(principal, 'cn', 'native-default') as any).identityPolicy.refreshGroup
  await expect(MiniMaxAuthRefreshGroups.open(join(f.root, 'groups')).run(group, async () => 'WRONG')).rejects.toMatchObject({ code: 'CLEANUP_UNCONFIRMED' })
})
