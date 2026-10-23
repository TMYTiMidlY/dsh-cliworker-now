import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, parse, resolve } from 'node:path'
import { request as httpRequest } from 'node:http'
import { Readable } from 'node:stream'

export const object = v => !!v && typeof v === 'object' && !Array.isArray(v)
export const text = v => typeof v === 'string' && !!v.trim() && v.length <= 2048 && !/[\x00-\x1f\x7f]/.test(v)
export const digest = v => createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(v)).digest('hex')
export class OpenCodeCompatibilityError extends Error {
  code = 'OPENCODE_NATIVE_UNAVAILABLE'
  constructor(message = 'OpenCode v2 原生服务元数据不可用，请打开原生账号终端后刷新') { super(message); this.name = 'OpenCodeCompatibilityError' }
}
const fail = message => new OpenCodeCompatibilityError(message)
export const DENY_ALL = Object.freeze([Object.freeze({ action: '*', resource: '*', effect: 'deny' })])
const statKey = s => `${s.dev}:${s.ino}:${s.mode}:${s.uid}:${s.nlink}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`
async function parents(path) {
  const result = []
  for (let cursor = dirname(path); ; cursor = dirname(cursor)) {
    const info = await lstat(cursor)
    if (!info.isDirectory() || info.isSymbolicLink()) throw fail()
    result.push([cursor, `${info.dev}:${info.ino}:${info.mode}:${info.uid}`])
    if (cursor === parse(cursor).root) return result
  }
}
export async function readPrivateJSON(path, limit = 65536, signal = AbortSignal.timeout(5000)) {
  let handle, buffer
  try {
    signal.throwIfAborted()
    const ancestors = await parents(path), parent = await lstat(dirname(path)), entry = await lstat(path)
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1 || entry.size > limit || entry.mode & 0o077 || parent.mode & 0o022 || entry.uid !== process.getuid?.()) throw fail('OpenCode v2 私有记录无法安全读取')
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const before = await handle.stat()
    if (statKey(before) !== statKey(entry)) throw fail()
    buffer = Buffer.alloc(before.size + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    signal.throwIfAborted()
    const after = await handle.stat(), current = await lstat(path)
    for (const [path, key] of ancestors) {
      const info = await lstat(path)
      if (!info.isDirectory() || info.isSymbolicLink() || `${info.dev}:${info.ino}:${info.mode}:${info.uid}` !== key) throw fail()
    }
    if (bytesRead !== before.size || statKey(after) !== statKey(before) || statKey(current) !== statKey(before) || current.isSymbolicLink()) throw fail('OpenCode v2 私有来源在读取时发生变化')
    const bytes = buffer.subarray(0, bytesRead)
    let data
    try { data = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes)) } catch { throw fail('OpenCode v2 私有记录格式无法安全解析') }
    return { data, fingerprint: digest(Buffer.concat([Buffer.from(statKey(before)), bytes])) }
  } finally { buffer?.fill(0); await handle?.close() }
}
function nativePath(options) {
  const env = options.env ?? process.env
  if ((options.platform ?? process.platform) !== 'linux') throw fail('OpenCode v2 原生服务目前仅核验 Linux；当前平台暂不支持')
  if (['OPENCODE_DB', 'OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG_CONTENT', 'OPENCODE_SERVER', 'OPENCODE_SERVER_URL', 'OPENCODE_PASSWORD', 'OPENCODE_SERVER_PASSWORD', 'OPENCODE_HOME', 'OPENCODE_DATA_DIR'].some(k => !!env[k])) throw fail('OpenCode v2 当前认证或服务覆盖来源尚未支持；不会猜测其他服务或数据库')
  const state = env.XDG_STATE_HOME ?? join(options.home ?? homedir(), '.local/state')
  if (!text(state) || !isAbsolute(state)) throw fail('OpenCode v2 原生服务目录必须是明确绝对路径')
  return join(state, 'opencode/service.json')
}
function baseOrigin(value) {
  if (!text(value)) throw fail()
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || Number(url.port) < 1 || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw fail('OpenCode v2 服务不是已确认的本机回环来源')
  return url.origin
}
async function registry(path, expected, signal) {
  try {
    const { data: raw, fingerprint } = await readPrivateJSON(path, 65536, signal)
    if (!object(raw) || !text(raw.password) || raw.version !== expected || !Number.isSafeInteger(raw.pid) || raw.pid <= 0 || raw.pid > 2147483647 || raw.id !== undefined && !text(raw.id) || Object.keys(raw).some(k => !['id', 'version', 'url', 'pid', 'password'].includes(k))) throw fail('OpenCode v2 原生服务版本、身份或认证记录无法确认')
    return { path, password: raw.password, base: baseOrigin(raw.url), pid: raw.pid, version: raw.version, fingerprint }
  } catch (error) {
    signal.throwIfAborted()
    if (error?.code === 'ENOENT') throw fail('OpenCode v2 原生服务未运行或未登记；请在原生账号终端打开 OpenCode 后刷新，这不表示账号已登出')
    if (error instanceof OpenCodeCompatibilityError) throw error
    throw fail('OpenCode v2 原生服务记录无法安全解析或读取')
  }
}
async function processIdentity(record, executable) {
  const info = await lstat(`/proc/${record.pid}`)
  if (info.uid !== process.getuid?.() || await realpath(`/proc/${record.pid}/exe`) !== await realpath(executable)) throw fail('OpenCode v2 服务进程身份与所选原生入口不匹配')
}
/** Direct literal-loopback HTTP, independent of Host proxy/global fetch dispatchers. */
function directRequest(url, init) {
  return new Promise((yes, no) => {
    const req = httpRequest(url, { method: init.method, headers: init.headers, signal: init.signal, agent: false }, incoming => {
      try {
        const headers = new Headers()
        for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
        const status = incoming.statusCode ?? 500
        const response = new Response([204, 205, 304].includes(status) ? null : Readable.toWeb(incoming), { status, headers })
        if ([204, 205, 304].includes(status)) incoming.resume()
        yes(response)
      } catch { incoming.destroy(); no(fail()) }
    })
    req.once('error', () => no(fail('OpenCode v2 原生服务连接失败或已取消')))
    req.end(init.body)
  })
}
const sessionID = 'ses[A-Za-z0-9_-]{1,180}', messageID = 'msg_[A-Za-z0-9_-]{1,180}'
function allowed(route, method) {
  const path = route.split('?')[0]
  if (method === 'GET') return ['/api/info', '/api/integration', '/api/provider', '/api/model', '/api/agent', '/api/event', '/api/session/active'].includes(path) || new RegExp(`^/api/(?:experimental/)?session/${sessionID}(?:/(?:log|inbox)|/message/${messageID})?$`).test(path)
  if (method === 'POST') return path === '/api/session' || new RegExp(`^/api/(?:experimental/)?session/${sessionID}/(?:prompt|interrupt|wait)$`).test(path)
  return method === 'DELETE' && new RegExp(`^/api/session/${sessionID}/inbox/${messageID}$`).test(path)
}
export async function openOpenCodeV2Service(executable, version, project, signal, options = {}) {
  if (version.major !== 2 || !isAbsolute(project)) throw fail()
  const path = nativePath(options), directory = resolve(project), record = await registry(path, version.version, signal)
  await processIdentity(record, executable)
  const maximum = Math.min(options.maxBytes ?? 8 * 1024 * 1024, 8 * 1024 * 1024)
  async function request(route, method = 'GET', body, requestSignal = AbortSignal.timeout(5000)) {
    requestSignal.throwIfAborted()
    if (!route.startsWith('/api/') || !allowed(route, method)) throw fail('OpenCode v2 请求超出自有会话范围')
    const url = new URL(route, record.base)
    if (url.origin !== record.base) throw fail()
    const response = await (options.fetch ?? directRequest)(url, { method, redirect: 'error', signal: requestSignal,
      headers: { Authorization: `Basic ${Buffer.from(`opencode:${record.password}`).toString('base64')}`, Accept: 'application/json, text/event-stream', ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    if (!response.ok) { await response.body?.cancel(); throw Object.assign(fail('OpenCode v2 原生服务未就绪、认证被拒绝或元数据格式暂不支持'), { httpStatus: response.status }) }
    return response
  }
  async function json(route, method = 'GET', body, requestSignal = AbortSignal.timeout(5000), budget = options.metadataBudget ?? { used: 0, maximum }) {
    const response = await request(route, method, body, requestSignal)
    if (response.status === 204) return undefined
    if (!response.headers.get('content-type')?.startsWith('application/json') || !response.body) { await response.body?.cancel(); throw fail('OpenCode v2 元数据格式暂不支持') }
    const reader = response.body.getReader(), decoder = new TextDecoder('utf8', { fatal: true })
    let raw = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        budget.used += value.byteLength
        if (budget.used > budget.maximum) throw fail('OpenCode v2 原生元数据超过读取限制')
        raw += decoder.decode(value, { stream: true }); requestSignal.throwIfAborted()
      }
      requestSignal.throwIfAborted()
      try { return JSON.parse(raw + decoder.decode()) } catch { throw fail('OpenCode v2 原生元数据格式无法安全解析') }
    } finally { raw = ''; await reader.cancel().catch(() => {}); reader.releaseLock() }
  }
  async function verify(verifySignal = AbortSignal.timeout(5000), budget) {
    await processIdentity(record, executable)
    const info = await json('/api/info', 'GET', undefined, verifySignal, budget)
    if (!object(info) || info.version !== version.version || info.pid !== record.pid || !Array.isArray(info.urls) || !info.urls.some(x => typeof x === 'string' && x.replace(/\/$/, '') === record.base)) throw fail('OpenCode v2 HTTP服务身份、版本或地址不匹配')
    const current = await registry(path, version.version, verifySignal)
    try { if (current.fingerprint !== record.fingerprint) throw fail('OpenCode v2 原生服务来源已改变，请刷新') } finally { current.password = '' }
  }
  await verify(signal)
  return { directory, epoch: record.fingerprint, pid: record.pid, version: record.version, registryPath: path,
    json, request, verify, credentialsEnvironment: () => JSON.stringify(record), close: () => { record.password = '' } }
}
function rows(value, directory, limit) {
  if (!object(value) || !object(value.location) || value.location.directory !== directory || !Array.isArray(value.data) || value.data.length > limit || value.data.some(x => !object(x))) throw fail('OpenCode v2 元数据项目或包装格式不匹配')
  return value.data
}
function unique(values) { if (values.some(x => !text(x.id)) || new Set(values.map(x => x.id)).size !== values.length) throw fail('OpenCode v2 元数据包含无法确认的重复身份') }
function overridden(value, depth = 0) {
  if (depth > 16) return true
  if (Array.isArray(value)) return value.some(v => overridden(v, depth + 1))
  return object(value) && Object.entries(value).some(([key, v]) => /auth|api[_-]?key|access[_-]?token|refresh[_-]?token|password|cookie|base[_-]?url|endpoint|credentials?/i.test(key) || overridden(v, depth + 1))
}
function unsupported(row) { return row.settings !== undefined && !object(row.settings) || row.headers !== undefined && (!object(row.headers) || Object.keys(row.headers).length > 0) || row.body !== undefined && (!object(row.body) || Object.keys(row.body).length > 0) || overridden(row.settings) }
export function openCodeV2ModelRef(id) {
  if (typeof id !== 'string' || !id.startsWith('opencode-v2:') || id.length > 16384) throw fail()
  try {
    const encoded = id.slice(12)
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw Error()
    const bytes = Buffer.from(encoded, 'base64url')
    if (bytes.toString('base64url') !== encoded) throw Error()
    const tuple = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes))
    if (!Array.isArray(tuple) || tuple.length !== 3 || !text(tuple[0]) || !text(tuple[1]) || tuple[2] !== null && (typeof tuple[2] !== 'string' || tuple[2].length > 2048 || /[\x00-\x1f\x7f]/.test(tuple[2])) || Buffer.from(JSON.stringify(tuple)).toString('base64url') !== encoded) throw Error()
    return { providerID: tuple[0], id: tuple[1], ...(tuple[2] !== null ? { variant: tuple[2] } : {}) }
  } catch { throw fail('OpenCode v2 原生模型标识无法确认') }
}
export async function serviceMetadata(service, signal, options = {}) {
  const { directory } = service, budget = options.metadataBudget ?? { used: 0, maximum: Math.min(options.maxBytes ?? 8 * 1024 * 1024, 8 * 1024 * 1024) }
  const query = async (route, limit) => rows(await service.json(`${route}?${new URLSearchParams({ 'location[directory]': directory })}`, 'GET', undefined, signal, budget), directory, limit)
  const integrations = await query('/api/integration', 512), providers = await query('/api/provider', 1024), models = await query('/api/model', 4096)
  unique(integrations); unique(providers)
  const active = new Map(), scopes = [], accepted = new Map(), candidates = [], pins = {}, seen = new Set()
  let hasConnections = false, needsAuth = false, unsupportedSource = false, derivedBytes = 0
  for (const integration of integrations) {
    if (!Array.isArray(integration.connections) || integration.connections.length > 256) throw fail()
    const current = integration.connections[0]
    if (!current) continue
    hasConnections = true
    if (!object(current)) throw fail()
    if (current.status !== undefined) { if (!object(current.status) || current.status.status !== 'needs_auth') throw fail(); needsAuth = true; continue }
    if (current.type !== 'credential' || !text(current.id) || !['key', 'oauth'].includes(current.method)) { unsupportedSource = true; continue }
    active.set(integration.id, current); scopes.push([integration.id, current.id, current.method])
  }
  const providerScopes = []
  for (const provider of providers) {
    if (!['auto', 'enabled', 'disabled'].includes(provider.activation)) throw fail()
    if (provider.activation === 'disabled' || !text(provider.integrationID) || !active.has(provider.integrationID) || unsupported(provider)) continue
    accepted.set(provider.id, provider)
    providerScopes.push([provider.id, provider.integrationID, provider.canonical ?? null, digest(provider.settings ?? {})])
  }
  let agent
  if (options.includeAgent) {
    const agents = await query('/api/agent', 512), first = agents[0]
    if (!object(first) || !text(first.id) || first.hidden !== false || !['primary', 'all'].includes(first.mode) || !Array.isArray(first.permissions) || !object(first.request) || unsupported(first.request) || overridden(first.request)) throw fail('OpenCode v2 原生默认agent或认证路由暂不支持')
    if (first.permissions.some(p => !object(p) || typeof p.action !== 'string' || typeof p.resource !== 'string' || !['allow', 'deny', 'ask'].includes(p.effect))) throw fail()
    agent = { id: first.id, mode: first.mode, hidden: first.hidden, permissions: first.permissions, fingerprint: digest(first) }
  }
  for (const model of models) {
    if (!text(model.id) || !text(model.modelID) || !text(model.providerID) || !text(model.name) || typeof model.enabled !== 'boolean' || !Array.isArray(model.variants) || model.variants.length > 128) throw fail('OpenCode v2 原生模型或数组变体格式不支持')
    if (!model.enabled || !accepted.has(model.providerID) || unsupported(model)) continue
    const variants = [null]
    for (const variant of model.variants) {
      if (!object(variant) || typeof variant.id !== 'string' || variant.id.length > 2048 || /[\x00-\x1f\x7f]/.test(variant.id)) throw fail()
      if (!unsupported(variant)) variants.push(variant.id)
    }
    if (new Set(variants).size !== variants.length) throw fail()
    const provider = accepted.get(model.providerID), connection = active.get(provider.integrationID)
    for (const variant of variants) {
      const id = `opencode-v2:${Buffer.from(JSON.stringify([model.providerID, model.id, variant])).toString('base64url')}`
      const label = variant === null ? model.name : `${model.name} [${JSON.stringify(variant)}]`
      derivedBytes += Buffer.byteLength(id) + Buffer.byteLength(label)
      if (seen.has(id) || candidates.length >= 4096 || derivedBytes > Math.min(budget.maximum, 8 * 1024 * 1024)) throw fail('OpenCode v2 原生候选展开超过读取限制')
      seen.add(id)
      candidates.push({ id, label, efforts: ['default'], cost: 'unknown', ...(options.includeAgent ? { opaqueIdentity: true } : {}) })
      pins[id] = digest([provider.integrationID, connection.id, connection.method, provider, model, variant, agent?.fingerprint ?? null])
    }
  }
  const integrationAfter = await query('/api/integration', 512), providerAfter = await query('/api/provider', 1024)
  if (JSON.stringify(integrations) !== JSON.stringify(integrationAfter) || JSON.stringify(providers) !== JSON.stringify(providerAfter)) throw fail('OpenCode v2 原生账号或路由在查询期间改变，请刷新')
  if (agent) { const after = await query('/api/agent', 512); if (!after[0] || digest(after[0]) !== agent.fingerprint) throw fail('OpenCode v2 原生默认agent发生变化') }
  await service.verify(signal, budget)
  const identity = { state: active.size ? 'configured' : needsAuth && !unsupportedSource ? 'unauthenticated' : hasConnections ? 'configured' : 'unconfigured', verification: 'cli',
    summary: active.size ? `OpenCode v2 原生服务识别到 ${active.size} 个账号来源、${candidates.length} 个配置候选；${options.includeAgent ? '仅支持显式只读纯文本，全部工具拒绝' : '任务另行核验只读纯文本通路'}，未验证远端账号或模型权限`
      : needsAuth && !unsupportedSource ? 'OpenCode v2 原生服务报告当前来源需要认证；插件未自动登录或退出'
      : hasConnections ? 'OpenCode v2 原生来源已配置，但当前环境或外部认证方式尚未支持' : 'OpenCode v2 原生服务当前没有连接账号；未读取旧账号文件或借用其他CLI密钥' }
  return { identity, candidates, agent, pins, bindingMaterial: { sourceIds: [service.registryPath, `native:opencode:v2:credential-source:${directory}`], entries: scopes.length ? [{ provider: 'opencode-v2-credential-source', principal: { kind: 'native-credential-records', records: digest(scopes) }, route: { providers: digest(providerScopes), ...(agent ? { agent: agent.fingerprint, models: digest(pins) } : {}) } }] : [] } }
}
export async function readOpenCodeV2Metadata(executable, version, project, signal, options = {}) {
  options = { ...options, metadataBudget: { used: 0, maximum: Math.min(options.maxBytes ?? 8 * 1024 * 1024, 8 * 1024 * 1024) } }
  const control = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.min(options.timeoutMs ?? 8000, 15000)))])
  let service
  try { service = await openOpenCodeV2Service(executable, version, project, control, options); return await serviceMetadata(service, control, options) }
  catch (error) { if (error instanceof OpenCodeCompatibilityError) throw error; signal.throwIfAborted(); throw fail(control.aborted ? 'OpenCode v2 原生元数据查询已取消或超时' : 'OpenCode v2 原生元数据读取失败，未改动账号或启动任务') }
  finally { service?.close() }
}
