import { constants } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { lstat, open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve, win32 } from 'node:path'
import { safePiOmpAncestors } from './pi-omp-native.js'
import type { AccountIdentity } from './account-identity.ts'
import type { RuntimeConfig } from './process.ts'

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
export function minimaxDataRoot(config: Pick<RuntimeConfig, 'minimaxHome'> = {}, env: NodeJS.ProcessEnv = process.env): string {
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
/** Bounded no-follow source read. Never log raw errors or credentials. */
async function document(path: string, signal: AbortSignal, privateFile = true, yaml = false): Promise<{ value: Record<string, any>; stamp: string; fingerprint: string } | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined, bytes: Buffer | undefined
  try {
    signal.throwIfAborted()
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
    signal.throwIfAborted()
    const after = await handle.stat(), current = await lstat(path), parentAfter = await lstat(dirname(path))
    await safePiOmpAncestors(dirname(path))
    if (parentAfter.isSymbolicLink() || parentAfter.dev !== parent.dev || parentAfter.ino !== parent.ino) throw new MiniMaxAccountError()
    const stamp = (s: typeof before) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}:${s.mode}:${s.nlink}`
    if (bytesRead !== before.size || current.isSymbolicLink() || stamp(entry) !== stamp(before) || stamp(before) !== stamp(after) || stamp(after) !== stamp(current)) throw new MiniMaxAccountError()
    const raw = bytes.subarray(0, bytesRead).toString('utf8')
    const value: unknown = yaml ? parseYaml(raw, { maxAliasCount: 0 }) ?? {} : JSON.parse(raw)
    if (!object(value)) throw new MiniMaxAccountError()
    return { value, stamp: stamp(current), fingerprint: digest(raw) }
  } catch (error) {
    signal.throwIfAborted()
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new MiniMaxAccountError('MiniMax Code 自身认证元数据无法安全读取或格式暂不支持')
  } finally { bytes?.fill(0); await handle?.close() }
}
export interface MiniMaxSource { root: string; region: 'cn' | 'en'; env: Record<string, string>; configuration?: string }
/** Standard token-plan source only. Stale OAuth must not authorize BYOK/custom routes. */
async function configuration(root: string, signal: AbortSignal): Promise<string> {
  const config = await document(join(root, 'config.yaml'), signal, true, true), value = config?.value ?? {}
  // Native 0.6.12 defaults minimaxModelSource to token_plan when omitted.
  if (value.minimaxModelSource !== undefined && value.minimaxModelSource !== 'token_plan' ||
      value.defaultModel !== undefined && (typeof value.defaultModel !== 'string' || !value.defaultModel.startsWith('minimax/') || !value.defaultModel.slice(8).trim()))
    throw new MiniMaxAccountError('MiniMax Code 当前 API 或自定义模型来源暂不支持，请明确选择原生 token_plan 来源')
  if (value.provider !== undefined && !object(value.provider)) throw new MiniMaxAccountError()
  const provider = value.provider?.minimax
  if (provider !== undefined && !object(provider) || provider?.npm !== undefined && provider.npm !== '@ai-sdk/anthropic') throw new MiniMaxAccountError('MiniMax Code 当前原生提供商协议暂不支持')
  const options = provider?.options
  if (options !== undefined && !object(options) || options?.authMode !== undefined && options.authMode !== 'managed-login' ||
      options && Object.keys(options).some(k => /^(?:apiKey|baseURL|baseUrl|headers|customHeaders|endpoint)$/i.test(k) && options[k] !== undefined))
    throw new MiniMaxAccountError('MiniMax Code 原生提供商存在尚未支持的认证或服务覆盖')
  const routeOverrides = (v: unknown): boolean => object(v) && Object.entries(v).some(([key, item]) =>
    /^(?:api_key|base_url|apiKey|baseURL|headers|customHeaders)$/i.test(key) && item !== undefined ||
    (object(item) || Array.isArray(item)) && (Array.isArray(item) ? item.some(routeOverrides) : routeOverrides(item)))
  if (routeOverrides(provider?.models) || routeOverrides(value.agents) || routeOverrides(value.model))
    throw new MiniMaxAccountError('MiniMax Code 当前模型级认证、请求头或服务覆盖暂不支持')
  // Stamp catches A->B->A edits even when contents are restored before admission.
  return config ? digest(config.fingerprint + ':' + config.stamp) : 'native-default-token-plan'
}
export async function minimaxSource(config: Pick<RuntimeConfig, 'minimaxHome'>, signal: AbortSignal): Promise<MiniMaxSource> {
  assertMiniMaxRoute()
  const root = minimaxDataRoot(config)
  let region = process.env.MAVIS_REGION?.trim() || undefined
  if (!region) {
    const preferences = await document(join(root, 'preferences/mcode-region.json'), signal, false)
    if (preferences && (preferences.value.version !== 1 || !object(preferences.value.regions) ||
        preferences.value.regions.prod !== undefined && !['cn', 'en'].includes(preferences.value.regions.prod))) throw new MiniMaxAccountError('MiniMax Code 区域偏好无法确认')
    region = preferences?.value.regions.prod
    if (!region) {
      const candidates = await Promise.all(['cn', 'en'].map(r => document(join(root, `auth/prod/${r}/mcode-public/auth-state.json`), signal)))
      const existing = candidates.flatMap((v, i) => {
        const r = i === 0 ? 'cn' : 'en'
        return v?.value.buildEnv === 'prod' && v.value.region === r &&
          ['authorizing', 'authenticated', 'refreshing', 'scope_upgrade_required', 'expired'].includes(v.value.status) ? [r] : []
      })
      if (existing.length > 1) throw new MiniMaxAccountError('MiniMax Code 存在多个区域来源，请在原生 CLI 明确选择区域')
      region = existing[0] ?? 'cn'
    }
  }
  return { root, region: region as 'cn' | 'en', configuration: await configuration(root, signal), env: { MINIMAX_DATA_DIR: root, MAVIS_DATA_DIR: root, MAVIS_REGION: region!, MAVIS_BUILD_ENV: 'prod' } }
}
const fixed = (state: AccountIdentity['state'], summary: string): AccountIdentity => ({ state, verification: 'local', summary })
export interface MiniMaxAccountProjection { identity: AccountIdentity; source: MiniMaxSource; principal?: string }
export async function readMiniMaxAccount(config: Pick<RuntimeConfig, 'minimaxHome'>, signal: AbortSignal): Promise<MiniMaxAccountProjection> {
  const source = await minimaxSource(config, signal), directory = join(source.root, `auth/prod/${source.region}/mcode-public`)
  const statePath = join(directory, 'auth-state.json'), authPath = join(directory, 'auth.json')
  const before = await document(statePath, signal)
  if (!before) return { source, identity: fixed('unconfigured', 'MiniMax Code 当前原生来源需要登录，请运行 mcode login') }
  const state = before.value
  const contract = (v: Record<string, any>) => v.clientId === 'mcode-public' && v.audience === 'agent-backend' &&
    Array.isArray(v.scopes) && v.scopes.every(text) && v.scopes.includes('agent.default') && Number.isSafeInteger(v.generation) && v.generation >= 0
  if (state.schemaVersion !== 2 || state.storeKind !== 'file' || state.buildEnv !== 'prod' || state.region !== source.region || !contract(state)) throw new MiniMaxAccountError()
  if (!['anonymous', 'authorizing', 'authenticated', 'refreshing', 'scope_upgrade_required', 'logging_out', 'logout_pending', 'expired', 'error'].includes(state.status)) throw new MiniMaxAccountError()
  if (state.status !== 'authenticated') return { source, identity: fixed(state.status === 'anonymous' ? 'unconfigured' : 'configured',
    state.status === 'refreshing' ? 'MiniMax Code 正在原生续期，请稍后刷新' : 'MiniMax Code 当前原生认证未就绪，请在账号终端检查登录或授权范围') }
  const auth = await document(authPath, signal)
  const key = `com.minimax.mcode.oauth.prod.${source.region}\0${digest(join(source.root, 'auth') + '\0mcode-public', 'base64url')}`
  if (!auth || auth.value.schemaVersion !== 1 || !object(auth.value.records)) throw new MiniMaxAccountError()
  const token = auth.value.records[key]
  if (!object(token) || token.schemaVersion !== 1 || !contract(token) || token.generation !== state.generation || token.tokenType !== 'Bearer' ||
      !text(token.accessToken) || !text(token.refreshToken) || !Number.isFinite(token.expiresAtMs) ||
      state.expiresAtMs !== undefined && state.expiresAtMs !== token.expiresAtMs ||
      JSON.stringify([...token.scopes].sort()) !== JSON.stringify([...state.scopes].sort())) throw new MiniMaxAccountError()
  if (token.expiresAtMs < Date.now() + 60000) return { source, identity: fixed('configured', 'MiniMax Code 凭据等待原生续期，请先在账号终端刷新') }
  let principal: string | undefined
  const stableId = (v: unknown): v is string => text(v) && v.length <= 512 && !/^(?:Bearer|sk[-_]|ya29\.|eyJ)/i.test(v)
  if (stableId(token.subject) || stableId(token.accountId)) principal = digest(JSON.stringify({ subject: stableId(token.subject) ? token.subject : undefined, accountId: stableId(token.accountId) ? token.accountId : undefined }))
  else {
    const cachePath = join(source.root, `cli-auth/prod/${source.region}/account-identity.json`)
    const cache = await document(cachePath, signal)
    const v = cache?.value
    if (v?.version === 1 && v.status === 'verified' && v.region === source.region && v.buildEnv === 'prod' &&
        v.tokenFingerprint === `sha256:${digest(token.accessToken.trim())}` && stableId(v.realUserID) && Number.isFinite(v.updatedAtMs)) principal = digest(JSON.stringify({ realUserID: v.realUserID }))
    if (cache && (await document(cachePath, signal))?.stamp !== cache.stamp) throw new MiniMaxAccountError()
  }
  if ((await document(statePath, signal))?.stamp !== before.stamp || (await document(authPath, signal))?.stamp !== auth.stamp ||
      JSON.stringify(await minimaxSource(config, signal)) !== JSON.stringify(source)) throw new MiniMaxAccountError('MiniMax Code 当前账号来源已变化，请刷新')
  return { source, ...(principal ? { principal } : {}), identity: principal
    ? { ...fixed('authenticated', '已识别 MiniMax Code 自身账号；模型调用权限以实际请求为准'), authMethod: 'oauth' }
    : { ...fixed('configured', 'MiniMax Code 认证已保存，但当前稳定账号身份无法确认；请在原生 CLI 刷新后重试'), authMethod: 'oauth' } }
}
export async function readMiniMaxBindingMaterial(config: Pick<RuntimeConfig, 'minimaxHome'>, signal: AbortSignal) {
  const account = await readMiniMaxAccount(config, signal)
  if (!account.principal) throw new MiniMaxAccountError(account.identity.summary)
  return { sourceIds: [account.source.root, `native:minimax:prod:${account.source.region}`], entries: [{ provider: 'minimax', principal: { kind: 'oauth', subjectHash: account.principal }, route: { configuration: account.source.configuration } }] }
}
