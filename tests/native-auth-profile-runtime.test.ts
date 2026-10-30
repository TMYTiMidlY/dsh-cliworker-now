import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { WorkerStorage } from '../src/host/storage.ts'
import { WorkerRuntime } from '../src/host/runtime.ts'
import { NativeAuthError } from '../src/host/native-auth-files.ts'
import { DEFAULT_CONFIG } from '../src/host/process.ts'
import { MiniMaxAuthRefreshGroups } from '../src/host/native-auth-minimax-refresh.ts'
import { projectMiniMaxAccountSettings } from '../src/host/native-auth-minimax-settings.ts'
import { assertMiniMaxProfileProtection } from '../src/host/minimax-profile-protection.mjs'
import { readCliAccountBinding } from '../src/host/cli-account-binding.ts'
import { authorizeSelection } from '../src/host/authorized-catalog.ts'
import * as profileScopeModule from '../src/host/native-auth-profile-scope.ts'
import type { Preference } from '../src/shared/types.ts'
// Actual Runtime/storage/group and private bridge payload. Native backend,
// target authorization, metadata/binding and resulting protocol are synthetic.
vi.mock('../src/host/cli-account-binding.ts', () => ({ readCliAccountBinding: vi.fn(async (_cli, _backend, config) => `SYNTHETIC_BINDING:${config.minimaxHome}`) }))
vi.mock('../src/host/authorized-catalog.ts', () => ({ ACCOUNT_CHANGED: 'SYNTHETIC_ACCOUNT_CHANGED', authorizeSelection: vi.fn(async (preference, _backend, config) => ({ binding: `SYNTHETIC_BINDING:${config.minimaxHome}`, preference, catalog: { cli: 'minimax', models: [{ id: preference.model, label: 'Synthetic', efforts: ['default'] }] } })) }))
vi.mock('../src/host/minimax-accounts.ts', async original => ({ ...await original<object>(), minimaxSource: vi.fn(async config => ({ root: config.minimaxHome, region: config.minimaxRegion, env: { MINIMAX_DATA_DIR: config.minimaxHome, MAVIS_DATA_DIR: config.minimaxHome, MAVIS_REGION: config.minimaxRegion, MAVIS_BUILD_ENV: 'prod' } })) }))
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.clearAllMocks() })
const pin = { id: 'ap_11111111-1111-4111-8111-111111111111', materialRevision: 'm_22222222-2222-4222-8222-222222222222' }
const preference: Preference = { cli: 'minimax', model: 'm:minimax:SYNTHETIC_MODEL:u', effort: 'default', authProfile: pin }
function fixture(mode = 'success') {
  mkdirSync('.cache', { recursive: true }); const project = mkdtempSync(join(process.cwd(), '.cache/auth-profile-runtime-synthetic-'))
  const root = join(project, 'profile-m1'); mkdirSync(root, { mode: 0o700 })
  const settings = projectMiniMaxAccountSettings(undefined, 'cn'); writeFileSync(join(root, 'config.yaml'), settings.bytes, { mode: 0o600 })
  const groups = MiniMaxAuthRefreshGroups.initialize(join(project, 'groups')), group = 'a'.repeat(64)
  const controller = new AbortController(), calls: any[] = [], requests: any[] = [], scopePins: any[] = []
  let enabled = true, resolveStarted!: () => void
  const started = new Promise<void>(ok => { resolveStarted = ok })
  let resolveAdmission!: () => void
  const admissionStarted = new Promise<void>(ok => { resolveAdmission = ok })
  const scoped = { ...DEFAULT_CONFIG, minimaxHome: root, minimaxRegion: 'cn' as const, minimaxExpectedConfigDigest: settings.digest }
  const profiles = { run: vi.fn(async (selected, _executable, operation, signal) => {
    scopePins.push({ ...selected }); if (!enabled) throw new Error('AUTH_DISABLED')
    return groups.run(group, async () => {
      if (JSON.stringify(selected) !== JSON.stringify(pin)) throw new Error('AUTH_MATERIAL_NOT_FOUND')
      assertMiniMaxProfileProtection({ root, region: 'cn', configDigest: settings.digest, version: '0.6.12' })
      if (mode === 'queued-cleanup') return new Promise((_ok, no) => {
        resolveAdmission()
        const abort = () => no(new NativeAuthError('CLEANUP_UNCONFIRMED'))
        if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true })
      })
      return operation({ pin: Object.freeze({ ...selected }), config: Object.freeze(scoped), signal: signal ?? controller.signal })
    }, signal)
  }) }
  const backend = { resolveExecutable: vi.fn(async () => '/SYNTHETIC_MCODE'), spawn(spec) {
    calls.push(spec); requests.push(JSON.parse(readFileSync(spec.argv.at(-1), 'utf8')))
    const stdout = new PassThrough(), stderr = new PassThrough(); let settle!: (value: any) => void, ended = false
    const done = new Promise<any>(ok => { settle = ok })
    const finish = () => {
      if (ended) return; ended = true
      if (mode.includes('post-drift')) writeFileSync(join(root, 'config.yaml'), '{}', { mode: 0o600 })
      stdout.end([{ type: 'session', id: 'SYNTHETIC_NATIVE_SESSION', model: preference.model }, { type: 'event', event: { kind: 'assistant', step: 0, text: 'SYNTHETIC_PROFILE_REPLY' } }, { type: 'result', status: mode === 'error-post-drift' ? 'ERROR' : 'SUCCESS', response: 'SYNTHETIC_PROFILE_REPLY', ...(mode === 'error-post-drift' ? { error: 'SYNTHETIC_NATIVE_ERROR' } : {}) }].map(row => JSON.stringify(row) + '\n').join(''))
      stderr.end(mode.startsWith('stderr-') ? 'SYNTHETIC_STDERR' : undefined); settle({ exitCode: 0 })
    }
    queueMicrotask(() => { resolveStarted(); if (!['hang', 'queued-cleanup'].includes(mode)) finish() })
    spec.signal?.addEventListener('abort', finish, { once: true })
    return { stdout, stderr, done, terminate: finish, waitForExit: async () => { await done; return !['cleanup', 'stderr-cleanup'].includes(mode) } } as any
  } }
  const storage = new WorkerStorage(join(project, 'state'))
  const config = { ...DEFAULT_CONFIG, minimaxHome: join(project, 'SYNTHETIC_DEPLOYMENT_ROOT'), minimaxRegion: 'en' as const, graceMs: 10 }
  const runtime = new (WorkerRuntime as any)(storage, backend, config, profiles) as WorkerRuntime
  cleanup.push(() => runtime.close())
  return { project, root, storage, runtime, config, groups, group, calls, requests, profiles, scopePins, started, admissionStarted, disable: () => { enabled = false } }
}
it('runs and resumes with the same fixed profile context, never the deployment account', async () => {
  const f = fixture(), first = f.runtime.submit('SYNTHETIC_PARENT', f.project, 'Profile', 'SYNTHETIC_PROMPT', preference, 'accept-edits')
  const done = await first.done
  expect(done.status).toBe('completed'); expect(done.lastResult).toBe('SYNTHETIC_PROFILE_REPLY')
  expect(f.requests).toHaveLength(1); expect(f.requests[0].minimaxProfile).toMatchObject({ root: f.root, region: 'cn', version: '0.6.12' })
  expect(f.requests[0].preference.authProfile).toEqual(pin)
  expect(f.calls[0].env.MINIMAX_DATA_DIR).toBe(f.root); expect(f.calls[0].env.MAVIS_REGION).toBe('cn')
  expect(f.config.minimaxRegion).toBe('en')
  const again = f.runtime.submit('SYNTHETIC_PARENT', f.project, 'Profile', 'SYNTHETIC_FOLLOWUP', preference, 'accept-edits', done.id)
  expect((await again.done).status).toBe('completed'); expect(f.scopePins.every(value => JSON.stringify(value) === JSON.stringify(pin))).toBe(true)
  expect(f.requests[1].conversationId).toBe('SYNTHETIC_NATIVE_SESSION')
  expect(vi.mocked(readCliAccountBinding).mock.calls.filter(row => row[0] === 'minimax').every(row => row[2].minimaxHome === f.root)).toBe(true)
  expect(vi.mocked(authorizeSelection).mock.calls.every(row => row[2].minimaxHome === f.root)).toBe(true)
})
it('rejects a declared partial pin before publishing any Worker or binding read', () => {
  const f = fixture(), bad = { ...preference, authProfile: { id: pin.id } } as any
  expect(() => f.runtime.submit('SYNTHETIC_PARENT', f.project, 'Bad', 'SYNTHETIC_PROMPT', bad, 'accept-edits')).toThrow(/^AUTH_/)
  expect(f.storage.workers.size).toBe(0); expect(readCliAccountBinding).not.toHaveBeenCalled(); expect(f.calls).toEqual([])
})
it('propagates actual cleanup uncertainty to the persistent profile group before finishing the run', async () => {
  const f = fixture('cleanup'), done = await f.runtime.submit('SYNTHETIC_PARENT', f.project, 'Cleanup', 'SYNTHETIC_PROMPT', preference, 'accept-edits').done
  expect(done.status).toBe('failed'); expect(done.lastResult).toBe('SYNTHETIC_PROFILE_REPLY')
  await expect(MiniMaxAuthRefreshGroups.open(join(f.project, 'groups')).run(f.group, async () => 'WRONG')).rejects.toMatchObject({ code: 'CLEANUP_UNCONFIRMED' })
  const outcomes = f.storage.history(done.id).filter(row => row.kind === 'status' && row.runOutcome)
  expect(outcomes.at(-1)?.runOutcome?.cleanup).toBe('unconfirmed')
})
it('keeps actual successful output and confirmed cleanup distinct from local post-policy drift', async () => {
  const f = fixture('post-drift'), done = await f.runtime.submit('SYNTHETIC_PARENT', f.project, 'Drift', 'SYNTHETIC_PROMPT', preference, 'accept-edits').done
  expect(done.status).toBe('uncertain'); expect(done.lastResult).toBe('SYNTHETIC_PROFILE_REPLY'); expect(done.error).toContain('后验')
  expect(f.storage.history(done.id).filter(row => row.kind === 'status' && row.runOutcome).at(-1)?.runOutcome?.cleanup).toBe('confirmed')
  expect(await f.groups.run(f.group, async () => 'released-after-cleanup')).toBe('released-after-cleanup')
})
it('always closes the owning profile scope when post-policy diagnostic persistence throws', async () => {
  const f = fixture('error-post-drift'), originalOpen = profileScopeModule.openNativeProfileScope, scopes: any[] = []
  const open = vi.spyOn(profileScopeModule, 'openNativeProfileScope').mockImplementation(async (...args) => { const scope = await originalOpen(...args); scopes.push(scope); return scope })
  const append = f.storage.append.bind(f.storage), fault = vi.spyOn(f.storage, 'append').mockImplementation((worker, event) => {
    if (event.kind === 'diagnostic' && event.text.includes('后验')) throw new Error('SYNTHETIC_POST_DIAGNOSTIC_EIO')
    return append(worker, event)
  })
  try {
    const done = await f.runtime.submit('SYNTHETIC_PARENT', f.project, 'Failure', 'SYNTHETIC_PROMPT', preference, 'accept-edits').done
    expect(done.status).toBe('failed')
    expect(await f.groups.run(f.group, async () => 'closed-before-task-done')).toBe('closed-before-task-done')
  } finally {
    // Join the controlled synthetic callback even on the old red implementation;
    // this is test cleanup, not evidence that Runtime closed it by itself.
    for (const scope of scopes) await scope.close()
    open.mockRestore(); fault.mockRestore()
  }
})
it.each(['stderr-confirmed', 'stderr-cleanup'])('preserves actual cleanup evidence when after-close CLI diagnostic persistence throws for %s', async mode => {
  const f = fixture(mode), append = f.storage.append.bind(f.storage)
  const fault = vi.spyOn(f.storage, 'append').mockImplementation((worker, event) => {
    if (event.kind === 'diagnostic' && event.text === 'CLI 诊断') throw new Error('SYNTHETIC_AFTER_CLOSE_EIO')
    return append(worker, event)
  })
  try {
    const done = await f.runtime.submit('SYNTHETIC_PARENT', f.project, 'Diagnostic', 'SYNTHETIC_PROMPT', preference, 'accept-edits').done
    expect(done.status).toBe('failed'); expect(done.lastResult).toBe('SYNTHETIC_PROFILE_REPLY')
    expect(f.storage.history(done.id).filter(row => row.kind === 'status' && row.runOutcome).at(-1)?.runOutcome?.cleanup).toBe(mode === 'stderr-cleanup' ? 'unconfirmed' : 'confirmed')
    if (mode === 'stderr-cleanup') { expect(done.error).not.toContain('SYNTHETIC_AFTER_CLOSE_EIO'); await expect(f.groups.run(f.group, async () => 'WRONG')).rejects.toMatchObject({ code: 'CLEANUP_UNCONFIRMED' }) }
    else expect(await f.groups.run(f.group, async () => 'free')).toBe('free')
  } finally { fault.mockRestore() }
})
it('does not report a normal queued stop when profile admission cleanup is authentically unconfirmed', async () => {
  const f = fixture('queued-cleanup'); f.runtime.setConcurrencyLimit(1)
  const legacy = f.runtime.submit('SYNTHETIC_PARENT', f.project, 'Occupy', 'SYNTHETIC_PROMPT', { ...preference, authProfile: undefined }, 'accept-edits')
  await f.started
  const waiting = f.runtime.submit('SYNTHETIC_PARENT', f.project, 'Queued', 'SYNTHETIC_PROMPT', preference, 'accept-edits')
  await f.admissionStarted
  try {
    await f.runtime.stop('SYNTHETIC_PARENT', waiting.worker.id)
    const done = await waiting.done
    expect(done.status).toBe('failed'); expect(done.interruptionReason).not.toBe('user')
    expect(f.storage.history(done.id).filter(row => row.kind === 'status' && row.runOutcome).at(-1)?.runOutcome?.cleanup).toBe('unconfirmed')
    expect(() => f.runtime.assertCliEnabled('minimax')).toThrow(); expect(f.calls).toHaveLength(1)
  } finally {
    ;(f.runtime as any).tasks.get(legacy.worker.id).nativeStop = undefined
    await f.runtime.stop('SYNTHETIC_PARENT', legacy.worker.id)
  }
})
it('stops an already owned task after disablement without reauthorizing the profile', async () => {
  const f = fixture('hang'), submitted = f.runtime.submit('SYNTHETIC_PARENT', f.project, 'Stop', 'SYNTHETIC_PROMPT', preference, 'accept-edits')
  await f.started; f.disable(); const calls = f.profiles.run.mock.calls.length
  // This synthetic bridge has no mailbox reader; exercise existing fallback
  // controller/owned range shutdown, not a forged Native stop acknowledgment.
  ;(f.runtime as any).tasks.get(submitted.worker.id).nativeStop = undefined
  await f.runtime.stop('SYNTHETIC_PARENT', submitted.worker.id)
  expect((await submitted.done).status).toBe('interrupted'); expect(f.profiles.run).toHaveBeenCalledTimes(calls)
  expect(await f.groups.run(f.group, async () => 'free')).toBe('free')
})
