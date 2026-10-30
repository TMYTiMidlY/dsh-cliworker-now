import { expect, it } from 'vitest'
import { projectMiniMaxAccountSettings, assertMiniMaxAccountSettings } from '../src/host/native-auth-minimax-settings.ts'

// Vendor-normalized target form: the same owned privacy/safety fields plus the
// provider advertisement and model preferences that mcode 0.6.12 re-adds to a
// root on ACP startup (observed live). The digest stays over the owned fields.
const vendorForm = (owned: Record<string, unknown>) =>
  Buffer.from(JSON.stringify({ logLevel: 'info', permissionMode: 'default', skipWindowsHardSafetyChecks: false, skipParentDeathGuard: false, ...owned, defaultModel: 'minimax/MiniMax-M3.1-Flash', provider: { minimax: { name: 'MiniMax', npm: '@ai-sdk/anthropic', options: { apiKey: 'sk-xxx', baseURL: 'https://agent.minimaxi.com/mavis/api/v1/llm/v1' } } } }))


// Synthetic public schema examples only; no real config, credential or Native.
const source = () => ({
  logLevel: 'info', defaultModel: 'minimax/SYNTHETIC_MODEL', defaultModelVariant: 'SYNTHETIC_VARIANT',
  defaultModelThinking: { effort: 'max' }, defaultModelContextWindow: 128000, permissionMode: 'bypassPermissions',
  dataContribution: { enabled: false }, memory: { enabled: false }, skipWindowsHardSafetyChecks: false, skipParentDeathGuard: false,
  provider: { minimax: { npm: '@ai-sdk/anthropic', options: { authMode: 'managed-login', apiKey: 'sk-xxx', baseURL: 'https://agent.minimax.cn/mavis/api/v1/llm/v1' }, models: { SYNTHETIC_MODEL: { name: 'SYNTHETIC_ADVERTISEMENT' } } } },
})
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value))
it('projects account-only privacy and safety without model advertisements or business preferences', () => {
  const p = projectMiniMaxAccountSettings(bytes(source()), 'cn'), value = JSON.parse(Buffer.from(p.bytes).toString('utf8'))
  expect(value).toEqual({ logLevel: 'info', permissionMode: 'default', dataContribution: { enabled: false }, memory: { enabled: false }, skipWindowsHardSafetyChecks: false, skipParentDeathGuard: false })
  expect(JSON.stringify(value)).not.toMatch(/provider|defaultModel|SYNTHETIC|apiKey|baseURL/)
  expect(() => assertMiniMaxAccountSettings(p.digest, p.bytes, 'cn')).not.toThrow()
})
it('preserves the different Native memory defaults for absent versus existing empty config', () => {
  const missing = projectMiniMaxAccountSettings(undefined, 'cn'), empty = projectMiniMaxAccountSettings(bytes({}), 'cn')
  expect(JSON.parse(Buffer.from(missing.bytes).toString()).memory.enabled).toBe(false)
  expect(JSON.parse(Buffer.from(empty.bytes).toString()).memory.enabled).toBe(true)
  expect(missing.digest).not.toBe(empty.digest)
})
it.each(['contribution', 'memory', 'mode', 'skip', 'unknown'])('does not normalize target %s drift back into the original protected settings', change => {
  const p = projectMiniMaxAccountSettings(bytes(source()), 'cn'), value: any = JSON.parse(Buffer.from(p.bytes).toString())
  if (change === 'contribution') value.dataContribution.enabled = true
  if (change === 'memory') value.memory.enabled = true
  if (change === 'mode') value.permissionMode = 'bypassPermissions'
  if (change === 'skip') value.skipParentDeathGuard = true
  if (change === 'unknown') value.futurePermission = true
  expect(() => assertMiniMaxAccountSettings(p.digest, bytes(value), 'cn')).toThrow(/^AUTH_/)
})
it.each(['private-key', 'other-region', 'custom-path', 'empty-query', 'empty-fragment', 'permission', 'memory-extra', 'privacy-extra', 'hooks', 'unknown-root'])('refuses unsupported source %s without quoting it', kind => {
  const v: any = source()
  if (kind === 'private-key') v.provider.minimax.options.apiKey = 'SYNTHETIC_PRIVATE_KEY'
  if (kind === 'other-region') v.provider.minimax.options.baseURL = 'https://agent.minimax.io/mavis/api/v1/llm/v1'
  if (kind === 'custom-path') v.provider.minimax.options.baseURL = 'https://agent.minimax.cn/SYNTHETIC_CUSTOM_ROUTE'
  if (kind === 'empty-query') v.provider.minimax.options.baseURL += '?'
  if (kind === 'empty-fragment') v.provider.minimax.options.baseURL += '#'
  if (kind === 'permission') v.permission = { nativeDelete: false }
  if (kind === 'memory-extra') v.memory.detailedLogging = true
  if (kind === 'privacy-extra') v.dataContribution.futureConsent = true
  if (kind === 'hooks') v.hooks = { command: 'SYNTHETIC_BUSINESS_COMMAND' }
  if (kind === 'unknown-root') v.futureProtection = false
  try { projectMiniMaxAccountSettings(bytes(v), 'cn'); throw new Error('SYNTHETIC_UNEXPECTED_ACCEPTANCE') }
  catch (error) { expect(String(error)).toMatch(/^NativeAuthError: AUTH_/); expect(JSON.stringify(error)).not.toMatch(/SYNTHETIC_PRIVATE_KEY|SYNTHETIC_CUSTOM_ROUTE|SYNTHETIC_BUSINESS_COMMAND/) }
})
it('supports the exact EN managed endpoint without borrowing a CN route', () => {
  const v = source(); v.provider.minimax.options.baseURL = 'https://agent.minimax.io/mavis/api/v1/llm/v1'
  expect(() => projectMiniMaxAccountSettings(bytes(v), 'en')).not.toThrow()
  expect(() => projectMiniMaxAccountSettings(bytes(v), 'cn')).toThrow(/^AUTH_/)
})
it('accepts the vendor-normalized target form against the original signed digest', () => {
  const settings = projectMiniMaxAccountSettings(vendorForm({ dataContribution: { enabled: true }, memory: { enabled: false } }), 'cn')
  expect(() => assertMiniMaxAccountSettings(settings.digest, vendorForm({ dataContribution: { enabled: true }, memory: { enabled: false } }), 'cn')).not.toThrow()
  expect(() => assertMiniMaxAccountSettings(settings.digest, settings.bytes, 'cn')).not.toThrow()
})
it.each(['memory', 'contribution', 'permission-mode', 'unknown-extra', 'custom-route', 'missing-owned'])('rejects vendor-form drift %s against the signed digest', kind => {
  const owned: any = { dataContribution: { enabled: true }, memory: { enabled: false } }
  if (kind === 'memory') owned.memory = { enabled: true }
  if (kind === 'contribution') owned.dataContribution = { enabled: false }
  const settings = projectMiniMaxAccountSettings(vendorForm({ dataContribution: { enabled: true }, memory: { enabled: false } }), 'cn')
  let bytes = vendorForm(owned)
  if (kind === 'permission-mode') bytes = Buffer.from(JSON.stringify({ ...JSON.parse(bytes.toString()), permissionMode: 'bypassPermissions' }))
  if (kind === 'unknown-extra') bytes = Buffer.from(JSON.stringify({ ...JSON.parse(bytes.toString()), futureProtection: true }))
  if (kind === 'custom-route') bytes = Buffer.from(JSON.stringify({ ...JSON.parse(bytes.toString()), provider: { minimax: { options: { apiKey: 'sk-xxx', baseURL: 'https://SYNTHETIC_ATTACK/mavis/api/v1/llm/v1' } } } }))
  if (kind === 'missing-owned') bytes = Buffer.from(JSON.stringify({ ...JSON.parse(bytes.toString()), memory: undefined }))
  expect(() => assertMiniMaxAccountSettings(settings.digest, bytes, 'cn')).toThrow(/^AUTH_/)
})
