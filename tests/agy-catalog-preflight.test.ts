import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { AGY_CATALOG_TIMEOUT_MS, catalogFor, captureCatalogMetadata } from '../src/host/adapters.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'
import { readAgySettings } from '../src/host/agy-settings.ts'

// All processes, settings and identity are synthetic. No CLI, credentials or network.
vi.mock('../src/host/agy-settings.ts', () => ({ readAgySettings: vi.fn(async () => ({})) }))
vi.mock('../src/host/agy-windows-account.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/host/agy-windows-account.ts')>(),
  nativeAgyAccountIdentity: () => async () => ({ state: 'authenticated' }),
}))
const privateMarker = 'PRIVATE_native_stderr_and_token'
function processFixture(delay: number | null, cleanup = true) {
  const stdout = new PassThrough(), stderr = new PassThrough()
  let finish!: (outcome: any) => void, settled = false
  const done = new Promise<any>(r => { finish = r })
  let removeAbort = () => {}
  const complete = (code: number) => {
    if (settled) return
    settled = true
    stdout.end(code === 0 ? 'gemini-4-argon-high\tGemini Argon fixture\n' : '')
    stderr.end(privateMarker)
    finish({ exitCode: code, signal: null })
  }
  const child = {
    stdout, stderr, done,
    terminate: vi.fn(async () => { removeAbort(); complete(143) }),
    waitForExit: vi.fn(async () => cleanup),
  }
  const backend: ProcessBackend = {
    resolveExecutable: vi.fn(async () => '/synthetic/bin/agy'),
    spawn: vi.fn((spec: any) => {
      const abort = () => complete(143)
      spec.signal.addEventListener('abort', abort, { once: true })
      removeAbort = () => spec.signal.removeEventListener('abort', abort)
      if (delay !== null) setTimeout(() => complete(0), delay)
      return child as any
    }),
  }
  return { backend, child }
}
function fakeDeadlines() {
  vi.useFakeTimers()
  return vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const c = new AbortController()
    setTimeout(() => c.abort(new DOMException('Synthetic deadline', 'TimeoutError')), ms)
    return c.signal
  })
}
const observe = <T>(p: Promise<T>) => p.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }))
beforeEach(() => vi.mocked(readAgySettings).mockReset().mockResolvedValue({}))
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('AGY catalog preflight budget and safe failure evidence', () => {
  it('allows a synthetic 16s AGY discovery without extending task or other CLI budgets', async () => {
    const deadline = fakeDeadlines(), f = processFixture(16_000)
    const result = observe(catalogFor('antigravity', f.backend, DEFAULT_CONFIG, '/synthetic/project', new AbortController().signal))
    await vi.advanceTimersByTimeAsync(0)
    expect(deadline).toHaveBeenCalledWith(AGY_CATALOG_TIMEOUT_MS)
    expect(AGY_CATALOG_TIMEOUT_MS).toBe(60_000)
    await vi.advanceTimersByTimeAsync(16_000)
    expect((await result).error).toBeUndefined()
    expect((await result).value?.models[0]?.id).toBe('gemini-4-argon-high')
    expect(f.child.terminate).toHaveBeenCalledOnce()
    expect(f.child.waitForExit).toHaveBeenCalledOnce()
    expect(DEFAULT_CONFIG.timeoutMs).toBe(1_800_000)
  })

  it('keeps generic metadata at 15s and reports its internal deadline safely', async () => {
    const deadline = fakeDeadlines(), f = processFixture(16_000)
    const result = observe(captureCatalogMetadata(f.backend, DEFAULT_CONFIG, ['synthetic'], '/synthetic/project', new AbortController().signal, undefined, [0], true))
    expect(deadline).toHaveBeenCalledWith(15_000)
    await vi.advanceTimersByTimeAsync(15_000)
    expect((await result).error).toMatchObject({ phase: 'timeout', reason: 'deadline' })
    expect(String((await result).error)).not.toContain(privateMarker)
    expect(f.child.waitForExit).toHaveBeenCalledOnce()
  })

  it('uses the selected lxy HOME for settings as well as the process environment', async () => {
    fakeDeadlines()
    const home = resolve(homedir(), '.agy-homes', 'lxy')
    vi.mocked(readAgySettings).mockImplementation(async selected => selected === homedir() ? { modelProvider: 'synthetic-custom-route' } : {})
    const f = processFixture(0), parentHome = process.env.HOME
    const result = observe(catalogFor('antigravity', f.backend, { ...DEFAULT_CONFIG, agyAccount: 'lxy' }, '/synthetic/project', new AbortController().signal))
    await vi.advanceTimersByTimeAsync(0)
    expect((await result).error).toBeUndefined()
    expect(readAgySettings).toHaveBeenCalledWith(home)
    expect(vi.mocked(f.backend.spawn).mock.calls[0]?.[0].env).toMatchObject({ HOME: home, USERPROFILE: home })
    expect(process.env.HOME).toBe(parentHome)
    const denied = processFixture(0)
    await expect(catalogFor('antigravity', denied.backend, DEFAULT_CONFIG, '/synthetic/project', new AbortController().signal)).rejects.toThrow('自定义模型来源')
    expect(denied.backend.spawn).not.toHaveBeenCalled()
  })

  it('does not turn caller cancellation into a catalog deadline or continue spawning', async () => {
    fakeDeadlines()
    const c = new AbortController(), reason = new Error('Synthetic caller cancellation'), f = processFixture(null)
    const result = observe(catalogFor('antigravity', f.backend, DEFAULT_CONFIG, '/synthetic/project', c.signal))
    await vi.advanceTimersByTimeAsync(0)
    c.abort(reason)
    expect((await result).error).toBe(reason)
    expect(f.child.waitForExit).toHaveBeenCalledOnce()
    const next = processFixture(0)
    await expect(catalogFor('antigravity', next.backend, DEFAULT_CONFIG, '/synthetic/project', c.signal)).rejects.toBe(reason)
    expect(next.backend.spawn).not.toHaveBeenCalled()
  })

  it('keeps cleanup uncertainty ahead of the extended AGY deadline', async () => {
    fakeDeadlines()
    const f = processFixture(null, false)
    const result = observe(catalogFor('antigravity', f.backend, DEFAULT_CONFIG, '/synthetic/project', new AbortController().signal))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect((await result).error).toBeInstanceOf(ProcessCleanupUnconfirmedError)
    expect(String((await result).error)).not.toContain(privateMarker)
  })

  it('classifies an AGY deadline and does not leak native stderr', async () => {
    fakeDeadlines()
    const f = processFixture(null)
    const result = observe(catalogFor('antigravity', f.backend, DEFAULT_CONFIG, '/synthetic/project', new AbortController().signal))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect((await result).error).toMatchObject({ code: 'CLI_METADATA_CAPTURE_FAILED', phase: 'timeout', reason: 'deadline' })
    expect(String((await result).error) + JSON.stringify((await result).error)).not.toContain(privateMarker)
  })

  it('does not let a completed probe deadline abort its parent or a later probe', async () => {
    fakeDeadlines()
    const parent = new AbortController(), first = processFixture(0)
    const firstResult = observe(catalogFor('antigravity', first.backend, DEFAULT_CONFIG, '/synthetic/project', parent.signal))
    await vi.advanceTimersByTimeAsync(0)
    expect((await firstResult).error).toBeUndefined()
    await vi.advanceTimersByTimeAsync(59_000)
    const second = processFixture(16_000)
    const secondResult = observe(catalogFor('antigravity', second.backend, DEFAULT_CONFIG, '/synthetic/project', parent.signal))
    await vi.advanceTimersByTimeAsync(16_000)
    expect((await secondResult).error).toBeUndefined()
    expect(parent.signal.aborted).toBe(false)
  })

  it.each([0, -1, 60_001, NaN])('rejects unbounded or invalid metadata budget %s before spawn', async budget => {
    const f = processFixture(0)
    await expect(captureCatalogMetadata(f.backend, DEFAULT_CONFIG, ['synthetic'], '/synthetic/project', new AbortController().signal, undefined, [0], true, budget)).rejects.toThrow('bounded CLI metadata timeout')
    expect(f.backend.spawn).not.toHaveBeenCalled()
  })
})
