import { expect, it, vi } from 'vitest'
import { CliWorkerService } from '../src/host/index.ts'
import { DEFAULT_CONFIG } from '../src/host/process.ts'
import { NativeAuthError } from '../src/host/native-auth-files.ts'

// Actual registered tool + Remote presentation, synthetic resource facade.
// No source/native process, private store, live account, HTTP or GUI.
const descriptor = { id: 'ap_11111111-1111-4111-8111-111111111111', cli: 'minimax', label: 'Synthetic profile', materialRevision: 'm_22222222-2222-4222-8222-222222222222', recordRevision: 1, enabled: true, state: 'available' }
const request = { cli: 'minimax', sourceRoot: '/SYNTHETIC_AUTH_SOURCE', region: 'cn', label: 'Synthetic profile', requestId: 'synthetic-import-1' }
function fixture() {
  const tools = new Map<string, any>(); let plan = false, mode = 'workspace-write'
  const agent: any = { id: 'synthetic-parent', session: { header: { origin: 'user', cwd: '/SYNTHETIC_PROJECT' } }, ctx: { get(name: string) {
    if (name === 'planMode') return { get: () => ({ active: plan }) }
    if (name === 'sandboxPolicy') return { resolve: () => ({ mode }) }
  } } }
  const profiles = { list: vi.fn(() => [descriptor]), import: vi.fn(async () => descriptor), manage: vi.fn(() => ({ ...descriptor, enabled: false })), dispose: vi.fn(async () => {}) }
  const service: any = Object.create(CliWorkerService.prototype), control = new AbortController()
  Object.assign(service, { ctx: { tools: { register(tool: any) { tools.set(tool.name, tool) } }, effect(fn: () => any) { fn() } },
    runtime: { assertCliEnabled: vi.fn(), assertAccountIdle: vi.fn(), blockCatalogOnCleanup: vi.fn(), storage: { directory: '/SYNTHETIC_STATE' } },
    backend: { resolveExecutable: vi.fn(async () => '/SYNTHETIC_MCODE') }, options: DEFAULT_CONFIG, nativeProfiles: profiles,
    disposed: new AbortController(), accounts: { isBusy: vi.fn(() => false) }, parent: vi.fn(async () => agent) })
  service.registerTools()
  const exec = (name: string, args = {}, owner = agent) => tools.get(`cliworker_auth_${name}`).execute(args, { agent: owner, signal: control.signal })
  return { service, tools, profiles, control, agent, exec, plan: (v: boolean) => { plan = v }, mode: (v: string) => { mode = v } }
}
it('registers distinct safe profile list/import/manage actions with no credential/transport input', () => {
  const f = fixture(); expect([...f.tools.keys()]).toEqual(expect.arrayContaining(['cliworker_auth_profiles', 'cliworker_auth_import', 'cliworker_auth_manage']))
  for (const name of ['import', 'manage']) {
    const tool = f.tools.get(`cliworker_auth_${name}`)
    expect(Object.keys(tool.parameters.properties)).not.toEqual(expect.arrayContaining(['access_token', 'refresh_token', 'backend', 'identity', 'snapshotBackend']))
    expect(tool.parameters.required).toContain('request_id')
  }
})
it('list is registration-only, main-session read-only and has no model or write effects', async () => {
  const f = fixture(); f.plan(true); f.mode('read-only')
  const result = JSON.parse(await f.exec('profiles'))
  expect(result.profiles).toEqual([descriptor]); expect(result.validation).toBe('registered-not-live-checked')
  expect(f.profiles.import).not.toHaveBeenCalled(); expect(f.profiles.manage).not.toHaveBeenCalled()
})
it.each(['plan', 'readonly', 'child'])('formal import and Remote management reject %s before facade/Native side effects', async kind => {
  const f = fixture(); if (kind === 'plan') f.plan(true); if (kind === 'readonly') f.mode('read-only'); if (kind === 'child') f.agent.session.header.origin = 'subagent'
  await expect(f.exec('import', { cli: 'minimax', source_root: request.sourceRoot, region: 'cn', label: request.label, request_id: request.requestId })).rejects.toThrow()
  await expect(f.service.authManage(f.agent.id, JSON.stringify({ cli: 'minimax', id: descriptor.id, expectedRecordRevision: 1, requestId: 'synthetic-disable', enabled: false }), f.control.signal)).rejects.toThrow()
  expect(f.profiles.import).not.toHaveBeenCalled(); expect(f.profiles.manage).not.toHaveBeenCalled(); expect(f.service.backend.resolveExecutable).not.toHaveBeenCalled()
})
it('Tool and Remote use the same account-only request semantics and safe descriptor projection', async () => {
  const f = fixture()
  const toolResult = JSON.parse(await f.exec('import', { cli: 'minimax', source_root: request.sourceRoot, region: 'cn', label: request.label, request_id: request.requestId }))
  const remoteResult = JSON.parse(await f.service.authImport(f.agent.id, JSON.stringify({ ...request, requestId: 'synthetic-import-2' }), f.control.signal))
  expect(toolResult.profile).toEqual(descriptor); expect(remoteResult.profile).toEqual(descriptor)
  expect(f.profiles.import).toHaveBeenCalledTimes(2)
  expect(f.profiles.import.mock.calls.every(([input]: any) => input.sourceRoot === request.sourceRoot && input.region === 'cn')).toBe(true)
  expect(JSON.stringify(toolResult)).not.toContain(request.sourceRoot)
})
it('preserves an already committed receipt without executable lookup or relabelling a later cancellation', async () => {
  const f = fixture()
  f.profiles.import.mockImplementationOnce(async () => { f.control.abort(new Error('SYNTHETIC_AFTER_COMMIT')); return descriptor })
  expect(JSON.parse(await f.exec('import', { cli: 'minimax', source_root: request.sourceRoot, region: 'cn', label: request.label, request_id: request.requestId })).profile).toEqual(descriptor)
  expect(f.service.backend.resolveExecutable).not.toHaveBeenCalled()
})
it('rejects arbitrary credentials, unsupported CLI and half CAS before facade or executable lookup', async () => {
  for (const patch of [{ accessToken: 'SYNTHETIC_SECRET' }, { cli: 'codex' }, { id: descriptor.id }]) {
    const f = fixture()
    await expect(f.service.authImport(f.agent.id, JSON.stringify({ ...request, ...patch }), f.control.signal)).rejects.toThrow()
    expect(f.profiles.import).not.toHaveBeenCalled(); expect(f.service.backend.resolveExecutable).not.toHaveBeenCalled()
  }
})
it('reconstructs native auth codes without echoing modified private error text', async () => {
  const f = fixture(), error = new NativeAuthError('IDENTITY_MISMATCH'); error.message = 'SYNTHETIC_PRIVATE_SOURCE /SYNTHETIC_SECRET_ROOT'
  f.profiles.import.mockRejectedValueOnce(error)
  const result = await f.exec('import', { cli: 'minimax', source_root: request.sourceRoot, region: 'cn', label: request.label, request_id: request.requestId }).catch((e: unknown) => e)
  expect(String(result)).toContain('AUTH_IDENTITY_MISMATCH'); expect(String(result)).not.toContain('SYNTHETIC_PRIVATE')
})
