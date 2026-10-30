// Host-private fixed-profile operation scope, never a public Worker DTO.
import { cancelled, fail, nativeAuthFailureCode, isNativeAuthCleanupUnconfirmedError } from './native-auth-files.ts'
import { isProcessCleanupUnconfirmedError, type RuntimeConfig } from './process.ts'
import type { NativeAuthStore, NativeAuthContext, NativeAuthIdentity } from './native-auth-store.ts'
import type { MiniMaxAuthRefreshGroups } from './native-auth-minimax-refresh.ts'
export interface MiniMaxProfilePin { readonly id: string; readonly materialRevision: string }
export interface MiniMaxProfileOperation { readonly pin: MiniMaxProfilePin; readonly config: Readonly<RuntimeConfig>; readonly signal: AbortSignal }
export interface MiniMaxProfileResolverDependencies {
  store: NativeAuthStore; groups: MiniMaxAuthRefreshGroups
  /** Trusted verifier joins preparation/refresh and owned cleanup before its
   * original-policy/fresh-principal postcheck. Models alone are not that proof. */
  verifyTarget: (context: NativeAuthContext, signal: AbortSignal) => Promise<NativeAuthIdentity>
}
const cleanupUnknown = (error: unknown) => isNativeAuthCleanupUnconfirmedError(error) || isProcessCleanupUnconfirmedError(error)
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((ok, bad) => { resolve = ok; reject = bad })
  // Rejection may precede the other side of the authorization handoff. Attach
  // a handler now, without replacing the original promise or losing its error.
  void promise.catch(() => {})
  return { promise, resolve, reject }
}
/** Two-stage private handoff: retain one group lease across target verification,
 * the store's identity/enablement CAS check, and the entire admitted operation.
 * No operation runs merely because a verifier returned an identity. */
export class MiniMaxNativeProfileResolver {
  readonly #dependencies: MiniMaxProfileResolverDependencies
  constructor(dependencies: MiniMaxProfileResolverDependencies) { this.#dependencies = dependencies }
  async run<T>(selection: { id: string; materialRevision?: string }, base: RuntimeConfig,
    operation: (context: MiniMaxProfileOperation) => Promise<T>, signal = new AbortController().signal): Promise<T> {
    cancelled(signal)
    const verified = deferred<NativeAuthIdentity>(), authorized = deferred<MiniMaxProfileOperation>()
    const { store, groups } = this.#dependencies
    let work: Promise<T> | undefined, admitted = false
    const verify = (context: NativeAuthContext): Promise<NativeAuthIdentity> => {
      const policy = context.identityPolicy
      if (context.cli !== 'minimax' || policy?.kind !== 'minimax-native-principal') fail('UNSUPPORTED')
      work = groups.run(policy.refreshGroup, async () => {
        const identity = await this.#dependencies.verifyTarget(context, signal)
        verified.resolve(identity)
        // The store still has to compare the signed expected identity and
        // current enabled/head state. Keep the lease while it decides.
        const handle = await authorized.promise
        cancelled(signal)
        return operation(handle)
      }, signal)
      void work.catch(verified.reject)
      return verified.promise
    }
    try {
      const context = selection.materialRevision === undefined
        ? await store.resolve(selection.id, 'minimax', verify)
        : await store.resolvePinned(selection.id, 'minimax', selection.materialRevision, verify)
      const policy = context.identityPolicy
      if (policy?.kind !== 'minimax-native-principal' || !work) fail('STORE_UNAVAILABLE')
      cancelled(signal)
      const handle = Object.freeze({
        pin: Object.freeze({ id: context.id, materialRevision: context.materialRevision }),
        config: Object.freeze({ ...base, minimaxHome: context.nativeRoot, minimaxRegion: policy.region,
          minimaxExpectedConfigDigest: policy.configPolicy === 'account-only' ? policy.configDigest : undefined }), signal,
      })
      admitted = true; authorized.resolve(handle)
      return await work
    } catch (error) {
      authorized.reject(error)
      if (work) {
        try { await work } catch (inner) { if (cleanupUnknown(inner)) fail('CLEANUP_UNCONFIRMED') }
      }
      if (cleanupUnknown(error)) fail('CLEANUP_UNCONFIRMED')
      // An admitted Native operation retains its existing result/error protocol;
      // do not mislabel quota, partial output or SDK failures as auth failures.
      if (admitted) throw error
      cancelled(signal)
      fail(nativeAuthFailureCode(error) ?? 'VALIDATION_FAILED')
    }
  }
}
