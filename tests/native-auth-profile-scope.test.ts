import { expect, it, vi } from 'vitest'
import { openNativeProfileScope, profileSelection, type NativeProfileAccess } from '../src/host/native-auth-profile-scope.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError } from '../src/host/process.ts'
const pin = { id: 'ap_11111111-1111-4111-8111-111111111111', materialRevision: 'm_22222222-2222-4222-8222-222222222222' }
const preference = { cli: 'minimax' as const, model: 'SYNTHETIC_MODEL', effort: 'default' as const, authProfile: pin }
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(ok => { resolve = ok }); return { promise, resolve } }
// Scope handoff only: no native process, auth file, HTTP or model.
it('clones the complete fixed source pin and never follows mutable caller input', () => {
  const input = { ...preference, authProfile: { ...pin } }, selected = profileSelection(input)!
  input.authProfile.materialRevision = 'm_33333333-3333-4333-8333-333333333333'
  expect(selected).toEqual(pin); expect(Object.isFrozen(selected)).toBe(true)
})
it.each(['wrong-cli', 'partial', 'wrong-revision', 'extra-root', 'agy-account'])('rejects declared profile %s instead of default fallback', kind => {
  const input: any = { ...preference, authProfile: { ...pin } }
  if (kind === 'wrong-cli') input.cli = 'codex'
  if (kind === 'partial') delete input.authProfile.materialRevision
  if (kind === 'wrong-revision') input.authProfile.materialRevision = 'bad'
  if (kind === 'extra-root') input.authProfile.root = '/SYNTHETIC_UNTRUSTED'
  if (kind === 'agy-account') input.agyAccount = 'lxy'
  expect(() => profileSelection(input)).toThrow(/^AUTH_/)
})
it('hands off only the authorized config and holds the operation until explicit cleanup closure', async () => {
  const signal = new AbortController().signal, released = vi.fn()
  const profiles = { run: vi.fn(async (_pin, _executable, operation) => {
    try { return await operation({ pin, config: Object.freeze({ ...DEFAULT_CONFIG, minimaxHome: '/SYNTHETIC_PRIVATE' }), signal }) }
    finally { released() }
  }) } as unknown as NativeProfileAccess
  const scope = await openNativeProfileScope(profiles, pin, '/SYNTHETIC_MCODE', signal)
  expect(scope.config.minimaxHome).toBe('/SYNTHETIC_PRIVATE'); expect(scope.signal).toBe(signal); expect(released).not.toHaveBeenCalled()
  await scope.close(); expect(released).toHaveBeenCalledTimes(1); await scope.close(); expect(released).toHaveBeenCalledTimes(1)
})
it('freezes the pin synchronously before starting the deferred owning operation', async () => {
  const input = { ...pin }, observed: any[] = []
  const profiles = { run: vi.fn(async (selected, _executable, operation) => { observed.push(selected); return operation({ pin: selected, config: DEFAULT_CONFIG, signal: new AbortController().signal }) }) } as unknown as NativeProfileAccess
  const opening = openNativeProfileScope(profiles, input, '/SYNTHETIC_MCODE', new AbortController().signal)
  input.materialRevision = 'm_33333333-3333-4333-8333-333333333333'
  const scope = await opening; await scope.close(); expect(observed).toEqual([pin])
})
it('fails the handoff when target/store authorization rejects without leaving a detached wait', async () => {
  const failure = new Error('SYNTHETIC_UNAUTHORIZED')
  const profiles = { run: vi.fn(async () => { throw failure }) } as unknown as NativeProfileAccess
  await expect(openNativeProfileScope(profiles, pin, '/SYNTHETIC_MCODE', new AbortController().signal)).rejects.toBe(failure)
})
it('carries authentic cleanup uncertainty out of the operation rather than reporting callback success', async () => {
  let observed: unknown
  const profiles = { run: vi.fn(async (_pin, _executable, operation) => {
    try { return await operation({ pin, config: DEFAULT_CONFIG, signal: new AbortController().signal }) }
    catch (error) { observed = error; throw error }
  }) } as unknown as NativeProfileAccess
  const scope = await openNativeProfileScope(profiles, pin, '/SYNTHETIC_MCODE', new AbortController().signal), failure = new ProcessCleanupUnconfirmedError()
  await expect(scope.close(failure)).rejects.toBe(failure); expect(observed).toBe(failure)
})
it('does not finish closure while the owning resource callback is still unwinding', async () => {
  const end = deferred(), started = deferred()
  const profiles = { run: vi.fn(async (_pin, _executable, operation) => {
    try { return await operation({ pin, config: DEFAULT_CONFIG, signal: new AbortController().signal }) }
    finally { started.resolve(); await end.promise }
  }) } as unknown as NativeProfileAccess
  const scope = await openNativeProfileScope(profiles, pin, '/SYNTHETIC_MCODE', new AbortController().signal)
  let closed = false; const work = scope.close().then(() => { closed = true })
  await started.promise; expect(closed).toBe(false); end.resolve(); await work; expect(closed).toBe(true)
})
