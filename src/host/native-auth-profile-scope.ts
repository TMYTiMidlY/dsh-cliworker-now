import { validAuthProfilePin, type AuthProfilePin } from '../shared/auth-profiles.ts'
import { cliOf, type Preference } from '../shared/types.ts'
import type { MiniMaxProfileOperation } from './native-auth-minimax-resolver.ts'
import type { MiniMaxNativeAuthProfiles } from './native-auth-minimax-service.ts'
import { cancelled, fail, NativeAuthError } from './native-auth-files.ts'
export type NativeProfileAccess = Pick<MiniMaxNativeAuthProfiles, 'run'>
export interface NativeProfileExecutionScope extends MiniMaxProfileOperation { close(error?: unknown): Promise<void> }
export function profileSelection(preference: Preference): Readonly<AuthProfilePin> | undefined {
  if (preference.authProfile === undefined) return undefined
  if (cliOf(preference) !== 'minimax' || preference.agyAccount !== undefined) fail('UNSUPPORTED')
  if (!validAuthProfilePin(preference.authProfile)) fail('INVALID_INPUT')
  return Object.freeze({ ...preference.authProfile })
}
/** Deliberate ownership handoff: the admitted operation remains pending until
 * Runtime has joined its actual Native range/readers/launch cleanup and closes
 * this scope. A callback's successful return must not hide cleanup uncertainty. */
export async function openNativeProfileScope(profiles: NativeProfileAccess, pin: AuthProfilePin, executable: string, signal: AbortSignal): Promise<NativeProfileExecutionScope> {
  cancelled(signal)
  if (!validAuthProfilePin(pin)) fail('INVALID_INPUT')
  const fixedPin = Object.freeze({ ...pin })
  let accept!: (scope: NativeProfileExecutionScope) => void, reject!: (error: unknown) => void
  const ready = new Promise<NativeProfileExecutionScope>((ok, no) => { accept = ok; reject = no })
  let finish!: () => void, failFinish!: (error: unknown) => void
  const end = new Promise<void>((ok, no) => { finish = ok; failFinish = no })
  let admitted = false, closing: Promise<void> | undefined
  const work = Promise.resolve().then(() => profiles.run(fixedPin, executable, async operation => {
    if (admitted) fail('CONFLICT')
    admitted = true
    const close = (error?: unknown): Promise<void> => closing ??= (async () => {
      if (error === undefined) finish(); else failFinish(error)
      await work
    })()
    accept(Object.freeze({ ...operation, close }))
    await end
  }, signal))
  void work.then(() => { if (!admitted) reject(new NativeAuthError('VALIDATION_FAILED')) }, error => { if (!admitted) reject(error) })
  return ready
}
