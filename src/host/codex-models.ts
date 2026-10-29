import { StringDecoder } from 'node:string_decoder'
import { EFFORTS, type ModelChoice } from '../shared/types.ts'
import { ProcessCleanupUnconfirmedError, type ProcessBackend, type RuntimeConfig } from './process.ts'
import { probeAccountModels } from './account-models.mjs'
import { readCodexOwnAccountSource } from './cli-account-binding.ts'

export type CodexCatalogReason = 'source-unconfirmed' | 'source-changed' | 'scope-unknown' | 'scope-denied-unclassified' | 'catalog-empty' | 'capability-intersection-empty' | 'quota' | 'authentication'
const catalogFailures = new WeakSet<object>()
const catalogMessages: Record<CodexCatalogReason, string> = {
  'source-unconfirmed': '本次原生来源证据不足；不能确认目录，不等于已登出或无额度',
  'source-changed': '账号来源在本次查询期间变更，请重新选择；未发布目录',
  'scope-unknown': '本次目录可用性检查未能确认；不等于无额度或已登出，请勿借用旧显示目录授权',
  'scope-denied-unclassified': '本次目录可用性检查被拒绝但原因未确认；不能断言无额度或已登出',
  'catalog-empty': '本次已确认来源返回空模型目录；不是余额查询',
  'capability-intersection-empty': '本次目录与可核验原生能力没有交集；未发布未经确认的模型或强度',
  quota: 'Codex 当前账号额度已用尽，请等待额度恢复后刷新',
  authentication: 'Codex 当前账号认证不可用或访问被拒绝，请检查登录后刷新',
}
/** Fixed source/stage reasons only. Never retains endpoints, credentials or HTTP/native causes. */
export class CodexCatalogError extends Error {
  readonly code: string
  constructor(readonly reason: CodexCatalogReason) {
    if (typeof reason !== 'string' || !Object.hasOwn(catalogMessages, reason)) throw new Error('Invalid Codex catalog reason')
    const message = catalogMessages[reason]
    const code = reason === 'source-changed' ? 'CODEX_SOURCE_CHANGED' : reason === 'quota' || reason === 'authentication' ? 'CODEX_CATALOG_DENIED' : 'CODEX_CATALOG_UNCONFIRMED'
    super(`${code}:${reason}：${message}`)
    this.name = 'CodexCatalogError'; this.code = code; catalogFailures.add(this)
  }
}
export const isCodexCatalogError = (value: unknown): value is CodexCatalogError => value !== null && typeof value === 'object' && catalogFailures.has(value)

const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const validId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(v)
export function parseCodexNativeModels(values: unknown[]): ModelChoice[] {
  const models = new Map<string, ModelChoice>()
  for (const value of values) {
    if (!record(value) || !validId(value.model) || value.hidden === true || value.availabilityNux) continue
    const efforts = EFFORTS.filter(
      (e) =>
        Array.isArray(value.supportedReasoningEfforts) &&
        value.supportedReasoningEfforts.some((item: unknown) => record(item) && item.reasoningEffort === e),
    )
    if (!efforts.length) continue
    models.set(value.model, {
      id: value.model,
      label: typeof value.displayName === 'string' ? value.displayName : value.model,
      efforts,
    })
  }
  return [...models.values()]
}
/** The native model list is capability metadata; discoverCodexModels separately checks account scope. */
export async function readCodexNativeModels(
  backend: ProcessBackend,
  config: RuntimeConfig,
  executable: string,
  cwd: string,
  signal: AbortSignal,
  options: { onServerVersion?: (version: string) => void } = {},
): Promise<ModelChoice[]> {
  signal.throwIfAborted()
  const control = AbortSignal.any([signal, AbortSignal.timeout(15_000)])
  const child = backend.spawn({
    argv: [executable, 'app-server', '--stdio'],
    cwd,
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
    graceMs: config.graceMs,
    signal: control,
  })
  void child.done.catch(() => undefined)
  const inputError = () => undefined
  child.stdin?.on('error', inputError)
  const write = (value: unknown) =>
    new Promise<void>((resolve, reject) => {
      if (!child.stdin || child.stdin.destroyed) return reject(new Error('Codex 模型查询不可用'))
      child.stdin.write(JSON.stringify(value) + '\n', (error) => (error ? reject(error) : resolve()))
    })
  let bytes = 0
  const count = (chunk: unknown) => {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    bytes += buf.length
    if (bytes > Math.min(config.maxRunBytes, 2_097_152)) throw new Error('Codex 模型目录过大')
    return buf
  }
  const errors = (async () => {
    if (child.stderr) for await (const chunk of child.stderr) count(chunk)
  })()
  void errors.catch(() => undefined)
  const output = (async () => {
    if (!child.stdout) throw new Error('Codex 模型查询不可用')
    const decoder = new StringDecoder('utf8'),
      values: unknown[] = [],
      cursors = new Set<string>()
    let pending = '',
      expected = 1
    for await (const chunk of child.stdout) {
      pending += decoder.write(count(chunk))
      let newline: number
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 1)
        let response: any
        try {
          response = JSON.parse(line)
        } catch {
          continue
        }
        if (!record(response) || response.id !== expected) continue
        if (response.error || !record(response.result)) throw new Error('Codex 模型查询失败，请刷新')
        if (expected === 1) {
          const userAgent = response.result.userAgent
          const version = typeof userAgent === 'string'
            ? /^cli_worker_models\/(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)(?:\s|$)/.exec(userAgent)?.[1]
            : undefined
          if (version && version.length <= 64) options.onServerVersion?.(version)
          expected = 2
          await write({ method: 'initialized', params: {} })
          await write({ id: expected, method: 'model/list', params: { includeHidden: false, limit: 100 } })
          continue
        }
        if (!Array.isArray(response.result.data)) throw new Error('Codex 模型目录格式无效')
        values.push(...response.result.data)
        const cursor = response.result.nextCursor
        if (cursor === null || cursor === undefined) return parseCodexNativeModels(values)
        if (typeof cursor !== 'string' || !cursor || cursors.has(cursor) || cursors.size >= 20)
          throw new Error('Codex 模型目录分页无效')
        cursors.add(cursor)
        expected++
        await write({
          id: expected,
          method: 'model/list',
          params: { includeHidden: false, limit: 100, cursor },
        })
      }
    }
    throw new Error('Codex 模型查询提前结束')
  })()
  void output.catch(() => undefined)
  let abort = () => {}
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new Error('Codex 模型查询已取消'))
    control.addEventListener('abort', abort, { once: true })
    if (control.aborted) abort()
  })
  const failed = new Promise<never>((_, reject) => {
    void errors.catch(reject)
    void child.done.catch(reject)
  })
  try {
    await Promise.race([
      write({
        id: 1,
        method: 'initialize',
        params: {
          clientInfo: { name: 'cli_worker_models', version: '1' },
          capabilities: { experimentalApi: false, requestAttestation: false, explicitGatewayOauth: true },
        },
      }),
      cancelled,
    ])
    const result = await Promise.race([output, cancelled, failed])
    control.throwIfAborted()
    return result
  } finally {
    control.removeEventListener('abort', abort)
    let exited = false
    try {
      child.terminate()
      exited = await child.waitForExit()
    } catch {
      throw new ProcessCleanupUnconfirmedError()
    }
    if (!exited) throw new ProcessCleanupUnconfirmedError()
    await Promise.allSettled([output, errors, child.done])
    child.stdin?.removeListener('error', inputError)
  }
}
export async function discoverCodexModels(
  backend: ProcessBackend,
  config: RuntimeConfig,
  executable: string,
  cwd: string,
  signal: AbortSignal,
): Promise<ModelChoice[]> {
  // Resolve the native source before opening the server, then reread after its normal OAuth refresh.
  const before = await readCodexOwnAccountSource(cwd, signal)
  if (!before.nativeRouteConfirmed || !before.sourceIdentity) throw new CodexCatalogError('source-unconfirmed')
  let codexClientVersion: string | undefined
  const native = await readCodexNativeModels(backend, config, executable, cwd, signal, {
    onServerVersion: (version) => {
      codexClientVersion = version
    },
  })
  signal.throwIfAborted()
  const source = await readCodexOwnAccountSource(cwd, signal)
  if (!source.nativeRouteConfirmed || !source.sourceIdentity) throw new CodexCatalogError('source-unconfirmed')
  if (before.sourceIdentity !== source.sourceIdentity) throw new CodexCatalogError('source-changed')
  if (source.provider === 'openai-codex' && !codexClientVersion)
    throw new Error('Codex 版本无法确认，请升级 CLI 后刷新')
  const scope = await probeAccountModels(
    {
      provider: source.provider,
      baseUrl: source.baseUrl,
      credential: source.credential,
      ...(codexClientVersion ? { codexClientVersion } : {}),
    },
    { signal },
  )
  signal.throwIfAborted()
  if (scope.state === 'denied' && scope.denialReason === 'quota')
    throw new CodexCatalogError('quota')
  if (scope.state === 'denied' && scope.denialReason === 'authentication')
    throw new CodexCatalogError('authentication')
  if (scope.state !== 'supported') throw new CodexCatalogError(scope.state === 'unknown' ? 'scope-unknown' : 'scope-denied-unclassified')
  if (!scope.models.length) throw new CodexCatalogError('catalog-empty')
  // Current account metadata can lead the app-server's bundled/cache catalog.
  // Add a remote ID only with reasoning capabilities from that same response.
  const models = scope.models.flatMap((allowed) => {
    if (!validId(allowed.id)) return []
    const current = native.find((model) => model.id === allowed.id)
    const remoteEfforts = EFFORTS.filter((effort) => allowed.reasoningEfforts?.includes(effort))
    if (remoteEfforts.length)
      return [{
        id: allowed.id,
        label: allowed.name ?? current?.label ?? allowed.id,
        efforts: remoteEfforts,
        cost: allowed.cost,
      }]
    return current ? [current] : []
  })
  if (!models.length) throw new CodexCatalogError('capability-intersection-empty')
  return models
}
