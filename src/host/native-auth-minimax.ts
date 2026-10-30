// Host-private Native 0.6.12 file-format building block. NOT an authorized
// importer, a physical snapshot, protection projection or remote auth proof.
import { createHash } from 'node:crypto'
import { isAbsolute, join, resolve, relative, sep } from 'node:path'
import { parseDocument } from 'yaml'
import { z } from 'zod'
import { fail } from './native-auth-files.ts'

const MAX_FILE_BYTES = 65536
const scope = z.string().min(1).max(8192)
const scopes = z.array(scope).min(1).max(128).refine(values => values.includes('agent.default'))
const generation = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const expiry = z.number().finite()
const credentialSchema = z.object({
  schemaVersion: z.literal(1), accessToken: z.string().min(1).max(8192),
  refreshToken: z.string().min(1).max(8192), tokenType: z.literal('Bearer'),
  clientId: z.literal('mcode-public'), audience: z.literal('agent-backend'),
  scopes, generation, expiresAtMs: expiry,
  subject: z.string().max(8192).optional(), accountId: z.string().max(8192).optional(),
  loginEpoch: z.string().max(8192).optional(),
}).strict()
const stateSchema = z.object({
  schemaVersion: z.literal(2), status: z.literal('authenticated'), storeKind: z.literal('file'),
  clientId: z.literal('mcode-public'), audience: z.literal('agent-backend'),
  buildEnv: z.literal('prod'), region: z.enum(['cn', 'en']), scopes, generation,
  expiresAtMs: expiry.optional(),
}).strict()
// Exact raw config initialized by the fixed 0.6.12 standard ACP entry. These
// literals validate that format; they are NOT a task model selection/catalog.
const initializedConfigSchema = z.object({
  logLevel: z.literal('info'), defaultModel: z.literal('minimax/MiniMax-M3.1-Flash-Preview'),
  dataContribution: z.object({ enabled: z.literal(true) }).strict(),
  memory: z.object({ enabled: z.literal(false) }).strict(),
  skipWindowsHardSafetyChecks: z.literal(false), skipParentDeathGuard: z.literal(false),
}).strict()
export type MiniMaxConfigPolicy = 'empty' | 'native-default'
/** Known source/default semantics only, never proof that other protection
 * files are absent. Preserve source bytes and do not manufacture {}. */
export function miniMaxConfigPolicy(bytes?: Uint8Array): MiniMaxConfigPolicy {
  if (bytes === undefined) return 'native-default'
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_FILE_BYTES) fail('UNSUPPORTED')
  let value: unknown
  try {
    const document = parseDocument(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), { logLevel: 'silent' })
    if (document.errors.length || document.warnings.length) fail('UNSUPPORTED')
    value = document.toJS({ maxAliasCount: 0 })
  } catch { fail('UNSUPPORTED') }
  if (value && typeof value === 'object' && !Array.isArray(value) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Object.keys(value).length === 0) return 'empty'
  if (initializedConfigSchema.safeParse(value).success) return 'native-default'
  return fail('UNSUPPORTED')
}
/** Post-Native/cold validation compares the ORIGINAL signed policy, not a new
 * baseline inferred from mutable config. Native initialization may add only
 * its proven native-default shape; it must not change empty's semantics. */
export function assertMiniMaxConfigPolicy(expected: MiniMaxConfigPolicy, bytes?: Uint8Array): void {
  if (expected !== 'empty' && expected !== 'native-default') fail('INVALID_INPUT')
  if (miniMaxConfigPolicy(bytes) !== expected) fail('IDENTITY_MISMATCH')
}
// Native validates every record. Dropping an invalid non-selected record would
// turn an invalid source envelope into an apparently usable account.
const recordKey = z.string().regex(/^com\.minimax\.mcode\.oauth\.prod\.(?:cn|en)\u0000[A-Za-z0-9_-]{43}$/)
const envelopeSchema = z.object({
  schemaVersion: z.literal(1), records: z.record(recordKey, credentialSchema),
}).strict()
const normalizedRoot = (root: string): string => {
  if (typeof root !== 'string' || root.length > 4096 || root.includes('\0') ||
      !isAbsolute(root) || resolve(root) !== root) fail('INVALID_INPUT')
  return root
}
const nested = (parent: string, child: string) => {
  const path = relative(parent, child)
  return path === '' || path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path)
}
const readBytes = (files: ReadonlyMap<string, Buffer>, path: string): Buffer => {
  const bytes = files.get(path)
  if (!Buffer.isBuffer(bytes) || bytes.byteLength < 1 || bytes.byteLength > MAX_FILE_BYTES) fail('UNSUPPORTED')
  return bytes
}
function json(bytes: Buffer): unknown {
  try {
    // Keep a possible BOM in the decoded value, as Native JSON parsing does;
    // fatal decoding rejects malformed bytes rather than replacing them.
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes))
  } catch { return fail('UNSUPPORTED') }
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) fail('UNSUPPORTED')
  return result.data
}
const sameScopes = (a: readonly string[], b: readonly string[]) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())

export interface MiniMaxNativeAuthProjection {
  readonly files: readonly { path: string; bytes: Uint8Array }[]
  /** Private, short-lived input to the existing Native identity check only. */
  readonly accessToken: string
}
export function miniMaxNativeAuthKey(root: string, region: 'cn' | 'en'): string {
  normalizedRoot(root)
  if (region !== 'cn' && region !== 'en') fail('INVALID_INPUT')
  const account = createHash('sha256').update(join(root, 'auth') + '\0mcode-public').digest('base64url')
  return `com.minimax.mcode.oauth.prod.${region}\0${account}`
}
interface MiniMaxNativeAuthInput {
  sourceRoot: string; region: 'cn' | 'en'; files: ReadonlyMap<string, Buffer>; nowMs?: number
}
function decodeMiniMaxNativeAuth(input: MiniMaxNativeAuthInput, phase: 'source' | 'before-native' | 'after-native' = 'source') {
  const sourceRoot = normalizedRoot(input.sourceRoot)
  if (input.region !== 'cn' && input.region !== 'en') fail('INVALID_INPUT')
  const now = input.nowMs ?? Date.now()
  if (!Number.isFinite(now) || now < 0) fail('INVALID_INPUT')
  // This format-only helper cannot authorize or project these protection
  // sources. Their actual absence must still be proved by the snapshot guard.
  for (const path of input.files.keys())
    if (path === 'permission.json' || path === 'agents' || path.startsWith('agents/') ||
        path === 'plugin-hook-permissions' || path.startsWith('plugin-hook-permissions/')) fail('UNSUPPORTED')
  const prefix = `auth/prod/${input.region}/mcode-public`
  const statePath = `${prefix}/auth-state.json`, authPath = `${prefix}/auth.json`
  const stateBytes = readBytes(input.files, statePath)
  const state = parse(stateSchema, json(stateBytes))
  const envelope = parse(envelopeSchema, json(readBytes(input.files, authPath)))
  const key = miniMaxNativeAuthKey(sourceRoot, input.region)
  if (!Object.hasOwn(envelope.records, key)) fail('UNSUPPORTED')
  const credential = envelope.records[key]
  if (state.region !== input.region || state.generation !== credential.generation ||
      !sameScopes(state.scopes, credential.scopes) ||
      state.expiresAtMs !== undefined && state.expiresAtMs !== credential.expiresAtMs ||
      phase === 'source' && credential.expiresAtMs - now < 60000 ||
      phase === 'after-native' && credential.expiresAtMs <= now) fail('UNSUPPORTED')
  const configBytes = input.files.has('config.yaml') ? readBytes(input.files, 'config.yaml') : undefined
  miniMaxConfigPolicy(configBytes)
  return { sourceRoot, authPath, statePath, stateBytes, configBytes, credential }
}
/** Source-format inspection for a trusted, still-held snapshot. No filesystem,
 * identity request, target path, temporary rekey or authorization occurs here. */
export function inspectMiniMaxNativeAuth(input: MiniMaxNativeAuthInput): Readonly<{ accessToken: string; configPolicy: MiniMaxConfigPolicy }> {
  const material = decodeMiniMaxNativeAuth(input)
  return Object.freeze({ accessToken: material.credential.accessToken, configPolicy: miniMaxConfigPolicy(material.configBytes) })
}
/** Target-only coherent sample; never used to relax source import expiry. */
export function inspectMiniMaxTargetAuth(input: { nativeRoot: string; region: 'cn' | 'en'; files: ReadonlyMap<string, Buffer>; nowMs?: number }, phase: 'before-native' | 'after-native'): Readonly<{ accessToken: string; expiresAtMs: number }> {
  if (phase !== 'before-native' && phase !== 'after-native') fail('INVALID_INPUT')
  const sample = decodeMiniMaxNativeAuth({ ...input, sourceRoot: input.nativeRoot }, phase)
  return Object.freeze({ accessToken: sample.credential.accessToken, expiresAtMs: sample.credential.expiresAtMs })
}
export function projectMiniMaxNativeAuth(input: MiniMaxNativeAuthInput & { targetRoot: string }): MiniMaxNativeAuthProjection {
  const sourceRoot = normalizedRoot(input.sourceRoot), targetRoot = normalizedRoot(input.targetRoot)
  if (nested(sourceRoot, targetRoot) || nested(targetRoot, sourceRoot)) fail('INVALID_INPUT')
  const { authPath, statePath, stateBytes, configBytes, credential } = decodeMiniMaxNativeAuth(input)
  // Importers must separately validate the target against its original signed
  // policy after joined Native work; a source inspection is not that proof.
  const targetKey = miniMaxNativeAuthKey(targetRoot, input.region)
  return Object.freeze({
    files: Object.freeze([
      Object.freeze({ path: authPath, bytes: Buffer.from(JSON.stringify({ schemaVersion: 1, records: { [targetKey]: credential } })) }),
      Object.freeze({ path: statePath, bytes: Buffer.from(stateBytes) }),
      ...(configBytes ? [Object.freeze({ path: 'config.yaml', bytes: Buffer.from(configBytes) })] : []),
    ]),
    accessToken: credential.accessToken,
  })
}
