import { describe, expect, it } from 'vitest'
import { projectMiniMaxManagedRoute } from '../src/host/minimax-route.ts'

// Pure synthetic configuration only. No files, CLI, credentials or network.
const origins = ['https://agent.minimaxi.com', 'https://agent.minimax.io', 'https://agent.minimax.cn']
const managed = (options?: Record<string, unknown>) => ({
  minimaxModelSource: 'token_plan', defaultProvider: 'minimax', defaultModel: 'minimax/synthetic-model',
  provider: { minimax: { npm: '@ai-sdk/anthropic', options } },
})

describe('MiniMax native managed route projection (synthetic)', () => {
  it.each(origins)('accepts implicit/explicit managed auth and native placeholders on %s', origin => {
    for (const path of ['', '/anthropic', '/anthropic/v1/'])
      for (const authMode of [undefined, 'managed-login'])
        for (const apiKey of [undefined, '', 'sk-xxx'])
          expect(projectMiniMaxManagedRoute(managed({ baseURL: origin + path, authMode, apiKey })))
            .toEqual({ kind: 'managed-oauth' })
  })
  it('preserves native managed defaults without inventing credentials', () => {
    for (const value of [{}, managed(), managed({}), managed({ apiKey: 'sk-xxx' }), managed({ authMode: 'managed-login' })])
      expect(projectMiniMaxManagedRoute(value)).toEqual({ kind: 'managed-oauth' })
  })
  it('compares parsed origins rather than spelling and never returns endpoint/key', () => {
    expect(projectMiniMaxManagedRoute(managed({ baseURL: '  HTTPS://AGENT.MINIMAX.IO:443/anthropic  ', apiKey: 'sk-xxx' })))
      .toEqual({ kind: 'managed-oauth' })
  })
  const refusals: Array<{ name: string; value: unknown; reason: string }> = [
    { name: 'API source with stale OAuth', value: { ...managed(), minimaxModelSource: 'minimax_api_key' }, reason: 'source' },
    { name: 'custom default model', value: { ...managed(), defaultModel: 'custom_provider:synthetic/model' }, reason: 'source' },
    { name: 'custom default provider', value: { ...managed(), defaultProvider: 'synthetic' }, reason: 'source' },
    { name: 'custom provider npm', value: { ...managed(), provider: { minimax: { npm: 'PRIVATE_PACKAGE' } } }, reason: 'provider' },
    { name: 'malformed provider map', value: { provider: [] }, reason: 'provider' },
    { name: 'malformed options', value: { provider: { minimax: { options: 'PRIVATE_OPTIONS' } } }, reason: 'route' },
    ...[
      { name: 'explicit api-key overrides managed origin', options: { authMode: 'api-key' } },
      { name: 'explicit oauth is not managed-login', options: { authMode: 'oauth' } },
      { name: 'unknown explicit mode', options: { authMode: 'PRIVATE_MODE' } },
      { name: 'null explicit mode is not missing', options: { authMode: null } },
      { name: 'empty explicit mode is not missing', options: { authMode: '' } },
      { name: 'real API key', options: { apiKey: 'sk-PRIVATE_REAL_KEY' } },
      { name: 'non-string key', options: { apiKey: { token: 'PRIVATE_KEY' } } },
      { name: 'native provider key is not ENV-expanded', options: { apiKey: '${PRIVATE_KEY}' } },
      { name: 'placeholder is literal not trimmed', options: { apiKey: ' sk-xxx ' } },
      { name: 'placeholder is literal not case-folded', options: { apiKey: 'SK-XXX' } },
      { name: 'HTTP managed host', options: { baseURL: 'http://agent.minimax.io/anthropic' } },
      { name: 'URL user credentials', options: { baseURL: 'https://PRIVATE_USER:PRIVATE_PASS@agent.minimax.io/anthropic' } },
      { name: 'near-match host', options: { baseURL: 'https://agent.minimax.io.PRIVATE_HOST/anthropic' } },
      { name: 'wrong managed port', options: { baseURL: 'https://agent.minimax.io:444/anthropic' } },
      { name: 'malformed URL', options: { baseURL: 'https://[PRIVATE_BAD_URL' } },
      { name: 'noncanonical scheme', options: { baseURL: 'https:agent.minimax.io' } },
      { name: 'backslash URL normalization', options: { baseURL: 'https://agent.minimax.io\\PRIVATE_PATH' } },
      { name: 'null endpoint is not missing', options: { baseURL: null } },
      { name: 'explicit managed mode does not allow custom endpoint', options: { baseURL: 'https://PRIVATE_ENDPOINT', authMode: 'managed-login' } },
      { name: 'provider headers', options: { headers: { Authorization: 'PRIVATE_HEADER' } } },
      { name: 'provider customHeaders', options: { customHeaders: { Authorization: 'PRIVATE_HEADER' } } },
      { name: 'unconfirmed endpoint alias', options: { endpoint: 'https://PRIVATE_ENDPOINT' } },
      { name: 'unconfirmed baseUrl alias', options: { baseUrl: 'https://PRIVATE_ENDPOINT' } },
    ].map(({ name, options }) => ({ name, value: managed({ baseURL: origins[0], apiKey: 'sk-xxx', ...options }), reason: 'route' })),
    { name: 'per-model headers', value: { provider: { minimax: { models: { synthetic: { headers: { Authorization: 'PRIVATE_HEADER' } } } } } }, reason: 'model' },
    { name: 'modelRef API key', value: { agents: { default: { model: { provider: 'minimax', api_key: 'PRIVATE_KEY' } } } }, reason: 'model' },
    { name: 'modelRef endpoint', value: { agents: { default: { model: { provider: 'minimax', base_url: 'https://PRIVATE_ENDPOINT' } } } }, reason: 'model' },
  ]
  it.each(refusals)('keeps unsupported $name private', ({ value, reason }) => {
    const result = projectMiniMaxManagedRoute(value)
    expect(result).toEqual({ kind: 'unsupported', reason })
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|sk-|https:|apiKey|baseURL/)
  })
})
