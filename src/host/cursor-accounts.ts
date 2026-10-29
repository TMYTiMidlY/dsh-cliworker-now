import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, win32 } from 'node:path'
import { accountEmail, type AccountIdentity } from './account-identity.ts'
import { captureCatalogMetadata, resolveCliExecutable } from './adapters.ts'
import { ProcessCleanupUnconfirmedError, type ProcessBackend, type RuntimeConfig } from './process.ts'
import { MetadataCaptureError, metadataSystemReason, type MetadataPhase, type MetadataReason } from './metadata-diagnostics.ts'

export class CursorAccountError extends Error {
  readonly code = 'CLI_OWN_ACCOUNT_REQUIRED'
  constructor(message = 'Cursor 原生账号身份无法确认，请在账号终端检查登录后刷新') {
    super(message)
    this.name = 'CursorAccountError'
  }
}
/** Process evidence, not an authentication verdict. No original error is retained. */
export class CursorMetadataError extends Error {
  readonly code = 'CLI_METADATA_QUERY_FAILED'
  readonly phase: MetadataPhase
  readonly reason: MetadataReason
  readonly exitCode: number | null
  constructor(diagnostic: MetadataCaptureError) {
    const safe = new MetadataCaptureError(diagnostic.phase, diagnostic.reason, diagnostic.exitCode)
    super(`Cursor 原生身份元数据调用失败（phase=${safe.phase}; reason=${safe.reason}; exitCode=${safe.exitCode ?? 'unknown'}），请核查原生 CLI 后再确认`)
    this.name = 'CursorMetadataError'; this.phase = safe.phase; this.reason = safe.reason; this.exitCode = safe.exitCode
  }
}
/** Same resolver/selection policy; only this binding preparation boundary gains diagnostics. */
export async function resolveCursorBindingExecutable(backend: ProcessBackend, config: RuntimeConfig, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  try { return await resolveCliExecutable('cursor', backend, config, signal) }
  catch (error) {
    if (error instanceof ProcessCleanupUnconfirmedError) throw error
    signal.throwIfAborted()
    throw new CursorMetadataError(new MetadataCaptureError('resolve', metadataSystemReason(error)))
  }
}
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
// Native GetMeResponse.user_id is protobuf int32; status preserves the number.
// Zero is its unset default. Do not coerce strings or accept unknown future shapes.
const subject = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 2147483647
const hash = (v: string) => createHash('sha256').update(v).digest('hex')

/** Verified CLI overrides only. Do not silently bind OAuth to an API-key route. */
export function assertCursorNativeRoute(env: NodeJS.ProcessEnv = process.env): void {
  if (['CURSOR_API_KEY', 'CURSOR_API_ENDPOINT'].some(key => !!env[key]))
    throw new CursorAccountError('Cursor API key 或自定义服务路由暂未支持，请使用原生账号登录')
}

/** Explicit Windows CLI-native shim only: never launch Cursor.exe or generic agent. */
export function cursorExecutable(configured?: string, platform = process.platform, home = homedir()): string {
  if (platform === 'win32') {
    if (!configured || !win32.isAbsolute(configured) || !/^cursor-agent\.(?:exe|cmd|bat|com)$/i.test(win32.basename(configured)))
      throw new CursorAccountError('Windows Cursor Agent 需要显式配置已安装的 cursor-agent CLI 路径；不使用 Cursor IDE')
    return configured
  }
  return configured || join(home, '.local/bin/cursor-agent')
}

export interface CursorAccountProjection {
  identity: AccountIdentity
  /** Private stable principal only. Never return from Gateway or persist native metadata. */
  principal?: string
}
/** Native token-presence flags are local evidence, not subscription/model entitlement. */
export function projectCursorStatus(value: unknown): CursorAccountProjection {
  if (!record(value) || typeof value.isAuthenticated !== 'boolean' || typeof value.hasAccessToken !== 'boolean' ||
      typeof value.hasRefreshToken !== 'boolean' || typeof value.status !== 'string')
    throw new CursorAccountError('Cursor 登录状态响应格式暂不支持，请检查原生 CLI 版本')
  const present = value.hasAccessToken || value.hasRefreshToken
  if (!present && !value.isAuthenticated) return {
    identity: { state: 'unconfigured', verification: 'cli', summary: '尚未登录 Cursor Agent' },
  }
  const info = record(value.userInfo) ? value.userInfo : undefined
  if (value.status !== 'authenticated' || !value.isAuthenticated || !value.hasAccessToken || !subject(info?.userId)) return {
    identity: { state: 'configured', verification: 'local', authMethod: 'oauth', summary: 'Cursor 登录凭据已保存，原生账号身份暂无法确认，请刷新或检查账号终端' },
  }
  const email = accountEmail(info?.email)
  return {
    identity: { state: 'authenticated', verification: 'cli', authMethod: 'oauth', summary: '已识别 Cursor 原生账号；模型调用权限以实际请求为准', ...(email ? { accountLabel: email } : {}) },
    principal: hash(JSON.stringify({ userId: info!.userId })),
  }
}

export async function readCursorAccount(backend: ProcessBackend, config: RuntimeConfig, executable: string, cwd: string, signal: AbortSignal): Promise<CursorAccountProjection> {
  assertCursorNativeRoute()
  let raw: string
  try {
    raw = await captureCatalogMetadata(backend, { ...config, maxRunBytes: Math.min(config.maxRunBytes, 65536) },
      [executable, 'status', '--format', 'json'], cwd, signal, undefined, [0], true)
  } catch (error) {
    if (error instanceof ProcessCleanupUnconfirmedError) throw error
    signal.throwIfAborted()
    if (error instanceof MetadataCaptureError) throw new CursorMetadataError(error)
    throw error
  }
  signal.throwIfAborted()
  assertCursorNativeRoute()
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new CursorAccountError('Cursor 登录状态响应无法解析，请检查原生 CLI') }
  return projectCursorStatus(value)
}

export async function readCursorBindingMaterial(backend: ProcessBackend, config: RuntimeConfig, executable: string, cwd: string, signal: AbortSignal) {
  const { principal } = await readCursorAccount(backend, config, executable, cwd, signal)
  if (!principal) throw new CursorAccountError()
  return { sourceIds: [join(homedir(), '.cursor'), executable, 'native:cursor-status-oauth'],
    entries: [{ provider: 'cursor', principal: { kind: 'oauth', subjectHash: principal } }] }
}
