import { afterEach, describe, expect, it, vi } from 'vitest'
import { PassThrough, Readable } from 'node:stream'
import { captureCatalogMetadata } from '../src/host/adapters.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'
// Synthetic process handles only. No native command, profile, credentials or network.
const marker = 'PRIVATE_metadata_token_endpoint_argv'
const failure = (code: unknown = 'PRIVATE_CODE') => Object.assign(new Error(marker), { code, name: marker, cause: { marker } })
function fixture(o: { phase?: string; error?: unknown; outcome?: any; wait?: 'false' | 'throw'; terminate?: boolean; bytes?: number; stderr?: string } = {}) {
  const hang = o.phase === 'hang', stdout = hang ? new PassThrough() : o.phase === 'read' ? Readable.from((async function* () { throw o.error ?? failure('EIO') })()) : Readable.from([Buffer.from(o.phase === 'budget' ? 'x'.repeat(20) : '模拟 UTF8')])
  const stderr = new PassThrough(); if (!hang) stderr.end(o.stderr ?? marker)
  let finish!: (outcome: any) => void
  const done = hang ? new Promise<any>(r => { finish = r }) : o.phase === 'done' ? Promise.reject(o.error ?? failure('EPIPE')) : Promise.resolve(Object.hasOwn(o, 'outcome') ? o.outcome : { exitCode: 0, signal: null })
  void done.catch(() => {})
  const stop = () => { if (hang) { (stdout as PassThrough).end(); stderr.end(); finish({ exitCode: 143, signal: null }) } }
  const child = { stdout, stderr, done, terminate: vi.fn(() => { stop(); if (o.terminate) throw failure() }), waitForExit: vi.fn(async () => { if (o.wait === 'throw') throw failure(); return o.wait !== 'false' }) }
  const backend: ProcessBackend = { resolveExecutable: vi.fn(), spawn: vi.fn((spec: any) => { if (o.phase === 'spawn') throw o.error ?? failure(); spec.signal?.addEventListener('abort', stop, { once: true }); return child as any }) }
  const run = (signal = new AbortController().signal, optIn = true, allowed = [0]) => (captureCatalogMetadata as any)(backend, { ...DEFAULT_CONFIG, maxRunBytes: o.bytes ?? DEFAULT_CONFIG.maxRunBytes }, [marker], marker, signal, { PRIVATE_ENV: marker }, allowed, optIn)
  return { backend, child, run }
}
const caught = async (promise: Promise<any>) => { try { await promise; throw new Error('Expected rejection') } catch (e: any) { return e } }
afterEach(() => vi.restoreAllMocks())
describe('safe metadata phase opt-in', () => {
  it.each([
    ['unknown command models', 'native-argument'],
    ['unknown flag --SYNTHETIC_SECRET_FLAG', 'native-argument'],
    ['authentication required: SYNTHETIC_SECRET', 'native-auth-text'],
    ['proxyconnect tcp: connection refused SYNTHETIC_SECRET', 'native-network-text'],
    ['x509: certificate signed by unknown authority', 'native-network-text'],
    ['permission denied SYNTHETIC_SECRET', 'native-permission-text'],
    ['no such file or directory: /SYNTHETIC_SECRET', 'native-file-text'],
    ['stdin is not a terminal', 'native-terminal-text'],
    ['panic: SYNTHETIC_SECRET runtime error', 'native-runtime-text'],
    ['config file SYNTHETIC_SECRET is invalid', 'native-settings-text'],
    ['auto-update failed SYNTHETIC_SECRET', 'native-update-text'],
    ['sandbox namespace failed SYNTHETIC_SECRET', 'native-sandbox-text'],
    ['failed to refresh token SYNTHETIC_SECRET', 'native-auth-text'],
    ['unexpected HTTP response SYNTHETIC_SECRET', 'native-network-text'],
    ['usage: SYNTHETIC_SECRET', 'native-argument'],
    ['updating failed SYNTHETIC_SECRET', 'native-update-text'],
    ['SYNTHETIC_SECRET unrecognized prose', 'native-unclassified-text'],
  ])('keeps only a fixed hint from failed native text %s', async (stderr, hint) => {
    const e = await caught(fixture({ outcome: { exitCode: 1, signal: null }, stderr }).run())
    expect(e).toMatchObject({ phase: 'exit', reason: 'exit', exitCode: 1 })
    expect(e.hint).toBe(hint)
    expect(String(e) + JSON.stringify(e)).not.toMatch(/SYNTHETIC_SECRET|--SYNTHETIC|unknown command models|certificate signed|\/SYNTHETIC/)
    if (hint) expect(String(e)).toContain(`hint=${hint}`)
  })
  it('does not let a recognized hint waive cleanup uncertainty', async () => {
    const e = await caught(fixture({ outcome: { exitCode: 1 }, stderr: 'authentication required', wait: 'false' }).run())
    expect(e).toBeInstanceOf(ProcessCleanupUnconfirmedError)
  })
  it.each(['ENOENT', 'EACCES', 'EPIPE', 'PRIVATE_CODE'])('captures synchronous spawn %s without retaining original payload', async code => {
    const f = fixture({ phase: 'spawn', error: failure(code) }), e = await caught(f.run())
    expect(e).toMatchObject({ phase: 'spawn', reason: code === 'PRIVATE_CODE' ? 'unknown' : code, exitCode: null })
    expect(String(e) + JSON.stringify(e)).not.toContain(marker); expect(e.cause).toBeUndefined()
    expect(f.child.terminate).not.toHaveBeenCalled(); expect(f.child.waitForExit).not.toHaveBeenCalled()
  })
  it.each([['read', 'read', 'EIO'], ['done', 'exit', 'EPIPE']])('labels %s failure by actual local boundary', async (phase, expected, reason) => {
    const f = fixture({ phase }), e = await caught(f.run())
    expect(e).toMatchObject({ phase: expected, reason, exitCode: null }); expect(String(e) + JSON.stringify(e)).not.toContain(marker)
    expect(f.child.terminate).toHaveBeenCalledOnce(); expect(f.child.waitForExit).toHaveBeenCalledOnce()
  })
  it.each([[{ exitCode: 42, signal: null }, 42, 'exit'], [{ exitCode: null, signal: 'SIGTERM' }, null, 'signal'], [{ exitCode: -1, signal: 'PRIVATE_SIGNAL' }, null, 'unknown'], [{ exitCode: 'PRIVATE_EXIT' }, null, 'unknown']])('restricts numeric exit/signal evidence %j', async (outcome, exitCode, reason) => {
    const f = fixture({ outcome }), e = await caught(f.run())
    expect(e).toMatchObject({ phase: 'exit', exitCode, reason }); expect(String(e) + JSON.stringify(e)).not.toMatch(/PRIVATE_/)
  })
  it.each(['SIGTERM', 'PRIVATE_SIGNAL', false, 0, '', {}])('rejects accepted exit zero with contradictory or unknown signal %j', async signal => {
    const f = fixture({ outcome: { exitCode: 0, signal } }), e = await caught(f.run())
    expect(e).toMatchObject({ phase: 'exit', exitCode: 0, reason: signal === 'SIGTERM' ? 'signal' : 'unknown' })
    expect(String(e) + JSON.stringify(e)).not.toMatch(/PRIVATE_/)
    expect(f.child.waitForExit).toHaveBeenCalledOnce()
  })
  it.each([-1, 0.5, 4294967296])('rejects invalid uint32 exit %j even if an internal caller allowed it', async exitCode => {
    const e = await caught(fixture({ outcome: { exitCode, signal: null } }).run(undefined, true, [exitCode]))
    expect(e).toMatchObject({ phase: 'exit', exitCode: null, reason: 'unknown' })
  })
  it.each(['spawn', 'read'])('preserves legacy %s error identity when caller cancellation races', async phase => {
    const controller = new AbortController(), original = failure('EIO'), cancel = new Error('synthetic caller cancelled'), f = fixture({ phase, error: original })
    if (phase === 'spawn') vi.mocked(f.backend.spawn).mockImplementation(() => { controller.abort(cancel); throw original })
    const pending = caught(f.run(controller.signal, false)); if (phase === 'read') controller.abort(cancel)
    expect(await pending).toBe(original)
  })
  it('keeps malformed or throwing completion fields at the safe exit boundary', async () => {
    for (const outcome of [null, undefined, Object.defineProperty({}, 'exitCode', { get() { throw failure('EIO') } })]) {
      const e = await caught(fixture({ outcome }).run()); expect(e).toMatchObject({ phase: 'exit', exitCode: null }); expect(String(e) + JSON.stringify(e)).not.toContain(marker)
    }
  })
  it('keeps split UTF8, accepted nonzero exits and legacy error identity unchanged by default', async () => {
    expect(await fixture({ outcome: { exitCode: 1 } }).run(undefined, true, [0, 1])).toBe('模拟 UTF8')
    const original = failure('EIO'); const f = fixture({ phase: 'read', error: original })
    expect(await caught(f.run(undefined, false))).toBe(original)
  })
  it('labels the shared stdout/stderr byte budget read/output-limit safely', async () => {
    const e = await caught(fixture({ phase: 'budget', bytes: 4 }).run())
    expect(e).toMatchObject({ phase: 'read', reason: 'output-limit' }); expect(String(e)).not.toContain(marker)
    expect(String(await caught(fixture({ phase: 'budget', bytes: 4 }).run(undefined, false)))).toContain('CLI discovery output too large')
  })
  it('distinguishes internal deadline from caller cancellation without guessing reason text', async () => {
    const deadline = new AbortController(); vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    const f = fixture({ phase: 'hang' }), pending = caught(f.run()); deadline.abort(failure())
    const e = await pending; expect(e).toMatchObject({ phase: 'timeout', reason: 'deadline' }); expect(String(e) + JSON.stringify(e)).not.toContain(marker)
    expect(f.child.waitForExit).toHaveBeenCalledOnce()
  })
  it('keeps caller abort identity, including an already aborted zero-spawn request', async () => {
    const controller = new AbortController(), reason = failure(), f = fixture({ phase: 'hang' })
    const pending = caught(f.run(controller.signal)); controller.abort(reason)
    expect(await pending).toBe(reason); expect(f.child.waitForExit).toHaveBeenCalledOnce()
    const pre = fixture(); expect(await caught(pre.run(controller.signal))).toBe(reason); expect(pre.backend.spawn).not.toHaveBeenCalled()
  })
  it('keeps typed cleanup from read/done ahead of caller abort, including late cleanup evidence', async () => {
    for (const phase of ['read', 'done']) {
      const c = new AbortController(), e = new ProcessCleanupUnconfirmedError(), f = fixture({ phase, error: e })
      const pending = caught(f.run(c.signal)); c.abort(failure())
      expect(await pending).toBeInstanceOf(ProcessCleanupUnconfirmedError)
    }
  })
  it('keeps a caller abort arriving during confirmed wait ahead of an earlier safe exit diagnostic', async () => {
    const c = new AbortController(), reason = failure(), f = fixture({ outcome: { exitCode: 7 } })
    f.child.waitForExit.mockImplementation(async () => { c.abort(reason); return true })
    expect(await caught(f.run(c.signal))).toBe(reason)
  })
  it('closes arbitrary or throwing code properties to unknown, not a copied label', async () => {
    const error = Object.defineProperty(new Error(marker), 'code', { get() { throw new Error(marker) } })
    const e = await caught(fixture({ phase: 'spawn', error }).run()); expect(e).toMatchObject({ phase: 'spawn', reason: 'unknown' }); expect(String(e) + JSON.stringify(e)).not.toContain(marker)
  })
  it.each(['false', 'throw', 'terminate'] as const)('cleanup %s wins over exit/read/abort diagnosis', async cleanup => {
    const options = cleanup === 'terminate' ? { terminate: true } : { wait: cleanup }
    for (const phase of ['read', 'done', 'budget']) {
      const e = await caught(fixture({ ...options, phase }).run())
      expect(e).toBeInstanceOf(ProcessCleanupUnconfirmedError); expect(String(e)).not.toContain(marker)
    }
    const controller = new AbortController(), f = fixture({ ...options, phase: 'hang' }), pending = caught(f.run(controller.signal)); controller.abort(failure())
    expect(await pending).toBeInstanceOf(ProcessCleanupUnconfirmedError)
  })
})
