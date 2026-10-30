// Standalone Host-private persistence, NOT source authorization. Do not expose
// this API through model tools. Future trusted adapters must independently prove
// coherent generation/source binding, whitelist, format and native identity.
// A prepare/verify callback existing or returning an identity is not that proof.
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import {
  AuthDirectory, cancelled, checkPaths, createAuthDirectory,
  fail, isNativeAuthCleanupUnconfirmedError, nativeAuthFailureCode, platformSupport, relativeParts,
} from './native-auth-files.ts'
import { isProcessCleanupUnconfirmedError } from './process.ts'

const opaque = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9a-f-]{36}$`))
const cliSchema = z.enum(['antigravity', 'minimax', 'codex'])
const labelSchema = z.string().min(1).max(100).refine(s => !/[\x00-\x1f\x7f]/.test(s))
const digest = z.string().regex(/^[0-9a-f]{64}$/)
const descriptorSchema = z.object({
  id: opaque('ap'), cli: cliSchema, label: labelSchema,
  materialRevision: opaque('m'), recordRevision: z.number().int().min(1),
  enabled: z.boolean(), state: z.enum(['available', 'disabled']),
}).strict()
// Plugin-private policy, NOT fields or a schema version invented for Native
// token files. Adapters still must prove the actual format/route/protection.
const legacyPolicySchema = z.object({ kind: z.literal('legacy-v1') }).strict()
const oauthPolicySchema = z.object({
  kind: z.literal('oauth-credential'), policyVersion: z.literal(1),
  cli: z.literal('antigravity'), authMethod: z.literal('consumer'), route: z.literal('native'),
  mode: z.enum(['refresh-token', 'access-only']),
}).strict()
const miniMaxPolicySchema = z.object({
  kind: z.literal('minimax-native-principal'), policyVersion: z.literal(1),
  cli: z.literal('minimax'), buildEnv: z.literal('prod'), format: z.literal('mcode-0.6.12-file-v1'),
  region: z.enum(['cn', 'en']), configPolicy: z.enum(['empty', 'native-default', 'account-only']), refreshGroup: digest,
  configDigest: digest.optional(),
}).strict().refine(value => (value.configPolicy === 'account-only') === (value.configDigest !== undefined))
const currentPolicySchema = z.discriminatedUnion('kind', [oauthPolicySchema, miniMaxPolicySchema])
const policySchema = z.discriminatedUnion('kind', [legacyPolicySchema, oauthPolicySchema, miniMaxPolicySchema])
const legacyMaterialSchema = z.object({
  // Historical field name: an identity digest, not necessarily remote principal.
  materialRevision: opaque('m'), principal: digest, rootIdentity: z.string().regex(/^\d+:\d+$/),
}).strict()
const materialSchema = legacyMaterialSchema.extend({ identityPolicy: policySchema }).strict()
const recordBaseSchema = descriptorSchema.omit({ state: true })
const legacyRecordSchema = recordBaseSchema.extend({ materials: z.array(legacyMaterialSchema).min(1).max(512) }).strict()
const recordSchema = recordBaseSchema.extend({ materials: z.array(materialSchema).min(1).max(512) }).strict()
const requestsSchema = z.array(z.object({ requestId: z.string().min(1).max(128), input: digest, result: descriptorSchema }).strict()).max(2048)
const legacyRegistrySchema = z.object({ schema: z.literal(1), records: z.array(legacyRecordSchema).max(128), requests: requestsSchema }).strict()
const registryV2Schema = z.object({ schema: z.literal(2), records: z.array(recordSchema).max(128), requests: requestsSchema }).strict()
const registrySchema = z.discriminatedUnion('schema', [legacyRegistrySchema, registryV2Schema])
const legacyManifestSchema = legacyMaterialSchema.extend({ schema: z.literal(1), id: opaque('ap'), cli: cliSchema }).strict()
const currentManifestSchema = legacyMaterialSchema.extend({ identityPolicy: currentPolicySchema, schema: z.literal(2), id: opaque('ap'), cli: cliSchema }).strict()
const manifestSchema = z.discriminatedUnion('schema', [legacyManifestSchema, currentManifestSchema])
const legacyIdentitySchema = z.object({ kind: z.enum(['native-principal', 'api-credential']), value: z.string().min(1).max(8192) }).strict()
const oauthIdentitySchema = oauthPolicySchema.extend({ value: z.string().min(1).max(8192).refine(value => Boolean(value.trim())) }).strict()
const miniMaxIdentitySchema = z.object({
  kind: z.literal('native-principal'), value: z.string().min(1).max(8192), identityPolicy: miniMaxPolicySchema,
}).strict()
const identitySchema = z.union([legacyIdentitySchema, oauthIdentitySchema, miniMaxIdentitySchema])
const miniMaxRefreshGroup = (value: string, region: 'cn' | 'en') => createHash('sha256')
  .update(JSON.stringify(['native-auth-minimax-refresh-group', 1, 'prod', region, value])).digest('hex')
const requestSchema = z.object({ requestId: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/) }).strict()
const importSchema = requestSchema.extend({
  cli: cliSchema, label: labelSchema, id: opaque('ap').optional(), expectedRecordRevision: z.number().int().min(1).optional(),
  // An adapter-supplied source/operation identity is bound to request replay.
  // It is private, need not be a path, and is never returned.
  sourceKey: z.string().min(1).max(2048).optional(),
}).strict().refine(x => Boolean(x.id) === (x.expectedRecordRevision !== undefined))
const manageSchema = requestSchema.extend({
  id: opaque('ap'), expectedRecordRevision: z.number().int().min(1), label: labelSchema.optional(), enabled: z.boolean().optional(),
}).strict().refine(x => x.label !== undefined || x.enabled !== undefined)
const MAX_REGISTRY = 4 * 1024 * 1024
const viewSize = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!
const fillBytes = Uint8Array.prototype.fill
const isProjectionBytes = (value: unknown): value is Uint8Array => {
  if (!ArrayBuffer.isView(value) || !(value instanceof Uint8Array)) return false
  // A detached view still passes both checks and reports byteLength=0. A
  // zero-range intrinsic validates usability without changing any source byte.
  try { fillBytes.call(value, 0, 0, 0); return true } catch { return false }
}
const byteSize = (value: Uint8Array): number => viewSize.call(value)
const bytesSchema = z.custom<Uint8Array>(isProjectionBytes)

// Normalize only in memory. Schema1 bytes/HMACs and manifests are not rewritten
// merely by open/list/resolve or by an identity-kind inference.
type Registry = Omit<z.infer<typeof registryV2Schema>, 'schema'> & { schema: 1 | 2 }
type RecordEntry = z.infer<typeof recordSchema>
export type NativeAuthIdentityPolicy = Readonly<z.infer<typeof policySchema>>
const legacyPolicy: NativeAuthIdentityPolicy = Object.freeze({ kind: 'legacy-v1' })
const samePolicy = (a: NativeAuthIdentityPolicy, b: NativeAuthIdentityPolicy) => JSON.stringify(a) === JSON.stringify(b)
function policyFor(identity: NativeAuthIdentity): NativeAuthIdentityPolicy {
  if (identity.kind === 'native-principal' && 'identityPolicy' in identity)
    return Object.freeze(miniMaxPolicySchema.parse(identity.identityPolicy))
  if (identity.kind !== 'oauth-credential') return legacyPolicy
  const { value: _secret, ...policy } = identity
  return Object.freeze(oauthPolicySchema.parse(policy))
}
export type NativeAuthCli = z.infer<typeof cliSchema>
/** The ONLY public store DTO. Never spread a private record into it. */
export type NativeAuthDescriptor = Readonly<z.infer<typeof descriptorSchema>>
export type NativeAuthIdentity = Readonly<z.infer<typeof identitySchema>>
/** Host-only factory. Its input must already be a freshly proved Native
 * principal, not an email, cached label, token claim or model-list result. */
export function miniMaxProfileIdentity(value: string, region: 'cn' | 'en', configPolicy: 'empty' | 'native-default'): NativeAuthIdentity {
  const input = z.object({ value: z.string().min(1).max(8192), region: z.enum(['cn', 'en']), configPolicy: z.enum(['empty', 'native-default']) }).strict().safeParse({ value, region, configPolicy })
  if (!input.success) fail('INVALID_INPUT')
  const selected = Object.freeze({
    kind: 'minimax-native-principal' as const, policyVersion: 1 as const, cli: 'minimax' as const,
    buildEnv: 'prod' as const, format: 'mcode-0.6.12-file-v1' as const,
    region: input.data.region, configPolicy: input.data.configPolicy,
    refreshGroup: miniMaxRefreshGroup(input.data.value, input.data.region),
  })
  return Object.freeze({ kind: 'native-principal' as const, value: input.data.value, identityPolicy: selected })
}
/** Account-only material has a separate signed protected-settings expectation;
 * it never upgrades an old empty/default material or carries business agents. */
export function miniMaxAccountProfileIdentity(value: string, region: 'cn' | 'en', configDigest: string): NativeAuthIdentity {
  const base = miniMaxProfileIdentity(value, region, 'empty')
  if (!('identityPolicy' in base)) fail('INVALID_INPUT')
  const selected = miniMaxPolicySchema.safeParse({ ...base.identityPolicy, configPolicy: 'account-only', configDigest })
  if (!selected.success) fail('INVALID_INPUT')
  return Object.freeze({ kind: 'native-principal' as const, value, identityPolicy: Object.freeze(selected.data) })
}
export type NativeAuthImport = z.input<typeof importSchema> & { signal?: AbortSignal }
export type NativeAuthManage = z.input<typeof manageSchema>
/** Private trusted-adapter context. No principal/raw credentials are returned. */
export interface NativeAuthContext {
  readonly id: string
  readonly cli: NativeAuthCli
  readonly materialRevision: string
  readonly nativeRoot: string
  /** Absent only while prepare projects source bytes. Verify and resolve always
   * receive a validated immutable policy; absence is NOT a legacy fallback. */
  readonly identityPolicy?: NativeAuthIdentityPolicy
}
export interface NativeAuthMaterial {
  identity: NativeAuthIdentity
  files: readonly { path: string; bytes: Uint8Array }[]
}
export type NativeAuthPrepare = (context: NativeAuthContext) => Promise<NativeAuthMaterial>
export type NativeAuthVerify = (context: NativeAuthContext) => Promise<NativeAuthIdentity>
const publicDescriptor = (r: RecordEntry): NativeAuthDescriptor => Object.freeze({
  id: r.id, cli: r.cli, label: r.label, materialRevision: r.materialRevision,
  recordRevision: r.recordRevision, enabled: r.enabled, state: r.enabled ? 'available' : 'disabled',
})
const safeError = (error: unknown): never => fail(nativeAuthFailureCode(error) ?? 'STORE_UNAVAILABLE')
function callbackError(error: unknown, signal?: AbortSignal): never {
  // A cancellation cannot certify that an owned process range has exited. Only
  // constructor-owned witnesses outrank it, never a code/name/message spoof.
  if (isNativeAuthCleanupUnconfirmedError(error) || isProcessCleanupUnconfirmedError(error)) fail('CLEANUP_UNCONFIRMED')
  cancelled(signal)
  // Reconstruct even our own errors: a callback must not smuggle a modified
  // message/stack/cause through an instanceof check.
  const code = nativeAuthFailureCode(error)
  if (code) return fail(code)
  return fail('VALIDATION_FAILED')
}

export class NativeAuthStore {
  readonly #path: string
  readonly #key: Buffer
  readonly #rootIdentity: string
  private constructor(root: AuthDirectory) {
    this.#path = root.path; this.#rootIdentity = root.nativeIdentity
    this.#key = root.read('key.bin', 32)
    if (this.#key.length !== 32) fail('STORE_UNAVAILABLE')
  }
  /** Explicit fresh provisioning only. Existing/partial roots are NOT repaired. */
  static initialize(path: string): NativeAuthStore {
    platformSupport()
    let root: AuthDirectory | undefined
    try {
      root = createAuthDirectory(path)
      root.mkdir('materials')
      const key = randomBytes(32)
      try {
        root.writeExclusive('key.bin', key)
        root.writeExclusive('registry.json', NativeAuthStore.#encode({ schema: 1, records: [], requests: [] }, key))
      } finally { key.fill(0) }
      const store = new NativeAuthStore(root)
      store.#load(root)
      return store
    } catch { return fail('STORE_UNAVAILABLE') } finally { root?.close() }
  }
  static open(path: string): NativeAuthStore {
    platformSupport()
    let root: AuthDirectory | undefined
    try {
      root = AuthDirectory.open(path, true)
      const store = new NativeAuthStore(root)
      store.#load(root)
      return store
    } catch { return fail('STORE_UNAVAILABLE') } finally { root?.close() }
  }
  static #encode(payload: unknown, key: Buffer): Buffer {
    const mac = createHmac('sha256', key).update(JSON.stringify(payload)).digest('hex')
    return Buffer.from(JSON.stringify({ payload, mac }))
  }
  #hash(input: unknown) { return createHmac('sha256', this.#key).update(JSON.stringify(input)).digest('hex') }
  #identityHash(identity: NativeAuthIdentity, cli: NativeAuthCli, expected: NativeAuthIdentityPolicy): string {
    if (!samePolicy(policyFor(identity), expected)) fail('IDENTITY_MISMATCH')
    if (identity.kind === 'oauth-credential') {
      if (identity.cli !== cli) fail('IDENTITY_MISMATCH')
      return this.#hash(['native-auth-oauth-credential', identity.policyVersion, identity.cli,
        identity.authMethod, identity.route, identity.mode, identity.value])
    }
    if (identity.kind === 'native-principal' && 'identityPolicy' in identity) {
      const policy = identity.identityPolicy
      if (cli !== 'minimax' || policy.refreshGroup !== miniMaxRefreshGroup(identity.value, policy.region)) fail('IDENTITY_MISMATCH')
      if (policy.configPolicy === 'account-only') {
        return this.#hash(['native-auth-minimax-account-only', policy.policyVersion, policy.cli,
          policy.buildEnv, policy.format, policy.region, policy.configDigest, policy.refreshGroup, identity.value])
      }
      return this.#hash(['native-auth-minimax-native-principal', policy.policyVersion, policy.cli,
        policy.buildEnv, policy.format, policy.region, policy.configPolicy, policy.refreshGroup, identity.value])
    }
    // Exact schema1 algorithm/order: do not add CLI, policy or a new prefix.
    // legacy-v1 means this opaque algorithm, NOT an inferred native/API kind.
    return this.#hash(identity)
  }
  #decode<T>(bytes: Buffer, schema: z.ZodType<T>): T {
    try {
      const envelope = z.object({ payload: z.unknown(), mac: digest }).strict().parse(JSON.parse(bytes.toString('utf8')))
      const expected = Buffer.from(this.#hash(envelope.payload), 'hex'), actual = Buffer.from(envelope.mac, 'hex')
      if (!timingSafeEqual(expected, actual)) fail('STORE_UNAVAILABLE')
      return schema.parse(envelope.payload)
    } finally { bytes.fill(0) }
  }
  #root(): AuthDirectory {
    let root: AuthDirectory | undefined
    try {
      root = AuthDirectory.open(this.#path, true)
      if (root.nativeIdentity !== this.#rootIdentity) fail('STORE_UNAVAILABLE')
      const key = root.read('key.bin', 32)
      try { if (key.length !== 32 || !timingSafeEqual(key, this.#key)) fail('STORE_UNAVAILABLE') } finally { key.fill(0) }
      return root
    } catch { root?.close(); fail('STORE_UNAVAILABLE') }
  }
  #load(root: AuthDirectory): Registry {
    try {
      root.verify(false)
      if (root.nativeIdentity !== this.#rootIdentity) fail('STORE_UNAVAILABLE')
      const key = root.read('key.bin', 32)
      try { if (key.length !== 32 || !timingSafeEqual(key, this.#key)) fail('STORE_UNAVAILABLE') } finally { key.fill(0) }
      const stored = this.#decode(root.read('registry.json', MAX_REGISTRY), registrySchema)
      const registry: Registry = stored.schema === 1 ? { ...stored, records: stored.records.map(record => ({
        ...record, materials: record.materials.map(material => ({ ...material, identityPolicy: legacyPolicy })),
      })) } : stored
      if (new Set(registry.records.map(r => r.id)).size !== registry.records.length ||
        new Set(registry.requests.map(r => r.requestId)).size !== registry.requests.length) fail('STORE_UNAVAILABLE')
      for (const record of registry.records) {
        if (new Set(record.materials.map(m => m.materialRevision)).size !== record.materials.length ||
          !record.materials.some(m => m.materialRevision === record.materialRevision) ||
          record.materials.some(m => m.principal !== record.materials[0].principal ||
            !samePolicy(m.identityPolicy, record.materials[0].identityPolicy))) fail('STORE_UNAVAILABLE')
        for (const material of record.materials) this.#context(root, record, material.materialRevision)
      }
      return registry
    } catch { fail('STORE_UNAVAILABLE') }
  }
  #context(root: AuthDirectory, record: RecordEntry, revision: string): NativeAuthContext {
    const material = record.materials.find(m => m.materialRevision === revision)
    if (!material) fail('NOT_FOUND')
    const materials = root.child('materials')
    let version: AuthDirectory | undefined, native: AuthDirectory | undefined
    try {
      version = materials.child(revision); native = version.child('native')
      const manifest = this.#decode(version.read('manifest.json', 4096), manifestSchema)
      if (manifest.id !== record.id || manifest.cli !== record.cli || manifest.materialRevision !== revision ||
        manifest.principal !== material.principal || manifest.rootIdentity !== material.rootIdentity || native.nativeIdentity !== material.rootIdentity) fail('STORE_UNAVAILABLE')
      if (manifest.schema === 1) {
        if (material.identityPolicy.kind !== 'legacy-v1') fail('STORE_UNAVAILABLE')
      } else if (material.identityPolicy.kind === 'legacy-v1' || material.identityPolicy.cli !== record.cli ||
        !samePolicy(manifest.identityPolicy, material.identityPolicy)) fail('STORE_UNAVAILABLE')
      return Object.freeze({ id: record.id, cli: record.cli, materialRevision: revision, nativeRoot: native.path,
        identityPolicy: Object.freeze({ ...material.identityPolicy }),
      })
    } finally { native?.close(); version?.close(); materials.close() }
  }
  #acquire(root: AuthDirectory): AuthDirectory {
    try { root.mkdir('write-lease') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('BUSY')
      fail('STORE_UNAVAILABLE')
    }
    return root.child('write-lease')
  }
  #release(root: AuthDirectory, lease?: AuthDirectory) {
    try { if (lease) root.releaseLease(lease) } catch { fail('STORE_UNAVAILABLE') } finally { lease?.close(); root.close() }
  }
  #replay(registry: Registry, requestId: string, input: string): NativeAuthDescriptor | undefined {
    const prior = registry.requests.find(r => r.requestId === requestId)
    if (prior && prior.input !== input) fail('CONFLICT')
    return prior ? Object.freeze({ ...prior.result }) : undefined
  }
  #publish(root: AuthDirectory, registry: Registry, requestId: string, input: string, result: NativeAuthDescriptor) {
    registry.requests.push({ requestId, input, result })
    // Bounded capacity is explicit and fail-closed, not lossy dedup eviction.
    // Pure legacy trees stay schema1. The first successful nonlegacy policy
    // upgrades only the atomic registry; old material/receipt bytes remain valid.
    if (registry.schema === 1 && registry.records.some(r => r.materials.some(m => m.identityPolicy.kind !== 'legacy-v1'))) fail('STORE_UNAVAILABLE')
    const stored = registry.schema === 1 ? legacyRegistrySchema.parse({ ...registry, records: registry.records.map(record => ({
      ...record, materials: record.materials.map(({ identityPolicy: _policy, ...material }) => material),
    })) }) : registryV2Schema.parse(registry)
    const bytes = NativeAuthStore.#encode(stored, this.#key)
    try { if (bytes.length > MAX_REGISTRY) fail('STORE_UNAVAILABLE'); root.replace('registry.json', bytes) } finally { bytes.fill(0) }
  }
  list(): NativeAuthDescriptor[] {
    const root = this.#root()
    try { return this.#load(root).records.map(publicDescriptor) } catch (error) { return safeError(error) } finally { root.close() }
  }
  manage(input: NativeAuthManage): NativeAuthDescriptor {
    let parsed: z.infer<typeof manageSchema>
    try { parsed = manageSchema.parse(input) } catch { fail('INVALID_INPUT') }
    const root = this.#root(); let lease: AuthDirectory | undefined
    try {
      lease = this.#acquire(root)
      const registry = this.#load(root), hash = this.#hash(['manage', parsed]), replay = this.#replay(registry, parsed.requestId, hash)
      if (replay) return replay
      const record = registry.records.find(r => r.id === parsed.id)
      if (!record) fail('NOT_FOUND')
      if (record.recordRevision !== parsed.expectedRecordRevision) fail('CONFLICT')
      if (parsed.label !== undefined) record.label = parsed.label
      if (parsed.enabled !== undefined) record.enabled = parsed.enabled
      record.recordRevision++
      const result = publicDescriptor(record)
      this.#publish(root, registry, parsed.requestId, hash, result)
      return result
    } catch (error) { return safeError(error) } finally { this.#release(root, lease) }
  }
  /** Host-private dedup preflight: read only the already committed receipt,
   * without requiring a now-missing export directory or re-verifying Native.
   * This is not a current availability/identity proof or a management bypass.
   * The eventual import retains its own atomic replay/conflict check. */
  lookupImport(input: NativeAuthImport): NativeAuthDescriptor | undefined {
    let parsed: z.infer<typeof importSchema>
    const { signal, ...parameters } = input
    try { parsed = importSchema.parse(parameters) } catch { fail('INVALID_INPUT') }
    cancelled(signal)
    const root = this.#root()
    try { return this.#replay(this.#load(root), parsed.requestId, this.#hash(['import', parsed])) }
    catch (error) { return safeError(error) } finally { root.close() }
  }
  async import(input: NativeAuthImport, prepare: NativeAuthPrepare, verify: NativeAuthVerify): Promise<NativeAuthDescriptor> {
    let parsed: z.infer<typeof importSchema>
    const { signal, ...parameters } = input
    try { parsed = importSchema.parse(parameters) } catch { fail('INVALID_INPUT') }
    cancelled(signal)
    const root = this.#root(); let lease: AuthDirectory | undefined
    let material: NativeAuthMaterial | undefined
    const ownedBytes: Uint8Array[] = []
    try {
      lease = this.#acquire(root)
      const registry = this.#load(root), hash = this.#hash(['import', parsed]), replay = this.#replay(registry, parsed.requestId, hash)
      if (replay) return replay
      const prior = parsed.id ? registry.records.find(r => r.id === parsed.id) : undefined
      if (parsed.id && !prior) fail('NOT_FOUND')
      if (prior && (prior.cli !== parsed.cli || prior.recordRevision !== parsed.expectedRecordRevision)) fail('CONFLICT')
      const id = prior?.id ?? `ap_${randomUUID()}`, revision = `m_${randomUUID()}`
      const materials = root.child('materials'); let version: AuthDirectory | undefined, native: AuthDirectory | undefined
      try {
        // The final path is fixed BEFORE adapter projection/validation. In
        // particular, MiniMax record keys may depend on this exact path.
        materials.mkdir(revision); version = materials.child(revision)
        version.mkdir('native'); native = version.child('native')
        const context = Object.freeze({ id, cli: parsed.cli, materialRevision: revision, nativeRoot: native.path })
        try { material = await prepare(context) } catch (error) { callbackError(error, signal) }
        // Ownership starts for bounded own-data projections on return, not only
        // after identity validation. Do not execute accessors/custom iterators to
        // discover hidden buffers. Proxies are not genuine typed-array views.
        try {
          const returned = material && Object.getOwnPropertyDescriptor(material, 'files')?.value
          if (Array.isArray(returned) && returned.length <= 16) {
            const length = returned.length
            for (let i = 0; i < length; i++) {
              const file = Object.getOwnPropertyDescriptor(returned, String(i))?.value
              const bytes = file && Object.getOwnPropertyDescriptor(file, 'bytes')?.value
              if (isProjectionBytes(bytes) && byteSize(bytes) <= 1024 * 1024) ownedBytes.push(bytes)
            }
          }
        } catch { /* Full validation/cancellation below still decides the error. */ }
        cancelled(signal)
        let principal: string, identityPolicy: NativeAuthIdentityPolicy
        try {
          const validated = z.object({ identity: identitySchema, files: z.array(z.object({ path: z.string(), bytes: bytesSchema }).strict()).min(1).max(16) }).strict().parse(material)
          material = validated
          for (const file of validated.files) if (!ownedBytes.includes(file.bytes)) ownedBytes.push(file.bytes)
          identityPolicy = policyFor(validated.identity)
          principal = this.#identityHash(validated.identity, parsed.cli, identityPolicy)
          checkPaths(validated.files.map(f => f.path))
        } catch { fail('INVALID_INPUT') }
        if (prior && prior.materials.some(m => m.principal !== principal || !samePolicy(m.identityPolicy, identityPolicy))) fail('IDENTITY_MISMATCH')
        let total = 0
        for (const file of material.files) {
          if (!isProjectionBytes(file.bytes) || byteSize(file.bytes) > 1024 * 1024 || (total += byteSize(file.bytes)) > 4 * 1024 * 1024) fail('INVALID_INPUT')
        }
        for (const file of material.files) {
          cancelled(signal)
          const parts = relativeParts(file.path), held: AuthDirectory[] = []; let directory = native
          try {
            for (const part of parts.slice(0, -1)) {
              try { directory.mkdir(part) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
              directory = directory.child(part); held.push(directory)
            }
            directory.writeExclusive(parts.at(-1)!, file.bytes)
          } finally { for (const dir of held.reverse()) dir.close() }
        }
        let validated: NativeAuthIdentity
        const verificationContext = Object.freeze({ ...context, identityPolicy })
        try { validated = identitySchema.parse(await verify(verificationContext)) } catch (error) { callbackError(error, signal) }
        if (this.#identityHash(validated, parsed.cli, identityPolicy) !== principal) fail('IDENTITY_MISMATCH')
        cancelled(signal); native.verify(false); version.verify(false)
        // Native validation/refresh may renew bytes, not substitute links or
        // insecure ownership. Do not compare immutable credential checksums.
        for (const file of material.files) {
          const parts = relativeParts(file.path), held: AuthDirectory[] = []; let directory = native
          try {
            for (const part of parts.slice(0, -1)) { directory = directory.child(part); held.push(directory) }
            directory.read(parts.at(-1)!, 1024 * 1024).fill(0)
          } finally { for (const dir of held.reverse()) dir.close() }
        }
        const baseEntry = { materialRevision: revision, principal, rootIdentity: native.nativeIdentity }
        const entry = { ...baseEntry, identityPolicy }
        const manifest = identityPolicy.kind === 'legacy-v1'
          ? { schema: 1, id, cli: parsed.cli, ...baseEntry }
          : { schema: 2, id, cli: parsed.cli, ...entry }
        version.writeExclusive('manifest.json', NativeAuthStore.#encode(manifest, this.#key))
        // An async trusted callback cannot legitimately bypass this lease or
        // mutate critical registry/key data. Recheck before the commit point.
        const latest = this.#load(root)
        if (this.#hash(latest) !== this.#hash(registry)) fail('CONFLICT')
        if (identityPolicy.kind !== 'legacy-v1') registry.schema = 2
        const record: RecordEntry = prior ?? { id, cli: parsed.cli, label: parsed.label, materialRevision: revision, recordRevision: 0, enabled: true, materials: [] }
        record.label = parsed.label; record.materialRevision = revision; record.recordRevision++; record.materials.push(entry)
        if (!prior) registry.records.push(record)
        const result = publicDescriptor(record)
        cancelled(signal)
        this.#publish(root, registry, parsed.requestId, hash, result)
        return result
      } finally { native?.close(); version?.close(); materials.close() }
    } catch (error) { return safeError(error) } finally {
      // Ownership of projected byte buffers transfers to import. Adapters must
      // not share buffers with their live state or retain them after return.
      try {
        for (const bytes of ownedBytes) {
          try { fillBytes.call(bytes, 0) }
          catch { /* A caller invalidated transferred ownership; never mask the
                   * primary result or skip other buffers/lease release. */ }
        }
      } finally { this.#release(root, lease) }
    }
  }
  async resolve(id: string, cli: NativeAuthCli, verify: NativeAuthVerify): Promise<NativeAuthContext> {
    return this.#resolve(id, cli, undefined, verify)
  }
  async resolvePinned(id: string, cli: NativeAuthCli, materialRevision: string, verify: NativeAuthVerify): Promise<NativeAuthContext> {
    return this.#resolve(id, cli, materialRevision, verify)
  }
  async #resolve(id: string, cli: NativeAuthCli, revision: string | undefined, verify: NativeAuthVerify): Promise<NativeAuthContext> {
    const root = this.#root()
    try {
      const registry = this.#load(root), record = registry.records.find(r => r.id === id && r.cli === cli)
      if (!record) fail('NOT_FOUND')
      if (!record.enabled) fail('DISABLED')
      const context = this.#context(root, record, revision ?? record.materialRevision)
      let principal: NativeAuthIdentity
      try { principal = identitySchema.parse(await verify(context)) } catch (error) { callbackError(error) }
      if (!context.identityPolicy || this.#identityHash(principal, cli, context.identityPolicy) !==
        record.materials.find(m => m.materialRevision === context.materialRevision)!.principal) fail('IDENTITY_MISMATCH')
      // Disable/management changes during async validation block admission;
      // label-only changes do not expire any legitimate material revision.
      const current = this.#load(root).records.find(r => r.id === id && r.cli === cli)
      if (!current?.enabled) fail('DISABLED')
      if (!revision && current.materialRevision !== context.materialRevision) fail('CONFLICT')
      this.#context(root, current, context.materialRevision)
      return context
    } catch (error) { return safeError(error) } finally { root.close() }
  }
}
