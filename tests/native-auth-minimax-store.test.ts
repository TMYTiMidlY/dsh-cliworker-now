import { expect, it, vi } from 'vitest'
import { createHash, createHmac } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NativeAuthStore, miniMaxProfileIdentity, type NativeAuthContext } from '../src/host/native-auth-store.ts'
import { NativeAuthError } from '../src/host/native-auth-files.ts'

// Synthetic store/policy tests only: no MiniMax token format, HTTP, native CLI,
// actual principal, protection projection or successful import is proved here.
const principal = 'SYNTHETIC_MINIMAX_NATIVE_PRINCIPAL'
const group = (value: string, region: string) => createHash('sha256').update(JSON.stringify(['native-auth-minimax-refresh-group', 1, 'prod', region, value])).digest('hex')
const policy = (region: 'cn' | 'en' = 'cn', configPolicy: 'empty' | 'native-default' = 'empty') => ({
  kind: 'minimax-native-principal', policyVersion: 1, cli: 'minimax', buildEnv: 'prod',
  format: 'mcode-0.6.12-file-v1', region, configPolicy, refreshGroup: group(principal, region),
} as const)
const identity = (p = policy()) => ({ kind: 'native-principal', value: principal, identityPolicy: p } as any)
const request = (requestId = 'mini-1') => ({ cli: 'minimax' as const, label: 'Synthetic MiniMax', sourceKey: 'SYNTHETIC_AUTHORIZED_SOURCE', requestId })
function fixture() {
  mkdirSync('.cache', { recursive: true })
  const parent = mkdtempSync(join(process.cwd(), '.cache/auth-minimax-policy-synthetic-'))
  const root = join(parent, 'store'), store = NativeAuthStore.initialize(root)
  return { root, store }
}
const project = (value: any = identity()) => async () => ({ identity: value, files: [{ path: 'account.json', bytes: Buffer.from('SYNTHETIC_NATIVE_MATERIAL') }] })
const current = async (context: NativeAuthContext) => {
  const p: any = context.identityPolicy
  if (p?.kind !== 'minimax-native-principal') throw new NativeAuthError('UNSUPPORTED')
  return identity(p)
}
const payload = (path: string) => JSON.parse(readFileSync(path, 'utf8')).payload
const hmac = (key: Buffer, value: unknown) => createHmac('sha256', key).update(JSON.stringify(value)).digest('hex')
const sign = (path: string, key: Buffer, value: unknown) => writeFileSync(path, JSON.stringify({ payload: value, mac: hmac(key, value) }), { mode: 0o600 })

it('constructs an immutable private identity without guessing a policy or accepting another region', () => {
  const built: any = miniMaxProfileIdentity(principal, 'cn', 'empty')
  expect(built).toEqual(identity())
  expect(Object.isFrozen(built)).toBe(true); expect(Object.isFrozen(built.identityPolicy)).toBe(true)
  expect(() => miniMaxProfileIdentity(principal, 'other' as any, 'empty')).toThrow('AUTH_INVALID_INPUT')
  expect(() => miniMaxProfileIdentity('', 'cn', 'empty')).toThrow('AUTH_INVALID_INPUT')
})
it('persists signed MiniMax context privately and restores it before any verifier I/O', async () => {
  const f = fixture(), p = policy()
  const verify = vi.fn(async (context: NativeAuthContext) => {
    expect(context.identityPolicy).toEqual(p)
    expect(Object.isFrozen(context.identityPolicy)).toBe(true)
    return current(context)
  })
  const descriptor = await f.store.import(request(), async context => {
    expect(context.identityPolicy).toBeUndefined()
    return project()()
  }, verify)
  const cold = NativeAuthStore.open(f.root)
  const context = await cold.resolvePinned(descriptor.id, 'minimax', descriptor.materialRevision, verify)
  expect(context.identityPolicy).toEqual(p)
  expect(verify).toHaveBeenCalledTimes(2)
  expect(Object.keys(descriptor).sort()).toEqual(['cli', 'enabled', 'id', 'label', 'materialRevision', 'recordRevision', 'state'])
  expect(JSON.stringify(descriptor)).not.toMatch(/nativeRoot|identityPolicy|refreshGroup|configPolicy|SYNTHETIC_MINIMAX_NATIVE_PRINCIPAL/)
  const registry = payload(join(f.root, 'registry.json')), manifest = payload(join(context.nativeRoot, '../manifest.json'))
  expect(registry.schema).toBe(2); expect(manifest.schema).toBe(2)
  expect(manifest.identityPolicy).toEqual(p)
  const key = readFileSync(join(f.root, 'key.bin'))
  expect(manifest.principal).toBe(hmac(key, ['native-auth-minimax-native-principal', p.policyVersion, p.cli, p.buildEnv, p.format, p.region, p.configPolicy, p.refreshGroup, principal]))
})
it.each(['region', 'configPolicy'] as const)('same principal cannot silently change signed %s on reimport', async change => {
  const f = fixture(), first = await f.store.import(request(), project(), current)
  const changed = change === 'region' ? policy('en') : policy('cn', 'native-default')
  await expect(f.store.import({ ...request('reimport'), id: first.id, expectedRecordRevision: first.recordRevision }, project(identity(changed)), current)).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' })
  expect(f.store.list()).toEqual([first])
})
it('refresh group follows the stable principal/region, not config mode or material root', async () => {
  const f = fixture(), a = await f.store.import(request(), project(), current)
  const b = await f.store.import(request('mini-2'), project(identity(policy('cn', 'native-default'))), current)
  const ca = await f.store.resolve(a.id, 'minimax', current), cb = await f.store.resolve(b.id, 'minimax', current)
  expect(ca.nativeRoot).not.toBe(cb.nativeRoot)
  expect((ca.identityPolicy as any).refreshGroup).toBe((cb.identityPolicy as any).refreshGroup)
})
it.each(['registry', 'manifest'] as const)('rejects one-sided signed %s policy changes before invoking verification', async side => {
  const f = fixture(), d = await f.store.import(request(), project(), current)
  const ctx = await f.store.resolve(d.id, 'minimax', current), key = readFileSync(join(f.root, 'key.bin'))
  const path = side === 'registry' ? join(f.root, 'registry.json') : join(ctx.nativeRoot, '../manifest.json')
  const body = payload(path)
  if (side === 'registry') body.records[0].materials[0].identityPolicy.configPolicy = 'native-default'
  else body.identityPolicy.configPolicy = 'native-default'
  sign(path, key, body)
  const verify = vi.fn(current)
  await expect(Promise.resolve().then(() => NativeAuthStore.open(f.root).resolve(d.id, 'minimax', verify))).rejects.toMatchObject({ code: 'STORE_UNAVAILABLE' })
  expect(verify).not.toHaveBeenCalled()
})
it.each(['unknown-policy', 'unknown-format', 'bad-group', 'cross-cli'] as const)('does not publish %s material or call a Native verifier', async kind => {
  const f = fixture(), p: any = { ...policy() }
  if (kind === 'unknown-policy') p.kind = 'FUTURE_PRIVATE_POLICY'
  if (kind === 'unknown-format') p.format = 'FUTURE_FORMAT'
  if (kind === 'bad-group') p.refreshGroup = 'a'.repeat(64)
  const verify = vi.fn(current)
  await expect(f.store.import({ ...request(), ...(kind === 'cross-cli' ? { cli: 'codex' as const } : {}) }, project(identity(p)), verify)).rejects.toBeInstanceOf(NativeAuthError)
  expect(verify).not.toHaveBeenCalled(); expect(f.store.list()).toEqual([])
})
it('looks up an exact committed import receipt before source preparation or verification', async () => {
  const f = fixture(), input = request(), first = await f.store.import(input, project(), current)
  const cold = NativeAuthStore.open(f.root)
  expect((cold as any).lookupImport(input)).toEqual(first)
  expect((cold as any).lookupImport(request('not-imported'))).toBeUndefined()
  expect(() => (cold as any).lookupImport({ ...input, sourceKey: 'SYNTHETIC_CHANGED_SOURCE' })).toThrow('AUTH_CONFLICT')
  const prepare = vi.fn(async () => { throw new Error('SYNTHETIC_SOURCE_GONE') }), verify = vi.fn(current)
  expect(await cold.import(input, prepare, verify)).toEqual(first)
  expect(prepare).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled()
})
it('does not treat an original receipt as current enablement or credential validation', async () => {
  const f = fixture(), input = request(), first = await f.store.import(input, project(), current)
  f.store.manage({ id: first.id, expectedRecordRevision: first.recordRevision, enabled: false, requestId: 'disable' })
  expect((f.store as any).lookupImport(input)).toEqual(first)
  await expect(f.store.resolve(first.id, 'minimax', current)).rejects.toMatchObject({ code: 'DISABLED' })
})
it('restores an account-only protected-settings digest before any target verifier I/O', async () => {
  const f = fixture(), p: any = { ...policy(), configPolicy: 'account-only', configDigest: 'c'.repeat(64) }
  const d = await f.store.import(request(), project(identity(p)), current)
  const verify = vi.fn(async (ctx: NativeAuthContext) => {
    expect(ctx.identityPolicy).toEqual(p)
    return identity(ctx.identityPolicy as any)
  })
  const ctx = await NativeAuthStore.open(f.root).resolvePinned(d.id, 'minimax', d.materialRevision, verify)
  expect(ctx.identityPolicy).toEqual(p); expect(verify).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(d)).not.toContain('configDigest')
})
it('does not reimport different account-only protected settings under the same profile identity', async () => {
  const f = fixture(), p: any = { ...policy(), configPolicy: 'account-only', configDigest: 'c'.repeat(64) }
  const d = await f.store.import(request(), project(identity(p)), current)
  await expect(f.store.import({ ...request('changed-settings'), id: d.id, expectedRecordRevision: d.recordRevision }, project(identity({ ...p, configDigest: 'd'.repeat(64) })), current)).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' })
})
it.each(['missing', 'wrong-type', 'extraneous'])('rejects %s account-only protection metadata rather than guessing a digest', async kind => {
  const f = fixture(), p: any = { ...policy(), configPolicy: 'account-only', configDigest: 'c'.repeat(64) }
  if (kind === 'missing') delete p.configDigest
  if (kind === 'wrong-type') p.configDigest = 1
  if (kind === 'extraneous') p.configPolicy = 'empty'
  await expect(f.store.import(request(), project(identity(p)), current)).rejects.toBeInstanceOf(NativeAuthError)
  expect(f.store.list()).toEqual([])
})
it('legacy MiniMax native identity stays legacy and is never automatically upgraded', async () => {
  const f = fixture(), old = { kind: 'native-principal', value: principal } as const
  const d = await f.store.import(request(), project(old), async () => old)
  expect(payload(join(f.root, 'registry.json')).schema).toBe(1)
  const c = await f.store.resolve(d.id, 'minimax', async () => old)
  expect(c.identityPolicy).toEqual({ kind: 'legacy-v1' })
  await expect(f.store.import({ ...request('upgrade'), id: d.id, expectedRecordRevision: d.recordRevision }, project(), current)).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' })
  expect(f.store.list()).toEqual([d])
})
