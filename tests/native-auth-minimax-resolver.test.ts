import { expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { NativeAuthStore, miniMaxProfileIdentity, miniMaxAccountProfileIdentity, type NativeAuthContext } from '../src/host/native-auth-store.ts'
import { MiniMaxAuthRefreshGroups } from '../src/host/native-auth-minimax-refresh.ts'
import { MiniMaxNativeProfileResolver, type MiniMaxProfileResolverDependencies } from '../src/host/native-auth-minimax-resolver.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError } from '../src/host/process.ts'
import { NativeAuthError } from '../src/host/native-auth-files.ts'

// Synthetic private store/target verifiers only. No source import, Native CLI,
// user identity HTTP, token refresh, real prompt or public Worker is exercised.
const value = 'SYNTHETIC_RESOLVER_NATIVE_PRINCIPAL'
const identity = () => miniMaxProfileIdentity(value, 'cn', 'empty')
const project = async () => ({ identity: identity(), files: [{ path: 'auth.json', bytes: Buffer.from('SYNTHETIC_MATERIAL') }] })
const current = async (context: NativeAuthContext) => {
  if (context.identityPolicy?.kind !== 'minimax-native-principal') throw new NativeAuthError('UNSUPPORTED')
  return miniMaxProfileIdentity(value, context.identityPolicy.region, context.identityPolicy.configPolicy)
}
async function fixture() {
  mkdirSync('.cache', { recursive: true })
  const root = mkdtempSync(join(process.cwd(), '.cache/auth-minimax-resolver-synthetic-'))
  const store = NativeAuthStore.initialize(join(root, 'store')), groups = MiniMaxAuthRefreshGroups.initialize(join(root, 'groups'))
  const descriptor = await store.import({ cli: 'minimax', label: 'Synthetic resolver', requestId: 'first' }, project, current)
  const verifyTarget = vi.fn(current)
  const dependencies: MiniMaxProfileResolverDependencies = { store, groups, verifyTarget }
  const create = () => new MiniMaxNativeProfileResolver(dependencies)
  return { root, store, groups, descriptor, verifyTarget, dependencies, create }
}
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(ok => { resolve = ok }); return { promise, resolve } }
it('authorizes a signed fixed profile and projects only its root/region into an isolated runtime config', async () => {
  const f = await fixture(), base = { ...DEFAULT_CONFIG, minimaxHome: '/SYNTHETIC_DEPLOYMENT', minimaxRegion: 'en' as const }
  const actual = await f.store.resolve(f.descriptor.id, 'minimax', current)
  const result = await f.create().run({ id: f.descriptor.id }, base, async operation => {
    expect(operation.config).not.toBe(base)
    expect(operation.config.minimaxHome).toBe(actual.nativeRoot); expect(operation.config.minimaxRegion).toBe('cn')
    expect(operation.pin).toEqual({ id: f.descriptor.id, materialRevision: f.descriptor.materialRevision })
    expect(Object.isFrozen(operation.pin)).toBe(true)
    return 'SYNTHETIC_OPERATION_DONE'
  })
  expect(result).toBe('SYNTHETIC_OPERATION_DONE'); expect(f.verifyTarget).toHaveBeenCalledTimes(1)
  expect(base.minimaxHome).toBe('/SYNTHETIC_DEPLOYMENT'); expect(base.minimaxRegion).toBe('en')
})
it('propagates the original signed account-only digest rather than a deployment-provided expectation', async () => {
  const f = await fixture(), digest = 'a'.repeat(64), expected = miniMaxAccountProfileIdentity(value, 'cn', digest)
  const descriptor = await f.store.import({ cli: 'minimax', label: 'Synthetic signed settings', requestId: 'signed-settings' }, async () => ({ identity: expected, files: [{ path: 'config.yaml', bytes: Buffer.from('SYNTHETIC_SETTINGS') }] }), async () => expected)
  f.dependencies.verifyTarget = vi.fn(async () => expected)
  const base = { ...DEFAULT_CONFIG, minimaxExpectedConfigDigest: 'b'.repeat(64) }
  await f.create().run({ id: descriptor.id, materialRevision: descriptor.materialRevision }, base, async operation => {
    expect(operation.config.minimaxExpectedConfigDigest).toBe(digest); expect(Object.isFrozen(operation.config)).toBe(true)
  })
  expect(base.minimaxExpectedConfigDigest).toBe('b'.repeat(64))
})
it('keeps the same refresh lease through authorization and the complete actual operation', async () => {
  const f = await fixture(), entered = deferred(), finish = deferred()
  const work = f.create().run({ id: f.descriptor.id }, DEFAULT_CONFIG, async () => { entered.resolve(); await finish.promise; return 1 })
  await entered.promise
  const group = (identity() as any).identityPolicy.refreshGroup
  await expect(f.groups.run(group, async () => 'WRONG')).rejects.toMatchObject({ code: 'BUSY' })
  finish.resolve(); expect(await work).toBe(1)
  expect(await f.groups.run(group, async () => 2)).toBe(2)
})
it('does not execute an operation whose post-verifier identity hash does not match', async () => {
  const f = await fixture(), work = vi.fn(async () => 'WRONG')
  f.dependencies.verifyTarget = vi.fn(async () => miniMaxProfileIdentity('SYNTHETIC_OTHER_PRINCIPAL', 'cn', 'empty'))
  await expect(f.create().run({ id: f.descriptor.id }, DEFAULT_CONFIG, work)).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' })
  expect(work).not.toHaveBeenCalled()
  const group = (identity() as any).identityPolicy.refreshGroup
  expect(await f.groups.run(group, async () => 1)).toBe(1)
})
it('does not execute after disablement during target verification', async () => {
  const f = await fixture(), work = vi.fn(async () => 'WRONG')
  f.dependencies.verifyTarget = vi.fn(async context => {
    f.store.manage({ id: f.descriptor.id, expectedRecordRevision: f.descriptor.recordRevision, enabled: false, requestId: 'disable' })
    return current(context)
  })
  await expect(f.create().run({ id: f.descriptor.id }, DEFAULT_CONFIG, work)).rejects.toMatchObject({ code: 'DISABLED' })
  expect(work).not.toHaveBeenCalled()
})
it('does not adopt a legacy material as a new MiniMax profile policy', async () => {
  const f = await fixture(), legacy = { kind: 'native-principal', value } as const
  const d = await f.store.import({ cli: 'minimax', label: 'Legacy', requestId: 'legacy' }, async () => ({ identity: legacy, files: [{ path: 'auth.json', bytes: Buffer.from('SYNTHETIC_LEGACY') }] }), async () => legacy)
  const operation = vi.fn(async () => 'WRONG')
  await expect(f.create().run({ id: d.id }, DEFAULT_CONFIG, operation)).rejects.toMatchObject({ code: 'UNSUPPORTED' })
  expect(operation).not.toHaveBeenCalled(); expect(f.verifyTarget).not.toHaveBeenCalled()
})
it('uses the old pinned material after same-principal reimport without moving conversations', async () => {
  const f = await fixture(), old = await f.store.resolve(f.descriptor.id, 'minimax', current)
  const next = await f.store.import({ cli: 'minimax', label: 'Next', requestId: 'next', id: f.descriptor.id, expectedRecordRevision: f.descriptor.recordRevision }, project, current)
  const firstRoot = await f.create().run({ id: f.descriptor.id, materialRevision: f.descriptor.materialRevision }, DEFAULT_CONFIG, async op => op.config.minimaxHome)
  const nextRoot = await f.create().run({ id: next.id }, DEFAULT_CONFIG, async op => op.config.minimaxHome)
  expect(firstRoot).toBe(old.nativeRoot); expect(nextRoot).not.toBe(firstRoot)
})
it('quarantines authentic cleanup uncertainty before any operation is admitted', async () => {
  const f = await fixture(), operation = vi.fn(async () => 'WRONG')
  f.dependencies.verifyTarget = vi.fn(async () => { throw new ProcessCleanupUnconfirmedError() })
  await expect(f.create().run({ id: f.descriptor.id }, DEFAULT_CONFIG, operation)).rejects.toMatchObject({ code: 'CLEANUP_UNCONFIRMED' })
  expect(operation).not.toHaveBeenCalled()
  const group = (identity() as any).identityPolicy.refreshGroup
  await expect(MiniMaxAuthRefreshGroups.open(join(f.root, 'groups')).run(group, async () => 'WRONG')).rejects.toMatchObject({ code: 'CLEANUP_UNCONFIRMED' })
})
it('fails promptly on an already-busy group without hanging the identity handoff', async () => {
  const f = await fixture(), entered = deferred(), finish = deferred(), group = (identity() as any).identityPolicy.refreshGroup
  const owner = f.groups.run(group, async () => { entered.resolve(); await finish.promise })
  await entered.promise
  try {
    await expect(f.create().run({ id: f.descriptor.id }, DEFAULT_CONFIG, async () => 'WRONG')).rejects.toMatchObject({ code: 'BUSY' })
    expect(f.verifyTarget).not.toHaveBeenCalled()
  } finally { finish.resolve(); await owner }
})
