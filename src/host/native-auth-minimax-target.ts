// Host-private target verification. The caller holds the original signed
// principal refresh group; this class never recursively resolves/acquires it.
import { readdirSync } from 'node:fs'
import { AuthDirectory, cancelled, fail, fdPath, isNativeAuthCleanupUnconfirmedError, nativeAuthFailureCode } from './native-auth-files.ts'
import { withNativeAuthSnapshot, type NativeAuthSnapshotInput, type NativeAuthSnapshotGuard } from './native-auth-snapshot.ts'
import { miniMaxAccountProfileIdentity, type NativeAuthContext, type NativeAuthIdentity } from './native-auth-store.ts'
import { isProcessCleanupUnconfirmedError, type ProcessBackend, type RuntimeConfig } from './process.ts'
import type { NativeAuthKernelBackend } from './native-auth-kernel.ts'
import { requestMiniMaxIdentity, type MiniMaxIdentityOptions } from './minimax-identity.ts'
import { assertMiniMaxRoute, minimaxSource } from './minimax-accounts.ts'
import { queryMiniMaxAcpModels } from './minimax-models.ts'
import { assertMiniMaxAccountSettings } from './native-auth-minimax-settings.ts'
import { inspectMiniMaxTargetAuth } from './native-auth-minimax.ts'
import { assertMiniMaxBuiltinTree } from './native-auth-minimax-builtins.ts'

const cleanupUnknown = (error: unknown) => isNativeAuthCleanupUnconfirmedError(error) || isProcessCleanupUnconfirmedError(error)
function safeFailure(error: unknown, signal?: AbortSignal): never {
  if (cleanupUnknown(error)) fail('CLEANUP_UNCONFIRMED')
  const code = nativeAuthFailureCode(error)
  if (code) fail(code)
  cancelled(signal)
  return fail('VALIDATION_FAILED')
}
/** Every nesting layer joins its own callback. A kernel race/finalizer must
 * never erase a genuine Native cleanup witness or leave callback work detached. */
async function joinedSnapshot<T>(input: NativeAuthSnapshotInput,
  callback: (files: ReadonlyMap<string, Buffer>, guard: NativeAuthSnapshotGuard) => Promise<T>, backend: NativeAuthKernelBackend): Promise<T> {
  let work: Promise<T> | undefined
  try {
    return await withNativeAuthSnapshot(input, (files, guard) => {
      work = Promise.resolve().then(() => callback(files, guard)); return work
    }, backend)
  } catch (error) {
    if (work) { try { await work } catch (inner) { if (cleanupUnknown(inner)) fail('CLEANUP_UNCONFIRMED') } }
    return safeFailure(error, input.signal)
  }
}
export interface MiniMaxTargetDependencies {
  backend: ProcessBackend; config: RuntimeConfig; executable: string
  /** Host-owned private empty verification cwd, not a tool input/business cwd. */
  workspace: string
  identity?: MiniMaxIdentityOptions; snapshotBackend?: NativeAuthKernelBackend
}
export class MiniMaxNativeTargetVerifier {
  readonly #dependencies: MiniMaxTargetDependencies
  constructor(dependencies: MiniMaxTargetDependencies) { this.#dependencies = dependencies }
  async verify(context: NativeAuthContext, signal: AbortSignal): Promise<NativeAuthIdentity> {
    const policy = context.identityPolicy
    if (context.cli !== 'minimax' || policy?.kind !== 'minimax-native-principal' ||
        policy.format !== 'mcode-0.6.12-file-v1' || policy.configPolicy !== 'account-only' || !policy.configDigest) fail('UNSUPPORTED')
    // The fixed builtin contract is not a promise about arbitrary alternate
    // assets or a caller-supplied business cwd. Do not execute an override.
    if (process.env.MAVIS_BUILTIN_AGENTS_V2_DIR) fail('UNSUPPORTED')
    cancelled(signal); assertMiniMaxRoute()
    const { backend, executable, workspace } = this.#dependencies
    const cwd = AuthDirectory.open(workspace, true)
    try { if (readdirSync(fdPath(cwd.fd)).length) fail('UNSUPPORTED'); cwd.verify(false) } finally { cwd.close() }
    const config = { ...this.#dependencies.config, minimaxHome: context.nativeRoot, minimaxRegion: policy.region, minimaxExpectedConfigDigest: policy.configDigest }
    const total = this.#dependencies.snapshotBackend?.timeoutMs ?? 30000
    if (!Number.isSafeInteger(total) || total < 1 || total > 30000) fail('INVALID_INPUT')
    const end = Date.now() + total
    const budget = (maximum: number): NativeAuthKernelBackend => {
      const remaining = Math.min(maximum, end - Date.now())
      if (remaining < 1) fail('VALIDATION_FAILED')
      return { ...this.#dependencies.snapshotBackend, timeoutMs: remaining }
    }
    const authInput = (active: AbortSignal): NativeAuthSnapshotInput => ({ root: context.nativeRoot, signal: active, files: [
      { path: `auth/prod/${policy.region}/mcode-public/auth.json`, maxBytes: 65536 },
      { path: `auth/prod/${policy.region}/mcode-public/auth-state.json`, maxBytes: 65536 },
    ] })
    const identityFor = (principal: string): NativeAuthIdentity => {
      const identity = miniMaxAccountProfileIdentity(principal, policy.region, policy.configDigest!)
      if (!('identityPolicy' in identity) || identity.identityPolicy.refreshGroup !== policy.refreshGroup) fail('IDENTITY_MISMATCH')
      return identity
    }
    // PRE: the prepared config is verified against the original signed digest
    // and both absent protections are proven BEFORE any Native process runs.
    // mcode 0.6.12 legitimately rewrites the config file's vendor-owned parts
    // during ACP startup, so the old spanning byte-stamp guard is replaced by
    // this sealed pre-check plus a fresh post-check after the owned range.
    await joinedSnapshot({ root: context.nativeRoot, signal,
      files: [{ path: 'config.yaml', maxBytes: 65536 }],
      metadata: [{ kind: 'absent', path: 'permission.json' }, { kind: 'absent', path: 'plugin-hook-permissions' }],
    }, async (protectedFiles, guard) => {
      assertMiniMaxAccountSettings(policy.configDigest!, protectedFiles.get('config.yaml')!, policy.region)
      assertMiniMaxBuiltinTree(context.nativeRoot, true)
      await guard.seal()
    }, budget(8000))
    const active = signal
    await joinedSnapshot(authInput(active), async (files, authGuard) => {
      const sample = inspectMiniMaxTargetAuth({ nativeRoot: context.nativeRoot, region: policy.region, files }, 'before-native')
      // Expired/near-expiry A is only a Native renewal candidate. Never send
      // it to UID and never alter it, R, state or expiry to manufacture auth.
      if (sample.expiresAtMs > Date.now() + 5000) {
        const principal = await requestMiniMaxIdentity(policy.region, sample.accessToken, AbortSignal.any([active, authGuard.signal]), this.#dependencies.identity)
        identityFor(principal)
      }
    }, budget(4000))
    // The short auth guard has actually sealed, closed and released before
    // Native may refresh. Do NOT use that completed guard's aborted signal.
    const source = await minimaxSource(config, active)
    await queryMiniMaxAcpModels(backend, config, executable, workspace, source, active, '0.6.12')
    // Low-level query has joined its owned range; model rows alone are not
    // auth/protection proof and are deliberately not returned as a catalog.
    assertMiniMaxBuiltinTree(context.nativeRoot, false)
    const identity = await joinedSnapshot(authInput(active), async (files, authGuard) => {
      const sample = inspectMiniMaxTargetAuth({ nativeRoot: context.nativeRoot, region: policy.region, files }, 'after-native')
      const principal = await requestMiniMaxIdentity(policy.region, sample.accessToken, AbortSignal.any([active, authGuard.signal]), this.#dependencies.identity)
      return identityFor(principal)
    }, budget(4000))
    // UID is asynchronous: re-sample the capability tree at this final
    // postcondition too. This is not an assertion of continuous subtree ABA
    // exclusion; the config/global protection guard has a narrower scope.
    assertMiniMaxBuiltinTree(context.nativeRoot, false)
    // POST: the vendor may have normalized the config file during its owned
    // range. Read FRESH bytes and re-assert the owned privacy/safety fields
    // against the original signed digest plus both absent protections.
    await joinedSnapshot({ root: context.nativeRoot, signal: active,
      files: [{ path: 'config.yaml', maxBytes: 65536 }],
      metadata: [{ kind: 'absent', path: 'permission.json' }, { kind: 'absent', path: 'plugin-hook-permissions' }],
    }, async (finalFiles, guard) => {
      assertMiniMaxAccountSettings(policy.configDigest!, finalFiles.get('config.yaml')!, policy.region)
      await guard.seal()
    }, budget(8000))
    cancelled(active)
    return identity
  }
}
