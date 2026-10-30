import { expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { miniMaxNativeAuthKey, projectMiniMaxNativeAuth, miniMaxConfigPolicy, assertMiniMaxConfigPolicy, inspectMiniMaxNativeAuth, inspectMiniMaxTargetAuth } from '../src/host/native-auth-minimax.ts'

// Pure format/selection tests. All tokens and roots are synthetic; no account,
// files, HTTP, CLI, native identity or publication is exercised by this suite.
const now = 1800000000000, sourceRoot = resolve('.cache/minimax-format-synthetic-source'), targetRoot = resolve('.cache/minimax-format-synthetic-target')
const nativeKey = (root: string, region: string) => `com.minimax.mcode.oauth.prod.${region}\0${createHash('sha256').update(join(root, 'auth') + '\0mcode-public').digest('base64url')}`
function fixture(region: 'cn' | 'en' = 'cn') {
  const prefix = `auth/prod/${region}/mcode-public`, authPath = `${prefix}/auth.json`, statePath = `${prefix}/auth-state.json`
  const common = { clientId: 'mcode-public', scopes: ['agent.default', 'SYNTHETIC_SCOPE'], audience: 'agent-backend', generation: 3 }
  const state: any = { schemaVersion: 2, status: 'authenticated', storeKind: 'file', buildEnv: 'prod', region, expiresAtMs: now + 600000, ...common }
  const credential: any = { schemaVersion: 1, accessToken: 'SYNTHETIC_ACCESS', refreshToken: 'SYNTHETIC_REFRESH', tokenType: 'Bearer', expiresAtMs: state.expiresAtMs, ...common }
  const key = nativeKey(sourceRoot, region), envelope: any = { schemaVersion: 1, records: { [key]: credential } }
  const files = new Map<string, Buffer>()
  const sync = () => { files.set(statePath, Buffer.from(JSON.stringify(state))); files.set(authPath, Buffer.from(JSON.stringify(envelope))) }
  sync()
  return { region, prefix, authPath, statePath, state, credential, key, envelope, files, sync,
    project: () => projectMiniMaxNativeAuth({ sourceRoot, targetRoot, region, files, nowMs: now }) }
}
const rejected = (f: ReturnType<typeof fixture>) => {
  try { f.project(); throw new Error('SYNTHETIC_UNEXPECTED_ACCEPTANCE') }
  catch (error) { expect(String(error)).toMatch(/^NativeAuthError: AUTH_/); expect(JSON.stringify(error)).not.toContain('SYNTHETIC_ACCESS'); expect(JSON.stringify(error)).not.toContain(sourceRoot) }
}

it('inspects a guarded source without inventing or rekeying to a temporary target', () => {
  const f = fixture(), before = [...f.files].map(([path, bytes]) => [path, Buffer.from(bytes)] as const)
  const sample = inspectMiniMaxNativeAuth({ sourceRoot, region: f.region, files: f.files, nowMs: now })
  expect(sample).toEqual({ accessToken: 'SYNTHETIC_ACCESS', configPolicy: 'native-default' })
  expect(Object.isFrozen(sample)).toBe(true)
  expect(Object.keys(sample).sort()).toEqual(['accessToken', 'configPolicy'])
  for (const [path, bytes] of before) expect(f.files.get(path)).toEqual(bytes)
})
it('admits a coherent authenticated expired target only for Native preparation, never source import or UID postcheck', () => {
  const f = fixture(); f.credential.expiresAtMs = f.state.expiresAtMs = now - 1; f.sync()
  const input = { nativeRoot: sourceRoot, region: f.region, files: f.files, nowMs: now }
  expect(inspectMiniMaxTargetAuth(input, 'before-native')).toEqual({ accessToken: 'SYNTHETIC_ACCESS', expiresAtMs: now - 1 })
  expect(() => inspectMiniMaxTargetAuth(input, 'after-native')).toThrow(/^AUTH_/)
  rejected(f)
})
it('accepts an actually valid post-Native token without imposing the source minimum lifetime', () => {
  const f = fixture(); f.credential.expiresAtMs = f.state.expiresAtMs = now + 30000; f.sync()
  expect(inspectMiniMaxTargetAuth({ nativeRoot: sourceRoot, region: f.region, files: f.files, nowMs: now }, 'after-native').expiresAtMs).toBe(now + 30000)
  rejected(f)
})
it.each(['refreshing', 'mismatch'])('target preparation does not loosen coherent state contract for %s', kind => {
  const f = fixture()
  if (kind === 'refreshing') f.state.status = 'refreshing'
  else f.state.generation++
  f.sync()
  expect(() => inspectMiniMaxTargetAuth({ nativeRoot: sourceRoot, region: f.region, files: f.files, nowMs: now }, 'before-native')).toThrow(/^AUTH_/)
})
it.each(['cn', 'en'] as const)('projects only the selected %s record with exact Native root rekey and unchanged state', region => {
  const f = fixture(region), other = nativeKey(resolve('.cache/minimax-format-synthetic-other'), region)
  f.envelope.records[other] = { ...f.credential, accessToken: 'SYNTHETIC_OTHER_DO_NOT_COPY' }; f.sync()
  const before = new Map([...f.files].map(([key, bytes]) => [key, Buffer.from(bytes)])), p = f.project()
  expect(miniMaxNativeAuthKey(sourceRoot, region)).toBe(f.key)
  expect(p.accessToken).toBe(f.credential.accessToken)
  expect(p.files.map(f => f.path).sort()).toEqual([f.authPath, f.statePath].sort())
  const projected = new Map(p.files.map(f => [f.path, f.bytes])), auth = JSON.parse(Buffer.from(projected.get(f.authPath)!).toString('utf8'))
  expect(auth).toEqual({ schemaVersion: 1, records: { [nativeKey(targetRoot, region)]: f.credential } })
  expect(Buffer.from(projected.get(f.statePath)!)).toEqual(f.files.get(f.statePath))
  expect(JSON.stringify(auth)).not.toContain('SYNTHETIC_OTHER_DO_NOT_COPY')
  for (const [path, bytes] of before) expect(f.files.get(path)).toEqual(bytes)
  for (const file of p.files) file.bytes.fill(0)
  for (const [path, bytes] of before) expect(f.files.get(path)).toEqual(bytes)
})
it.each(['absent', 'empty', 'value'])('credential-only optional loginEpoch %s is preserved without invented state fields', kind => {
  const f = fixture()
  if (kind !== 'absent') f.credential.loginEpoch = kind === 'empty' ? '' : 'SYNTHETIC_LOGIN_EPOCH'
  f.credential.subject = ''; f.credential.accountId = 'SYNTHETIC_LOCAL_ACCOUNT_NOT_IDENTITY'; f.sync()
  const p = f.project(), auth = JSON.parse(Buffer.from(p.files.find(x => x.path === f.authPath)!.bytes).toString('utf8'))
  expect(auth.records[nativeKey(targetRoot, f.region)]).toEqual(f.credential)
  expect(Object.hasOwn(JSON.parse(Buffer.from(p.files.find(x => x.path === f.statePath)!.bytes).toString('utf8')), 'loginEpoch')).toBe(false)
})
it('accepts state expiry absence and scope order differences without adding or normalizing fields', () => {
  const f = fixture(); delete f.state.expiresAtMs; f.state.scopes = [...f.credential.scopes].reverse(); f.sync()
  const p = f.project()
  expect(JSON.parse(Buffer.from(p.files.find(x => x.path === f.statePath)!.bytes).toString('utf8'))).toEqual(f.state)
})
it('copies a known empty config as data but does not drop unrelated input into the projection', () => {
  const f = fixture(); f.files.set('config.yaml', Buffer.from('{}\n')); f.files.set('cli-auth/prod/cn/account-identity.json', Buffer.from('SYNTHETIC_CACHE_NOT_AUTH'))
  const p = f.project()
  expect(p.files.find(x => x.path === 'config.yaml')?.bytes).toEqual(Buffer.from('{}\n'))
  expect(p.files.some(x => x.path.includes('cli-auth'))).toBe(false)
})
it.each(['schema', 'store', 'build', 'region', 'client', 'audience', 'generation', 'scopes', 'expiry', 'authorization', 'fake-epoch', 'timestamp', 'token-field', 'unknown'])('rejects state %s mismatch/unknown rather than repairing it', kind => {
  const f = fixture()
  if (kind === 'schema') f.state.schemaVersion = 1
  if (kind === 'store') f.state.storeKind = 'os-keyring'
  if (kind === 'build') f.state.buildEnv = 'staging'
  if (kind === 'region') f.state.region = 'en'
  if (kind === 'client') f.state.clientId = 'SYNTHETIC_OTHER_CLIENT'
  if (kind === 'audience') f.state.audience = 'other'
  if (kind === 'generation') f.state.generation++
  if (kind === 'scopes') f.state.scopes = ['agent.default']
  if (kind === 'expiry') f.state.expiresAtMs++
  if (kind === 'authorization') f.state.authorization = { leaseId: 'SYNTHETIC_DEVICE', leaseExpiresAtMs: now + 1000 }
  if (kind === 'fake-epoch') f.state.loginEpoch = 'SYNTHETIC_NOT_NATIVE_STATE_FIELD'
  if (kind === 'timestamp') f.state.updatedAtMs = now
  if (kind === 'token-field') f.state.accessToken = 'SYNTHETIC_ACCESS'
  if (kind === 'unknown') f.state.futureProtection = false
  f.sync(); rejected(f)
})
it.each(['anonymous', 'authorizing', 'refreshing', 'scope_upgrade_required', 'logging_out', 'logout_pending', 'expired', 'error'])('does not import transitional status %s as authenticated', status => {
  const f = fixture(); f.state.status = status; f.sync(); rejected(f)
})
it.each(['access', 'refresh', 'type', 'schema', 'client', 'audience', 'scopes', 'generation', 'expiry', 'epoch-type', 'unknown'])('rejects credential %s without claiming a Native principal', kind => {
  const f = fixture()
  if (kind === 'access') f.credential.accessToken = ''
  if (kind === 'refresh') delete f.credential.refreshToken
  if (kind === 'type') f.credential.tokenType = 'bearer'
  if (kind === 'schema') f.credential.schemaVersion = 2
  if (kind === 'client') f.credential.clientId = 'other'
  if (kind === 'audience') f.credential.audience = 'other'
  if (kind === 'scopes') f.credential.scopes = ['SYNTHETIC_OTHER_SCOPE']
  if (kind === 'generation') f.credential.generation = -1
  if (kind === 'expiry') f.credential.expiresAtMs = now + 59999
  if (kind === 'epoch-type') f.credential.loginEpoch = 1
  if (kind === 'unknown') f.credential.futureField = true
  f.sync(); rejected(f)
})
it.each(['wrong-root', 'wrong-region', 'missing', 'bad-other', 'envelope-schema', 'envelope-extra'])('rejects %s envelope without searching another record or silently removing an invalid one', kind => {
  const f = fixture()
  if (kind === 'wrong-root') { f.envelope.records[nativeKey(targetRoot, 'cn')] = f.credential; delete f.envelope.records[f.key] }
  if (kind === 'wrong-region') { f.envelope.records[nativeKey(sourceRoot, 'en')] = f.credential; delete f.envelope.records[f.key] }
  if (kind === 'missing') delete f.envelope.records[f.key]
  if (kind === 'bad-other') f.envelope.records.other = { ...f.credential, tokenType: 'bad' }
  if (kind === 'envelope-schema') f.envelope.schemaVersion = 2
  if (kind === 'envelope-extra') f.envelope.other = 'SYNTHETIC_SECRET_DO_NOT_EXPOSE'
  f.sync(); rejected(f)
})
it('preserves the exact known Native ACP initialized config without inserting a provider', () => {
  const f = fixture(), config = {
    logLevel: 'info', defaultModel: 'minimax/MiniMax-M3.1-Flash-Preview', dataContribution: { enabled: true }, memory: { enabled: false },
    skipWindowsHardSafetyChecks: false, skipParentDeathGuard: false,
  }
  const raw = Buffer.from(JSON.stringify(config)); f.files.set('config.yaml', raw)
  expect(f.project().files.find(file => file.path === 'config.yaml')?.bytes).toEqual(raw)
})
it.each(['permissionMode: auto\n', 'permission:\n  nativeDelete: false\n', 'mcpServers: {}\n', 'provider: {}\n', 'sandbox: {}\n', '[]', 'null'])('does not strip an unimplemented config shape %s', config => {
  const f = fixture(); f.files.set('config.yaml', Buffer.from(config)); rejected(f)
})
it('rejects malformed UTF-8 and does not treat replacement decoding as a Native proof', () => {
  const f = fixture(); f.files.set(f.authPath, Buffer.from([0xff])); rejected(f)
})
it('does not project into its own source root', () => {
  const f = fixture(); expect(() => projectMiniMaxNativeAuth({ sourceRoot, targetRoot: sourceRoot, region: f.region, files: f.files, nowMs: now })).toThrow(/^AUTH_/)
})
it.each(['permission.json', 'agents/example/permission.json', 'plugin-hook-permissions/state.json'])('does not silently discard explicitly supplied protection %s', path => {
  const f = fixture(); f.files.set(path, Buffer.from('{"deny":"SYNTHETIC_PROTECTION"}')); rejected(f)
})
it.each(['child', '..named-child'])('refuses a target nested in the source at %s', name => {
  const f = fixture()
  expect(() => projectMiniMaxNativeAuth({ sourceRoot, targetRoot: join(sourceRoot, name), region: f.region, files: f.files, nowMs: now })).toThrow(/^AUTH_/)
})
it('keeps absent config absent rather than manufacturing an empty config', () => {
  const f = fixture(); expect(f.project().files.some(file => file.path === 'config.yaml')).toBe(false)
})
it('preserves matching duplicate scope multisets but rejects different multiplicities', () => {
  const f = fixture(); f.state.scopes = [...f.state.scopes]; f.credential.scopes = [...f.credential.scopes]
  f.state.scopes.push('agent.default'); f.credential.scopes.unshift('agent.default'); f.sync()
  const projected = f.project()
  expect(JSON.parse(Buffer.from(projected.files.find(file => file.path === f.statePath)!.bytes).toString('utf8')).scopes).toEqual(f.state.scopes)
  f.credential.scopes.pop(); f.sync(); rejected(f)
})
it.each(['state-utf8', 'auth-oversize', 'state-oversize', 'config-oversize', 'unsafe-generation', 'fractional-generation', 'nonfinite-expiry', 'null-records', 'array-records'])('rejects bounded Native format edge %s', kind => {
  const f = fixture()
  if (kind === 'unsafe-generation') f.credential.generation = f.state.generation = Number.MAX_SAFE_INTEGER + 1
  if (kind === 'fractional-generation') f.credential.generation = f.state.generation = 3.5
  if (kind === 'nonfinite-expiry') f.credential.expiresAtMs = Infinity
  if (kind === 'null-records') f.envelope.records = null
  if (kind === 'array-records') f.envelope.records = []
  f.sync()
  if (kind === 'state-utf8') f.files.set(f.statePath, Buffer.from([0xff]))
  if (kind === 'auth-oversize') f.files.set(f.authPath, Buffer.alloc(65537, 32))
  if (kind === 'state-oversize') f.files.set(f.statePath, Buffer.alloc(65537, 32))
  if (kind === 'config-oversize') f.files.set('config.yaml', Buffer.alloc(65537, 32))
  rejected(f)
})
it('rejects unknown YAML tags without emitting their private source text as a warning', () => {
  const warning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
  try {
    const f = fixture(); f.files.set('config.yaml', Buffer.from('!SYNTHETIC_PRIVATE_CONFIG_TAG {}'))
    rejected(f)
    expect(warning).not.toHaveBeenCalled()
  } finally { warning.mockRestore() }
})
it('keeps original absent/default semantics distinct from empty through target initialization', () => {
  const initialized = Buffer.from(JSON.stringify({
    logLevel: 'info', defaultModel: 'minimax/MiniMax-M3.1-Flash-Preview', dataContribution: { enabled: true }, memory: { enabled: false },
    skipWindowsHardSafetyChecks: false, skipParentDeathGuard: false,
  }))
  expect(miniMaxConfigPolicy()).toBe('native-default')
  expect(miniMaxConfigPolicy(Buffer.from('{}'))).toBe('empty')
  expect(miniMaxConfigPolicy(initialized)).toBe('native-default')
  expect(() => assertMiniMaxConfigPolicy('native-default', initialized)).not.toThrow()
  expect(() => assertMiniMaxConfigPolicy('empty', Buffer.from('{}'))).not.toThrow()
  expect(() => assertMiniMaxConfigPolicy('empty')).toThrow('AUTH_IDENTITY_MISMATCH')
  expect(() => assertMiniMaxConfigPolicy('native-default', Buffer.from('{}'))).toThrow('AUTH_IDENTITY_MISMATCH')
  expect(() => assertMiniMaxConfigPolicy('empty', initialized)).toThrow('AUTH_IDENTITY_MISMATCH')
})
it.each(['memory', 'windows-skip', 'parent-skip', 'provider', 'permission', 'nested-extra', 'missing-field'])('does not accept initialized target %s protection drift', kind => {
  const config: any = {
    logLevel: 'info', defaultModel: 'minimax/MiniMax-M3.1-Flash-Preview', dataContribution: { enabled: true }, memory: { enabled: false },
    skipWindowsHardSafetyChecks: false, skipParentDeathGuard: false,
  }
  if (kind === 'memory') config.memory.enabled = true
  if (kind === 'windows-skip') config.skipWindowsHardSafetyChecks = true
  if (kind === 'parent-skip') config.skipParentDeathGuard = true
  if (kind === 'provider') config.provider = {}
  if (kind === 'permission') config.permissionMode = 'bypassPermissions'
  if (kind === 'nested-extra') config.memory.futureProtection = false
  if (kind === 'missing-field') delete config.skipParentDeathGuard
  expect(() => assertMiniMaxConfigPolicy('native-default', Buffer.from(JSON.stringify(config)))).toThrow('AUTH_UNSUPPORTED')
})
it.each([NaN, Infinity, -1])('rejects invalid operation clock %s', nowMs => {
  const f = fixture(); expect(() => projectMiniMaxNativeAuth({ sourceRoot, targetRoot, region: f.region, files: f.files, nowMs })).toThrow(/^AUTH_/)
})
