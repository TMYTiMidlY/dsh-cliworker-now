import { createHash } from 'node:crypto'

const LIMIT = 64 * 1024
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const md5 = (value: string) => createHash('md5').update(value).digest('hex')

export class MiniMaxIdentityError extends Error {
  constructor(readonly kind: 'rejected' | 'unavailable' = 'unavailable') {
    super(kind === 'rejected'
      ? 'MiniMax Code 当前原生用户身份验证被拒绝，未启动模型；这不等于本地凭据未保存'
      : 'MiniMax Code 认证已保存，但原生用户身份暂不可验证，请稍后重试；未启动模型')
    this.name = 'MiniMaxIdentityError'
  }
}
const identityCancellations = new WeakSet<object>()
const cancelled = () => {
  const error = new DOMException('MiniMax Code 身份验证已取消', 'AbortError')
  identityCancellations.add(error)
  return error
}
/** Internal source witness only; an arbitrary AbortError/name/message is not evidence. */
export const isMiniMaxIdentityCancellation = (value: unknown): value is DOMException =>
  value !== null && typeof value === 'object' && identityCancellations.has(value)
/** Cancellation reasons may contain private upstream data; keep the class, never the reason/cause. */
export function assertMiniMaxIdentityActive(signal: AbortSignal): void { if (signal.aborted) throw cancelled() }

/** Only a genuine native realUserID field may enter this normalizer. Never pass a token as an identity. */
export function miniMaxIdentityPrincipal(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192 || /[\x00-\x1f\x7f]/.test(value)) return undefined
  return createHash('sha256').update(JSON.stringify({ realUserID: value.trim() })).digest('hex')
}
export interface MiniMaxIdentityOptions {
  /** Host-internal dependency injection; never accepted from a tool/Gateway request. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
  now?: () => number
  timezoneOffsetSeconds?: () => number
  platform?: NodeJS.Platform
}

export function waitForMiniMaxIdentity<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void work.catch(() => {}); return Promise.reject(cancelled()) }
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(cancelled()) }
    signal.addEventListener('abort', abort, { once: true })
    work.then(value => { signal.removeEventListener('abort', abort); resolve(value) }, error => {
      signal.removeEventListener('abort', abort); reject(error)
    })
  })
}

/** Mirrors 0.6.12 p0e.fetchAccountIdentity/buildUrl, not the model provider's baseURL. No CLI or model is started. */
export async function requestMiniMaxIdentity(
  region: 'cn' | 'en', accessToken: string, signal: AbortSignal, options: MiniMaxIdentityOptions = {},
): Promise<string> {
  const controller = new AbortController(), chunks: Uint8Array[] = []
  const abort = () => controller.abort()
  let response: Response | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  signal.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(abort, Math.max(1, Math.min(options.timeoutMs ?? 3000, 3000)))
  try {
    if (signal.aborted) throw cancelled()
    if (!['cn', 'en'].includes(region) || typeof accessToken !== 'string' || !accessToken.trim() || accessToken.length > 8192 || /[\x00-\x1f\x7f]/.test(accessToken)) throw new MiniMaxIdentityError()
    const now = (options.now ?? Date.now)(), timestamp = String(Math.floor(now / 1000))
    const url = new URL('/v1/api/user/info', region === 'cn' ? 'https://agent.minimaxi.com' : 'https://agent.minimax.io')
    const language = region === 'cn' ? 'zh' : 'en'
    url.search = new URLSearchParams({
      device_platform: 'mcode', biz_id: '3', app_id: '3001', version_code: '22201', unix: String(now),
      timezone_offset: String((options.timezoneOffsetSeconds ?? (() => new Date().getTimezoneOffset() * -60))()),
      sys_language: language, lang: language, device_id: '0', os_name: options.platform ?? process.platform,
      browser_name: 'mcode', user_id: '0', client: 'mcode',
    }).toString()
    const pathAndQuery = `${url.pathname}${url.search}`
    response = await waitForMiniMaxIdentity((options.fetchImpl ?? globalThis.fetch)(url, {
      method: 'GET', redirect: 'error', signal: controller.signal,
      headers: {
        Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'MiniMaxCode',
        Authorization: `Bearer ${accessToken.trim()}`,
        yy: md5(`${encodeURIComponent(pathAndQuery)}_{}${md5(String(now))}ooui`),
        'x-timestamp': timestamp,
        // Public SDK protocol constant from native 0.6.12, not a user credential.
        'x-signature': md5(`${timestamp}I*7Cf%WZ#S&%1RlZJ&C2`),
      },
    }), controller.signal)
    if (response.status === 401 || response.status === 403) throw new MiniMaxIdentityError('rejected')
    if (!response.ok || response.redirected || response.url && response.url !== url.href || !response.body) throw new MiniMaxIdentityError()
    const size = response.headers.get('content-length')
    if (size !== null && (!/^\d+$/.test(size) || Number(size) > LIMIT)) throw new MiniMaxIdentityError()
    reader = response.body.getReader()
    let total = 0
    while (true) {
      const part = await waitForMiniMaxIdentity(reader.read(), controller.signal)
      if (part.done) break
      chunks.push(part.value); total += part.value.byteLength
      if (total > LIMIT) throw new MiniMaxIdentityError()
    }
    const bytes = new Uint8Array(total)
    try {
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      if (!record(value)) throw new MiniMaxIdentityError()
      for (const [key, field] of [['statusInfo', 'code'], ['base_resp', 'status_code']] as const) {
        const status = value[key]
        if (status !== undefined && !record(status)) throw new MiniMaxIdentityError()
        const code = record(status) ? status[field] : undefined
        if (code !== undefined && code !== 0) throw new MiniMaxIdentityError(key === 'statusInfo' && code === 1000048 ? 'rejected' : 'unavailable')
      }
      const data = record(value.data) ? value.data : undefined
      const user = [data?.userInfo, data?.user_info, value.userInfo, value.user_info].find(record)
      const principal = miniMaxIdentityPrincipal(user?.realUserID) ?? miniMaxIdentityPrincipal(user?.real_user_id)
      if (!principal) throw new MiniMaxIdentityError()
      return principal
    } finally { bytes.fill(0) }
  } catch (error) {
    if (signal.aborted) throw cancelled()
    if (error instanceof MiniMaxIdentityError) throw error
    throw new MiniMaxIdentityError()
  } finally {
    clearTimeout(timeout); signal.removeEventListener('abort', abort); controller.abort()
    for (const chunk of chunks) chunk.fill(0)
    // A transport that ignores cancellation must not hold admission forever.
    try { void (reader ? reader.cancel() : response?.body?.cancel())?.catch(() => {}) } catch { /* fixed public error only */ }
    try { reader?.releaseLock() } catch { /* a cancelled read may still be settling */ }
    accessToken = ''
  }
}
