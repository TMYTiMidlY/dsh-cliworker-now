/** Kimi 2.2 native CLI provider metadata; private material, never a Gateway result. */
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const nonempty = (v: unknown) => typeof v === 'string' ? v.trim() || undefined : undefined
const usable = (v: string) => v.length <= 65536 && !/[\x00-\x20{}$]/.test(v) && !/^(?:!|<|your[_ -]|placeholder|changeme)/i.test(v)
const typedKeys: Readonly<Record<string, readonly string[]>> = Object.freeze({
  kimi: ['KIMI_API_KEY'], openai: ['OPENAI_API_KEY'], openai_responses: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'], 'google-genai': ['VERTEXAI_API_KEY', 'GOOGLE_API_KEY'],
})
export type KimiCredentialResolution =
  | { kind: 'api'; source: 'inline' | 'provider-env' | 'declared-env'; key: string; environment?: Record<string, string>; reference?: string }
  | { kind: 'oauth' | 'none' | 'conflict' | 'invalid' | 'unresolved' | 'unsupported' }
export class KimiCredentialConfigurationError extends Error {
  readonly code = 'CLI_OWN_ACCOUNT_REQUIRED'
  constructor(message = 'Kimi 当前凭据配置或显式环境引用无法确认，请在原生账号终端检查') { super(message); this.name = 'KimiCredentialConfigurationError' }
}
/** A native global model overlay changes actual execution, not just presentation.
 * Refuse it consistently rather than borrowing an ambient key or suppressing user config. */
export function assertKimiEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  if (Object.entries(env).some(([name, value]) => name.startsWith('KIMI_MODEL_') && !!value))
    throw new KimiCredentialConfigurationError('Kimi 全局环境模型覆盖暂不支持，请使用明确的原生提供商配置')
}
export function resolveKimiCredential(provider: unknown, env: NodeJS.ProcessEnv = process.env): KimiCredentialResolution {
  if (!record(provider)) return { kind: 'invalid' }
  if (['apiKey', 'apiKeyEnv'].some(k => provider[k] !== undefined && typeof provider[k] !== 'string') ||
      provider.env !== undefined && (!record(provider.env) || Object.values(provider.env).some(v => typeof v !== 'string')))
    return { kind: 'invalid' }
  const inline = nonempty(provider.apiKey), reference = nonempty(provider.apiKeyEnv), oauth = provider.oauth !== undefined
  // Native conflicts are checked before validating placeholder-like values.
  if (inline && reference || oauth && (inline || reference)) return { kind: 'conflict' }
  if (oauth && !record(provider.oauth)) return { kind: 'invalid' }
  if (inline) return usable(inline) ? { kind: 'api', source: 'inline', key: inline } : { kind: 'invalid' }
  if (reference) {
    if (reference.length > 1024 || /[=\x00-\x1f\x7f]/.test(reference) || /^(?:DSH_|CLIWORKER_)/i.test(reference) || reference.toUpperCase() === 'ELECTRON_RUN_AS_NODE')
      return { kind: 'unsupported' }
    // Read this exact declared variable only. Never use a default key if absent.
    const key = nonempty(env[reference])
    if (!key) return { kind: 'unresolved' }
    return usable(key) ? { kind: 'api', source: 'declared-env', reference, key, environment: { [reference]: key } } : { kind: 'unsupported' }
  }
  const names = typeof provider.type === 'string' && Object.hasOwn(typedKeys, provider.type) ? typedKeys[provider.type]! : []
  // Native firstEnvHit picks by raw length BEFORE trimming: an empty-after-trim
  // first Google value must not cause a different second key to be selected.
  const selected = names.find(name => typeof provider.env?.[name] === 'string' && provider.env[name].length > 0)
  const key = selected ? nonempty(provider.env[selected]) : undefined
  if (key && oauth) return { kind: 'conflict' }
  if (key) return usable(key) ? { kind: 'api', source: 'provider-env', key } : { kind: 'invalid' }
  return { kind: oauth ? 'oauth' : 'none' }
}
/** Only explicit references cross the Harness scrub boundary; never spread process.env. */
export function kimiDeclaredEnvironment(raw: unknown, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  assertKimiEnvironment(env)
  if (!record(raw) || !record(raw.providers)) throw new KimiCredentialConfigurationError()
  const result: Record<string, string> = {}
  let bytes = 0
  for (const provider of Object.values(raw.providers)) {
    const credential = resolveKimiCredential(provider, env)
    if (credential.kind !== 'api' || !credential.environment) continue
    for (const [name, value] of Object.entries(credential.environment)) {
      if (Object.hasOwn(result, name)) continue
      bytes += Buffer.byteLength(name) + Buffer.byteLength(value)
      if (Object.keys(result).length >= 64 || bytes > 65536) throw new KimiCredentialConfigurationError()
      Object.defineProperty(result, name, { value, enumerable: true, writable: true, configurable: true })
    }
  }
  return result
}
