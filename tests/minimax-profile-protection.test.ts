import { expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { projectMiniMaxAccountSettings } from '../src/host/native-auth-minimax-settings.ts'
import { assertMiniMaxProfileProtection } from '../src/host/minimax-profile-protection.mjs'
// Synthetic private profile settings only. No credentials, Native or HTTP.
function fixture() {
  mkdirSync('.cache', { recursive: true }); const root = mkdtempSync(join(process.cwd(), '.cache/minimax-protection-synthetic-'))
  const settings = projectMiniMaxAccountSettings(undefined, 'cn')
  writeFileSync(join(root, 'config.yaml'), settings.bytes, { mode: 0o600 })
  const expected = { root, region: 'cn' as const, configDigest: settings.digest, version: '0.6.12' as const }
  const env = { MINIMAX_DATA_DIR: root, MAVIS_DATA_DIR: root, MAVIS_REGION: 'cn', MAVIS_BUILD_ENV: 'prod' }
  return { root, expected, env, value: JSON.parse(Buffer.from(settings.bytes).toString()) }
}
it.each(['json', 'yaml'])('accepts unchanged original settings in %s without rewriting them', kind => {
  const f = fixture(); if (kind === 'yaml') writeFileSync(join(f.root, 'config.yaml'), stringify(f.value), { mode: 0o600 })
  expect(() => assertMiniMaxProfileProtection(f.expected, f.env)).not.toThrow()
})
it.each(['digest', 'permission', 'privacy', 'unknown', 'global-permission', 'plugin-hook', 'environment', 'version', 'symlink', 'public'])('rejects private protection drift %s without leaking contents', kind => {
  const f = fixture(), p = join(f.root, 'config.yaml')
  if (kind === 'digest') f.expected.configDigest = 'a'.repeat(64)
  if (kind === 'permission') f.value.permissionMode = 'bypassPermissions'
  if (kind === 'privacy') f.value.dataContribution.enabled = false
  if (kind === 'unknown') f.value.SYNTHETIC_SECRET = 'SYNTHETIC_SECRET_VALUE'
  if (['permission', 'privacy', 'unknown'].includes(kind)) writeFileSync(p, JSON.stringify(f.value), { mode: 0o600 })
  if (kind === 'global-permission') writeFileSync(join(f.root, 'permission.json'), '{}', { mode: 0o600 })
  if (kind === 'plugin-hook') mkdirSync(join(f.root, 'plugin-hook-permissions'), { mode: 0o700 })
  if (kind === 'environment') f.env.MAVIS_REGION = 'en'
  if (kind === 'version') (f.expected as any).version = '0.0.0'
  if (kind === 'symlink') { const other = join(f.root, 'other'); mkdirSync(other, { mode: 0o700 }); symlinkSync(other, join(f.root, 'plugin-hook-permissions')) }
  if (kind === 'public') chmodSync(p, 0o644)
  let error: unknown; try { assertMiniMaxProfileProtection(f.expected, f.env) } catch (caught) { error = caught }
  expect(error).toBeInstanceOf(Error); expect(String(error)).not.toContain(f.root); expect(String(error)).not.toContain('SYNTHETIC_SECRET')
})
