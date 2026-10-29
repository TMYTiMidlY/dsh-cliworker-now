import { expect, it } from 'vitest'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NativeAuthStore, type NativeAuthContext, type NativeAuthIdentity } from '../src/host/native-auth-store.ts'
import { NativeAuthError } from '../src/host/native-auth-files.ts'
import { ProcessCleanupUnconfirmedError } from '../src/host/process.ts'

// All envelopes, credentials, roots and simulated Native updates are synthetic.
// This tests persistence policy, NOT AGY's actual serialized token/Native auth.
const R0 = 'SYNTHETIC_REFRESH_R0', R1 = 'SYNTHETIC_REFRESH_R1', A0 = 'SYNTHETIC_ACCESS_A0'
const policy = { kind: 'oauth-credential', policyVersion: 1, cli: 'antigravity', authMethod: 'consumer', route: 'native', mode: 'refresh-token' } as const
const pin = (value = R0, mode: 'refresh-token' | 'access-only' = 'refresh-token') => ({ ...policy, mode, value })
function fixture() {
  mkdirSync('.cache', { recursive: true })
  return mkdtempSync(join(process.cwd(), '.cache/auth-profile-oauth-store-synthetic-'))
}
const request = (requestId = 'oauth-1') => ({ cli: 'antigravity' as const, label: 'Synthetic OAuth', sourceKey: 'SYNTHETIC_AUTHORIZED_SOURCE', requestId })
const projected = (identity: NativeAuthIdentity = pin(), data: object = { r: R0, a: A0, expiry: 1 }) => async () => ({ identity, files: [{ path: 'auth.json', bytes: Buffer.from(JSON.stringify(data)) }] })
function current(context: NativeAuthContext): Promise<NativeAuthIdentity> {
  const selected = context.identityPolicy
  if (selected?.kind !== 'oauth-credential') throw new NativeAuthError('IDENTITY_MISMATCH')
  const data = JSON.parse(readFileSync(join(context.nativeRoot, 'auth.json'), 'utf8'))
  if (selected.mode === 'access-only' && data.r !== undefined) throw new NativeAuthError('IDENTITY_MISMATCH')
  const value = selected.mode === 'refresh-token' ? data.r : data.a
  if (typeof value !== 'string' || !value.trim()) throw new NativeAuthError('IDENTITY_MISMATCH')
  return Promise.resolve({ ...selected, value })
}
const hmac = (key: Buffer, value: unknown) => createHmac('sha256', key).update(JSON.stringify(value)).digest('hex')
function sign(path: string, key: Buffer, payload: unknown) { writeFileSync(path, JSON.stringify({ payload, mac: hmac(key, payload) }), { mode: 0o600 }) }
const payload = (path: string) => JSON.parse(readFileSync(path, 'utf8')).payload

// Independent fixed schema1 writer: do not create old fixtures with the new API.
function legacyFixture(kind: 'native-principal' | 'api-credential' = 'native-principal') {
  const root = join(fixture(), 'store'), key = randomBytes(32), id = `ap_${randomUUID()}`, revision = `m_${randomUUID()}`
  const version = join(root, 'materials', revision), nativeRoot = join(version, 'native')
  mkdirSync(nativeRoot, { recursive: true, mode: 0o700 })
  writeFileSync(join(root, 'key.bin'), key, { mode: 0o600 })
  writeFileSync(join(nativeRoot, 'auth.json'), 'SYNTHETIC_LEGACY_AUTH', { mode: 0o600 })
  const identity = { kind, value: 'SYNTHETIC_LEGACY_ID' }, st = statSync(nativeRoot, { bigint: true })
  const material = { materialRevision: revision, principal: hmac(key, identity), rootIdentity: `${st.dev}:${st.ino}` }
  const descriptor = { id, cli: 'codex' as const, label: 'Legacy', materialRevision: revision, recordRevision: 1, enabled: true, state: 'available' as const }
  const { state: _state, ...record } = descriptor
  const originalInput = { requestId: 'legacy-import', cli: 'codex' as const, label: 'Legacy', sourceKey: 'SYNTHETIC_LEGACY_SOURCE' }
  sign(join(version, 'manifest.json'), key, { ...material, schema: 1, id, cli: 'codex' })
  sign(join(root, 'registry.json'), key, { schema: 1, records: [{ ...record, materials: [material] }], requests: [{ requestId: originalInput.requestId, input: hmac(key, ['import', originalInput]), result: descriptor }] })
  return { root, key, identity, descriptor, originalInput, material, manifest: join(version, 'manifest.json'), nativeRoot }
}

it('persists a private versioned OAuth policy without changing the seven-key public descriptor', async () => {
  const root = join(fixture(), 'store'), store = NativeAuthStore.initialize(root)
  let prepared = '', verified = ''
  const p = await store.import(request(), async context => {
    prepared = context.nativeRoot; expect((context as any).identityPolicy).toBeUndefined()
    return projected()()
  }, async context => {
    verified = context.nativeRoot
    expect((context as any).identityPolicy).toEqual(policy)
    expect(Object.isFrozen((context as any).identityPolicy)).toBe(true)
    return current(context)
  })
  expect(verified).toBe(prepared)
  expect(Object.keys(p).sort()).toEqual(['cli', 'enabled', 'id', 'label', 'materialRevision', 'recordRevision', 'state'])
  const context = await NativeAuthStore.open(root).resolve(p.id, 'antigravity', current)
  expect((context as any).identityPolicy).toEqual(policy)
  const registry = payload(join(root, 'registry.json')), manifest = payload(join(context.nativeRoot, '../manifest.json'))
  expect(registry.schema).toBe(2); expect(manifest.schema).toBe(2)
  expect(registry.records[0].materials[0].identityPolicy).toEqual(policy)
  expect(manifest.identityPolicy).toEqual(policy)
  for (const text of [JSON.stringify(store.list()), JSON.stringify(registry), JSON.stringify(manifest)]) {
    expect(text).not.toContain(R0); expect(text).not.toContain(A0)
  }
  const descriptor = JSON.stringify(p)
  for (const secret of [root, 'identityPolicy', 'principal', 'nativeRoot', 'mode', 'policyVersion']) expect(descriptor).not.toContain(secret)
})

it('R0-preserving simulated access/expiry renewal survives cold resolve and pinned old roots', async () => {
  const root = join(fixture(), 'store'), store = NativeAuthStore.initialize(root), p = await store.import(request(), projected(), current)
  const old = await store.resolve(p.id, 'antigravity', current)
  writeFileSync(join(old.nativeRoot, 'auth.json'), JSON.stringify({ r: R0, a: 'SYNTHETIC_ACCESS_A1', expiry: 2 }), { mode: 0o600 })
  const renamed = store.manage({ id: p.id, expectedRecordRevision: p.recordRevision, label: 'Renamed', requestId: 'rename' })
  const next = await store.import({ ...request('reimport'), id: p.id, expectedRecordRevision: renamed.recordRevision }, projected(), current)
  const cold = NativeAuthStore.open(root)
  expect((await cold.resolvePinned(p.id, 'antigravity', p.materialRevision, current)).nativeRoot).toBe(old.nativeRoot)
  expect((await cold.resolve(p.id, 'antigravity', current)).materialRevision).toBe(next.materialRevision)
  expect(next.materialRevision).not.toBe(p.materialRevision)
})

it.each(['rotated', 'missing', 'empty'])('a current %s refresh credential cannot re-pin or fall back to unchanged access', async change => {
  const root = join(fixture(), 'store'), store = NativeAuthStore.initialize(root), p = await store.import(request(), projected(), current)
  const context = await store.resolve(p.id, 'antigravity', current)
  const data = change === 'missing' ? { a: A0 } : { r: change === 'rotated' ? R1 : '', a: A0 }
  writeFileSync(join(context.nativeRoot, 'auth.json'), JSON.stringify(data), { mode: 0o600 })
  await expect(NativeAuthStore.open(root).resolvePinned(p.id, 'antigravity', p.materialRevision, current)).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' })
  expect(store.list()).toEqual([p])
  expect(JSON.parse(readFileSync(join(context.nativeRoot, 'auth.json'), 'utf8'))).toEqual(data)
})

it('first target verification rotating R0 publishes nothing and never restores the old token', async () => {
  const root = join(fixture(), 'store'), store = NativeAuthStore.initialize(root); let staged = ''
  await expect(store.import(request(), projected(), async context => {
    staged = context.nativeRoot
    writeFileSync(join(staged, 'auth.json'), JSON.stringify({ r: R1, a: A0 }), { mode: 0o600 })
    return current(context)
  })).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' })
  expect(NativeAuthStore.open(root).list()).toEqual([])
  expect(JSON.parse(readFileSync(join(staged, 'auth.json'), 'utf8')).r).toBe(R1)
  expect(payload(join(root, 'registry.json')).requests).toEqual([])
  expect(payload(join(root, 'registry.json')).schema).toBe(1)
})

it.each(['changed-access', 'added-refresh'])('native access-only simulation rejects %s without upgrading the pinned policy', async change => {
  const root = join(fixture(), 'store'), store = NativeAuthStore.initialize(root)
  const p = await store.import(request(), projected(pin(A0, 'access-only'), { a: A0 }), current)
  const context = await store.resolve(p.id, 'antigravity', current)
  const data = change === 'changed-access' ? { a: 'SYNTHETIC_ACCESS_A1' } : { a: A0, r: R0 }
  writeFileSync(join(context.nativeRoot, 'auth.json'), JSON.stringify(data), { mode: 0o600 })
  await expect(NativeAuthStore.open(root).resolve(p.id, 'antigravity', current)).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' })
})

it.each(['refresh-rotation', 'mode', 'api', 'native', 'whitespace'])('same-ID %s replacement is rejected before target verify', async change => {
  const store = NativeAuthStore.initialize(join(fixture(), 'store')), p = await store.import(request(), projected(), current)
  const other: NativeAuthIdentity = change === 'refresh-rotation' ? pin(R1) : change === 'mode' ? pin(R0, 'access-only')
    : change === 'api' ? { kind: 'api-credential', value: R0 } : change === 'native' ? { kind: 'native-principal', value: R0 } : pin(` ${R0}`)
  let calls = 0
  await expect(store.import({ ...request(`replace-${change}`), id: p.id, expectedRecordRevision: p.recordRevision }, projected(other), async () => { calls++; return other })).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' })
  expect(calls).toBe(0); expect(store.list()).toEqual([p])
})

it('identical secrets have separate refresh/access/API domains and stable root-independent OAuth identity', async () => {
  const root = join(fixture(), 'store'), store = NativeAuthStore.initialize(root)
  const refresh = await store.import(request(), projected(pin(R0)), current)
  const access = await store.import(request('access'), projected(pin(R0, 'access-only'), { a: R0 }), current)
  const apiIdentity = { kind: 'api-credential' as const, value: R0 }
  const api = await store.import({ ...request('api'), cli: 'codex' }, projected(apiIdentity), async () => apiIdentity)
  const refresh2 = await store.import(request('refresh-copy'), projected(pin(R0)), current)
  const records = payload(join(root, 'registry.json')).records
  const digests = [refresh, access, api, refresh2].map(p => records.find((r: any) => r.id === p.id).materials[0].principal)
  expect(new Set(digests.slice(0, 3)).size).toBe(3); expect(digests[0]).toBe(digests[3])
  const key = readFileSync(join(root, 'key.bin'))
  expect(digests[0]).toBe(hmac(key, ['native-auth-oauth-credential', 1, 'antigravity', 'consumer', 'native', 'refresh-token', R0]))
})

it.each(['wrong-cli', 'version', 'route', 'auth-method', 'unknown-mode', 'missing-mode', 'blank-secret'])('unknown OAuth policy %s is not guessed or normalized', async change => {
  const store = NativeAuthStore.initialize(join(fixture(), 'store')), identity: any = pin(); let calls = 0
  if (change === 'version') identity.policyVersion = 2
  if (change === 'route') identity.route = 'custom'
  if (change === 'auth-method') identity.authMethod = 'unknown'
  if (change === 'unknown-mode') identity.mode = 'guess'
  if (change === 'missing-mode') delete identity.mode
  if (change === 'blank-secret') identity.value = '   '
  await expect(store.import({ ...request(), cli: change === 'wrong-cli' ? 'minimax' : 'antigravity' }, projected(identity), async () => { calls++; return identity })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  expect(calls).toBe(0); expect(store.list()).toEqual([])
})

it('request replay returns the old receipt without accepting R1 or calling validation again', async () => {
  const root = join(fixture(), 'store'), store = NativeAuthStore.initialize(root), p = await store.import(request(), projected(), current)
  const context = await store.resolve(p.id, 'antigravity', current)
  writeFileSync(join(context.nativeRoot, 'auth.json'), JSON.stringify({ r: R1, a: A0 }), { mode: 0o600 })
  let calls = 0
  const cold = NativeAuthStore.open(root)
  expect(await cold.import(request(), async () => { calls++; return projected(pin(R1))() }, async () => { calls++; return pin(R1) })).toEqual(p)
  expect(calls).toBe(0)
  await expect(cold.resolve(p.id, 'antigravity', current)).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' })
})

it.each(['native-principal', 'api-credential'] as const)('independent legacy %s fixture and receipt survive OAuth registry upgrade unchanged', async kind => {
  const f = legacyFixture(kind), beforeManifest = readFileSync(f.manifest), beforeRegistry = readFileSync(join(f.root, 'registry.json'))
  const store = NativeAuthStore.open(f.root)
  const old = await store.resolve(f.descriptor.id, 'codex', async context => {
    expect((context as any).identityPolicy).toEqual({ kind: 'legacy-v1' }); return f.identity
  })
  expect(old.nativeRoot).toBe(f.nativeRoot)
  expect(readFileSync(join(f.root, 'registry.json'))).toEqual(beforeRegistry)
  let calls = 0
  expect(await store.import(f.originalInput, async () => { calls++; return projected()() }, async () => { calls++; return f.identity })).toEqual(f.descriptor)
  expect(calls).toBe(0)
  const renamed = store.manage({ id: f.descriptor.id, expectedRecordRevision: 1, label: 'Renamed legacy', requestId: 'rename-legacy' })
  expect(payload(join(f.root, 'registry.json')).schema).toBe(1)
  const added = await store.import(request(), projected(), current)
  const registry = payload(join(f.root, 'registry.json')); expect(registry.schema).toBe(2)
  const legacy = registry.records.find((r: any) => r.id === f.descriptor.id)
  expect(legacy.materials[0]).toEqual({ ...f.material, identityPolicy: { kind: 'legacy-v1' } })
  expect(readFileSync(f.manifest)).toEqual(beforeManifest)
  const cold = NativeAuthStore.open(f.root)
  expect((await cold.resolvePinned(f.descriptor.id, 'codex', f.descriptor.materialRevision, async () => f.identity)).nativeRoot).toBe(old.nativeRoot)
  expect((await cold.resolve(added.id, 'antigravity', current) as any).identityPolicy).toEqual(policy)
  expect(await cold.import(f.originalInput, async () => { calls++; return projected()() }, async () => { calls++; return f.identity })).toEqual(f.descriptor)
  expect(calls).toBe(0)
  expect(cold.list().find(p => p.id === f.descriptor.id)).toEqual(renamed)
})

it.each(['kind', 'mode', 'policyVersion', 'route', 'missing-policy', 'manifest-mismatch'])('signed unknown or inconsistent policy %s fails before any verifier', async change => {
  const root = join(fixture(), 'store'), store = NativeAuthStore.initialize(root), p = await store.import(request(), projected(), current)
  const context = await store.resolve(p.id, 'antigravity', current), key = readFileSync(join(root, 'key.bin'))
  const path = change === 'manifest-mismatch' ? join(context.nativeRoot, '../manifest.json') : join(root, 'registry.json')
  const data = payload(path), entry = change === 'manifest-mismatch' ? data : data.records[0].materials[0]
  if (change === 'missing-policy') delete entry.identityPolicy
  else if (change === 'manifest-mismatch') entry.identityPolicy.mode = 'access-only'
  else entry.identityPolicy[change] = 'SYNTHETIC_UNKNOWN_POLICY'
  sign(path, key, data)
  expect(() => NativeAuthStore.open(root)).toThrowError('AUTH_STORE_UNAVAILABLE')
})

it('legacy opaque policy cannot be silently interpreted as OAuth by a verifier', async () => {
  const f = legacyFixture(), store = NativeAuthStore.open(f.root)
  await expect(store.resolve(f.descriptor.id, 'codex', async () => pin(f.identity.value))).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' })
  expect(readFileSync(f.manifest, 'utf8')).not.toContain('oauth-credential')
})

it.each(['prepare-auth', 'verify-auth', 'prepare-process', 'verify-process'])('actual owned cleanup failure outranks concurrent cancellation: %s', async kind => {
  const root = join(fixture(), 'store'), store = NativeAuthStore.initialize(root), controller = new AbortController()
  const error = kind.endsWith('auth') ? new NativeAuthError('CLEANUP_UNCONFIRMED') : new ProcessCleanupUnconfirmedError()
  Object.defineProperty(error, 'message', { value: 'SYNTHETIC_PRIVATE_ERROR_MESSAGE' })
  Object.defineProperty(error, 'cause', { value: { secret: R0 } })
  let codeReads = 0
  if (kind.endsWith('auth')) Object.defineProperty(error, 'code', { get: () => { codeReads++; throw new Error('SYNTHETIC_CODE_GETTER') } })
  const fail = () => { controller.abort({ secret: R0 }); throw error }
  const work = store.import({ ...request(), signal: controller.signal }, kind.startsWith('prepare') ? async () => fail() : projected(), kind.startsWith('verify') ? async () => fail() : current)
  const result = await work.catch(error => error)
  expect(result).toMatchObject({ code: 'CLEANUP_UNCONFIRMED', message: 'AUTH_CLEANUP_UNCONFIRMED' })
  expect(result).not.toHaveProperty('cause'); expect(codeReads).toBe(0)
  expect(JSON.stringify(result)).not.toContain(R0)
  expect(NativeAuthStore.open(root).list()).toEqual([])
})
it.each(['spoofed-auth', 'unknown-proxy'])('cancellation ignores unowned cleanup claims without probing %s', async kind => {
  const store = NativeAuthStore.initialize(join(fixture(), 'store')), controller = new AbortController(); let reads = 0
  const error = kind === 'spoofed-auth' ? new NativeAuthError('VALIDATION_FAILED')
    : new Proxy({}, { getPrototypeOf: () => { reads++; throw new Error('SYNTHETIC_PRIVATE_PROXY') }, get: () => { reads++; throw new Error('SYNTHETIC_PRIVATE_GETTER') } })
  if (kind === 'spoofed-auth') Object.defineProperty(error, 'code', { get: () => { reads++; return 'CLEANUP_UNCONFIRMED' } })
  await expect(store.import({ ...request(), signal: controller.signal }, projected(), async () => { controller.abort(); throw error })).rejects.toMatchObject({ code: 'CANCELLED' })
  expect(reads).toBe(0)
})
it('a mutated non-cleanup code cannot manufacture a cleanup witness without cancellation', async () => {
  const store = NativeAuthStore.initialize(join(fixture(), 'store')), error = new NativeAuthError('BUSY'); let reads = 0
  Object.defineProperty(error, 'code', { get: () => { reads++; return 'CLEANUP_UNCONFIRMED' } })
  await expect(store.import(request(), projected(), async () => { throw error })).rejects.toMatchObject({ code: 'BUSY' })
  expect(reads).toBe(0)
})
it('an unknown error proxy without cancellation remains opaque and unprobed', async () => {
  const store = NativeAuthStore.initialize(join(fixture(), 'store')); let reads = 0
  const error = new Proxy({}, { getPrototypeOf: () => { reads++; throw new Error(R0) }, get: () => { reads++; throw new Error(R0) } })
  const result = await store.import(request(), projected(), async () => { throw error }).catch(error => error)
  expect(result).toMatchObject({ code: 'VALIDATION_FAILED' }); expect(reads).toBe(0)
  expect(JSON.stringify(result)).not.toContain(R0)
})
it('early ownership uses own data and intrinsic length/wipe, not custom iteration or instance fill', async () => {
  const store = NativeAuthStore.initialize(join(fixture(), 'store')), controller = new AbortController()
  const bytes = Buffer.from('SYNTHETIC_INTRINSIC_WIPE'); let reads = 0
  Object.defineProperty(bytes, 'fill', { value: () => { reads++ } })
  Object.defineProperty(bytes, 'byteLength', { get: () => { reads++; throw new Error(R0) } })
  const files = [{ path: 'auth.json', bytes }]
  Object.defineProperty(files, Symbol.iterator, { get: () => { reads++; throw new Error(R0) } })
  await expect(store.import({ ...request(), signal: controller.signal }, async () => { controller.abort(); return { identity: pin(), files } }, current)).rejects.toMatchObject({ code: 'CANCELLED' })
  expect(reads).toBe(0); expect(bytes.every(byte => byte === 0)).toBe(true)
})
it('cancellation does not invoke an accessor to discover a buffer that was not delivered as data', async () => {
  const store = NativeAuthStore.initialize(join(fixture(), 'store')), controller = new AbortController(); let reads = 0
  const material = { identity: pin(), get files() { reads++; return [{ path: 'auth.json', bytes: Buffer.from(R0) }] } }
  await expect(store.import({ ...request(), signal: controller.signal }, async () => { controller.abort(); return material }, current)).rejects.toMatchObject({ code: 'CANCELLED' })
  expect(reads).toBe(0)
})
it('independent schema1 management receipts replay before and after OAuth publication', async () => {
  const f = legacyFixture(), registry = payload(join(f.root, 'registry.json'))
  const oldInput = { requestId: 'legacy-manage', id: f.descriptor.id, expectedRecordRevision: 1, label: 'Old managed label' }
  const oldResult = { ...f.descriptor, label: oldInput.label, recordRevision: 2 }
  registry.records[0].label = oldResult.label; registry.records[0].recordRevision = oldResult.recordRevision
  registry.requests.push({ requestId: oldInput.requestId, input: hmac(f.key, ['manage', oldInput]), result: oldResult })
  sign(join(f.root, 'registry.json'), f.key, registry)
  const manifest = readFileSync(f.manifest), store = NativeAuthStore.open(f.root)
  expect(store.manage(oldInput)).toEqual(oldResult)
  await store.import(request(), projected(), current)
  expect(NativeAuthStore.open(f.root).manage(oldInput)).toEqual(oldResult)
  expect(readFileSync(f.manifest)).toEqual(manifest)
})
it.each(['registry', 'manifest'])('one-sided schema downgrade of OAuth %s never becomes legacy fallback', async kind => {
  const root = join(fixture(), 'store'), store = NativeAuthStore.initialize(root), p = await store.import(request(), projected(), current)
  const context = await store.resolve(p.id, 'antigravity', current), key = readFileSync(join(root, 'key.bin'))
  const path = kind === 'registry' ? join(root, 'registry.json') : join(context.nativeRoot, '../manifest.json')
  const data = payload(path); data.schema = 1
  if (kind === 'registry') for (const record of data.records) for (const entry of record.materials) delete entry.identityPolicy
  else delete data.identityPolicy
  sign(path, key, data)
  expect(() => NativeAuthStore.open(root)).toThrowError('AUTH_STORE_UNAVAILABLE')
})
it.each(['disable', 'head'])('OAuth async resolve still rechecks management %s after verification', async kind => {
  const store = NativeAuthStore.initialize(join(fixture(), 'store')), p = await store.import(request(), projected(), current)
  await expect(store.resolve(p.id, 'antigravity', async context => {
    const identity = await current(context)
    if (kind === 'disable') store.manage({ id: p.id, expectedRecordRevision: p.recordRevision, enabled: false, requestId: 'disable-during-verify' })
    else await store.import({ ...request('reimport-during-verify'), id: p.id, expectedRecordRevision: p.recordRevision }, projected(), current)
    return identity
  })).rejects.toMatchObject({ code: kind === 'disable' ? 'DISABLED' : 'CONFLICT' })
})
it.each(['cancelled', 'invalid'])('an already detached projection is safely %s without stranding its write lease', async kind => {
  const root = join(fixture(), 'store'), store = NativeAuthStore.initialize(root), controller = new AbortController()
  const bytes = new Uint8Array([1, 2, 3]); structuredClone(bytes.buffer, { transfer: [bytes.buffer] })
  const result = await store.import({ ...request(), signal: controller.signal }, async () => {
    if (kind === 'cancelled') controller.abort()
    return { identity: pin(), files: [{ path: 'auth.json', bytes }] }
  }, current).catch(error => error)
  expect({ code: result.code, leaseExists: existsSync(join(root, 'write-lease')) }).toEqual({ code: kind === 'cancelled' ? 'CANCELLED' : 'INVALID_INPUT', leaseExists: false })
  expect((await store.import(request('after-detached'), projected(), current)).id).toBeTruthy()
})
it('a handed-off view detached by an invalid caller cannot mask the primary failure or skip remaining cleanup', async () => {
  const root = join(fixture(), 'store'), store = NativeAuthStore.initialize(root)
  const first = new Uint8Array([1, 2, 3]), second = Buffer.from('SYNTHETIC_SECOND_WIPE')
  const result = await store.import(request(), async () => ({ identity: pin(), files: [{ path: 'first.meta', bytes: first }, { path: 'second.meta', bytes: second }] }), async () => {
    structuredClone(first.buffer, { transfer: [first.buffer] }); throw new NativeAuthError('BUSY')
  }).catch(error => error)
  expect({ code: result.code, leaseExists: existsSync(join(root, 'write-lease')), secondWiped: second.every(byte => byte === 0) }).toEqual({ code: 'BUSY', leaseExists: false, secondWiped: true })
  expect((await store.import(request('after-late-detach'), projected(), current)).id).toBeTruthy()
})
it('a genuine empty projection remains usable at the generic byte layer', async () => {
  const store = NativeAuthStore.initialize(join(fixture(), 'store'))
  // Explicitly synthetic identity callback: not a claim that empty AGY auth works.
  const p = await store.import(request(), async () => ({ identity: pin(), files: [{ path: 'empty.meta', bytes: new Uint8Array(0) }] }), async () => pin())
  expect(p.id).toBeTruthy()
})
it('a byte proxy is rejected without probing its prototype, length or methods', async () => {
  const store = NativeAuthStore.initialize(join(fixture(), 'store')); let reads = 0
  const bytes = new Proxy(new Uint8Array([1, 2, 3]), { get: () => { reads++; throw new Error(R0) }, getPrototypeOf: () => { reads++; throw new Error(R0) } })
  await expect(store.import(request(), async () => ({ identity: pin(), files: [{ path: 'auth.json', bytes }] }), current)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  expect(reads).toBe(0)
})
it.each(['cancel-after-prepare', 'invalid-policy'])('transferred bounded projection bytes are wiped on %s', async kind => {
  const root = join(fixture(), 'store'), store = NativeAuthStore.initialize(root), controller = new AbortController()
  const bytes = Buffer.from('SYNTHETIC_OWNED_PROJECTION_SECRET'); let verified = false
  const identity: any = kind === 'invalid-policy' ? { ...pin(), policyVersion: 999 } : pin()
  await expect(store.import({ ...request(), signal: controller.signal }, async () => {
    if (kind === 'cancel-after-prepare') controller.abort()
    return { identity, files: [{ path: 'auth.json', bytes }] }
  }, async context => { verified = true; return current(context) })).rejects.toMatchObject({ code: kind === 'invalid-policy' ? 'INVALID_INPUT' : 'CANCELLED' })
  expect(verified).toBe(false); expect(bytes.every(byte => byte === 0)).toBe(true)
  expect(NativeAuthStore.open(root).list()).toEqual([])
})
