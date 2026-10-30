import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { NativeAuthStore, miniMaxAccountProfileIdentity } from '../src/host/native-auth-store.ts'
import { MiniMaxAuthRefreshGroups } from '../src/host/native-auth-minimax-refresh.ts'
import { MiniMaxNativeAuthProfiles } from '../src/host/native-auth-minimax-service.ts'
import { MiniMaxNativeTargetVerifier } from '../src/host/native-auth-minimax-target.ts'
import { projectMiniMaxAccountSettings } from '../src/host/native-auth-minimax-settings.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'

// Facade/resource semantics only; target verifier is synthetic when needed.
// No real source, account, Native process, identity HTTP or GUI is exercised.
afterEach(() => vi.restoreAllMocks())
const backend = { resolveExecutable: vi.fn(async name => name), spawn: vi.fn() } as unknown as ProcessBackend
const root = () => { mkdirSync('.cache', { recursive: true }); return mkdtempSync(join(process.cwd(), '.cache/auth-minimax-service-synthetic-')) }
async function fixture() {
  const directory = root(), store = NativeAuthStore.initialize(join(directory, 'native-auth-profiles'))
  MiniMaxAuthRefreshGroups.initialize(join(directory, 'native-auth-minimax-groups'))
  mkdirSync(join(directory, 'native-auth-minimax-verify-workspace'), { mode: 0o700 })
  const settings = projectMiniMaxAccountSettings(undefined, 'cn'), identity = miniMaxAccountProfileIdentity('SYNTHETIC_FACADE_PRINCIPAL', 'cn', settings.digest)
  const d = await store.import({ cli: 'minimax', label: 'Synthetic facade', requestId: 'first' }, async () => ({ identity, files: [{ path: 'config.yaml', bytes: settings.bytes }] }), async () => identity)
  const service = new MiniMaxNativeAuthProfiles(directory, backend, DEFAULT_CONFIG)
  return { directory, store, d, service, identity }
}
it('read-only listing has no store/root creation side effect', () => {
  const directory = root(), service = new MiniMaxNativeAuthProfiles(directory, backend, DEFAULT_CONFIG)
  expect(service.list()).toEqual([]); expect(readdirSync(directory)).toEqual([])
})
it('lists descriptors without roots, identity policy, config digest or credentials', async () => {
  const f = await fixture(); expect(f.service.list()).toEqual([f.d])
  expect(Object.keys(f.service.list()[0]).sort()).toEqual(['cli', 'enabled', 'id', 'label', 'materialRevision', 'recordRevision', 'state'])
})
it('selects a new registry head once without claiming Native authentication or moving an old pin', async () => {
  const f = await fixture(), verifier = vi.spyOn(MiniMaxNativeTargetVerifier.prototype, 'verify')
  const first = f.service.select(f.d.id)
  expect(first).toEqual({ id: f.d.id, materialRevision: f.d.materialRevision }); expect(Object.isFrozen(first)).toBe(true)
  const settings = projectMiniMaxAccountSettings(undefined, 'cn')
  const next = await f.store.import({ cli: 'minimax', label: 'Next synthetic head', requestId: 'head', id: f.d.id, expectedRecordRevision: f.d.recordRevision }, async () => ({ identity: f.identity, files: [{ path: 'config.yaml', bytes: settings.bytes }] }), async () => f.identity)
  expect(f.service.select(f.d.id)).toEqual({ id: next.id, materialRevision: next.materialRevision }); expect(first.materialRevision).toBe(f.d.materialRevision)
  expect(verifier).not.toHaveBeenCalled()
  f.service.manage({ id: next.id, expectedRecordRevision: next.recordRevision, requestId: 'disabled-head', enabled: false })
  expect(() => f.service.select(next.id)).toThrow('AUTH_DISABLED'); expect(() => f.service.select('/SYNTHETIC_ROOT')).toThrow('AUTH_INVALID_INPUT')
})
it('management changes only the CAS label/enablement and preserves material', async () => {
  const f = await fixture(), next = f.service.manage({ id: f.d.id, expectedRecordRevision: f.d.recordRevision, requestId: 'disable', label: 'New label', enabled: false })
  expect(next).toMatchObject({ label: 'New label', enabled: false, materialRevision: f.d.materialRevision })
  expect(next.recordRevision).toBe(f.d.recordRevision + 1)
  expect(() => f.service.manage({ id: f.d.id, expectedRecordRevision: f.d.recordRevision, requestId: 'stale', enabled: true })).toThrow(/^AUTH_/)
})
it('does not manage another CLI through the MiniMax facade', async () => {
  const f = await fixture(), legacy = { kind: 'native-principal', value: 'SYNTHETIC_OTHER_CLI' } as const
  const other = await f.store.import({ cli: 'codex', label: 'Other', requestId: 'other' }, async () => ({ identity: legacy, files: [{ path: 'auth.json', bytes: Buffer.from('SYNTHETIC_OTHER') }] }), async () => legacy)
  expect(f.service.list()).toEqual([f.d])
  expect(() => f.service.manage({ id: other.id, expectedRecordRevision: other.recordRevision, requestId: 'wrong-cli', enabled: false })).toThrow('AUTH_NOT_FOUND')
})
it('refuses destructive management while the same profile operation owns its scope', async () => {
  const f = await fixture(); vi.spyOn(MiniMaxNativeTargetVerifier.prototype, 'verify').mockResolvedValue(f.identity)
  let entered!: () => void, finish!: () => void
  const ready = new Promise<void>(ok => { entered = ok }), gate = new Promise<void>(ok => { finish = ok })
  const task = f.service.run({ id: f.d.id }, '/SYNTHETIC_MCODE', async operation => { expect(operation.signal.aborted).toBe(false); entered(); await gate; return 1 })
  await ready
  expect(() => f.service.manage({ id: f.d.id, expectedRecordRevision: f.d.recordRevision, requestId: 'busy', enabled: false })).toThrow('AUTH_BUSY')
  finish(); expect(await task).toBe(1)
})
it('registers work before a synchronous resource callback can initiate disposal', async () => {
  const f = await fixture(); let finish!: () => void, entered!: () => void, closing!: Promise<void>, disposed = false
  const ready = new Promise<void>(ok => { entered = ok }), gate = new Promise<void>(ok => { finish = ok })
  vi.spyOn(MiniMaxNativeTargetVerifier.prototype, 'verify').mockImplementation(async () => {
    closing = f.service.dispose(); void Promise.resolve(closing).then(() => { disposed = true }); entered(); await gate; return f.identity
  })
  const task = f.service.run({ id: f.d.id }, '/SYNTHETIC_MCODE', async () => 'WRONG')
  void task.catch(() => {})
  await ready
  try { await Promise.resolve(); expect(disposed).toBe(false) }
  finally { finish(); await expect(task).rejects.toThrow('AUTH_CANCELLED'); await closing }
})
it('does not interpret disposal as clearing an earlier authentic cleanup debt', async () => {
  const f = await fixture(); vi.spyOn(MiniMaxNativeTargetVerifier.prototype, 'verify').mockRejectedValue(new ProcessCleanupUnconfirmedError())
  await expect(f.service.run({ id: f.d.id }, '/SYNTHETIC_MCODE', async () => 'WRONG')).rejects.toThrow('AUTH_CLEANUP_UNCONFIRMED')
  await expect(f.service.dispose()).rejects.toThrow('AUTH_CLEANUP_UNCONFIRMED')
})
it('dispose propagates cancellation and waits for the admitted operation to actually settle', async () => {
  const f = await fixture(); vi.spyOn(MiniMaxNativeTargetVerifier.prototype, 'verify').mockResolvedValue(f.identity)
  let entered!: () => void, finish!: () => void, sawAbort = false
  const ready = new Promise<void>(ok => { entered = ok }), gate = new Promise<void>(ok => { finish = ok })
  const task = f.service.run({ id: f.d.id }, '/SYNTHETIC_MCODE', async operation => {
    operation.signal.addEventListener('abort', () => { sawAbort = true }, { once: true }); entered(); await gate
  })
  await ready
  let disposed = false
  const cleanup = f.service.dispose()
  try {
    expect(cleanup).toBeInstanceOf(Promise)
    void Promise.resolve(cleanup).then(() => { disposed = true })
    await Promise.resolve(); expect(sawAbort).toBe(true); expect(disposed).toBe(false)
  } finally { finish(); await task; await cleanup }
  expect(disposed).toBe(true)
})
