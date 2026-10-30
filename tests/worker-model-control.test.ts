import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { CliWorkerService } from '../src/host/index.ts'
import { WorkerStorage } from '../src/host/storage.ts'
import { WorkerRuntime } from '../src/host/runtime.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError } from '../src/host/process.ts'
import { readCliAccountBinding } from '../src/host/cli-account-binding.ts'
import { catalogFor, type Catalog } from '../src/host/adapters.ts'
import type { Worker } from '../src/shared/types.ts'
import { CodexCatalogError } from '../src/host/codex-models.ts'
vi.mock('../src/host/cli-account-binding.ts', () => ({ readCliAccountBinding: vi.fn(async () => 'SYNTHETIC_ACCOUNT') }))
vi.mock('../src/host/adapters.ts', async original => ({ ...await original<object>(), catalogFor: vi.fn() }))
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); vi.restoreAllMocks(); vi.clearAllMocks() })
const profilePin = { id: 'ap_11111111-1111-4111-8111-111111111111', materialRevision: 'm_22222222-2222-4222-8222-222222222222' }
const catalog: Catalog = { cli: 'antigravity', notice: 'Synthetic models, not remote entitlement', models: [
  { id: 'SYNTHETIC_ARGON', label: 'Synthetic Argon', efforts: ['default'] },
  { id: 'SYNTHETIC_OPUS', label: 'Synthetic Opus', efforts: ['default', 'high'], variants: { default: 'SYNTHETIC_OPUS', high: 'SYNTHETIC_OPUS-high' } },
] }
function setup() {
  mkdirSync('.cache', { recursive: true }); const project = mkdtempSync(join(process.cwd(), '.cache/model-control-synthetic-'))
  const storage = new WorkerStorage(join(project, 'state')), calls: any[] = []
  const backend = { resolveExecutable: vi.fn(async () => '/synthetic/agy'), spawn: vi.fn((spec: any) => {
    const stdout = new PassThrough(), stderr = new PassThrough(); let resolve!: (v: any) => void
    const done = new Promise(r => { resolve = r })
    const end = () => { stdout.end(); stderr.end(); resolve({ exitCode: 0 }) }
    spec.signal?.addEventListener('abort', end, { once: true })
    calls.push({ spec, stdout, end }); return { stdout, stderr, done, terminate: end, waitForExit: async () => { await done; return true } } as any
  }) }
  const runtime = new WorkerRuntime(storage, backend, DEFAULT_CONFIG); cleanups.push(() => runtime.close())
  const worker: Worker = { id: randomUUID(), runId: randomUUID(), parentSessionId: 'synthetic-parent', project,
    title: 'Synthetic worker', agentName: 'synthetic-agy-1', preference: { cli: 'antigravity', model: 'SYNTHETIC_ARGON', effort: 'default' }, mode: 'plan',
    role: { name: 'Synthetic role', summary: 'Synthetic', prompt: 'SYNTHETIC_ROLE' }, conversationId: 'synthetic-native-conversation',
    status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  storage.save(worker); storage.bindAccount(worker.id, 'SYNTHETIC_ACCOUNT')
  storage.append(worker, { kind: 'user', text: 'synthetic previous' }); storage.append(worker, { kind: 'assistant', text: 'Synthetic Argon result' }); storage.append(worker, { kind: 'status', text: 'completed', state: 'completed' })
  const tools = new Map<string, any>(), jobs: any[] = [], nativeChildren = new Map<string, any>()
  let permission = 'workspace-write', plan = false
  storage.saveRolePreset({ name: 'Synthetic preset', summary: 'Synthetic role', prompt: 'SYNTHETIC_ROLE_PRESERVED' })
  const ask = vi.fn(async (request: any) => ({ answers: request.questions.map((question: any) => ({ id: question.id,
    selected: [question.id === 'cliworker_model' ? 'Synthetic Argon' : question.id === 'cliworker_role' ? 'Synthetic preset' : question.id === 'cliworker_reuse' ? '沿用' : 'High'] })) }))
  const agent = { id: worker.parentSessionId, session: { header: { origin: 'user', cwd: project } }, ctx: { get(name: string) {
    if (name === 'sandboxPolicy') return { resolve: () => ({ mode: permission }) }
    if (name === 'planMode') return { get: () => ({ active: plan }) }
    if (name === 'userQuestions') return { ask }
    if (name === 'jobs') return { start(spec: any) { const entry = spec.run(); jobs.push(entry); return `synthetic-job-${jobs.length}` } }
  } } }
  const service: any = Object.create(CliWorkerService.prototype)
  Object.assign(service, { ctx: { tools: { register(tool: any) { tools.set(tool.name, tool) } }, effect(fn: () => void) { fn() }, agents: { get: (id: string) => nativeChildren.get(id) } },
    runtime, backend, options: DEFAULT_CONFIG, pending: new Map(), dispatchWaits: new Map(), selectionBindings: new WeakMap(), selectionProjects: new WeakMap(), disposed: new AbortController(), accounts: { isBusy: vi.fn(() => false) }, nativeRunDone: new Map(), parent: vi.fn(async () => agent) })
  service.registerTools(); vi.mocked(readCliAccountBinding).mockResolvedValue('SYNTHETIC_ACCOUNT'); vi.mocked(catalogFor).mockResolvedValue(catalog)
  const control = new AbortController()
  const execute = async (name: string, args: any = {}, owner: any = agent, signal = control.signal) => JSON.parse(await tools.get(`cliworker_${name}`).execute(JSON.parse(JSON.stringify({ worker_id: worker.id, ...args })), { agent: owner, signal }))
  return { project, storage, runtime, backend, worker, tools, service, agent, control, calls, jobs, nativeChildren, execute, ask,
    permission: (v: string) => { permission = v }, plan: (v: boolean) => { plan = v } }
}
it.each(['catalog', 'followup'] as const)('real Remote %s does not inspect unknown Error/revoked Proxy prototypes before safe presentation', async target => {
  for (const revoked of [false, true]) {
    const f = setup(), trap = vi.fn(() => { throw new Error('PRIVATE_PROXY_REMOTE') })
    const held = Proxy.revocable(new Error('PRIVATE_ORIGINAL_ERROR'), { getPrototypeOf: trap, get: trap, getOwnPropertyDescriptor: trap })
    if (revoked) held.revoke()
    if (target === 'catalog') vi.mocked(readCliAccountBinding).mockRejectedValueOnce(held.proxy)
    else vi.spyOn(f.service, 'launch').mockRejectedValueOnce(held.proxy)
    const error = await (target === 'catalog'
      ? f.service.catalogForWorker(f.agent.id, f.worker.id, f.control.signal)
      : f.service.followup(f.agent.id, f.worker.id, 'NOT_SENT', f.control.signal)).catch((e: unknown) => e)
    expect(String(error)).toContain('CLI_OPERATION_FAILED'); expect(String(error)).not.toContain('PRIVATE_')
    expect(trap).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(0); expect(f.jobs).toHaveLength(0)
  }
})
it('registers read-only model/result tools and a distinct configure action, without changing first-start arguments', () => {
  const f = setup()
  expect([...f.tools.keys()]).toEqual(expect.arrayContaining(['cliworker_models', 'cliworker_configure', 'cliworker_result']))
  const start = f.tools.get('cliworker_start'); expect(start.parameters.properties).toHaveProperty('model'); expect(start.parameters.properties).toHaveProperty('effort'); expect(start.parameters.properties).toHaveProperty('agy_account'); expect(start.parameters.required).toContain('cli')
  expect(f.tools.get('cliworker_followup').parameters.properties).toHaveProperty('expected_model')
})
it.each([
  ['lxy', 'default', 'tool'], ['default', 'lxy', 'tool'],
  ['lxy', 'default', 'remote'], ['default', 'lxy', 'remote'],
] as const)('Worker catalog keeps its %s deployment / %s bound account through %s', async (deployment, selected, channel) => {
  const f = setup()
  f.service.options = { ...DEFAULT_CONFIG, agyAccount: deployment }
  f.worker.preference = { ...f.worker.preference, agyAccount: selected }
  f.storage.save(f.worker)
  const binding = f.storage.accountBinding(f.worker.id)
  vi.mocked(readCliAccountBinding).mockImplementation(async (_cli, _backend, config) =>
    config.agyAccount === selected ? 'SYNTHETIC_ACCOUNT' : 'SYNTHETIC_OTHER_ACCOUNT')
  vi.mocked(catalogFor).mockImplementation(async (_cli, _backend, config) => {
    expect(config.agyAccount).toBe(selected)
    return catalog
  })
  if (channel === 'tool') await f.execute('models')
  else await f.service.catalogForWorker(f.agent.id, f.worker.id, f.control.signal)
  expect(readCliAccountBinding).toHaveBeenCalled()
  expect(vi.mocked(readCliAccountBinding).mock.calls.every(call => call[2].agyAccount === selected)).toBe(true)
  expect(catalogFor).toHaveBeenCalledOnce()
  expect(f.storage.accountBinding(f.worker.id)).toBe(binding)
  expect(f.runtime.get(f.agent.id, f.worker.id).preference.agyAccount).toBe(selected)
  expect(f.service.options.agyAccount).toBe(deployment)
  expect(f.calls).toHaveLength(0); expect(f.jobs).toHaveLength(0)
})
it('explicit start selection accepts model, effort and AGY account without opening questions', async () => {
  const f = setup()
  const launch = vi.spyOn(f.service, 'launch').mockResolvedValue(JSON.stringify({ synthetic: true }))
  await f.tools.get('cliworker_start').execute({ cli: 'agy', title: 'Synthetic explicit', prompt: 'Synthetic explicit task', read_only: true,
    model: 'SYNTHETIC_OPUS', effort: 'high', agy_account: 'lxy' }, { agent: f.agent, signal: f.control.signal })
  expect(f.ask).not.toHaveBeenCalled()
  expect(launch).toHaveBeenCalledOnce()
  expect(launch.mock.calls[0]![3]).toMatchObject({ cli: 'antigravity', model: 'SYNTHETIC_OPUS-high', effort: 'high', agyAccount: 'lxy' })
})

it('formal concurrency tool and Remote share persisted global state without catalog/job/default effects', async () => {
  const f = setup(), tool = f.tools.get('cliworker_concurrency'), exec = { agent: f.agent, signal: f.control.signal }
  const read = JSON.parse(await tool.execute({}, exec))
  expect(read).toMatchObject({ limit: 8, globalActive: 0, globalQueued: 0, parentActive: 0, writable: true })
  const updated = JSON.parse(await tool.execute({ limit: 12 }, exec))
  expect(updated).toMatchObject({ limit: 12, maxLimit: 12, source: 'persisted', concurrencyApiVersion: 1 })
  expect(JSON.parse(await f.service.readConcurrency(f.agent.id, f.control.signal)).limit).toBe(12)
  expect(JSON.parse(await f.service.configureConcurrency(f.agent.id, 3, f.control.signal)).limit).toBe(3)
  expect(catalogFor).not.toHaveBeenCalled(); expect(f.jobs).toHaveLength(0); expect(f.calls).toHaveLength(0)
  expect(f.runtime.get(f.agent.id, f.worker.id).preference).toEqual(f.worker.preference)
})
it.each(['plan', 'read-only', 'child'])('concurrency write rejects %s without changing budget or revision', async kind => {
  const f = setup(); if (kind === 'plan') f.plan(true); if (kind === 'read-only') f.permission('read-only'); if (kind === 'child') f.agent.session.header.origin = 'subagent'
  const revision = f.runtime.revision
  await expect(f.tools.get('cliworker_concurrency').execute({ limit: 10 }, { agent: f.agent, signal: f.control.signal })).rejects.toThrow()
  expect(f.runtime.concurrencySnapshot(f.agent.id).limit).toBe(8); expect(f.runtime.revision).toBe(revision)
  if (kind !== 'child') expect(JSON.parse(await f.tools.get('cliworker_concurrency').execute({}, { agent: f.agent, signal: f.control.signal })).writable).toBe(false)
})
it('cancelled concurrency request does not persist or notify', async () => {
  const f = setup(); f.control.abort(new Error('synthetic cancel')); const revision = f.runtime.revision
  await expect(f.service.configureConcurrency(f.agent.id, 10, f.control.signal)).rejects.toThrow('synthetic cancel')
  expect(f.runtime.revision).toBe(revision); expect(f.runtime.concurrencySnapshot(f.agent.id).limit).toBe(8)
})
it('new queued Worker without an account binding says PENDING_ADMISSION, not legacy/login failure, and does not borrow identity', async () => {
  const f = setup(); f.runtime.setConcurrencyLimit(1)
  f.runtime.submit(f.agent.id, f.project, 'synthetic active', 'synthetic active', f.worker.preference, 'plan', f.worker.id, undefined, 'SYNTHETIC_ACCOUNT')
  await vi.waitFor(() => expect(f.calls).toHaveLength(1))
  const queued = f.runtime.submit(f.agent.id, f.project, 'synthetic queued', 'synthetic queued', f.worker.preference, 'plan', undefined, undefined, 'SYNTHETIC_ACCOUNT')
  vi.mocked(catalogFor).mockClear()
  await expect(f.execute('models', { worker_id: queued.worker.id })).rejects.toThrow('PENDING_ADMISSION')
  await expect(f.service.catalogForWorker(f.agent.id, queued.worker.id, f.control.signal)).rejects.toThrow('cli 参数')
  expect(catalogFor).not.toHaveBeenCalled(); expect(f.storage.accountBinding(queued.worker.id)).toBeUndefined(); expect(f.calls).toHaveLength(1)
})
it('an active existing native conversation with missing binding is not described as awaiting first admission', async () => {
  const f = setup()
  f.runtime.submit(f.agent.id, f.project, 'Synthetic active existing', 'SYNTHETIC_EXISTING_TURN', f.worker.preference, 'plan', f.worker.id, undefined, 'SYNTHETIC_ACCOUNT')
  await vi.waitFor(() => expect(f.calls).toHaveLength(1))
  vi.spyOn(f.storage, 'accountBinding').mockReturnValue(undefined)
  vi.mocked(readCliAccountBinding).mockClear(); vi.mocked(catalogFor).mockClear()
  await expect(f.execute('models')).rejects.toThrow('ACCOUNT_RECORD_UNCONFIRMED')
  expect(readCliAccountBinding).not.toHaveBeenCalled(); expect(catalogFor).not.toHaveBeenCalled()
  expect(f.calls).toHaveLength(1); expect(f.jobs).toHaveLength(0)
})
it('a real first-admission failure is not diagnosed as an old historical account, and never borrows identity', async () => {
  const f = setup()
  vi.mocked(readCliAccountBinding).mockRejectedValueOnce(new DOMException('SYNTHETIC_PREPARATION_TIMEOUT', 'TimeoutError'))
  const submitted = f.runtime.submit(f.agent.id, f.project, 'Synthetic failed admission', 'SYNTHETIC_NOT_EXECUTED', f.worker.preference, 'plan')
  const failed = await submitted.done
  expect(failed.status).toBe('failed')
  expect(f.storage.accountBinding(failed.id)).toBeUndefined()
  expect(f.runtime.hasPendingAdmission(failed.id)).toBe(false)
  expect(f.storage.history(failed.id).some(event => event.runId === failed.runId && event.runConfiguration)).toBe(true)
  vi.mocked(readCliAccountBinding).mockClear(); vi.mocked(catalogFor).mockClear()
  await expect(f.execute('models', { worker_id: failed.id })).rejects.toThrow('ADMISSION_INCOMPLETE')
  await expect(f.execute('configure', { worker_id: failed.id, model: 'SYNTHETIC_OPUS' })).rejects.toThrow('ADMISSION_INCOMPLETE')
  await expect(f.execute('followup', { worker_id: failed.id, prompt: 'SYNTHETIC_RECOVERY_NOT_SENT' })).rejects.toThrow('ADMISSION_INCOMPLETE')
  expect(readCliAccountBinding).not.toHaveBeenCalled(); expect(catalogFor).not.toHaveBeenCalled()
  expect(f.calls).toHaveLength(0); expect(f.jobs).toHaveLength(0)
  expect(f.storage.accountBinding(failed.id)).toBeUndefined()
  expect(f.runtime.get(f.agent.id, failed.id)).toMatchObject({ runId: failed.runId, status: 'failed' })
})
it('unbound data with neither native-session nor admission evidence stays neutral instead of inventing a legacy origin', async () => {
  const f = setup(), id = randomUUID()
  f.storage.save({ ...f.worker, id, agentName: 'synthetic-evidence-unknown', conversationId: undefined, status: 'failed' })
  await expect(f.execute('models', { worker_id: id })).rejects.toThrow('ACCOUNT_RECORD_UNCONFIRMED')
  expect(readCliAccountBinding).not.toHaveBeenCalled(); expect(catalogFor).not.toHaveBeenCalled()
  expect(f.storage.accountBinding(id)).toBeUndefined(); expect(f.calls).toHaveLength(0)
})
it('cold recovery retains uncompleted-admission evidence without taking a new identity, and stopping remains available', async () => {
  const f = setup()
  vi.mocked(readCliAccountBinding).mockRejectedValueOnce(new DOMException('SYNTHETIC_COLD_PREPARATION_TIMEOUT', 'TimeoutError'))
  const failed = await f.runtime.submit(f.agent.id, f.project, 'Synthetic cold failed admission', 'SYNTHETIC_NOT_EXECUTED', f.worker.preference, 'plan').done
  await f.runtime.close()
  const restoredStorage = new WorkerStorage(f.storage.directory)
  const restored = new WorkerRuntime(restoredStorage, f.backend, DEFAULT_CONFIG)
  cleanups.push(() => restored.close()); f.service.runtime = restored
  vi.mocked(readCliAccountBinding).mockClear(); vi.mocked(catalogFor).mockClear()
  await expect(f.execute('models', { worker_id: failed.id })).rejects.toThrow('ADMISSION_INCOMPLETE')
  await expect(f.execute('configure', { worker_id: failed.id, model: 'SYNTHETIC_OPUS' })).rejects.toThrow('ADMISSION_INCOMPLETE')
  await restored.stop(f.agent.id, failed.id)
  expect(restoredStorage.accountBinding(failed.id)).toBeUndefined()
  expect(readCliAccountBinding).not.toHaveBeenCalled(); expect(catalogFor).not.toHaveBeenCalled()
  expect(f.calls).toHaveLength(0); expect(f.jobs).toHaveLength(0)
  expect(restored.get(f.agent.id, failed.id).runId).toBe(failed.runId)
})
it('models returns exact live account choices with no preference/run/role/default/job mutation', async () => {
  const f = setup(), before = structuredClone(f.worker), events = structuredClone(f.storage.history(f.worker.id))
  const receipt = await f.execute('models', { worker_id: undefined, worker_name: f.worker.agentName })
  expect(receipt.models).toEqual(catalog.models); expect(receipt.configuredModel).toBe('SYNTHETIC_ARGON')
  expect(f.storage.workers.get(f.worker.id)).toEqual(before); expect(f.storage.history(f.worker.id)).toEqual(events)
  expect(f.storage.preference(f.project, 'antigravity')).toBeUndefined(); expect(f.calls).toHaveLength(0); expect(f.jobs).toHaveLength(0)
  expect(JSON.stringify(receipt)).not.toContain('SYNTHETIC_ACCOUNT')
})
it('configures only this idle Worker and returns not-executed, preserving native conversation/role/mode/defaults/history', async () => {
  const f = setup(), initial = structuredClone(f.worker), history = structuredClone(f.storage.history(f.worker.id))
  f.storage.setPreference(f.project, f.worker.preference)
  const receipt = await f.execute('configure', { model: 'SYNTHETIC_OPUS', effort: 'high' })
  expect(receipt).toMatchObject({ configuredModel: 'SYNTHETIC_OPUS-high', configuredEffort: 'high', previousRunId: initial.runId, executed: false, appliesTo: 'next-run' })
  const current = f.runtime.get(f.agent.id, f.worker.id)
  expect(current).toMatchObject({ id: initial.id, conversationId: initial.conversationId, role: initial.role, mode: initial.mode, runId: initial.runId })
  expect(f.storage.preference(f.project, 'antigravity')).toEqual(initial.preference)
  expect(f.storage.history(f.worker.id)).toEqual(history); expect(f.calls).toHaveLength(0); expect(f.jobs).toHaveLength(0)
})
it.each([{ model: 'Opus' }, { model: 'SYNTHETIC_OPUS', effort: 'ultra' }, { model: 'SYNTHETIC_OPUS-high', effort: 'default' }])('rejects unavailable/ambiguous model-effort %j without saving', async selection => {
  const f = setup(), before = structuredClone(f.worker)
  await expect(f.execute('configure', selection)).rejects.toThrow()
  expect(f.runtime.get(f.agent.id, f.worker.id)).toEqual(before); expect(f.jobs).toHaveLength(0); expect(f.calls).toHaveLength(0)
})
it.each(['models', 'configure', 'result'])('rejects foreign parent %s before source discovery or output disclosure', async tool => {
  const f = setup(); await expect(f.execute(tool, { model: 'SYNTHETIC_OPUS' }, { ...f.agent, id: 'other-parent' })).rejects.toThrow()
  expect(catalogFor).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(0)
})
it('missing legacy account binding and empty or changed-source catalogs never borrow another source', async () => {
  const f = setup(); f.storage.save({ ...f.worker, id: randomUUID(), agentName: 'synthetic-unbound' })
  await expect(f.execute('models', { worker_id: undefined, worker_name: 'synthetic-unbound' })).rejects.toThrow('账号记录')
  vi.mocked(readCliAccountBinding).mockResolvedValue('OTHER_SYNTHETIC_ACCOUNT')
  await expect(f.execute('models')).rejects.toThrow('账号已变更')
  vi.mocked(readCliAccountBinding).mockResolvedValue('SYNTHETIC_ACCOUNT'); vi.mocked(catalogFor).mockResolvedValue({ ...catalog, models: [] })
  await expect(f.execute('models')).rejects.toThrow()
  expect(f.calls).toHaveLength(0)
})
it.each(['running', 'stopping', 'queued'] as const)('refuses %s model changes without automatically stopping or cloning', async status => {
  const f = setup(); f.storage.save({ ...f.worker, status })
  await expect(f.execute('configure', { model: 'SYNTHETIC_OPUS' })).rejects.toThrow()
  expect(f.storage.workers.size).toBe(1); expect(f.calls).toHaveLength(0); expect(catalogFor).not.toHaveBeenCalled()
})
it.each(['plan', 'read-only', 'child'])('enforces %s Host policy before model configuration', async kind => {
  const f = setup(); if (kind === 'plan') f.plan(true); if (kind === 'read-only') f.permission('read-only')
  if (kind === 'child') f.agent.session.header.origin = 'subagent'
  await expect(f.execute('configure', { model: 'SYNTHETIC_OPUS' })).rejects.toThrow()
  expect(catalogFor).not.toHaveBeenCalled(); expect(f.jobs).toHaveLength(0)
})
it('rejects fixed OpenCode v2, native child busy and real native inbox/paused queue', async () => {
  const f = setup()
  f.storage.save({ ...f.worker, transport: 'opencode-http-v2' })
  await expect(f.execute('configure', { model: 'SYNTHETIC_OPUS' })).rejects.toThrow('固定模型')
  const bound = { ...f.worker, harnessConversation: { sessionId: 'synthetic-child', capabilities: { model: true } } } as any
  f.storage.save(bound); f.nativeChildren.set('synthetic-child', { status: 'running', inbox: { nextTurn: [], nextStep: [] } })
  await expect(f.execute('configure', { model: 'SYNTHETIC_OPUS' })).rejects.toThrow('原生对话')
  f.nativeChildren.set('synthetic-child', { status: 'idle', inbox: { nextTurn: [{ id: 'pending' }], nextStep: [] } })
  await expect(f.execute('configure', { model: 'SYNTHETIC_OPUS' })).rejects.toThrow('待发消息')
  f.storage.save(f.worker)
  vi.spyOn((f.runtime as any).followups, 'list').mockReturnValue([{ state: 'paused', id: randomUUID() }])
  await expect(f.execute('configure', { model: 'SYNTHETIC_OPUS' })).rejects.toThrow('包含已暂停消息')
  expect(f.calls).toHaveLength(0)
})
it('unconfirmed cleanup blocks controls without starting another native task', async () => {
  const f = setup(); f.runtime.blockCatalogOnCleanup('antigravity', new ProcessCleanupUnconfirmedError())
  await expect(f.execute('models')).rejects.toThrow('清理')
  await expect(f.execute('configure', { model: 'SYNTHETIC_OPUS' })).rejects.toThrow('清理')
  expect(f.calls).toHaveLength(0)
})
it('cancelled model/configure requests cannot commit late discovery; preparation excludes simultaneous UI configuration', async () => {
  const f = setup(); let release!: (value: Catalog) => void
  vi.mocked(catalogFor).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const pending = f.execute('configure', { model: 'SYNTHETIC_OPUS' }).catch(error => error)
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  await expect(f.service.configureWorker(f.agent.id, f.worker.id, JSON.stringify({ ...f.worker.preference, model: 'SYNTHETIC_OPUS' }), f.control.signal)).rejects.toThrow()
  f.control.abort(new Error('SYNTHETIC_CANCELLED')); release(catalog)
  expect(await pending).toBeInstanceOf(Error)
  expect(f.runtime.get(f.agent.id, f.worker.id).preference.model).toBe('SYNTHETIC_ARGON'); expect(f.jobs).toHaveLength(0)
})
it('expected model or stale run rejects before jobs, run creation, queue mutation or prompt', async () => {
  const f = setup(), runId = f.worker.runId, history = structuredClone(f.storage.history(f.worker.id))
  await expect(f.execute('followup', { prompt: 'Please act as Opus', expected_model: 'SYNTHETIC_OPUS', expected_run_id: runId })).rejects.toThrow('预期模型')
  await expect(f.execute('followup', { prompt: 'Synthetic next', expected_run_id: randomUUID() })).rejects.toThrow('runId')
  expect(f.runtime.get(f.agent.id, f.worker.id).runId).toBe(runId); expect(f.storage.history(f.worker.id)).toEqual(history)
  expect(f.jobs).toHaveLength(0); expect(f.calls).toHaveLength(0)
})
it('rechecks expected model/run after asynchronous selection and at final Runtime admission', async () => {
  const f = setup(), originalRun = f.worker.runId
  let release!: (value: any) => void
  vi.spyOn(f.service, 'querySelection').mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const pending = f.execute('followup', { prompt: 'Synthetic next', expected_model: 'SYNTHETIC_ARGON', expected_run_id: originalRun }).catch(error => error)
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  f.storage.save({ ...f.worker, runId: randomUUID() }); release({ preference: f.worker.preference, catalog, binding: 'SYNTHETIC_ACCOUNT' })
  expect(await pending).toBeInstanceOf(Error); expect(f.jobs).toHaveLength(0)
  const current = f.runtime.get(f.agent.id, f.worker.id), before = structuredClone(f.storage.history(f.worker.id))
  expect(() => f.runtime.submit(f.agent.id, f.project, 'Synthetic', 'Synthetic', current.preference, 'plan', current.id, undefined, undefined, undefined, undefined, undefined, undefined, { expectedRunId: originalRun })).toThrow('runId')
  expect(f.storage.history(f.worker.id)).toEqual(before)
})
it('explicit configure then conditional followup starts exactly one same-conversation run, and result records the new model independently', async () => {
  const f = setup(), previous = f.worker.runId
  const configured = await f.execute('configure', { model: 'SYNTHETIC_OPUS', effort: 'high' })
  await expect(f.execute('followup', { prompt: 'Synthetic wrong base alias', expected_model: 'SYNTHETIC_OPUS', expected_run_id: previous })).rejects.toThrow('预期模型')
  const receipt = await f.execute('followup', { prompt: 'Synthetic Opus followup', expected_model: configured.configuredModel, expected_run_id: previous })
  expect(receipt.workerId).toBe(f.worker.id); expect(receipt.runId).not.toBe(previous)
  await vi.waitFor(() => expect(f.calls).toHaveLength(1))
  expect(f.calls[0].spec.argv).toContain(configured.configuredModel); expect(f.calls[0].spec.argv).toContain(f.worker.conversationId)
  f.calls[0].stdout.write(JSON.stringify({ event: 'init', conversation_id: f.worker.conversationId, init: { model: configured.configuredModel } }) + '\n')
  f.calls[0].stdout.write(JSON.stringify({ event: 'step_update', step_update: { conversation_id: f.worker.conversationId, step_index: 0, step_type: 'agent_response', state: 'DONE', text_delta: 'Synthetic Opus response' } }) + '\n')
  f.calls[0].stdout.write(JSON.stringify({ event: 'result', result: { conversation_id: f.worker.conversationId, status: 'SUCCESS', response: 'Synthetic Opus response' } }) + '\n'); f.calls[0].end()
  await f.jobs[0].done
  expect(await f.execute('result', { run_id: receipt.runId })).toMatchObject({ configuredModel: 'SYNTHETIC_OPUS-high', observedModel: 'SYNTHETIC_OPUS-high', targetModelVerified: true, body: 'Synthetic Opus response', status: 'completed', cleanup: 'confirmed' })
  expect(await f.execute('result', { run_id: previous })).toMatchObject({ configuredModel: null, body: 'Synthetic Argon result' })
})
it.each([1, 2, 3])('a displayed Codex catalog never authorizes start when fresh admission catalog check %i becomes unknown', async unavailableAt => {
  const f = setup(), workers = f.storage.workers.size
  const models: Catalog = { cli: 'codex', notice: 'Synthetic same-source capabilities only', models: [{ id: 'SYNTHETIC_CODEX', label: 'Synthetic Codex', efforts: ['high'] }] }
  vi.mocked(catalogFor).mockResolvedValue(models)
  const displayed = await f.execute('models', { worker_id: undefined, cli: 'codex' })
  expect(displayed.models).toEqual(models.models)
  let checked = 0
  vi.mocked(catalogFor).mockClear().mockImplementation(async () => {
    if (++checked === unavailableAt) throw new CodexCatalogError('scope-unknown')
    return models
  })
  await expect(f.tools.get('cliworker_start').execute({ cli: 'codex', model: 'SYNTHETIC_CODEX', effort: 'high', role: 'none', title: 'Synthetic admission', prompt: 'NEVER_SENT', read_only: true }, { agent: f.agent, signal: f.control.signal })).rejects.toThrow('CODEX_CATALOG_UNCONFIRMED:scope-unknown')
  expect(checked).toBe(unavailableAt)
  expect(f.jobs).toHaveLength(0); expect(f.calls).toHaveLength(0); expect(f.storage.workers.size).toBe(workers)
  expect(f.ask).not.toHaveBeenCalled()
  expect(f.service.pending.size).toBe(0)
  if (unavailableAt < 3) expect(f.storage.conversationSetup(f.agent.id, f.project, 'codex')).toBeUndefined()
})

it('explicit CLI models needs no Worker/setup, but cannot manufacture first confirmation or bypass native questions', async () => {
  const f = setup(), workers = f.storage.workers.size
  const directory = await f.execute('models', { worker_id: undefined, cli: 'agy' })
  expect(directory).toMatchObject({ controlApiVersion: 1, cli: 'antigravity', firstSelectionConfirmed: false, configuredModel: null })
  expect(directory.models).toEqual(catalog.models)
  await expect(f.execute('configure_conversation', { worker_id: undefined, cli: 'agy', model: 'SYNTHETIC_OPUS' })).rejects.toThrow('FIRST_SELECTION_REQUIRED')
  expect(f.storage.conversationSetup(f.agent.id, f.project, 'antigravity')).toBeUndefined()
  expect(f.ask).not.toHaveBeenCalled(); expect(f.jobs).toHaveLength(0); expect(f.calls).toHaveLength(0); expect(f.storage.workers.size).toBe(workers)
  await expect(f.execute('models', { cli: 'agy' })).rejects.toThrow('不能同时使用')
})
it('confirmed conversation model controls the FIRST prompt of a fresh Worker without changing global default, role, other parent or existing Worker', async () => {
  const f = setup()
  // Exact synthetic model/role parameters, through the non-interactive dispatch flow.
  const confirmed = await f.service.chooseDispatch(f.agent, f.control.signal, 'antigravity', 'plan', undefined, undefined, 'SYNTHETIC_ARGON', 'default', f.storage.rolePresets().find(preset => preset.name === 'Synthetic preset')!.id)
  expect(f.ask).not.toHaveBeenCalled(); expect(confirmed.role.name).toBe('Synthetic preset')
  const originalDefault = f.storage.dispatchSetup(f.project, 'antigravity'), existing = structuredClone(f.worker)
  f.storage.setConversationSetup('synthetic-other-parent', f.project, confirmed)
  await f.execute('models', { worker_id: undefined, cli: 'agy' })
  const changed = await f.execute('configure_conversation', { worker_id: undefined, cli: 'agy', model: 'SYNTHETIC_OPUS' })
  expect(changed).toMatchObject({ configuredModel: 'SYNTHETIC_OPUS', appliesTo: 'new-workers-only', executed: false })
  expect(f.storage.dispatchSetup(f.project, 'antigravity')).toEqual(originalDefault)
  expect(f.storage.conversationSetup('synthetic-other-parent', f.project, 'antigravity')).toEqual(confirmed)
  expect(f.runtime.get(f.agent.id, f.worker.id)).toEqual(existing)
  expect(f.storage.conversationSetup(f.agent.id, f.project, 'antigravity')!.role).toEqual(confirmed.role)
  // The native backend is a legacy wire simulation here; bridge/default transports have separate suites.
  vi.spyOn(f.runtime as any, 'initialTransport').mockReturnValue(undefined)
  const fresh = JSON.parse(await f.tools.get('cliworker_start').execute({ cli: 'agy', title: 'Synthetic fresh Opus', prompt: 'Synthetic first real prompt', read_only: true, expected_model: changed.configuredModel }, { agent: f.agent, signal: f.control.signal }))
  await vi.waitFor(() => expect(f.calls).toHaveLength(1))
  expect(f.calls[0].spec.argv).toContain('SYNTHETIC_OPUS'); expect(f.calls[0].spec.argv).not.toContain('SYNTHETIC_ARGON')
  expect(f.calls[0].spec.argv.join(' ')).toContain('Synthetic first real prompt')
  expect(f.ask).not.toHaveBeenCalled()
  const actual = f.runtime.get(f.agent.id, fresh.workerId)
  expect(actual.role).toEqual(confirmed.role); expect(actual.preference.model).toBe('SYNTHETIC_OPUS')
  f.calls[0].stdout.write(JSON.stringify({ event: 'init', conversation_id: 'synthetic-fresh-opus', init: { model: 'SYNTHETIC_OPUS' } }) + '\n')
  f.calls[0].stdout.write(JSON.stringify({ event: 'result', result: { conversation_id: 'synthetic-fresh-opus', status: 'SUCCESS', response: 'Synthetic fresh Opus answer' } }) + '\n'); f.calls[0].end()
  await f.jobs[0].done
  expect(f.storage.preference(f.project, 'antigravity')).toEqual(originalDefault!.preference)
})
it('fresh start expected_model is only a precondition and refuses a setup changed back to Argon before any new Worker/job/prompt', async () => {
  const f = setup(), confirmed = await f.service.chooseDispatch(f.agent, f.control.signal, 'antigravity', 'plan', undefined, undefined, 'SYNTHETIC_ARGON', 'default', f.storage.rolePresets().find(preset => preset.name === 'Synthetic preset')!.id)
  const selected = await f.execute('configure_conversation', { worker_id: undefined, cli: 'agy', model: 'SYNTHETIC_OPUS', effort: 'high' })
  // A parallel explicit/UI selection changes this parent setup before start.
  f.storage.setConversationSetup(f.agent.id, f.project, confirmed)
  const before = f.storage.workers.size
  await expect(f.tools.get('cliworker_start').execute({ cli: 'agy', title: 'Synthetic must be Opus', prompt: 'Synthetic first prompt', read_only: true, expected_model: selected.configuredModel }, { agent: f.agent, signal: f.control.signal })).rejects.toThrow('预期模型')
  expect(f.storage.workers.size).toBe(before); expect(f.jobs).toHaveLength(0); expect(f.calls).toHaveLength(0)
  // The final synchronous Runtime admission has the same check, not just the tool schema.
  expect(() => f.runtime.submit(f.agent.id, f.project, 'Synthetic', 'Synthetic', confirmed.preference, 'plan', undefined, undefined, undefined, undefined, undefined, undefined, undefined, { expectedModel: selected.configuredModel })).toThrow('预期模型')
  expect(f.storage.workers.size).toBe(before)
})
it.each(['account', 'model', 'effort', 'variant'] as const)('conditional start rejects stale confirmed %s without reopening selection or overwriting the confirmation', async kind => {
  const f = setup()
  const confirmed = { preference: { cli: 'antigravity' as const, model: 'SYNTHETIC_OPUS-high', effort: 'high' as const }, role: null, binding: 'SYNTHETIC_ACCOUNT' }
  f.storage.setConversationSetup(f.agent.id, f.project, confirmed)
  f.storage.setDispatchSetup(f.project, confirmed)
  const before = f.storage.workers.size
  if (kind === 'account') vi.mocked(readCliAccountBinding).mockResolvedValue('OTHER_SYNTHETIC_ACCOUNT')
  else if (kind === 'model') vi.mocked(catalogFor).mockResolvedValue({ ...catalog, models: [catalog.models[0]!] })
  else vi.mocked(catalogFor).mockResolvedValue({ ...catalog, models: [{
    ...catalog.models[1]!, ...(kind === 'effort' ? { efforts: ['default'] } : { id: confirmed.preference.model, variants: { high: 'SYNTHETIC_REPLACEMENT-high' } }),
  }] })
  const starts = Array.from({ length: 4 }, () => f.tools.get('cliworker_start').execute({ cli: 'agy', title: 'Synthetic conditional start', prompt: 'Synthetic task', read_only: true, expected_model: confirmed.preference.model }, { agent: f.agent, signal: f.control.signal }))
  for (const result of await Promise.allSettled(starts)) expect(result.status).toBe('rejected')
  expect(f.ask).not.toHaveBeenCalled()
  if (kind === 'account') expect(catalogFor).not.toHaveBeenCalled()
  expect(f.jobs).toHaveLength(0); expect(f.calls).toHaveLength(0); expect(f.storage.workers.size).toBe(before)
  expect(f.storage.conversationSetup(f.agent.id, f.project, 'antigravity')).toEqual(confirmed)
  expect(f.storage.dispatchSetup(f.project, 'antigravity')).toEqual(confirmed)
  expect(f.service.pending.size).toBe(0)
  await vi.waitFor(() => expect(f.service.dispatchWaits.size).toBe(0))
})
it('conditional starts reuse explicit no-role/high variant after conversation configuration, parallel calls and a new Agent instance for the same parent', async () => {
  const f = setup()
  f.ask.mockImplementation(async (request: any) => ({ answers: request.questions.map((question: any) => ({ id: question.id,
    selected: [question.id === 'cliworker_model' ? 'Synthetic Argon' : question.id === 'cliworker_role' ? '不使用角色预设' : 'High'] })) }))
  const launch = vi.spyOn(f.service, 'launch').mockResolvedValue(JSON.stringify({ synthetic: true }))
  const start = (agent = f.agent) => f.tools.get('cliworker_start').execute({ cli: 'agy', title: 'Synthetic no role', prompt: 'Synthetic task', read_only: true, model: 'SYNTHETIC_ARGON', effort: 'default', role: 'none', expected_model: 'SYNTHETIC_ARGON' }, { agent, signal: f.control.signal })
  await start()
  expect(f.ask).not.toHaveBeenCalled()
  expect(f.storage.conversationSetup(f.agent.id, f.project, 'antigravity')!.role).toBeNull()
  const configured = await f.execute('configure_conversation', { worker_id: undefined, cli: 'agy', model: 'SYNTHETIC_OPUS', effort: 'high' })
  expect(configured).toMatchObject({ configuredModel: 'SYNTHETIC_OPUS-high', configuredEffort: 'high', role: null })
  const resumed = { ...f.agent, session: { header: { ...f.agent.session.header } } }
  const repeat = () => f.tools.get('cliworker_start').execute({ cli: 'agy', title: 'Synthetic next round', prompt: 'Synthetic task', read_only: true, expected_model: configured.configuredModel }, { agent: resumed, signal: new AbortController().signal })
  await Promise.all([repeat(), repeat(), repeat(), repeat()])
  expect(f.ask).not.toHaveBeenCalled()
  expect(launch).toHaveBeenCalledTimes(5)
  for (const args of launch.mock.calls.slice(1)) {
    expect(args[3]).toEqual({ cli: 'antigravity', model: 'SYNTHETIC_OPUS-high', effort: 'high' })
    expect(args[6]).toMatchObject({ role: undefined })
  }
  expect(f.storage.conversationSetup(f.agent.id, f.project, 'antigravity')!.role).toBeNull()
  expect(f.calls).toHaveLength(0); expect(f.jobs).toHaveLength(0)
})
it('conditional start in a new parent still asks native reuse, and expected_model never fills in first selection', async () => {
  const f = setup(), confirmed = { preference: f.worker.preference, role: null, binding: 'SYNTHETIC_ACCOUNT' }
  f.storage.setDispatchSetup(f.project, confirmed)
  f.storage.setConversationSetup(f.agent.id, f.project, confirmed)
  vi.spyOn(f.service, 'launch').mockResolvedValue(JSON.stringify({ synthetic: true }))
  const other = { ...f.agent, id: 'synthetic-new-parent' }
  await f.tools.get('cliworker_start').execute({ cli: 'agy', title: 'Synthetic new parent', prompt: 'Synthetic task', read_only: true, expected_model: confirmed.preference.model }, { agent: other, signal: f.control.signal })
  expect(f.ask).not.toHaveBeenCalled()
  expect(f.storage.conversationSetup(other.id, f.project, 'antigravity')).toEqual(confirmed)
})
it('first conditional start cannot substitute expected_model for an explicit selection', async () => {
  const f = setup()
  await expect(f.tools.get('cliworker_start').execute({ cli: 'agy', title: 'Synthetic first use', prompt: 'Synthetic task', read_only: true, expected_model: 'SYNTHETIC_OPUS-high' }, { agent: f.agent, signal: f.control.signal })).rejects.toThrow('MODEL_REQUIRED')
  expect(f.ask).not.toHaveBeenCalled()
  expect(f.storage.conversationSetup(f.agent.id, f.project, 'antigravity')).toBeUndefined()
  expect(f.calls).toHaveLength(0); expect(f.jobs).toHaveLength(0)
})
it('conditional start rechecks account after the catalog and never reprompts or commits a changed source', async () => {
  const f = setup(), confirmed = { preference: f.worker.preference, role: null, binding: 'SYNTHETIC_ACCOUNT' }
  f.storage.setConversationSetup(f.agent.id, f.project, confirmed)
  vi.mocked(readCliAccountBinding).mockResolvedValueOnce('SYNTHETIC_ACCOUNT').mockResolvedValueOnce('SYNTHETIC_ACCOUNT').mockResolvedValueOnce('OTHER_SYNTHETIC_ACCOUNT')
  await expect(f.tools.get('cliworker_start').execute({ cli: 'agy', title: 'Synthetic changing source', prompt: 'Synthetic task', read_only: true, expected_model: confirmed.preference.model }, { agent: f.agent, signal: f.control.signal })).rejects.toThrow('账号已变更')
  expect(f.ask).not.toHaveBeenCalled()
  expect(f.storage.conversationSetup(f.agent.id, f.project, 'antigravity')).toEqual(confirmed)
  expect(f.calls).toHaveLength(0); expect(f.jobs).toHaveLength(0)
})
it('a rejected conditional AGY start cannot consume another CLI first confirmation in the same parent', async () => {
  const f = setup(), confirmed = { preference: f.worker.preference, role: null, binding: 'SYNTHETIC_ACCOUNT' }
  f.storage.setConversationSetup(f.agent.id, f.project, confirmed)
  vi.mocked(readCliAccountBinding).mockImplementation(async cli => cli === 'antigravity' ? 'OTHER_SYNTHETIC_ACCOUNT' : 'SYNTHETIC_CODEX_ACCOUNT')
  vi.mocked(catalogFor).mockResolvedValue({ ...catalog, cli: 'codex' })
  const launch = vi.spyOn(f.service, 'launch').mockResolvedValue(JSON.stringify({ synthetic: true }))
  const args = { title: 'Synthetic separate CLI', prompt: 'Synthetic task', read_only: true, expected_model: confirmed.preference.model }
  await expect(f.tools.get('cliworker_start').execute({ ...args, cli: 'agy' }, { agent: f.agent, signal: f.control.signal })).rejects.toThrow('账号已变更')
  expect(f.ask).not.toHaveBeenCalled()
  await f.tools.get('cliworker_start').execute({ ...args, cli: 'codex', model: 'SYNTHETIC_ARGON', effort: 'default' }, { agent: f.agent, signal: f.control.signal })
  expect(f.ask).not.toHaveBeenCalled()
  expect(f.storage.conversationSetup(f.agent.id, f.project, 'antigravity')).toEqual(confirmed)
  expect(f.storage.conversationSetup(f.agent.id, f.project, 'codex')!.preference.cli).toBe('codex')
  expect(launch).toHaveBeenCalledOnce()
  expect(launch.mock.calls[0]![3]).toMatchObject({ cli: 'codex' })
  expect(f.calls).toHaveLength(0); expect(f.jobs).toHaveLength(0)
})
it('conversation configuration shares parameter-validation lock; cancelled waiters never save or ask', async () => {
  const f = setup(); let release!: (value: Catalog) => void
  vi.mocked(catalogFor).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const first = f.service.chooseDispatch(f.agent, f.control.signal, 'antigravity', 'plan', undefined, undefined, 'SYNTHETIC_ARGON', 'default').catch((error: any) => error)
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  const controller = new AbortController()
  const config = f.execute('configure_conversation', { worker_id: undefined, cli: 'agy', model: 'SYNTHETIC_OPUS' }, f.agent, controller.signal).catch(error => error)
  controller.abort(new Error('synthetic cancelled waiter')); expect(await config).toBeInstanceOf(Error)
  f.control.abort(new Error('synthetic cancelled setup')); release(catalog)
  expect(await first).toBeInstanceOf(Error)
  expect(f.storage.conversationSetup(f.agent.id, f.project, 'antigravity')).toBeUndefined()
  expect(f.ask).not.toHaveBeenCalled(); expect(f.jobs).toHaveLength(0)
})
it('conversation changes refuse stale account, missing strength, Host policy and post-discovery cancellation without changing confirmed role/setup', async () => {
  const f = setup(), confirmed = await f.service.chooseDispatch(f.agent, f.control.signal, 'antigravity', 'plan', undefined, undefined, 'SYNTHETIC_ARGON', 'default', f.storage.rolePresets().find(preset => preset.name === 'Synthetic preset')!.id)
  vi.mocked(readCliAccountBinding).mockResolvedValueOnce('OTHER_SYNTHETIC_ACCOUNT')
  await expect(f.execute('configure_conversation', { worker_id: undefined, cli: 'agy', model: 'SYNTHETIC_OPUS' })).rejects.toThrow('账号已变更')
  f.plan(true)
  await expect(f.execute('configure_conversation', { worker_id: undefined, cli: 'agy', model: 'SYNTHETIC_OPUS' })).rejects.toThrow('规划')
  f.plan(false)
  vi.mocked(catalogFor).mockImplementationOnce(async () => { f.control.abort(new Error('synthetic late cancellation')); return catalog })
  await expect(f.execute('configure_conversation', { worker_id: undefined, cli: 'agy', model: 'SYNTHETIC_OPUS' })).rejects.toThrow()
  expect(f.storage.conversationSetup(f.agent.id, f.project, 'antigravity')).toEqual(confirmed)
  expect(f.jobs).toHaveLength(0); expect(f.calls).toHaveLength(0)
})

// New source selection uses the ACTUAL Tool/Host/storage path but a synthetic
// authorized profile facade. No real Native/account/model is exercised here.
function profileSetup() {
  const f = setup(), root = '/SYNTHETIC_PRIVATE_PROFILE'
  vi.mocked(catalogFor).mockResolvedValue({ ...catalog, cli: 'minimax' })
  const profiles = { list: vi.fn(() => [{ ...profilePin, cli: 'minimax', label: 'Synthetic profile', recordRevision: 1, enabled: true, state: 'available' }]), select: vi.fn((id: string) => { if (id !== profilePin.id) throw new Error('AUTH_NOT_FOUND'); return Object.freeze({ ...profilePin }) }),
    run: vi.fn(async (pin: any, _executable: string, operation: any, signal: AbortSignal) => operation({ pin, config: Object.freeze({ ...DEFAULT_CONFIG, minimaxHome: root, minimaxRegion: 'cn', minimaxExpectedConfigDigest: 'a'.repeat(64) }), signal })) }
  ;(f.service as any).nativeProfiles = profiles
  ;(f.service as any).ctx.agents.get = (id: string) => id === f.agent.id ? f.agent : f.nativeChildren.get(id)
  const launch = vi.spyOn(f.service as any, 'launch').mockResolvedValue('{"syntheticLaunchOnly":true}')
  return { ...f, profiles, launch, root }
}
it('profile models query scopes the whole catalog without establishing or changing any setup', async () => {
  const f = profileSetup()
  await f.execute('models', { worker_id: undefined, cli: 'minimax', auth_profile: profilePin.id })
  expect(f.profiles.run).toHaveBeenCalledTimes(1)
  expect(vi.mocked(catalogFor).mock.calls.every(row => row[2].minimaxHome === f.root)).toBe(true)
  expect(f.storage.conversationSetup(f.agent.id, f.project, 'minimax')).toBeUndefined(); expect(f.launch).not.toHaveBeenCalled()
})
it('explicit profile cannot borrow a same-model complete native setup or role', async () => {
  const f = profileSetup(), native = { preference: { cli: 'minimax' as const, model: 'SYNTHETIC_ARGON', effort: 'default' as const }, role: { name: 'Synthetic native role', summary: 'Synthetic', prompt: 'SYNTHETIC_NATIVE_ROLE' }, binding: 'SYNTHETIC_ACCOUNT' }
  f.storage.setDispatchSetup(f.project, native)
  await expect(f.execute('start', { cli: 'minimax', title: 'Profile', prompt: 'SYNTHETIC_PROMPT', auth_profile: profilePin.id })).rejects.toThrow('MODEL_REQUIRED')
  expect(f.launch).not.toHaveBeenCalled(); expect(f.profiles.run).not.toHaveBeenCalled()
})
it('profile first selection persists the fixed revision and does not replace native project defaults', async () => {
  const f = profileSetup(), native = { preference: { cli: 'minimax' as const, model: 'SYNTHETIC_ARGON', effort: 'default' as const }, role: null, binding: 'SYNTHETIC_ACCOUNT' }
  f.storage.setDispatchSetup(f.project, native)
  await f.execute('start', { cli: 'minimax', title: 'Profile', prompt: 'SYNTHETIC_PROMPT', auth_profile: profilePin.id, model: 'SYNTHETIC_ARGON', effort: 'default', role: 'none' })
  expect(f.launch.mock.calls[0][3]).toMatchObject({ authProfile: profilePin })
  expect(f.storage.conversationSetup(f.agent.id, f.project, 'minimax')?.preference.authProfile).toEqual(profilePin)
  expect(f.storage.dispatchSetup(f.project, 'minimax')).toEqual(native)
  expect(f.storage.dispatchSetup(f.project, 'minimax', profilePin)?.preference.authProfile).toEqual(profilePin)
})
it('explicit native selection returns to its own domain while omission reuses the current complete profile', async () => {
  const f = profileSetup()
  const start = (auth_profile?: string, model?: string) => f.execute('start', { cli: 'minimax', title: 'Select', prompt: 'SYNTHETIC_PROMPT', auth_profile, model, effort: 'default', role: 'none' })
  await start('native', 'SYNTHETIC_ARGON'); await start(profilePin.id, 'SYNTHETIC_ARGON'); await start()
  expect(f.launch.mock.calls.at(-1)?.[3]).toMatchObject({ authProfile: profilePin })
  await start('native')
  expect(f.launch.mock.calls.at(-1)?.[3].authProfile).toBeUndefined()
})
it('worker selector refuses a profile override before reading a new source', async () => {
  const f = profileSetup()
  await expect(f.execute('models', { worker_id: f.worker.id, auth_profile: profilePin.id })).rejects.toThrow()
  expect(f.profiles.run).not.toHaveBeenCalled(); expect(f.profiles.select).not.toHaveBeenCalled()
})
it('profile-aware conversation model changes preserve its original role and source domain', async () => {
  const f = profileSetup()
  await f.execute('start', { cli: 'minimax', title: 'Select', prompt: 'SYNTHETIC_PROMPT', auth_profile: profilePin.id, model: 'SYNTHETIC_ARGON', effort: 'default', role: 'none' })
  await f.execute('configure_conversation', { cli: 'minimax', auth_profile: profilePin.id, model: 'SYNTHETIC_OPUS', effort: 'high' })
  const current = f.storage.conversationSetup(f.agent.id, f.project, 'minimax', profilePin)!
  expect(current.preference).toMatchObject({ authProfile: profilePin, model: 'SYNTHETIC_OPUS-high', effort: 'high' }); expect(current.role).toBeNull()
})
it('profile Worker model configuration derives its fixed source from Worker ID, never a new selector', async () => {
  const f = profileSetup(), worker = { ...f.worker, preference: { cli: 'minimax' as const, model: 'SYNTHETIC_ARGON', effort: 'default' as const, authProfile: profilePin }, transport: 'minimax-acp-v1' as const, mode: 'accept-edits' as const }
  f.storage.save(worker)
  const result = JSON.parse(await f.service.configureWorker(f.agent.id, worker.id, JSON.stringify({ cli: 'minimax', model: 'SYNTHETIC_OPUS', effort: 'high' }), f.control.signal))
  expect(result.preference).toMatchObject({ authProfile: profilePin, model: 'SYNTHETIC_OPUS-high' })
  const before = f.profiles.run.mock.calls.length
  await expect(f.service.configureWorker(f.agent.id, worker.id, JSON.stringify({ cli: 'minimax', model: 'SYNTHETIC_ARGON', effort: 'default', authProfile: { ...profilePin, materialRevision: 'm_33333333-3333-4333-8333-333333333333' } }), f.control.signal)).rejects.toThrow('账号')
  expect(f.profiles.run).toHaveBeenCalledTimes(before)
})
it('native-default configure rejects a profile before discovery and cannot contaminate its complete role/setup bucket', async () => {
  const f = profileSetup(), native = { preference: { cli: 'minimax' as const, model: 'SYNTHETIC_ARGON', effort: 'default' as const }, role: { name: 'Synthetic native role', summary: 'Synthetic', prompt: 'SYNTHETIC_NATIVE_ROLE' }, binding: 'SYNTHETIC_ACCOUNT' }
  f.storage.setDispatchSetup(f.project, native)
  await expect(f.service.configure(f.agent.id, JSON.stringify({ ...native.preference, authProfile: profilePin }), f.control.signal)).rejects.toThrow('原生默认')
  expect(f.profiles.run).not.toHaveBeenCalled(); expect(f.storage.dispatchSetup(f.project, 'minimax')).toEqual(native)
  expect(() => f.storage.setPreference(f.project, { ...native.preference, authProfile: profilePin })).toThrow('原生默认')
  expect(f.storage.dispatchSetup(f.project, 'minimax')).toEqual(native)
})
it('profile task settings Gateway applies one fully checked parent-only source/model combination', async () => {
  const f = profileSetup(), native = { preference: { cli: 'minimax' as const, model: 'SYNTHETIC_ARGON', effort: 'default' as const }, role: null, binding: 'SYNTHETIC_ACCOUNT' }
  f.storage.setDispatchSetup(f.project, native)
  const catalog = JSON.parse(await f.service.authTaskCatalog(f.agent.id, profilePin.id, f.control.signal))
  expect(catalog.pin).toEqual(profilePin); expect(catalog.catalog.models).toHaveLength(2)
  expect(f.storage.conversationSetup(f.agent.id, f.project, 'minimax')).toBeUndefined()
  const selected = { source: profilePin.id, preference: { cli: 'minimax', authProfile: catalog.pin, model: 'SYNTHETIC_OPUS', effort: 'high' } }
  const applied = JSON.parse(await f.service.authTaskApply(f.agent.id, JSON.stringify(selected), f.control.signal))
  expect(applied.preference).toMatchObject({ authProfile: profilePin, model: 'SYNTHETIC_OPUS-high' })
  expect(f.storage.conversationSetup(f.agent.id, f.project, 'minimax')?.preference).toEqual(applied.preference)
  expect(f.storage.dispatchSetup(f.project, 'minimax')).toEqual(native); expect(f.storage.conversationSetup('OTHER_SYNTHETIC_PARENT', f.project, 'minimax')).toBeUndefined()
  expect(f.launch).not.toHaveBeenCalled()
})
it('task-source Gateway rejects incomplete/forged selection and stale displayed proof without changing defaults', async () => {
  const f = profileSetup()
  await f.service.authTaskCatalog(f.agent.id, profilePin.id, f.control.signal)
  const request = { source: profilePin.id, preference: { cli: 'minimax', authProfile: profilePin, model: 'SYNTHETIC_ARGON', effort: 'default' } }
  for (const patch of [{ source: 'native' }, { root: '/SYNTHETIC_FORGED' }, { preference: { ...request.preference, authProfile: { id: profilePin.id } } }])
    await expect(f.service.authTaskApply(f.agent.id, JSON.stringify({ ...request, ...patch }), f.control.signal)).rejects.toThrow()
  vi.mocked(readCliAccountBinding).mockResolvedValue('SYNTHETIC_CHANGED')
  await expect(f.service.authTaskApply(f.agent.id, JSON.stringify(request), f.control.signal)).rejects.toThrow()
  expect(f.storage.conversationSetup(f.agent.id, f.project, 'minimax')).toBeUndefined(); expect(f.launch).not.toHaveBeenCalled()
})
it('queued task-source apply rejects a changed project before any new signed metadata operation', async () => {
  const f = profileSetup(); await f.service.authTaskCatalog(f.agent.id, profilePin.id, f.control.signal)
  let release!: () => void, entered!: () => void
  const ready = new Promise<void>(ok => { entered = ok }), gate = new Promise<void>(ok => { release = ok })
  const holding = f.service.withDispatchSetup(f.agent, f.control.signal, 'minimax', async () => { entered(); await gate })
  await ready
  const request = JSON.stringify({ source: profilePin.id, preference: { cli: 'minimax', authProfile: profilePin, model: 'SYNTHETIC_ARGON', effort: 'default' } })
  const applying = f.service.authTaskApply(f.agent.id, request, f.control.signal); void applying.catch(() => {})
  await Promise.resolve(); await Promise.resolve()
  const before = f.profiles.run.mock.calls.length, other = join(f.project, 'other-synthetic-project'); mkdirSync(other, { mode: 0o700 })
  f.agent.session.header.cwd = other; release(); await holding
  await expect(applying).rejects.toThrow()
  expect(f.profiles.run).toHaveBeenCalledTimes(before)
  expect(f.storage.conversationSetup(f.agent.id, f.project, 'minimax')).toBeUndefined(); expect(f.storage.conversationSetup(f.agent.id, other, 'minimax')).toBeUndefined()
})
it.each(['catalog', 'apply'])('task-source %s cannot publish a late result after its parent Agent instance is replaced', async operation => {
  const f = profileSetup(); (f.service as any).ctx.agents.get = () => f.agent
  if (operation === 'apply') await f.service.authTaskCatalog(f.agent.id, profilePin.id, f.control.signal)
  let release!: () => void, entered!: () => void
  const ready = new Promise<void>(ok => { entered = ok }), gate = new Promise<void>(ok => { release = ok })
  vi.mocked(catalogFor).mockImplementationOnce(async () => { entered(); await gate; return { ...catalog, cli: 'minimax' } })
  const promise = operation === 'catalog' ? f.service.authTaskCatalog(f.agent.id, profilePin.id, f.control.signal)
    : f.service.authTaskApply(f.agent.id, JSON.stringify({ source: profilePin.id, preference: { cli: 'minimax', authProfile: profilePin, model: 'SYNTHETIC_ARGON', effort: 'default' } }), f.control.signal)
  void promise.catch(() => {}); await ready
  ;(f.service as any).ctx.agents.get = () => ({ ...f.agent })
  release(); await expect(promise).rejects.toThrow('主会话')
  expect(f.storage.conversationSetup(f.agent.id, f.project, 'minimax')).toBeUndefined()
  if (operation === 'catalog') expect((f.service as any).profileTaskProofs?.size ?? 0).toBe(0)
})
it('task-source metadata remains registration-only and reports current read-only capability without touching Native', async () => {
  const f = profileSetup(); f.plan(true)
  const result = JSON.parse(await f.service.authTaskSettings(f.agent.id, f.control.signal))
  expect(result.writable).toBe(false); expect(result.validation).toBe('registered-not-live-checked'); expect(result.current).toBeNull()
  expect(f.profiles.run).not.toHaveBeenCalled(); expect(catalogFor).not.toHaveBeenCalled(); expect(f.launch).not.toHaveBeenCalled()
  expect(JSON.stringify(result)).not.toContain(f.root)
})
it.each(['plan', 'cancel'])('task-source apply rechecks %s after a deferred fresh catalog before saving', async change => {
  const f = profileSetup(); await f.service.authTaskCatalog(f.agent.id, profilePin.id, f.control.signal)
  let release!: () => void, entered!: () => void
  const ready = new Promise<void>(ok => { entered = ok }), gate = new Promise<void>(ok => { release = ok })
  vi.mocked(catalogFor).mockImplementationOnce(async () => { entered(); await gate; return { ...catalog, cli: 'minimax' } })
  const promise = f.service.authTaskApply(f.agent.id, JSON.stringify({ source: profilePin.id, preference: { cli: 'minimax', authProfile: profilePin, model: 'SYNTHETIC_ARGON', effort: 'default' } }), f.control.signal)
  void promise.catch(() => {}); await ready
  if (change === 'plan') f.plan(true); else f.control.abort(new Error('SYNTHETIC_CANCELLED_AFTER_CATALOG'))
  release(); await expect(promise).rejects.toThrow()
  expect(f.storage.conversationSetup(f.agent.id, f.project, 'minimax')).toBeUndefined(); expect(f.storage.preference(f.project, 'minimax')).toBeUndefined()
})
it('task-source Gateway respects plan and native return without contaminating imported-role domains', async () => {
  const f = profileSetup()
  await f.service.authTaskCatalog(f.agent.id, 'native', f.control.signal)
  const request = JSON.stringify({ source: 'native', preference: { cli: 'minimax', model: 'SYNTHETIC_ARGON', effort: 'default' } })
  f.plan(true); await expect(f.service.authTaskApply(f.agent.id, request, f.control.signal)).rejects.toThrow('规划')
  f.plan(false); const result = JSON.parse(await f.service.authTaskApply(f.agent.id, request, f.control.signal))
  expect(result.preference.authProfile).toBeUndefined(); expect(f.storage.conversationSetup(f.agent.id, f.project, 'minimax')?.role).toBeNull()
  expect(f.storage.preference(f.project, 'minimax')).toBeUndefined(); expect(f.launch).not.toHaveBeenCalled()
})
