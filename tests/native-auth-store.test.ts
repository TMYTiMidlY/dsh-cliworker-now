import { expect, it, vi } from 'vitest'
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { NativeAuthStore, type NativeAuthIdentity } from '../src/host/native-auth-store.ts'
import { AuthDirectory } from '../src/host/native-auth-files.ts'

// All credentials in this file are deliberately synthetic. Retain fixtures.
const marker = 'SYNTHETIC_SECRET_DO_NOT_DISCLOSE'
const identity = { kind: 'native-principal' as const, value: 'SYNTHETIC_ACCOUNT_A' }
function fixture() {
  mkdirSync('.cache', { recursive: true })
  return mkdtempSync(join(process.cwd(), '.cache/auth-profile-store-synthetic-'))
}
const material = (value = marker, principal: NativeAuthIdentity = identity) => async () => ({
  identity: principal, files: [{ path: 'auth.json', bytes: Buffer.from(value) }],
})
const verify = async () => identity
const create = (store: NativeAuthStore, requestId = 'synthetic-request-1') => store.import({
  cli: 'codex', label: 'Synthetic account', requestId,
}, material(), verify)

it('opaque public descriptors exclude private identity, roots, fingerprints and bytes', async () => {
  const root = fixture(), store = NativeAuthStore.initialize(join(root, 'store'))
  const p = await create(store)
  expect(Object.keys(p).sort()).toEqual(['cli', 'enabled', 'id', 'label', 'materialRevision', 'recordRevision', 'state'])
  expect(p.id).not.toContain('Synthetic')
  const text = JSON.stringify(store.list())
  for (const secret of [root, marker, identity.value, 'principal', 'nativeRoot', 'hash', 'cause']) expect(text).not.toContain(secret)
})

it('rename changes management CAS only; old pinned material survives same-ID reimport and cold open', async () => {
  const root = join(fixture(), 'store'), a = NativeAuthStore.initialize(root), p = await create(a)
  const old = await a.resolve(p.id, 'codex', verify)
  const renamed = a.manage({ id: p.id, expectedRecordRevision: p.recordRevision, label: 'Renamed', requestId: 'rename-1' })
  expect(renamed.materialRevision).toBe(p.materialRevision)
  expect(renamed.recordRevision).not.toBe(p.recordRevision)
  const next = await a.import({ cli: 'codex', label: 'Renamed', requestId: 'reimport-1', id: p.id, expectedRecordRevision: renamed.recordRevision }, material('SYNTHETIC_RENEWED'), verify)
  expect(next.id).toBe(p.id); expect(next.materialRevision).not.toBe(p.materialRevision)
  const b = NativeAuthStore.open(root)
  expect((await b.resolve(p.id, 'codex', verify)).nativeRoot).not.toBe(old.nativeRoot)
  expect((await b.resolvePinned(p.id, 'codex', p.materialRevision, verify)).nativeRoot).toBe(old.nativeRoot)
  writeFileSync(join(old.nativeRoot, 'auth.json'), 'SYNTHETIC_NATIVE_REFRESH', { mode: 0o600 })
  expect((await b.resolvePinned(p.id, 'codex', p.materialRevision, verify)).nativeRoot).toBe(old.nativeRoot)
  await expect(b.resolvePinned(p.id, 'codex', p.materialRevision, async () => ({ ...identity, value: 'SYNTHETIC_OTHER' }))).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' })
})

it('request IDs replay exact committed receipts; differing inputs and stale CAS are rejected across instances', async () => {
  const root = join(fixture(), 'store'), a = NativeAuthStore.initialize(root), p = await create(a)
  const b = NativeAuthStore.open(root)
  expect(await create(b)).toEqual(p)
  expect(() => b.manage({ id: p.id, expectedRecordRevision: p.recordRevision, requestId: 'synthetic-request-1', enabled: false })).toThrowError('AUTH_CONFLICT')
  const input = { id: p.id, expectedRecordRevision: p.recordRevision, requestId: 'manage-1', enabled: false }
  const disabled = a.manage(input)
  expect(b.manage(input)).toEqual(disabled)
  expect(() => b.manage({ ...input, requestId: 'manage-2' })).toThrowError('AUTH_CONFLICT')
  await expect(b.resolve(p.id, 'codex', verify)).rejects.toMatchObject({ code: 'DISABLED' })
  await expect(b.resolvePinned(p.id, 'codex', p.materialRevision, verify)).rejects.toMatchObject({ code: 'DISABLED' })
  // Disable is management-only: the original native material remains intact.
  const enabled = b.manage({ id: p.id, expectedRecordRevision: disabled.recordRevision, requestId: 'enable-1', enabled: true })
  expect(enabled.materialRevision).toBe(p.materialRevision)
  expect(readFileSync(join((await b.resolvePinned(p.id, 'codex', p.materialRevision, verify)).nativeRoot, 'auth.json'), 'utf8')).toBe(marker)
})

it('identity is never inferred from provider, label or path, including API key changes', async () => {
  const store = NativeAuthStore.initialize(join(fixture(), 'store'))
  const api = { kind: 'api-credential' as const, value: 'SYNTHETIC_API_KEY_A' }
  const p = await store.import({ cli: 'codex', label: 'Same provider', requestId: 'api-1' }, material(marker, api), async () => api)
  const other = { ...api, value: 'SYNTHETIC_API_KEY_B' }
  await expect(store.import({ cli: 'codex', label: p.label, id: p.id, expectedRecordRevision: p.recordRevision, requestId: 'api-2' }, material(marker, other), async () => other)).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' })
  expect(store.list()).toEqual([p])
})

it('filesystem lease spans async staging and validation; other instances cannot race writes', async () => {
  const root = join(fixture(), 'store'), a = NativeAuthStore.initialize(root), b = NativeAuthStore.open(root)
  let resume!: () => void
  const held = new Promise<void>(resolve => { resume = resolve })
  let entered!: () => void
  const ready = new Promise<void>(resolve => { entered = resolve })
  const pending = a.import({ cli: 'codex', label: 'Async', requestId: 'async-1' }, async () => { entered(); await held; return material()() }, verify)
  await ready
  await expect(create(b, 'async-2')).rejects.toMatchObject({ code: 'BUSY' })
  expect(b.list()).toEqual([])
  resume(); await pending
  expect((await create(b, 'async-2')).id).toBeTruthy()
  expect(b.list()).toHaveLength(2)
})

it.each(['registry', 'key', 'manifest'])('critical %s missing or corrupt never falls back or resurrects material', async kind => {
  const root = join(fixture(), 'store'), store = NativeAuthStore.initialize(root), p = await create(store)
  const context = await store.resolve(p.id, 'codex', verify)
  const file = kind === 'registry' ? join(root, 'registry.json') : kind === 'key' ? join(root, 'key.bin') : join(context.nativeRoot, '..', 'manifest.json')
  renameSync(file, `${file}.retained-synthetic`)
  expect(() => NativeAuthStore.open(root).list()).toThrowError('AUTH_STORE_UNAVAILABLE')
  expect(() => NativeAuthStore.initialize(root)).toThrowError('AUTH_STORE_UNAVAILABLE')
})

it('bad registry/key content and insecure modes are safe errors without cause or marker', async () => {
  for (const name of ['registry.json', 'key.bin']) {
    const root = join(fixture(), 'store'), store = NativeAuthStore.initialize(root)
    await create(store); writeFileSync(join(root, name), marker, { mode: 0o600 })
    try { NativeAuthStore.open(root).list(); expect.unreachable() } catch (error) {
      expect(String(error)).toBe('NativeAuthError: AUTH_STORE_UNAVAILABLE')
      expect(JSON.stringify(error)).not.toContain(marker)
      expect(error).not.toHaveProperty('cause')
    }
  }
  const root = join(fixture(), 'store'); NativeAuthStore.initialize(root); chmodSync(root, 0o755)
  expect(() => NativeAuthStore.open(root)).toThrowError('AUTH_STORE_UNAVAILABLE')
})

it('failed validation/cancellation leave old head intact; unpublished revisions never resolve on restart', async () => {
  const root = join(fixture(), 'store'), store = NativeAuthStore.initialize(root), p = await create(store)
  let failedRoot = ''
  await expect(store.import({ cli: 'codex', label: 'Failed', id: p.id, expectedRecordRevision: p.recordRevision, requestId: 'failed-1' }, material(), async context => { failedRoot = context.nativeRoot; throw new Error(marker) })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  const signal = AbortSignal.abort(marker)
  await expect(store.import({ cli: 'codex', label: 'Cancelled', requestId: 'cancel-1', signal }, material(), verify)).rejects.toMatchObject({ code: 'CANCELLED' })
  const cold = NativeAuthStore.open(root)
  expect(cold.list()).toEqual([p])
  await expect(cold.resolvePinned(p.id, 'codex', failedRoot.split('/').at(-2)!, verify)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  expect((await cold.resolve(p.id, 'codex', verify)).materialRevision).toBe(p.materialRevision)
})

it('filesystem lease excludes a real independent process for its entire async import', async () => {
  const root = join(fixture(), 'store'), store = NativeAuthStore.initialize(root)
  const child = fork(join(process.cwd(), 'tests/fixtures/native-auth-store-child.ts'), [root], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  const exited = once(child, 'exit')
  try {
    const [ready] = await once(child, 'message')
    expect(ready).toEqual({ ready: true })
    await expect(create(store, 'parent-request')).rejects.toMatchObject({ code: 'BUSY' })
    child.send({ proceed: true })
    const [done] = await once(child, 'message'); expect(done).toEqual({ completed: true })
    expect(await exited).toEqual([0, null])
    expect(store.list()).toHaveLength(1)
    await create(store, 'parent-request'); expect(store.list()).toHaveLength(2)
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited } }
})

it('cold crash lease fails closed without stale takeover or automatic removal', async () => {
  const root = join(fixture(), 'store'); NativeAuthStore.initialize(root)
  mkdirSync(join(root, 'write-lease'), { mode: 0o700 })
  const cold = NativeAuthStore.open(root)
  await expect(create(cold)).rejects.toMatchObject({ code: 'BUSY' })
  expect(readdirSync(root)).toContain('write-lease')
  expect(cold.list()).toEqual([])
})

it.each(['registry-link', 'key-link', 'root-link', 'material-root-swap'])('critical path tampering %s fails closed', async kind => {
  const parent = fixture(), root = join(parent, 'store'), store = NativeAuthStore.initialize(root), p = await create(store)
  if (kind === 'material-root-swap') {
    const context = await store.resolve(p.id, 'codex', verify)
    renameSync(context.nativeRoot, `${context.nativeRoot}.retained`)
    mkdirSync(context.nativeRoot, { mode: 0o700 })
  } else if (kind === 'root-link') {
    renameSync(root, `${root}.retained`); symlinkSync(`${root}.retained`, root)
  } else {
    const file = join(root, kind === 'key-link' ? 'key.bin' : 'registry.json')
    linkSync(file, `${file}.retained-link`)
  }
  expect(() => store.list()).toThrowError('AUTH_STORE_UNAVAILABLE')
})

it('validation root is already final and unchanging; partial write and callback cancellation never publish', async () => {
  const root = join(fixture(), 'store'), store = NativeAuthStore.initialize(root)
  let staged = ''
  const controller = new AbortController()
  await expect(store.import({ cli: 'minimax', label: 'Synthetic', requestId: 'interrupted', signal: controller.signal }, async context => {
    staged = context.nativeRoot
    return material()()
  }, async context => {
    expect(context.nativeRoot).toBe(staged)
    expect(readFileSync(join(context.nativeRoot, 'auth.json'), 'utf8')).toBe(marker)
    controller.abort(marker); return identity
  })).rejects.toMatchObject({ code: 'CANCELLED' })
  expect(NativeAuthStore.open(root).list()).toEqual([])
  expect(readFileSync(join(staged, 'auth.json'), 'utf8')).toBe(marker)
  const published = await store.import({ cli: 'minimax', label: 'Synthetic', requestId: 'interrupted' }, async context => { staged = context.nativeRoot; return material()() }, verify)
  expect((await store.resolve(published.id, 'minimax', verify)).nativeRoot).toBe(staged)
})

it('target symlink, traversal and native validation replacing auth with a link cannot escape owned root', async () => {
  const parent = fixture(), outside = join(parent, 'outside'); mkdirSync(outside, { mode: 0o700 })
  writeFileSync(join(outside, 'auth.json'), 'SYNTHETIC_OUTSIDE_UNCHANGED', { mode: 0o600 })
  const store = NativeAuthStore.initialize(join(parent, 'store'))
  await expect(store.import({ cli: 'codex', label: 'Unsafe', requestId: 'target-link' }, async context => {
    symlinkSync(outside, join(context.nativeRoot, 'auth'))
    return { identity, files: [{ path: 'auth/auth.json', bytes: Buffer.from(marker) }] }
  }, verify)).rejects.toBeDefined()
  await expect(store.import({ cli: 'codex', label: 'Unsafe', requestId: 'target-traversal' }, async () => ({ identity, files: [{ path: '../auth.json', bytes: Buffer.from(marker) }] }), verify)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  await expect(store.import({ cli: 'codex', label: 'Unsafe', requestId: 'validation-link' }, material(), async context => {
    renameSync(join(context.nativeRoot, 'auth.json'), join(context.nativeRoot, 'retained-auth.json'))
    symlinkSync(join(outside, 'auth.json'), join(context.nativeRoot, 'auth.json'))
    return identity
  })).rejects.toBeDefined()
  expect(readFileSync(join(outside, 'auth.json'), 'utf8')).toBe('SYNTHETIC_OUTSIDE_UNCHANGED')
  expect(store.list()).toEqual([])
})

it('key loss during async native validation blocks commit, with no repair or partial receipt', async () => {
  const root = join(fixture(), 'store'), store = NativeAuthStore.initialize(root)
  await expect(store.import({ cli: 'codex', label: 'Lost key', requestId: 'key-loss' }, material(), async () => {
    renameSync(join(root, 'key.bin'), join(root, 'key.retained')); return identity
  })).rejects.toMatchObject({ code: 'STORE_UNAVAILABLE' })
  expect(readFileSync(join(root, 'registry.json'), 'utf8')).not.toContain('key-loss')
})

it('failed atomic registry publish preserves old head and signed orphan manifests never resurrect', async () => {
  const root = join(fixture(), 'store'), store = NativeAuthStore.initialize(root), p = await create(store)
  let orphanRevision = ''
  const failure = vi.spyOn(AuthDirectory.prototype, 'replace').mockImplementation(() => { throw new Error(marker) })
  try {
    await expect(store.import({ cli: 'codex', label: p.label, id: p.id, expectedRecordRevision: p.recordRevision, requestId: 'publish-failure' }, async context => {
      orphanRevision = context.materialRevision; return material()()
    }, verify)).rejects.toMatchObject({ code: 'STORE_UNAVAILABLE' })
  } finally { failure.mockRestore() }
  expect(readFileSync(join(root, 'materials', orphanRevision, 'manifest.json'), 'utf8')).toContain(orphanRevision)
  const cold = NativeAuthStore.open(root)
  expect(cold.list()).toEqual([p])
  await expect(cold.resolvePinned(p.id, 'codex', orphanRevision, verify)).rejects.toMatchObject({ code: 'NOT_FOUND' })
})

it('async admission rechecks disable and head while pinned roots tolerate rename/reimport', async () => {
  const root = join(fixture(), 'store'), store = NativeAuthStore.initialize(root), p = await create(store)
  await expect(store.resolve(p.id, 'codex', async () => {
    store.manage({ id: p.id, expectedRecordRevision: p.recordRevision, requestId: 'disable-during-check', enabled: false })
    return identity
  })).rejects.toMatchObject({ code: 'DISABLED' })
  const disabled = store.list()[0]
  store.manage({ id: p.id, expectedRecordRevision: disabled.recordRevision, requestId: 'enable-after-check', enabled: true })
  const current = store.list()[0]
  await expect(store.resolve(p.id, 'codex', async () => {
    await store.import({ cli: 'codex', label: 'Reimported', id: p.id, expectedRecordRevision: current.recordRevision, requestId: 'head-during-check' }, material(), verify)
    return identity
  })).rejects.toMatchObject({ code: 'CONFLICT' })
  expect((await store.resolvePinned(p.id, 'codex', p.materialRevision, verify)).materialRevision).toBe(p.materialRevision)
})
