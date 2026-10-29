const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim() && value.length <= 8192 && !/[\x00-\x1f\x7f]/.test(value)

// Native 0.6.12 managed origins. This is routing evidence, never login evidence.
const managedOrigins = new Set([
  'https://agent.minimaxi.com',
  'https://agent.minimax.io',
  'https://agent.minimax.cn',
])
export type MiniMaxManagedRoute =
  | { kind: 'managed-oauth' }
  | { kind: 'unsupported'; reason: 'source' | 'provider' | 'route' | 'model' }
const unsupported = (reason: Extract<MiniMaxManagedRoute, { kind: 'unsupported' }>['reason']): MiniMaxManagedRoute =>
  ({ kind: 'unsupported', reason })

function managedEndpoint(value: unknown): boolean {
  if (!text(value) || !/^https:\/\//i.test(value.trim()) || value.includes('\\')) return false
  try {
    const url = new URL(value.trim())
    return !url.username && !url.password && managedOrigins.has(url.origin)
  } catch { return false }
}
function modelRouteOverride(value: unknown): boolean {
  return record(value) && Object.entries(value).some(([key, item]) =>
    /^(?:api_key|base_url|apiKey|baseURL|headers|customHeaders)$/i.test(key) && item !== undefined ||
    (record(item) || Array.isArray(item)) &&
      (Array.isArray(item) ? item.some(modelRouteOverride) : modelRouteOverride(item)))
}

/** Pure, secret-free decision for the currently supported managed OAuth route only. */
export function projectMiniMaxManagedRoute(value: unknown): MiniMaxManagedRoute {
  if (!record(value) || value.minimaxModelSource !== undefined && value.minimaxModelSource !== 'token_plan' ||
      value.defaultProvider !== undefined && value.defaultProvider !== 'minimax' ||
      value.defaultModel !== undefined && (!text(value.defaultModel) || !value.defaultModel.startsWith('minimax/') || !value.defaultModel.slice(8).trim()))
    return unsupported('source')
  if (value.provider !== undefined && !record(value.provider)) return unsupported('provider')
  const provider = (value.provider as Record<string, unknown> | undefined)?.minimax
  if (provider !== undefined && !record(provider) ||
      record(provider) && provider.npm !== undefined && provider.npm !== '@ai-sdk/anthropic') return unsupported('provider')
  const models = record(provider) ? provider.models : undefined
  const options = record(provider) ? provider.options : undefined
  if (options !== undefined && !record(options)) return unsupported('route')
  const ownOptions = options as Record<string, unknown> | undefined
  // Exact native names only. Do not reinterpret aliases or generic provider keys as ENV references.
  if (ownOptions && Object.keys(ownOptions).some(key =>
    /^(?:apiKey|baseURL|headers|customHeaders|endpoint)$/i.test(key) &&
    key !== 'apiKey' && key !== 'baseURL' && ownOptions[key] !== undefined)) return unsupported('route')
  const baseURL = ownOptions?.baseURL
  const knownEndpoint = baseURL === undefined || managedEndpoint(baseURL)
  // Native explicit authMode takes precedence over origin inference. Missing endpoint uses the native managed default.
  const authMode = ownOptions?.authMode !== undefined ? ownOptions.authMode : knownEndpoint ? 'managed-login' : 'api-key'
  if (authMode !== 'managed-login' || !knownEndpoint) return unsupported('route')
  const key = ownOptions?.apiKey
  // EDe uses a missing/empty provider key as sk-xxx. No ${NAME} expansion happens on this native path.
  if (key !== undefined && key !== '' && key !== 'sk-xxx') return unsupported('route')
  if (modelRouteOverride(models) || modelRouteOverride(value.agents) || modelRouteOverride(value.model))
    return unsupported('model')
  return { kind: 'managed-oauth' }
}
