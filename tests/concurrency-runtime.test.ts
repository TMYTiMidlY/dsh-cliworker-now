import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync, statSync, symlinkSync, linkSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { WorkerStorage } from '../src/host/storage.ts'
import { WorkerRuntime } from './fixtures/legacy-runtime.ts'
import { HostChildCapacityDeferred } from '../src/host/host-child-admission.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError } from '../src/host/process.ts'
vi.mock('../src/host/authorized-catalog.ts', () => ({ ACCOUNT_CHANGED: 'synthetic changed', authorizeSelection: vi.fn(async (preference: unknown) => ({ binding: 'synthetic', preference })) }))
vi.mock('../src/host/cli-account-binding.ts', () => ({ readCliAccountBinding: vi.fn(async () => 'synthetic') }))
const closes: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); vi.useRealTimers(); vi.restoreAllMocks() })
const pref = { cli: 'antigravity' as const, model: 'SYNTHETIC_MODEL', effort: 'default' as const }
function setup(limit?: number) {
  mkdirSync('.cache', { recursive: true }); const root = mkdtempSync(join(process.cwd(), '.cache/concurrency-synthetic-')), calls: any[] = []
  const storage = new WorkerStorage(join(root, 'state'))
  const backend = { resolveExecutable: async () => '/synthetic/agy', spawn: vi.fn((spec: any) => {
    const stdout = new PassThrough(), stderr = new PassThrough(); let settle!: (value: any) => void
    const done = new Promise(resolve => { settle = resolve })
    const row = { spec, stdout, terminated: false, complete() { stdout.write(JSON.stringify({ event: 'result', result: { conversation_id: `synthetic-${calls.indexOf(row)}`, status: 'SUCCESS', response: 'synthetic reply' } }) + '\n'); stdout.end(); stderr.end(); settle({ exitCode: 0 }) } }
    calls.push(row)
    spec.signal?.addEventListener('abort', () => { row.terminated = true; stdout.end(); stderr.end(); settle({ exitCode: 143 }) }, { once: true })
    return { stdout, stderr, done, terminate() { row.terminated = true; stdout.end(); stderr.end(); settle({ exitCode: 0 }) }, waitForExit: async () => { await done; return true } } as any
  }) }
  const config = { ...DEFAULT_CONFIG, ...(limit === undefined ? {} : { maxConcurrent: limit }) }
  const runtime = new WorkerRuntime(storage, backend, config); closes.push(() => runtime.close())
  const project = (name = 'project') => { const path = join(root, name); mkdirSync(path, { recursive: true }); return path }
  const submit = (parent: string, text: string, mode: 'plan' | 'accept-edits' = 'plan', path = project()) => runtime.submit(parent, path, text, text, pref, mode, undefined, undefined, 'synthetic')
  const waitCalls = async (count: number) => { await vi.waitFor(() => expect(calls).toHaveLength(count)) }
  return { root, storage, backend, runtime, config, calls, project, submit, waitCalls }
}
it('host wait survives its execution timeout, lost event and no-end rollback, retaining task/run/prompt until one native start', async () => {
  const f = setup(12), owner = {}, inputs: any[] = []; f.config.timeoutMs = 200
  f.runtime.setHarnessPreparation(async (_worker, _signal, input) => {
    inputs.push(input)
    if (inputs.length === 1) f.runtime.wakeHostAdmission() // end before the failure reaches the queue
    if (inputs.length <= 2) throw new HostChildCapacityDeferred(owner, 'synthetic-candidate')
    return undefined
  })
  vi.useFakeTimers()
  const task = f.submit('A', 'single-original-prompt'), run = task.worker.runId
  await vi.waitFor(() => expect(f.runtime.scheduling(task.worker)?.reason).toBe('host-child-capacity'))
  expect(f.runtime.concurrencySnapshot('A')).toMatchObject({ globalActive: 0, globalQueued: 1, limit: 12 })
  await vi.advanceTimersByTimeAsync(2_000)
  expect(inputs).toHaveLength(2); expect(task.worker.status).toBe('queued'); expect(f.calls).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(4_000) // no event for the second unpublished rollback
  await f.waitCalls(1)
  expect(inputs[2]).toMatchObject({ hostAuthority: owner, hostChildId: 'synthetic-candidate' })
  expect(task.worker.runId).toBe(run); expect(task.worker.status).toBe('running')
  f.calls[0].complete(); expect((await task.done).status).toBe('completed')
  expect(f.storage.history(task.worker.id).filter(event => event.kind === 'user')).toHaveLength(1)
  expect(f.storage.history(task.worker.id).filter(event => event.runOutcome)).toHaveLength(1)
  expect(vi.getTimerCount()).toBe(0)
})
it.each([true, false])('candidate-less Deferred retains a candidate only under the same authority: %s', async same => {
  const f = setup(12), first = {}, second = same ? first : {}, inputs: any[] = []
  f.runtime.setHarnessPreparation(async (_worker, _signal, input) => {
    inputs.push(input)
    if (inputs.length === 1) throw new HostChildCapacityDeferred(first, 'synthetic-first-candidate')
    if (inputs.length === 2) throw new HostChildCapacityDeferred(second)
    return undefined
  })
  vi.useFakeTimers(); const task = f.submit('A', 'authority-continuity'), run = task.worker.runId
  await vi.waitFor(() => expect(f.runtime.scheduling(task.worker)?.reason).toBe('host-child-capacity'))
  await vi.advanceTimersByTimeAsync(2_000); expect(inputs).toHaveLength(2)
  await vi.advanceTimersByTimeAsync(4_000); await f.waitCalls(1)
  expect(inputs[2].hostAuthority).toBe(second)
  expect(inputs[2].hostChildId).toBe(same ? 'synthetic-first-candidate' : undefined)
  expect(task.worker.runId).toBe(run)
  f.calls[0].complete(); expect((await task.done).status).toBe('completed')
  expect(f.calls).toHaveLength(1)
})
it('capacity event storms coalesce and cannot create rapid prepare loops; closing clears watchdog and late hints', async () => {
  const f = setup(12); let attempts = 0
  f.runtime.setHarnessPreparation(async () => { attempts++; throw new HostChildCapacityDeferred({}) })
  vi.useFakeTimers(); const task = f.submit('A', 'cancelled-wait')
  await vi.waitFor(() => expect(f.runtime.scheduling(task.worker)?.reason).toBe('host-child-capacity'))
  for (let i = 0; i < 1000; i++) f.runtime.wakeHostAdmission()
  await vi.advanceTimersByTimeAsync(500)
  expect(attempts).toBe(1); expect(f.calls).toHaveLength(0)
  await f.runtime.close(); f.runtime.wakeHostAdmission(); await vi.advanceTimersByTimeAsync(60_000)
  expect(attempts).toBe(1); expect(f.calls).toHaveLength(0); expect(vi.getTimerCount()).toBe(0)
  expect((await task.done).status).toBe('interrupted')
})
it('deferred writer returns to its original barrier while another root/project uses its released plugin slot', async () => {
  const f = setup(2), p = f.project('P'), q = f.project('Q'); let ready = false
  f.runtime.setHarnessPreparation(async worker => { if (worker.title === 'writer' && !ready) throw new HostChildCapacityDeferred({}); return undefined })
  vi.useFakeTimers()
  const writer = f.submit('A', 'writer', 'accept-edits', p), reader = f.submit('B', 'reader', 'plan', p)
  const independent = f.submit('C', 'other', 'plan', q)
  await vi.waitFor(() => expect(f.runtime.scheduling(writer.worker)?.reason).toBe('host-child-capacity'))
  await f.waitCalls(1); expect(f.calls[0].spec.argv.at(-1)).toContain('other')
  expect(f.runtime.scheduling(reader.worker)?.reason).toBe('project-write-conflict')
  ready = true; f.runtime.wakeHostAdmission(); await vi.advanceTimersByTimeAsync(2_000); await f.waitCalls(2)
  expect(f.calls[1].spec.argv.at(-1)).toContain('writer'); expect(reader.worker.status).toBe('queued')
  f.calls[1].complete(); await writer.done; await f.waitCalls(3)
  expect(f.calls[2].spec.argv.at(-1)).toContain('reader')
  f.calls[0].complete(); f.calls[2].complete(); await Promise.all([independent.done, reader.done])
})
it('rechecks real queued authority and never launches after the preparation channel is removed', async () => {
  const f = setup(12)
  const remove = f.runtime.setHarnessPreparation(async () => { throw new HostChildCapacityDeferred({}) })
  vi.useFakeTimers(); const task = f.submit('A', 'channel-removed')
  await vi.waitFor(() => expect(f.runtime.scheduling(task.worker)?.reason).toBe('host-child-capacity'))
  remove(); await vi.advanceTimersByTimeAsync(2_000)
  const outcome = await task.done
  expect(outcome.status).toBe('failed'); expect(outcome.error).toContain('准入通道已关闭'); expect(f.calls).toHaveLength(0)
})
it('permission/project authority is rechecked after a host wait before any native start', async () => {
  const f = setup(12); let attempts = 0
  f.runtime.setHarnessPreparation(async () => { attempts++; throw new HostChildCapacityDeferred({}) })
  vi.useFakeTimers(); const task = f.submit('A', 'permission-revoked')
  await vi.waitFor(() => expect(f.runtime.scheduling(task.worker)?.reason).toBe('host-child-capacity'))
  f.runtime.setQueuedExecutionGuard(() => { throw new Error('synthetic parent policy/project changed') })
  await vi.advanceTimersByTimeAsync(2_000)
  const outcome = await task.done
  expect(outcome.status).toBe('failed'); expect(outcome.error).toContain('policy/project changed')
  expect(attempts).toBe(1); expect(f.calls).toHaveLength(0)
})
it('default8 sustains eight separate simulated read-only slots, never treating a queued job as native execution', async () => {
  const f = setup(), submissions = Array.from({ length: 10 }, (_, i) => f.submit('A', `task-${i}`))
  await f.waitCalls(8)
  expect(f.runtime.concurrencySnapshot('A')).toMatchObject({ limit: 8, globalActive: 8, globalQueued: 2, parentActive: 8, parentQueued: 2, source: 'initial' })
  expect(f.runtime.scheduling(submissions[8]!.worker)).toMatchObject({ reason: 'capacity', globalActive: 8, limit: 8 })
  expect(submissions[8]!.worker.harnessConversation).toBeUndefined()
})
it('raise2→8 immediately drains eligible tasks without replacing old handles; lower8→2 preserves them until capacity clears', async () => {
  const f = setup(2), tasks = Array.from({ length: 9 }, (_, i) => f.submit('A', `task-${i}`))
  await f.waitCalls(2); const first = [...f.calls]
  f.runtime.setConcurrencyLimit(8); await f.waitCalls(8)
  expect(f.calls.slice(0, 2)).toEqual(first); expect(f.calls.every(row => !row.terminated)).toBe(true)
  f.runtime.setConcurrencyLimit(2)
  expect(f.runtime.concurrencySnapshot('A')).toMatchObject({ limit: 2, globalActive: 8, globalQueued: 1 })
  expect(f.calls.every(row => !row.terminated)).toBe(true)
  for (let i = 0; i < 6; i++) { f.calls[i].complete(); await tasks[i]!.done }
  expect(f.calls).toHaveLength(8)
  f.calls[6].complete(); await tasks[6]!.done; await f.waitCalls(9)
  expect(f.calls[7].terminated).toBe(false)
})
it('round-robins parents while preserving each parent FIFO instead of draining a 43-task parent first', async () => {
  const f = setup(1), tasks: any[] = []
  tasks.push(f.submit('A', 'A0')); await f.waitCalls(1)
  for (let i = 1; i <= 43; i++) tasks.push(f.submit('A', `A${i}`))
  const b1 = f.submit('B', 'B1'), b2 = f.submit('B', 'B2')
  f.calls[0].complete(); await tasks[0].done; await f.waitCalls(2)
  expect(f.calls[1].spec.argv.at(-1)).toContain('B1')
  f.calls[1].complete(); await b1.done; await f.waitCalls(3)
  expect(f.calls[2].spec.argv.at(-1)).toContain('A1')
  f.calls[2].complete(); await tasks[1].done; await f.waitCalls(4)
  expect(f.calls[3].spec.argv.at(-1)).toContain('B2')
  f.calls[3].complete(); await b2.done; await f.waitCalls(5)
  expect(f.calls[4].spec.argv.at(-1)).toContain('A2')
})
it('retains earlier project writer barrier, while another project can use a slot', async () => {
  const f = setup(2), p = f.project('P'), q = f.project('Q')
  const first = f.submit('A', 'read-P', 'plan', p); await f.waitCalls(1)
  const writer = f.submit('B', 'write-P', 'accept-edits', p), later = f.submit('C', 'later-read-P', 'plan', p)
  f.submit('D', 'read-Q', 'plan', q); await f.waitCalls(2)
  expect(f.calls[1].spec.argv.at(-1)).toContain('read-Q')
  expect(f.runtime.scheduling(later.worker)?.reason).toBe('project-write-conflict')
  f.calls[0].complete(); await first.done; await f.waitCalls(3)
  expect(f.calls[2].spec.argv.at(-1)).toContain('write-P')
  f.calls[2].complete(); await writer.done; await f.waitCalls(4)
  expect(f.calls[3].spec.argv.at(-1)).toContain('later-read-P')
})
it('does not skip a blocked parent head to run that parent later task in another project', async () => {
  const f = setup(3), p = f.project('P')
  const running = f.submit('X', 'write-P', 'accept-edits', p); await f.waitCalls(1)
  f.submit('A', 'head-P', 'plan', p)
  const later = f.submit('A', 'later-Q', 'plan', f.project('Q'))
  await new Promise<void>(resolve => queueMicrotask(resolve))
  expect(f.calls).toHaveLength(1); expect(f.runtime.scheduling(later.worker)?.reason).toBe('parent-turn')
  f.calls[0].complete(); await running.done; await f.waitCalls(3)
  expect(f.calls[1].spec.argv.at(-1)).toContain('head-P'); expect(f.calls[2].spec.argv.at(-1)).toContain('later-Q')
})
it('counts real preparation separately and never leaks foreign identifiers or task text in aggregate', async () => {
  const f = setup(1); let release!: () => void
  f.runtime.setHarnessPreparation(async () => { await new Promise<void>(resolve => { release = resolve }); return undefined })
  const active = f.submit('FOREIGN_PARENT_PRIVATE', 'FOREIGN_TASK_PRIVATE')
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  expect(f.runtime.scheduling(active.worker)?.reason).toBe('harness-preparation')
  const state = f.runtime.concurrencySnapshot('A')
  expect(state).toMatchObject({ globalActive: 1, parentActive: 0 }); expect(JSON.stringify(state)).not.toMatch(/FOREIGN_|synthetic-|workerId|title|prompt/)
  release(); await f.waitCalls(1)
})
it('same Worker remains mutually exclusive after raising the global budget', async () => {
  const f = setup(1), task = f.submit('A', 'active'); await f.waitCalls(1)
  f.runtime.setConcurrencyLimit(10)
  expect(() => f.runtime.submit('A', task.worker.project, 'again', 'again', pref, 'plan', task.worker.id, undefined, 'synthetic')).toThrow()
  expect(f.calls).toHaveLength(1)
})
it('configured10 is valid and a cold malformed setting keeps readonly diagnostics but blocks dispatch', async () => {
  const f = setup(10)
  expect(f.runtime.concurrencySnapshot('A')).toMatchObject({ limit: 10, source: 'initial' })
  await f.runtime.close()
  writeFileSync(join(f.storage.directory, 'concurrency.json'), '{PRIVATE_SYNTHETIC_BROKEN', { mode: 0o600 })
  const restored = new WorkerRuntime(new WorkerStorage(f.storage.directory), f.backend, DEFAULT_CONFIG); closes.push(() => restored.close())
  const state = restored.concurrencySnapshot('A')
  expect(state).toMatchObject({ limit: null, source: 'unavailable', globalActive: 0 })
  expect(JSON.stringify(state)).not.toContain('PRIVATE_SYNTHETIC')
  expect(() => restored.setConcurrencyLimit(8)).toThrow('安全核验')
  expect(() => restored.submit('A', f.project(), 'blocked', 'blocked', pref, 'plan', undefined, undefined, 'synthetic')).toThrow('安全核验')
})
it('raising a budget never resurrects a cancelled queued task or bypasses CLI cleanup quarantine', async () => {
  const f = setup(1); f.submit('A', 'active'); await f.waitCalls(1)
  const cancelled = f.submit('B', 'cancelled'), blocked = f.submit('C', 'quarantined')
  await f.runtime.stop('B', cancelled.worker.id)
  f.runtime.blockCatalogOnCleanup('antigravity', new ProcessCleanupUnconfirmedError())
  f.runtime.setConcurrencyLimit(8)
  await blocked.done
  expect(f.calls).toHaveLength(1); expect(cancelled.worker.status).toBe('interrupted'); expect(blocked.worker.status).toBe('failed')
  expect(f.calls[0].terminated).toBe(false)
})
it('explicit12 expands from two slots, lowers without killing twelve in-flight handles, and survives restart while default remains8', async () => {
  expect(DEFAULT_CONFIG.maxConcurrent).toBe(8)
  const f = setup(2), tasks = Array.from({ length: 13 }, (_, i) => f.submit('A', `twelve-${i}`))
  await f.waitCalls(2); const first = [...f.calls]
  f.runtime.setConcurrencyLimit(12); await f.waitCalls(12)
  expect(f.runtime.concurrencySnapshot('A')).toMatchObject({ limit: 12, maxLimit: 12, globalActive: 12, globalQueued: 1, source: 'persisted' })
  expect(f.calls.slice(0, 2)).toEqual(first)
  f.runtime.setConcurrencyLimit(8)
  expect(f.calls.every(row => !row.terminated)).toBe(true)
  for (let i = 0; i < 4; i++) { f.calls[i].complete(); await tasks[i]!.done }
  expect(f.calls).toHaveLength(12)
  f.calls[4].complete(); await tasks[4]!.done; await f.waitCalls(13)
  f.runtime.setConcurrencyLimit(12); await f.runtime.close()
  const restored = new WorkerRuntime(new WorkerStorage(f.storage.directory), f.backend, DEFAULT_CONFIG)
  closes.push(() => restored.close())
  expect(restored.concurrencySnapshot('A')).toMatchObject({ limit: 12, maxLimit: 12, source: 'persisted' })
})
it.each([0, 13, -1, 2.5, NaN])('invalid limit %s has no persistence/notification/scheduling side effects', value => {
  const f = setup(2), before = f.runtime.concurrencySnapshot('A'), revision = f.runtime.revision
  expect(() => f.runtime.setConcurrencyLimit(value)).toThrow()
  expect(f.runtime.concurrencySnapshot('A')).toEqual(before); expect(f.runtime.revision).toBe(revision)
})
it('write failure keeps old budget and revision; persisted explicit limit wins new initial config on restart', async () => {
  const f = setup(2), revision = f.runtime.revision
  const save = vi.spyOn((f.runtime as any).concurrencySettings, 'save').mockImplementationOnce(() => { throw new Error('synthetic denied') })
  expect(() => f.runtime.setConcurrencyLimit(8)).toThrow('synthetic denied'); expect(f.runtime.concurrencySnapshot('A').limit).toBe(2); expect(f.runtime.revision).toBe(revision)
  save.mockRestore(); f.runtime.setConcurrencyLimit(6)
  if (process.platform !== 'win32') expect(statSync(join(f.storage.directory, 'concurrency.json')).mode & 0o777).toBe(0o600)
  await f.runtime.close()
  const restored = new WorkerRuntime(new WorkerStorage(f.storage.directory), f.backend, { ...DEFAULT_CONFIG, maxConcurrent: 3 }); closes.push(() => restored.close())
  expect(restored.concurrencySnapshot('A')).toMatchObject({ limit: 6, source: 'persisted' })
})
it.each(['malformed', 'oversize', 'symlink', 'hardlink', 'mode'] as const)('untrusted %s setting is readable as unavailable but cannot silently fall back or create tasks', kind => {
  const f = setup(), target = join(f.storage.directory, 'concurrency.json'), outside = join(f.root, 'synthetic-private-source')
  writeFileSync(outside, JSON.stringify({ policy: 1, limit: 10 }), { mode: 0o600 })
  if (kind === 'symlink') symlinkSync(outside, target)
  else if (kind === 'hardlink') linkSync(outside, target)
  else writeFileSync(target, kind === 'malformed' ? '{PRIVATE_SYNTHETIC' : kind === 'oversize' ? 'x'.repeat(1025) : JSON.stringify({ policy: 1, limit: 3 }), { mode: 0o600 })
  if (kind === 'mode') { if (process.platform === 'win32') return; chmodSync(target, 0o644) }
  expect(f.runtime.concurrencySnapshot('A')).toMatchObject({ limit: null, source: 'unavailable' })
  expect(() => f.runtime.setConcurrencyLimit(8)).toThrow('安全核验'); expect(() => f.submit('A', 'blocked')).toThrow('安全核验')
  expect(f.calls).toHaveLength(0); expect(f.storage.workers.size).toBe(0)
})
