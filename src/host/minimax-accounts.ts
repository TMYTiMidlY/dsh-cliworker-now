import { constants } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { lstat, open } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve, win32 } from 'node:path'
import { safePiOmpAncestors } from './pi-omp-native.js'
import type { AccountIdentity } from './account-identity.ts'
import type { RuntimeConfig } from './process.ts'
import { assertMiniMaxProfileProtection } from './minimax-profile-protection.mjs'
import { assertMiniMaxAccountSettings } from './native-auth-minimax-settings.ts'
import { projectMiniMaxManagedRoute } from './minimax-route.ts'
import { MiniMaxIdentityError, miniMaxIdentityPrincipal, requestMiniMaxIdentity, waitForMiniMaxIdentity, assertMiniMaxIdentityActive, type MiniMaxIdentityOptions } from './minimax-identity.ts'

const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 8192 && !/[\x00-\x1f\x7f]/.test(v)
const digest = (v: string, encoding: 'hex' | 'base64url' = 'hex') => createHash('sha256').update(v).digest(encoding)
export class MiniMaxAccountError extends Error {
  readonly code = 'CLI_OWN_ACCOUNT_REQUIRED'
  constructor(message = 'MiniMax Code 当前自身认证或稳定账号身份无法确认，请检查原生账号终端') { super(message); this.name = 'MiniMaxAccountError' }
}
/** Stable native installer entry, never a shell account wrapper or MiMo executable. */
export function minimaxExecutable(configured?: string, platform = process.platform, home = homedir()): string {
  if (platform === 'win32' && (!configured || !win32.isAbsolute(configured) || !/^mcode\.(?:exe|cmd|bat|com)$/i.test(win32.basename(configured))))
    throw new MiniMaxAccountError('Windows MiniMax Code 需要显式配置原生 mcode CLI 路径')
  return configured || join(home, '.minimax-code/bin/mcode')
}
export function minimaxDataRoot(config: Pick<RuntimeConfig, 'minimaxHome' | 'minimaxRegion' | 'minimaxExpectedConfigDigest'> = {}, env: NodeJS.ProcessEnv = process.env): string {
  const path = config.minimaxHome ?? (env.MINIMAX_DATA_DIR?.trim() || env.MAVIS_DATA_DIR?.trim() || join(homedir(), '.minimax'))
  if (!text(path) || !isAbsolute(path)) throw new MiniMaxAccountError('MiniMax Code 数据目录必须是明确的绝对路径')
  return resolve(path)
}
export function assertMiniMaxRoute(env: NodeJS.ProcessEnv = process.env): void {
  if (env.MAVIS_BUILD_ENV?.trim() && env.MAVIS_BUILD_ENV.trim() !== 'prod' ||
      ['MCODE_OAUTH_DEVICE_AUTHORIZATION_ENDPOINT', 'MCODE_OAUTH_TOKEN_ENDPOINT', 'MCODE_OAUTH_REVOCATION_ENDPOINT', 'MINIMAX_API_KEY', 'MAVIS_API_KEY'].some(k => !!env[k]?.trim()))
    throw new MiniMaxAccountError('MiniMax Code 当前认证路由暂不支持；仅支持标准 prod 原生账号')
  if (env.MAVIS_REGION?.trim() && !['cn', 'en'].includes(env.MAVIS_REGION.trim())) throw new MiniMaxAccountError('MiniMax Code 当前区域无法确认')
}
interface FileVersion { dev: number; ino: number; size: number; mode: number; nlink: number; uid: number; gid: number }
interface NativeDocument { value: Record<string, any>; stamp: string; fingerprint: string; version: Readonly<FileVersion> }
/** Bounded no-follow source read. Never log raw errors or credentials. */
async function document(path: string, signal: AbortSignal, privateFile = true, yaml = false, observeBytes?: (bytes: Buffer) => void): Promise<NativeDocument | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined, bytes: Buffer | undefined
  try {
    assertMiniMaxIdentityActive(signal)
    await safePiOmpAncestors(dirname(path))
    const entry = await lstat(path)
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1 || entry.size > 65536 ||
        process.platform === 'win32' || privateFile && (entry.mode & 0o077)) throw new MiniMaxAccountError()
    const parent = await lstat(dirname(path))
    if (!parent.isDirectory() || parent.isSymbolicLink() || privateFile && (parent.mode & 0o077) ||
        typeof process.getuid === 'function' && (entry.uid !== process.getuid() || privateFile && parent.uid !== process.getuid())) throw new MiniMaxAccountError()
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const before = await handle.stat()
    if (before.dev !== entry.dev || before.ino !== entry.ino || !before.isFile() || before.nlink !== 1 || before.size > 65536) throw new MiniMaxAccountError()
    bytes = Buffer.alloc(before.size + 1)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    assertMiniMaxIdentityActive(signal)
    const after = await handle.stat(), current = await lstat(path), parentAfter = await lstat(dirname(path))
    await safePiOmpAncestors(dirname(path))
    if (parentAfter.isSymbolicLink() || parentAfter.dev !== parent.dev || parentAfter.ino !== parent.ino) throw new MiniMaxAccountError()
    const stamp = (s: typeof before) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}:${s.mode}:${s.nlink}`
    if (bytesRead !== before.size || current.isSymbolicLink() || stamp(entry) !== stamp(before) || stamp(before) !== stamp(after) || stamp(after) !== stamp(current)) throw new MiniMaxAccountError()
    observeBytes?.(bytes.subarray(0, bytesRead))
    const raw = bytes.subarray(0, bytesRead).toString('utf8')
    const value: unknown = yaml ? parseYaml(raw, { maxAliasCount: 0 }) ?? {} : JSON.parse(raw)
    if (!object(value)) throw new MiniMaxAccountError()
    return { value, stamp: stamp(current), fingerprint: yaml ? createHash('sha256').update(bytes.subarray(0, bytesRead)).digest('hex') : digest(raw), version: Object.freeze({ dev: current.dev, ino: current.ino, size: current.size, mode: current.mode, nlink: current.nlink, uid: current.uid, gid: current.gid }) }
  } catch (error) {
    assertMiniMaxIdentityActive(signal)
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new MiniMaxAccountError('MiniMax Code 自身认证元数据无法安全读取或格式暂不支持')
  } finally { bytes?.fill(0); await handle?.close() }
}
export interface MiniMaxSource { root: string; region: 'cn' | 'en'; env: Record<string, string>; configuration?: string; selection?: string }
const sourceConfigurationEpochs = new WeakMap<MiniMaxSource, string>()
const lastConfigurations = new Map<string, { fingerprint: string; stamp: string; version: Readonly<FileVersion>; epoch: string }>()
const CONFIGURATION_LIMIT = 64
function configurationVersion(root: string, config?: NativeDocument): string {
  if (!config) { lastConfigurations.delete(root); return 'absent' }
  const previous = lastConfigurations.get(root)
  const sameAttributes = previous && (['dev', 'size', 'mode', 'nlink', 'uid', 'gid'] as const).every(key => previous.version[key] === config.version[key])
  // Same-content atomic replacement is a source-equivalent save, not a new account. In-place touches remain new versions.
  const reusable = previous && previous.fingerprint === config.fingerprint && sameAttributes &&
    (previous.stamp === config.stamp || previous.version.ino !== config.version.ino)
  const epoch = reusable ? previous.epoch : randomUUID()
  lastConfigurations.delete(root)
  if (lastConfigurations.size >= CONFIGURATION_LIMIT) lastConfigurations.delete(lastConfigurations.keys().next().value!)
  lastConfigurations.set(root, { fingerprint: config.fingerprint, stamp: config.stamp, version: config.version, epoch })
  return epoch
}
/** Standard token-plan source only. Stale OAuth must not authorize BYOK/custom routes. */
async function configuration(root: string, signal: AbortSignal, expected?: { digest: string; region: 'cn' | 'en' }): Promise<{ fingerprint: string; epoch: string }> {
  let config: NativeDocument | undefined
  try {
    config = await document(join(root, 'config.yaml'), signal, true, true,
      expected ? bytes => assertMiniMaxAccountSettings(expected.digest, bytes, expected.region) : undefined)
    if (expected && !config) throw new MiniMaxAccountError('MiniMax 私有账号原签名设置已失效')
  }
  catch (error) { lastConfigurations.delete(root); throw error }
  // Observe safe reads even if their route is unsupported, so a later restored A cannot hide an observed B.
  const epoch = configurationVersion(root, config), value = config?.value ?? {}
  const route = projectMiniMaxManagedRoute(value)
  if (route.kind === 'unsupported') throw new MiniMaxAccountError({
    source: 'MiniMax Code 当前 API 或自定义模型来源暂不支持，请明确选择原生 token_plan 来源',
    provider: 'MiniMax Code 当前原生提供商协议暂不支持',
    route: 'MiniMax Code 原生提供商存在尚未支持的认证或服务覆盖',
    model: 'MiniMax Code 当前模型级认证、请求头或服务覆盖暂不支持',
  }[route.reason])
  // Stable binding uses the complete raw contents; operation-local versions are kept privately above.
  return { fingerprint: config?.fingerprint ?? 'native-default-token-plan', epoch }
}
export async function minimaxSource(config: Pick<RuntimeConfig, 'minimaxHome' | 'minimaxRegion' | 'minimaxExpectedConfigDigest'>, signal: AbortSignal): Promise<MiniMaxSource> {
  assertMiniMaxIdentityActive(signal)
  assertMiniMaxRoute()
  const fixedRegion = config.minimaxRegion, expected = config.minimaxExpectedConfigDigest
  if (expected !== undefined && (typeof expected !== 'string' || !/^[0-9a-f]{64}$/.test(expected) || !config.minimaxHome || !fixedRegion || process.env.MAVIS_BUILTIN_AGENTS_V2_DIR))
    throw new MiniMaxAccountError('MiniMax 私有账号原签名设置需要完整固定来源')
  if (fixedRegion !== undefined && (!config.minimaxHome || !['cn', 'en'].includes(fixedRegion)))
    throw new MiniMaxAccountError('MiniMax Code 固定区域需要明确的私有根与受支持区域')
  const root = minimaxDataRoot(config)
  let region = fixedRegion ?? (process.env.MAVIS_REGION?.trim() || undefined)
  let selection = digest(JSON.stringify({ origin: fixedRegion === undefined ? 'env' : 'fixed-private-region', region }))
  if (!region) {
    const preferences = await document(join(root, 'preferences/mcode-region.json'), signal, false)
    selection = digest(JSON.stringify({ origin: 'preferences', stamp: preferences?.stamp, fingerprint: preferences?.fingerprint }))
    if (preferences && (preferences.value.version !== 1 || !object(preferences.value.regions) ||
        preferences.value.regions.prod !== undefined && !['cn', 'en'].includes(preferences.value.regions.prod))) throw new MiniMaxAccountError('MiniMax Code 区域偏好无法确认')
    region = preferences?.value.regions.prod
    if (!region) {
      const candidates = await Promise.all(['cn', 'en'].map(r => document(join(root, `auth/prod/${r}/mcode-public/auth-state.json`), signal)))
      selection = digest(JSON.stringify({ origin: 'fallback', preferences: selection, candidates: candidates.map(v => v && { stamp: v.stamp, fingerprint: v.fingerprint }) }))
      const existing = candidates.flatMap((v, i) => {
        const r = i === 0 ? 'cn' : 'en'
        return v?.value.buildEnv === 'prod' && v.value.region === r &&
          ['authorizing', 'authenticated', 'refreshing', 'scope_upgrade_required', 'expired'].includes(v.value.status) ? [r] : []
      })
      if (existing.length > 1) throw new MiniMaxAccountError('MiniMax Code 存在多个区域来源，请在原生 CLI 明确选择区域')
      region = existing[0] ?? 'cn'
    }
  }
  const currentConfiguration = await configuration(root, signal, expected === undefined ? undefined : { digest: expected, region: fixedRegion! })
  assertMiniMaxIdentityActive(signal)
  const source: MiniMaxSource = { root, region: region as 'cn' | 'en', selection, configuration: currentConfiguration.fingerprint, env: { MINIMAX_DATA_DIR: root, MAVIS_DATA_DIR: root, MAVIS_REGION: region!, MAVIS_BUILD_ENV: 'prod' } }
  if (expected !== undefined) assertMiniMaxProfileProtection({ root, region: fixedRegion!, configDigest: expected, version: '0.6.12' }, source.env)
  sourceConfigurationEpochs.set(source, currentConfiguration.epoch)
  return source
}
const fixed = (state: AccountIdentity['state'], summary: string): AccountIdentity => ({ state, verification: 'local', summary })
export interface MiniMaxAccountProjection { identity: AccountIdentity; source: MiniMaxSource; principal?: string }
const accountEpochs = new WeakMap<MiniMaxAccountProjection, string>()
// Private file-version components only; never returned, logged or used to grant admission.
const accountSnapshotParts = new WeakMap<MiniMaxAccountProjection, Readonly<{ configuration: string; state: string; credential: string; cache?: string }>>()
export function sameMiniMaxAccountSnapshot(before: MiniMaxAccountProjection, after: MiniMaxAccountProjection): boolean {
  const epoch = accountEpochs.get(before)
  return !!epoch && epoch === accountEpochs.get(after) && !!before.principal && (!after.principal || before.principal === after.principal) && JSON.stringify(before.source) === JSON.stringify(after.source)
}
/** Safe fixed classification only. The original admission predicate above is unchanged. */
export function miniMaxAccountSnapshotDifference(before: MiniMaxAccountProjection, after: MiniMaxAccountProjection): string {
  if (sameMiniMaxAccountSnapshot(before, after)) return 'none'
  if (!accountEpochs.has(before)) return 'untracked-before'
  if (!before.principal) return 'unverified-before'
  if (after.principal && before.principal !== after.principal) return 'principal-changed'
  if (before.source.root !== after.source.root) return 'source-root'
  if (before.source.region !== after.source.region) return 'source-region'
  if (before.source.configuration !== after.source.configuration) return 'source-configuration'
  if (before.source.selection !== after.source.selection) return 'source-selector'
  if (JSON.stringify(before.source.env) !== JSON.stringify(after.source.env)) return 'source-environment'
  if (!accountEpochs.has(after)) return after.identity.summary === 'MiniMax Code 凭据等待原生续期，请稍后重试' ? 'renewal-after' : 'untracked-after'
  const left = accountSnapshotParts.get(before), right = accountSnapshotParts.get(after)
  if (left && right) {
    if (left.configuration !== right.configuration) return 'source-configuration-version'
    if (left.state !== right.state) return 'state-version'
    if (left.credential !== right.credential) return 'credential-version'
    if (left.cache !== right.cache) return 'identity-cache-version'
  }
  return accountEpochs.get(before) !== accountEpochs.get(after) ? 'epoch-version' : 'source-unconfirmed'
}
/** Never leaves this module or enters a Gateway response, process payload or persisted record. */
interface OwnOAuthProof { sourceKey: string; epoch: string; accessToken: string; expiresAtMs: number }
interface PrivateAccount { account: MiniMaxAccountProjection; proof?: OwnOAuthProof }
async function readOwnMiniMaxAccount(config: Pick<RuntimeConfig, 'minimaxHome' | 'minimaxRegion' | 'minimaxExpectedConfigDigest'>, signal: AbortSignal): Promise<PrivateAccount> {
  const source = await minimaxSource(config, signal), directory = join(source.root, `auth/prod/${source.region}/mcode-public`)
  const statePath = join(directory, 'auth-state.json'), authPath = join(directory, 'auth.json')
  const before = await document(statePath, signal)
  if (!before) return { account: { source, identity: fixed('unconfigured', 'MiniMax Code 当前原生来源需要登录，请运行 mcode login') } }
  const state = before.value
  const contract = (v: Record<string, any>) => v.clientId === 'mcode-public' && v.audience === 'agent-backend' &&
    Array.isArray(v.scopes) && v.scopes.every(text) && v.scopes.includes('agent.default') && Number.isSafeInteger(v.generation) && v.generation >= 0
  if (state.schemaVersion !== 2 || state.storeKind !== 'file' || state.buildEnv !== 'prod' || state.region !== source.region || !contract(state)) throw new MiniMaxAccountError()
  if (!['anonymous', 'authorizing', 'authenticated', 'refreshing', 'scope_upgrade_required', 'logging_out', 'logout_pending', 'expired', 'error'].includes(state.status)) throw new MiniMaxAccountError()
  if (state.status !== 'authenticated') return { account: { source, identity: fixed(state.status === 'anonymous' ? 'unconfigured' : 'configured',
    state.status === 'refreshing' ? 'MiniMax Code 正在原生续期，请稍后刷新' : 'MiniMax Code 当前原生认证未就绪，请检查原生授权状态') } }
  const auth = await document(authPath, signal)
  const key = `com.minimax.mcode.oauth.prod.${source.region}\0${digest(join(source.root, 'auth') + '\0mcode-public', 'base64url')}`
  if (!auth || auth.value.schemaVersion !== 1 || !object(auth.value.records)) throw new MiniMaxAccountError()
  const token = auth.value.records[key]
  if (!object(token) || token.schemaVersion !== 1 || !contract(token) || token.generation !== state.generation || token.tokenType !== 'Bearer' ||
      !text(token.accessToken) || !text(token.refreshToken) || !Number.isFinite(token.expiresAtMs) ||
      state.expiresAtMs !== undefined && state.expiresAtMs !== token.expiresAtMs ||
      JSON.stringify([...token.scopes].sort()) !== JSON.stringify([...state.scopes].sort())) throw new MiniMaxAccountError()
  if (token.expiresAtMs < Date.now() + 60000) return { account: { source, identity: fixed('configured', 'MiniMax Code 凭据等待原生续期，请稍后重试') } }
  const cachePath = join(source.root, `cli-auth/prod/${source.region}/account-identity.json`)
  const cache = await document(cachePath, signal), value = cache?.value
  const principal = value?.version === 1 && value.status === 'verified' && value.region === source.region && value.buildEnv === 'prod' &&
    value.tokenFingerprint === `sha256:${digest(token.accessToken.trim())}` && Number.isFinite(value.updatedAtMs)
    ? miniMaxIdentityPrincipal(value.realUserID) : undefined
  const cacheAfter = await document(cachePath, signal), stateAfter = await document(statePath, signal), authAfter = await document(authPath, signal)
  const afterSource = await minimaxSource(config, signal), configurationEpoch = sourceConfigurationEpochs.get(source)
  if (!configurationEpoch || cacheAfter?.stamp !== cache?.stamp || stateAfter?.stamp !== before.stamp || authAfter?.stamp !== auth.stamp ||
      JSON.stringify(afterSource) !== JSON.stringify(source) || sourceConfigurationEpochs.get(afterSource) !== configurationEpoch) throw new MiniMaxAccountError('MiniMax Code 当前账号来源已变化，请刷新')
  const proof: OwnOAuthProof = {
    sourceKey: digest(JSON.stringify({ root: source.root, region: source.region, buildEnv: 'prod' })),
    // Full authenticated records include generation/loginEpoch/scope/expiry; stamps also detect ABA restoration.
    epoch: digest(JSON.stringify({ source, configurationEpoch, state: [before.fingerprint, before.stamp], credential: [auth.fingerprint, auth.stamp], cache: cache && [cache.fingerprint, cache.stamp] })),
    accessToken: token.accessToken.trim(), expiresAtMs: token.expiresAtMs,
  }
  const account: MiniMaxAccountProjection = { source, ...(principal ? { principal } : {}), identity: principal
    ? { ...fixed('authenticated', '已识别 MiniMax Code 自身账号；模型调用权限以实际请求为准'), authMethod: 'oauth' }
    : { ...fixed('configured', 'MiniMax Code 认证已保存，当前稳定账号身份尚待原生身份服务核对'), authMethod: 'oauth' } }
  accountEpochs.set(account, proof.epoch)
  accountSnapshotParts.set(account, Object.freeze({ configuration: configurationEpoch, state: before.fingerprint + ':' + before.stamp, credential: auth.fingerprint + ':' + auth.stamp, cache: cache ? cache.fingerprint + ':' + cache.stamp : undefined }))
  return { proof, account }
}
/** Ordinary account summaries remain strictly local, even when userinfo is absent. */
export async function readMiniMaxAccount(config: Pick<RuntimeConfig, 'minimaxHome' | 'minimaxRegion' | 'minimaxExpectedConfigDigest'>, signal: AbortSignal): Promise<MiniMaxAccountProjection> {
  try {
    assertMiniMaxIdentityActive(signal)
    const value = await readOwnMiniMaxAccount(config, signal)
    try { assertMiniMaxIdentityActive(signal); return value.account }
    finally { if (value.proof) value.proof.accessToken = '' }
  } catch (error) { assertMiniMaxIdentityActive(signal); throw error }
}
interface RememberedIdentity { epoch: string; principal: string; expiresAtMs: number }
interface PendingIdentity { controller: AbortController; waiters: number; settled: boolean; promise: Promise<string> }
const remembered = new Map<string, RememberedIdentity>(), pending = new Map<string, PendingIdentity>()
const MEMORY_LIMIT = 64, IDENTITY_TTL = 30000
async function resolveMiniMaxIdentity(proof: OwnOAuthProof, region: 'cn' | 'en', signal: AbortSignal, options: MiniMaxIdentityOptions): Promise<string> {
  const cached = remembered.get(proof.sourceKey)
  if (cached?.epoch === proof.epoch && cached.expiresAtMs > Date.now()) return cached.principal
  if (cached) remembered.delete(proof.sourceKey)
  let entry = pending.get(proof.epoch)
  if (!entry || entry.controller.signal.aborted) {
    if (pending.size >= MEMORY_LIMIT) throw new MiniMaxIdentityError()
    const controller = new AbortController()
    entry = { controller, waiters: 0, settled: false, promise: undefined! }
    const owned = entry, epoch = proof.epoch
    owned.promise = requestMiniMaxIdentity(region, proof.accessToken, controller.signal, options).finally(() => {
      owned.settled = true
      if (pending.get(epoch) === owned) pending.delete(epoch)
    })
    pending.set(epoch, owned)
  }
  entry.waiters++
  try { return await waitForMiniMaxIdentity(entry.promise, signal) }
  finally { if (--entry.waiters === 0 && !entry.settled) entry.controller.abort() }
}
/** Only formal binding/catalog admission may perform the bounded identity metadata request. */
export async function ensureMiniMaxVerifiedAccount(config: Pick<RuntimeConfig, 'minimaxHome' | 'minimaxRegion' | 'minimaxExpectedConfigDigest'>, signal: AbortSignal, options: MiniMaxIdentityOptions = {}): Promise<MiniMaxAccountProjection> {
  try {
    assertMiniMaxIdentityActive(signal)
    const account = await verifyMiniMaxAccount(config, signal, options)
    assertMiniMaxIdentityActive(signal)
    return account
  } catch (error) { assertMiniMaxIdentityActive(signal); throw error }
}
async function verifyMiniMaxAccount(config: Pick<RuntimeConfig, 'minimaxHome' | 'minimaxRegion' | 'minimaxExpectedConfigDigest'>, signal: AbortSignal, options: MiniMaxIdentityOptions): Promise<MiniMaxAccountProjection> {
  const before = await readOwnMiniMaxAccount(config, signal)
  if (!before.proof) return before.account
  const proof = before.proof
  try {
    if (config.minimaxExpectedConfigDigest !== undefined) assertMiniMaxProfileProtection({ root: before.account.source.root,
      region: before.account.source.region, configDigest: config.minimaxExpectedConfigDigest, version: '0.6.12' }, before.account.source.env)
    if (before.account.principal) return before.account
    let principal: string | undefined, issue: MiniMaxIdentityError | undefined
    try { principal = await resolveMiniMaxIdentity(proof, before.account.source.region, signal, options) }
    catch (error) {
      if (signal.aborted) throw new DOMException('MiniMax Code 身份验证已取消', 'AbortError')
      issue = error instanceof MiniMaxIdentityError ? error : new MiniMaxIdentityError()
    }
    const after = await readOwnMiniMaxAccount(config, signal)
    try {
      assertMiniMaxIdentityActive(signal)
      if (after.proof?.epoch !== proof.epoch) throw new MiniMaxAccountError('MiniMax Code 当前账号来源已变化，请刷新后重试；未启动模型')
      if (!principal || issue) return { ...after.account, identity: { ...fixed('configured', (issue ?? new MiniMaxIdentityError()).message), authMethod: 'oauth' } }
      const cached = remembered.get(proof.sourceKey)
      if (!remembered.has(proof.sourceKey) && remembered.size >= MEMORY_LIMIT) remembered.delete(remembered.keys().next().value!)
      remembered.set(proof.sourceKey, { epoch: proof.epoch, principal,
        expiresAtMs: cached?.epoch === proof.epoch ? cached.expiresAtMs : Math.min(Date.now() + IDENTITY_TTL, proof.expiresAtMs - 60000) })
      const account: MiniMaxAccountProjection = { ...after.account, principal, identity: { ...fixed('authenticated', 'MiniMax Code 当前原生用户身份已核对；模型调用权限以实际请求为准'), authMethod: 'oauth' } }
      accountEpochs.set(account, proof.epoch)
      const parts = accountSnapshotParts.get(after.account)
      if (parts) accountSnapshotParts.set(account, parts)
      return account
    } finally { if (after.proof) after.proof.accessToken = '' }
  } finally { proof.accessToken = '' }
}
export async function readMiniMaxBindingMaterial(config: Pick<RuntimeConfig, 'minimaxHome' | 'minimaxRegion' | 'minimaxExpectedConfigDigest'>, signal: AbortSignal) {
  assertMiniMaxIdentityActive(signal)
  const account = await ensureMiniMaxVerifiedAccount(config, signal)
  assertMiniMaxIdentityActive(signal)
  if (!account.principal) throw new MiniMaxAccountError(account.identity.summary)
  return { sourceIds: [account.source.root, `native:minimax:prod:${account.source.region}`], entries: [{ provider: 'minimax', principal: { kind: 'oauth', subjectHash: account.principal }, route: { configuration: account.source.configuration } }] }
}
