import { afterEach, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CliWorkerService } from '../src/host/index.ts'
import { WorkerStorage, type DispatchSetup } from '../src/host/storage.ts'
import { validatePreference, type Catalog } from '../src/host/adapters.ts'
import { resolveModel } from '../src/shared/models.ts'
import type { CliId } from '../src/shared/types.ts'
import { roleSnapshot } from '../src/host/roles.ts'
import { ProcessCleanupUnconfirmedError } from '../src/host/process.ts'
import { MetadataCaptureError } from '../src/host/metadata-diagnostics.ts'
import { assertMiniMaxIdentityActive, requestMiniMaxIdentity } from '../src/host/minimax-identity.ts'

// Real Host selection/storage with synthetic metadata only. No CLI or account is read.
const cleanups: Array<() => void> = []
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close() })
function fixture() {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-dispatch-parameters-')))
  const storage = new WorkerStorage(join(project, 'state'))
  cleanups.push(() => rmSync(project, { recursive: true, force: true }), () => storage.close())
  const ask = vi.fn(() => { throw new Error('Dispatch must never open a user question') })
  let binding = 'synthetic-account-a', enabled = true
  let models: Catalog['models'] = [
    { id: 'fixture-a', label: 'Fixture A', efforts: ['low', 'high'] },
    { id: 'fixture-b', label: 'Fixture B', efforts: ['default'] },
  ]
  const tools = new Map<string, any>()
  const service: any = Object.create(CliWorkerService.prototype)
  Object.assign(service, {
    ctx: { effect: (register: () => void) => register(), tools: { register: (tool: any) => tools.set(tool.name, tool) } },
    options: {}, backend: {}, disposed: new AbortController(), pending: new Map(), dispatchWaits: new Map(),
    selectionBindings: new WeakMap(), accounts: { isBusy: () => false },
    runtime: { storage, changed: vi.fn(), assertCliEnabled: () => { if (!enabled) throw new Error('CLI 已关闭') } },
    assertExecution: vi.fn(),
    queryCatalog: vi.fn(async (cli: CliId, _backend: any, _config: any, _project: any, signal: AbortSignal, expected?: string) => {
      signal.throwIfAborted()
      if (expected !== undefined && expected !== binding) throw new Error('账号已变更')
      return { catalog: { cli, models, notice: 'Synthetic native metadata' }, binding }
    }),
    querySelection: vi.fn(async (preference: any, _backend: any, _config: any, _project: any, signal: AbortSignal, expected: string) => {
      signal.throwIfAborted()
      if (expected !== binding) throw new Error('账号已变更')
      const catalog = { cli: preference.cli, models }
      validatePreference(preference, catalog)
      return { catalog, binding, preference: resolveModel(preference, models) }
    }),
    launch: vi.fn(async (_agent: any, _title: string, _prompt: string, preference: any, _mode: any, _id: any, identity: any) => JSON.stringify({ preference, identity })),
  })
  const agents = new Map<string, any>()
  const agent = (id = 'parent', cwd = project) => {
    if (!agents.has(id)) agents.set(id, { id, session: { header: { cwd, origin: 'user' } },
      ctx: { get: (name: string) => name === 'userQuestions' ? { ask } : undefined } })
    return agents.get(id)
  }
  service.registerTools()
  const choose = (options: { id?: string; cli?: CliId; mode?: string; signal?: AbortSignal; model?: string; effort?: string; role?: string; expected?: string; agyAccount?: string } = {}) =>
    service.chooseDispatch(agent(options.id), options.signal ?? new AbortController().signal, options.cli ?? 'antigravity', options.mode ?? 'accept-edits', options.expected, options.agyAccount, options.model, options.effort, options.role) as Promise<DispatchSetup>
  const saved = (id = 'parent', model = 'fixture-a', effort = 'high', role: DispatchSetup['role'] = null) => {
    const setup = { preference: { cli: 'antigravity' as const, model, effort: effort as any }, role, binding }
    storage.setDispatchSetup(project, setup); storage.setConversationSetup(id, project, setup)
    return setup
  }
  return { project, storage, service, ask, tools, choose, agent, saved,
    setBinding: (value: string) => { binding = value }, setModels: (value: Catalog['models']) => { models = value },
    setEnabled: (value: boolean) => { enabled = value } }
}

it('formal MiniMax start projects a real structured pre-abort without serializing its reason or touching metadata', async () => {
  const f = fixture(), control = new AbortController()
  control.abort({ kind: 'user', private: 'PRIVATE_CANCEL_REASON' })
  const error = await f.tools.get('cliworker_start').execute({ cli: 'minimax', title: 'Synthetic', prompt: 'NOT_SENT', model: 'fixture-a', effort: 'high' }, { agent: f.agent(), signal: control.signal }).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(Error)
  expect(error.message).toContain('CLI_OPERATION_CANCELLED'); expect(error.message).not.toContain('PRIVATE_CANCEL_REASON')
  expect(f.service.queryCatalog).not.toHaveBeenCalled(); expect(f.service.launch).not.toHaveBeenCalled()
  expect(f.storage.conversationSetup('parent', f.project, 'minimax')).toBeUndefined()
})
it.each(['assert', 'request'] as const)('formal MiniMax start recognizes identity-internal %s cancellation without broadening unrelated abort handling', async stage => {
  const f = fixture(), control = new AbortController(), reason = { private: 'PRIVATE_IDENTITY_CANCEL' }
  let internal: unknown
  const fetcher = vi.fn(async () => { control.abort(reason); throw new Error('PRIVATE_TRANSPORT_ABORT') })
  f.service.queryCatalog.mockImplementationOnce(async (_cli: unknown, _backend: unknown, _config: unknown, _project: unknown, signal: AbortSignal) => {
    try {
      if (stage === 'assert') { control.abort(reason); assertMiniMaxIdentityActive(signal) }
      else await requestMiniMaxIdentity('cn', 'SYNTHETIC_IDENTITY_TOKEN', signal, { fetchImpl: fetcher })
      throw new Error('Identity unexpectedly succeeded')
    } catch (error) { internal = error; throw error }
  })
  const error = await f.tools.get('cliworker_start').execute({ cli: 'minimax', title: 'Synthetic', prompt: 'NOT_SENT', model: 'fixture-a', effort: 'high' }, { agent: f.agent(), signal: control.signal }).catch((e: unknown) => e)
  expect(internal === reason).toBe(false); expect((internal as Error).name).toBe('AbortError')
  expect(error).toBeInstanceOf(Error); expect(error.message).toContain('CLI_OPERATION_CANCELLED')
  expect(error.message).not.toMatch(/PRIVATE_|SYNTHETIC_IDENTITY_TOKEN/)
  expect(f.service.queryCatalog).toHaveBeenCalledOnce(); expect(f.service.launch).not.toHaveBeenCalled()
  expect(f.storage.conversationSetup('parent', f.project, 'minimax')).toBeUndefined()
  expect(fetcher).toHaveBeenCalledTimes(stage === 'request' ? 1 : 0)
})

it('only the second same-CLI setup-lock waiter is cancelled and its object reason stays private', async () => {
  const f = fixture(), gate = Promise.withResolvers<void>(), original = f.service.queryCatalog.getMockImplementation()!
  f.saved()
  f.service.queryCatalog.mockImplementationOnce(async (...args: unknown[]) => { await gate.promise; return original(...args) })
  const first = f.tools.get('cliworker_start').execute({ cli: 'agy', title: 'First', prompt: 'FIRST_ALLOWED' }, { agent: f.agent(), signal: new AbortController().signal })
  await vi.waitFor(() => expect(f.service.queryCatalog).toHaveBeenCalledTimes(1))
  const control = new AbortController(), second = f.tools.get('cliworker_start').execute({ cli: 'agy', title: 'Second', prompt: 'SECOND_NOT_SENT' }, { agent: f.agent(), signal: control.signal }).catch((e: unknown) => e)
  await vi.waitFor(() => expect(f.service.pending.get('parent')).toBe(2))
  control.abort({ kind: 'user', private: 'PRIVATE_WAITER_REASON' })
  const error = await second
  gate.resolve(); await first
  expect(error).toBeInstanceOf(Error)
  expect(error.message).toContain('CLI_OPERATION_CANCELLED'); expect(error.message).not.toContain('PRIVATE_WAITER_REASON')
  expect(f.service.launch).toHaveBeenCalledTimes(1); expect(f.service.launch.mock.calls[0][2]).toBe('FIRST_ALLOWED')
  expect(f.service.queryCatalog).toHaveBeenCalledTimes(1); expect(f.service.pending.size).toBe(0)
})
it.each(['plain', 'error-accessor'] as const)('public start never evaluates unknown %s getters, cause or toString', async kind => {
  const f = fixture(), called = vi.fn(() => { throw new Error('PRIVATE_GETTER_CONTENT') })
  const thrown = kind === 'plain' ? {} : new Error('placeholder')
  for (const key of ['message', 'code', 'cause', 'toString']) Object.defineProperty(thrown, key, { configurable: true, get: called })
  f.service.assertExecution.mockImplementationOnce(() => { throw thrown })
  const error = await f.tools.get('cliworker_start').execute({ cli: 'minimax', title: 'Synthetic', prompt: 'NOT_SENT', model: 'fixture-a', effort: 'high' }, { agent: f.agent(), signal: new AbortController().signal }).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(Error)
  expect(Object.getOwnPropertyDescriptor(error, 'message')?.value).toContain('CLI_OPERATION_FAILED')
  expect(called).not.toHaveBeenCalled(); expect(f.service.queryCatalog).not.toHaveBeenCalled(); expect(f.service.launch).not.toHaveBeenCalled()
})
it.each(['cleanup', 'metadata', 'delivery'] as const)('public error keeps confirmed %s semantics ahead of cancellation', async kind => {
  const f = fixture(), control = new AbortController()
  const typed = kind === 'cleanup' ? new ProcessCleanupUnconfirmedError() : kind === 'metadata' ? new MetadataCaptureError('read', 'ECONNRESET', 3) : Object.assign(new Error('SYNTHETIC_DELIVERY_UNKNOWN; do not retry'), { code: 'STEER_UNKNOWN' })
  f.service.assertExecution.mockImplementationOnce(() => { if (kind !== 'metadata') control.abort({ private: 'PRIVATE_ABORT' }); throw typed })
  const error = await f.tools.get('cliworker_start').execute({ cli: 'minimax', title: 'Synthetic', prompt: 'NOT_SENT', model: 'fixture-a', effort: 'high' }, { agent: f.agent(), signal: control.signal }).catch((e: unknown) => e)
  if (kind === 'cleanup') expect(error).toBeInstanceOf(ProcessCleanupUnconfirmedError)
  if (kind === 'metadata') expect(error).toMatchObject({ code: 'CLI_METADATA_CAPTURE_FAILED', phase: 'read', reason: 'ECONNRESET', exitCode: 3 })
  if (kind === 'delivery') expect(error.code).toBe('STEER_UNKNOWN')
  expect(error.message).not.toContain('CLI_OPERATION_CANCELLED'); expect(f.service.queryCatalog).not.toHaveBeenCalled(); expect(f.service.launch).not.toHaveBeenCalled()
})

it.each(['cancel', 'unknown'] as const)('real Remote configure safely renders %s without committing a selection', async kind => {
  const f = fixture(), control = new AbortController(), touched = vi.fn(() => { throw new Error('PRIVATE_REMOTE_GETTER') })
  f.service.parent = vi.fn(async () => f.agent())
  if (kind === 'cancel') control.abort({ private: 'PRIVATE_REMOTE_CANCEL' })
  else {
    const thrown = {}; for (const key of ['message', 'code', 'cause', 'toString']) Object.defineProperty(thrown, key, { get: touched })
    f.service.querySelection.mockRejectedValueOnce(thrown)
  }
  const error = await f.service.configure('parent', JSON.stringify({ cli: 'minimax', model: 'fixture-a', effort: 'high' }), control.signal).catch((e: unknown) => e)
  expect(String(error)).toContain(kind === 'cancel' ? 'CLI_OPERATION_CANCELLED' : 'CLI_OPERATION_FAILED')
  expect(String(error)).not.toContain('PRIVATE_REMOTE_'); expect(touched).not.toHaveBeenCalled()
  expect(f.storage.preference(f.project, 'minimax')).toBeUndefined(); expect(f.service.launch).not.toHaveBeenCalled()
})

it('first use without model rejects without questions, partial settings, or a launch', async () => {
  const f = fixture()
  await expect(f.choose()).rejects.toThrow('MODEL_REQUIRED')
  expect(f.ask).not.toHaveBeenCalled(); expect(f.service.queryCatalog).not.toHaveBeenCalled()
  expect(f.storage.dispatchSetup(f.project, 'antigravity')).toBeUndefined()
  expect(f.storage.conversationSetup('parent', f.project, 'antigravity')).toBeUndefined()
})
it('legacy model preferences do not silently become a complete setup', async () => {
  const f = fixture(); f.storage.setPreference(f.project, { cli: 'antigravity', model: 'fixture-b', effort: 'default' })
  await expect(f.choose()).rejects.toThrow('MODEL_REQUIRED'); expect(f.ask).not.toHaveBeenCalled()
})
it('explicit model and effort establish an exact no-role setup with no question', async () => {
  const f = fixture(), setup = await f.choose({ model: 'fixture-a', effort: 'high' })
  expect(setup).toMatchObject({ preference: { cli: 'antigravity', model: 'fixture-a', effort: 'high' }, role: null })
  expect(f.storage.conversationSetup('parent', f.project, 'antigravity')).toEqual(setup)
  expect(f.storage.dispatchSetup(f.project, 'antigravity')).toEqual(setup); expect(f.ask).not.toHaveBeenCalled()
})
it('single advertised effort can be used without guessing unsupported default', async () => {
  const f = fixture(); f.setModels([{ id: 'only', label: 'Only', efforts: ['high'] }])
  expect((await f.choose({ model: 'only' })).preference.effort).toBe('high')
})
it('multiple efforts without default require an explicit effort', async () => {
  const f = fixture(); await expect(f.choose({ model: 'fixture-a' })).rejects.toThrow('EFFORT_REQUIRED')
  expect(f.storage.preference(f.project)).toBeUndefined(); expect(f.ask).not.toHaveBeenCalled()
})
it('unsupported models and efforts do not save or ask', async () => {
  for (const input of [{ model: 'missing' }, { model: 'fixture-b', effort: 'max' }]) {
    const f = fixture(); await expect(f.choose(input)).rejects.toThrow()
    expect(f.ask).not.toHaveBeenCalled(); expect(f.storage.preference(f.project)).toBeUndefined()
  }
})
it('current parent setup wins over later project defaults', async () => {
  const f = fixture(), current = f.saved()
  f.storage.setDispatchSetup(f.project, { ...current, preference: { cli: 'antigravity', model: 'fixture-b', effort: 'default' } })
  expect(await f.choose()).toEqual(current); expect(f.ask).not.toHaveBeenCalled()
})
it('new parents automatically reuse a valid complete project setup without a reuse card', async () => {
  const f = fixture(), current = f.saved()
  expect(await f.choose({ id: 'second' })).toEqual(current)
  expect(f.storage.conversationSetup('second', f.project, 'antigravity')).toEqual(current)
  expect(f.ask).not.toHaveBeenCalled()
})
it('project and CLI setup isolation is retained', async () => {
  const f = fixture(); f.saved()
  await expect(f.choose({ cli: 'hermes' })).rejects.toThrow('MODEL_REQUIRED')
  const other = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-dispatch-other-')))
  cleanups.push(() => rmSync(other, { recursive: true, force: true }))
  await expect(f.service.chooseDispatch(f.agent('other', other), new AbortController().signal, 'antigravity')).rejects.toThrow('MODEL_REQUIRED')
})
it.each(['account', 'model', 'effort', 'variant'])('invalid %s setup rejects instead of opening a fresh selection', async kind => {
  const f = fixture(), old = f.saved()
  if (kind === 'account') f.setBinding('other-account')
  if (kind === 'model') f.setModels([{ id: 'fixture-b', label: 'B', efforts: ['default'] }])
  if (kind === 'effort') f.setModels([{ id: 'fixture-a', label: 'A', efforts: ['low'] }])
  if (kind === 'variant') f.setModels([{ id: 'fixture-a', label: 'A', efforts: ['high'], variants: { high: 'changed-high' } }])
  await expect(f.choose()).rejects.toThrow(); expect(f.ask).not.toHaveBeenCalled()
  expect(f.storage.conversationSetup('parent', f.project, 'antigravity')).toEqual(old)
})
it('explicit role snapshots the exact preset and role=none clears only new dispatch setup', async () => {
  const f = fixture(), preset = f.storage.rolePresets()[0]!
  const selected = await f.choose({ model: 'fixture-b', role: preset.id })
  expect(selected.role).toEqual(roleSnapshot(preset))
  f.storage.saveRolePreset({ ...preset, prompt: 'changed later' })
  expect((await f.choose()).role).toEqual(roleSnapshot(preset))
  expect((await f.choose({ role: 'none' })).role).toBeNull()
  expect(selected.role).toEqual(roleSnapshot(preset)); expect(f.ask).not.toHaveBeenCalled()
})
it('unknown role IDs fail before native metadata or saved settings are touched', async () => {
  const f = fixture(); await expect(f.choose({ model: 'fixture-b', role: 'missing' })).rejects.toThrow('ROLE_NOT_FOUND')
  expect(f.service.queryCatalog).not.toHaveBeenCalled(); expect(f.storage.preference(f.project)).toBeUndefined()
})
it('same-model effort is reusable and an explicit effort can update a saved model', async () => {
  const f = fixture(); f.saved()
  expect((await f.choose({ model: 'fixture-a' })).preference.effort).toBe('high')
  expect((await f.choose({ effort: 'low' })).preference).toMatchObject({ model: 'fixture-a', effort: 'low' })
})
it('exact native variants are validated before expected_model and before persisting', async () => {
  const f = fixture(); f.setModels([{ id: 'group', label: 'Group', efforts: ['high'], variants: { high: 'exact-high' } }])
  await expect(f.choose({ model: 'group', effort: 'high', expected: 'group' })).rejects.toThrow('预期模型')
  expect(f.storage.preference(f.project)).toBeUndefined()
  expect((await f.choose({ model: 'group', effort: 'high', expected: 'exact-high' })).preference.model).toBe('exact-high')
})
it.each([undefined, 'default'])('an exact variant cannot silently resolve to a different model at effort=%s', async effort => {
  const f = fixture(); f.setModels([{ id: 'group', label: 'Group', efforts: ['default', 'high'], variants: { default: 'group', high: 'exact-high' } }])
  await expect(f.choose({ model: 'exact-high', effort })).rejects.toThrow(effort === undefined ? 'EFFORT_REQUIRED' : '精确模型')
  expect(f.storage.preference(f.project)).toBeUndefined(); expect(f.ask).not.toHaveBeenCalled()
  expect((await f.choose({ model: 'exact-high', effort: 'high' })).preference.model).toBe('exact-high')
})
it('expected_model alone cannot fill in first use', async () => {
  const f = fixture(); await expect(f.choose({ expected: 'fixture-b' })).rejects.toThrow('MODEL_REQUIRED')
  expect(f.ask).not.toHaveBeenCalled()
})
it('final authorization detects a changed account and leaves setup unchanged', async () => {
  const f = fixture(); const original = f.saved()
  f.service.querySelection.mockImplementationOnce(async () => { throw new Error('账号已变更') })
  await expect(f.choose({ model: 'fixture-b' })).rejects.toThrow('账号已变更')
  expect(f.storage.conversationSetup('parent', f.project, 'antigravity')).toEqual(original)
})
it('explicit AGY account selection reaches both metadata and final authorization', async () => {
  const f = fixture(), setup = await f.choose({ model: 'fixture-b', agyAccount: 'lxy' })
  expect(setup.preference.agyAccount).toBe('lxy')
  expect(f.service.queryCatalog.mock.calls[0][2]).toMatchObject({ agyAccount: 'lxy' })
  expect(f.service.querySelection.mock.calls[0][2]).toMatchObject({ agyAccount: 'lxy' })
})
it.each([['lxy', 'default'], ['default', 'lxy']])('parent AGY account %s survives directory/configuration with deployment=%s', async (selected, deployment) => {
  const f = fixture(); f.service.options.agyAccount = deployment
  f.service.queryCatalog.mockImplementation(async (cli: CliId, _backend: any, config: any, _project: any, _signal: AbortSignal, expected?: string) => {
    const binding = 'route-' + config.agyAccount
    if (expected !== undefined && expected !== binding) throw new Error('账号已变更')
    return { catalog: { cli, notice: 'Synthetic per-route catalog', models: [{ id: 'fixture-b', label: 'B', efforts: ['default'] }] }, binding }
  })
  f.service.querySelection.mockImplementation(async (preference: any, _backend: any, config: any, _project: any, _signal: AbortSignal, expected: string) => {
    const binding = 'route-' + config.agyAccount
    if (expected !== binding) throw new Error('账号已变更')
    return { preference, binding }
  })
  await f.choose({ model: 'fixture-b', agyAccount: selected })
  const directory = JSON.parse(await f.tools.get('cliworker_models').execute({ cli: 'agy' }, { agent: f.agent(), signal: new AbortController().signal }))
  expect(directory.configuredModel).toBe('fixture-b')
  await f.service.configureConversation(f.agent(), 'antigravity', 'fixture-b', 'default', new AbortController().signal)
  const current = f.storage.conversationSetup('parent', f.project, 'antigravity')!
  expect(current.preference.agyAccount).toBe(selected)
  expect(current.binding).toBe('route-' + selected)
  expect(f.service.options.agyAccount).toBe(deployment); expect(f.ask).not.toHaveBeenCalled()
})
it.each(['default', 'lxy'])('explicit AGY %s directory can discover after stale binding without changing selection', async account => {
  const f = fixture(), original = f.saved()
  f.setBinding('synthetic-account-b')
  const run = (args: any) => f.tools.get('cliworker_models').execute(args, { agent: f.agent(), signal: new AbortController().signal })
  await expect(run({ cli: 'agy' })).rejects.toThrow('账号已变更')
  const directory = JSON.parse(await run({ cli: 'agy', agy_account: account }))
  expect(directory).toMatchObject({ scope: 'explicit-account-read-only', agyAccount: account,
    firstSelectionConfirmed: false, configuredModel: null, configuredEffort: null })
  expect(directory.models).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'fixture-a', efforts: ['low', 'high'] })]))
  expect(f.service.queryCatalog.mock.calls.at(-1)[2]).toMatchObject({ agyAccount: account })
  expect(f.service.queryCatalog.mock.calls.at(-1)[5]).toBeUndefined()
  expect(f.storage.conversationSetup('parent', f.project, 'antigravity')).toEqual(original)
  expect(f.storage.dispatchSetup(f.project, 'antigravity')).toEqual(original)
  expect(f.storage.workers.size).toBe(0)
  expect(f.service.querySelection).not.toHaveBeenCalled(); expect(f.service.launch).not.toHaveBeenCalled()
  expect(f.service.options).toEqual({}); expect(f.ask).not.toHaveBeenCalled()
  await expect(run({ cli: 'agy' })).rejects.toThrow('账号已变更')
})
it('explicit account discovery never establishes a first selection or creates a cache directory', async () => {
  const f = fixture(), cachePath = join(f.storage.directory, 'settings-catalogs')
  expect(existsSync(cachePath)).toBe(false)
  const result = JSON.parse(await f.tools.get('cliworker_models').execute({ cli: 'agy', agy_account: 'lxy' }, { agent: f.agent(), signal: new AbortController().signal }))
  expect(result.firstSelectionConfirmed).toBe(false)
  expect(f.storage.conversationSetup('parent', f.project, 'antigravity')).toBeUndefined()
  expect(f.storage.dispatchSetup(f.project, 'antigravity')).toBeUndefined()
  expect(f.storage.workers.size).toBe(0)
  expect(f.service.settingsCatalogs).toBeUndefined(); expect(existsSync(cachePath)).toBe(false)
})
it('explicit account discovery does not touch an existing display cache', async () => {
  const f = fixture(), cache = { revision: vi.fn(), remember: vi.fn() }
  f.service.settingsCatalogs = cache
  await f.tools.get('cliworker_models').execute({ cli: 'agy', agy_account: 'lxy' }, { agent: f.agent(), signal: new AbortController().signal })
  expect(f.service.settingsCatalogs).toBe(cache)
  expect(cache.revision).not.toHaveBeenCalled(); expect(cache.remember).not.toHaveBeenCalled()
})
it.each([
  { cli: 'codex', agy_account: 'lxy' },
  { agy_account: 'lxy' },
  { worker_id: 'synthetic-worker', agy_account: 'lxy' },
  { cli: 'agy', worker_name: 'synthetic-worker', agy_account: 'lxy' },
  { cli: 'agy', worker_id: '', agy_account: 'lxy' },
  { cli: 'agy', agy_account: '/arbitrary/home' },
])('invalid explicit account selector rejects before querying: %j', async args => {
  const f = fixture()
  await expect(f.tools.get('cliworker_models').execute(args, { agent: f.agent(), signal: new AbortController().signal })).rejects.toThrow()
  expect(f.service.queryCatalog).not.toHaveBeenCalled(); expect(f.service.launch).not.toHaveBeenCalled()
})
it.each(['subagent', 'busy', 'cancelled', 'disabled'])('explicit account directory retains %s guard', async kind => {
  const f = fixture(), controller = new AbortController(), agent = f.agent()
  if (kind === 'subagent') agent.session.header.origin = 'subagent'
  if (kind === 'busy') f.service.accounts.isBusy = () => true
  if (kind === 'cancelled') controller.abort()
  if (kind === 'disabled') f.setEnabled(false)
  await expect(f.tools.get('cliworker_models').execute({ cli: 'agy', agy_account: 'lxy' }, { agent, signal: controller.signal })).rejects.toThrow()
  expect(f.service.queryCatalog).not.toHaveBeenCalled()
})
it('explicit account lookup propagates native identity changes without rebind', async () => {
  const f = fixture(), original = f.saved()
  f.service.queryCatalog.mockRejectedValueOnce(new Error('账号已变更'))
  await expect(f.tools.get('cliworker_models').execute({ cli: 'agy', agy_account: 'lxy' }, { agent: f.agent(), signal: new AbortController().signal })).rejects.toThrow('账号已变更')
  expect(f.storage.conversationSetup('parent', f.project, 'antigravity')).toEqual(original)
  expect(f.storage.dispatchSetup(f.project, 'antigravity')).toEqual(original)
})
it('AGY conversation account override pins its catalog binding through final authorization', async () => {
  const f = fixture(), original = f.saved()
  f.service.queryCatalog.mockResolvedValueOnce({ catalog: { cli: 'antigravity', notice: 'Synthetic account B', models: [{ id: 'fixture-b', label: 'B', efforts: ['default'] }] }, binding: 'catalog-account-b' })
  f.service.querySelection.mockImplementationOnce(async (_p: any, _b: any, _c: any, _project: any, _s: any, expected: string) => {
    expect(expected).toBe('catalog-account-b')
    return { preference: { cli: 'antigravity', model: 'fixture-b', effort: 'default', agyAccount: 'lxy' }, binding: 'changed-account-c' }
  })
  await expect(f.service.configureConversation(f.agent(), 'antigravity', 'fixture-b', 'default', new AbortController().signal, 'lxy')).rejects.toThrow('账号已变更')
  expect(f.storage.conversationSetup('parent', f.project, 'antigravity')).toEqual(original)
})
it('mode restrictions fail before selection is saved', async () => {
  const f = fixture(); f.service.queryCatalog.mockResolvedValueOnce({ catalog: { cli: 'opencode', models: [{ id: 'only', label: 'Only', efforts: ['default'] }], allowedModes: ['plan'] }, binding: 'synthetic-account-a' })
  await expect(f.choose({ cli: 'opencode', model: 'only' })).rejects.toThrow('只读纯文本')
  expect(f.storage.preference(f.project, 'opencode')).toBeUndefined()
})
it('parameterized tool passes model, effort and role, without a userQuestions service', async () => {
  const f = fixture(); f.agent().ctx.get = () => undefined
  const value = await f.tools.get('cliworker_start').execute({ cli: 'agy', title: 'Synthetic', prompt: 'Synthetic task', model: 'fixture-b', role: 'none' }, { agent: f.agent(), signal: new AbortController().signal })
  expect(JSON.parse(value)).toMatchObject({ preference: { model: 'fixture-b', effort: 'default' } })
  expect(f.service.launch).toHaveBeenCalledOnce(); expect(f.ask).not.toHaveBeenCalled()
})
it('role directory is read-only and does not expose preset prompt bodies', async () => {
  const f = fixture(), value = JSON.parse(await f.tools.get('cliworker_roles').execute({}, { agent: f.agent(), signal: new AbortController().signal }))
  expect(value.noRole).toBe('none'); expect(value.roles.length).toBeGreaterThan(0)
  for (const row of value.roles) expect(Object.keys(row).sort()).toEqual(['id', 'name', 'summary'])
  expect(f.service.queryCatalog).not.toHaveBeenCalled(); expect(f.storage.preference(f.project)).toBeUndefined()
})
it('same-scope wait cancellation releases only its own slot and preserves the leader', async () => {
  const f = fixture(); let release!: () => void
  f.service.queryCatalog.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve }); return { catalog: { cli: 'antigravity', notice: 'Synthetic native metadata', models: [{ id: 'fixture-b', label: 'B', efforts: ['default'] }] }, binding: 'synthetic-account-a' } })
  const leader = f.choose({ model: 'fixture-b' })
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  const controller = new AbortController(), waiter = f.choose({ signal: controller.signal })
  const rejected = expect(waiter).rejects.toThrow('cancelled waiter')
  controller.abort(new Error('cancelled waiter')); await rejected
  release(); await leader
  expect((await f.choose()).preference.model).toBe('fixture-b')
  await vi.waitFor(() => expect(f.service.dispatchWaits.size).toBe(0))
  expect(f.service.pending.size).toBe(0); expect(f.ask).not.toHaveBeenCalled()
})
it.each(['cancel', 'dispose', 'project', 'cli'])('late %s invalidation never saves partial setup', async kind => {
  const f = fixture(), controller = new AbortController()
  f.service.querySelection.mockImplementationOnce(async (preference: any) => {
    if (kind === 'cancel') controller.abort(new Error('cancelled'))
    if (kind === 'dispose') f.service.disposed.abort(new Error('disposed'))
    if (kind === 'project') f.agent().session.header.cwd = '/synthetic/changed'
    if (kind === 'cli') f.setEnabled(false)
    return { preference, binding: 'synthetic-account-a' }
  })
  await expect(f.choose({ model: 'fixture-b', signal: controller.signal })).rejects.toThrow()
  expect(f.storage.dispatchSetup(f.project, 'antigravity')).toBeUndefined()
  expect(f.service.pending.size).toBe(0); expect(f.ask).not.toHaveBeenCalled()
})
