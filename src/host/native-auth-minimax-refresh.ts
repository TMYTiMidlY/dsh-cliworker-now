// Host-private refresh serialization, not Native identity or cleanup proof.
// A key is obtained only from a verified MiniMax context (or an initially
// proved source principal). Never expose this resource API to model tools.
import { z } from 'zod'
import {
  AuthDirectory, cancelled, createAuthDirectory, fail, nativeAuthFailureCode,
  isNativeAuthCleanupUnconfirmedError,
} from './native-auth-files.ts'
import { isProcessCleanupUnconfirmedError } from './process.ts'

const policySchema = z.object({ schema: z.literal(1), cli: z.literal('minimax') }).strict()
const stateSchema = z.object({ policy: z.literal(1), state: z.enum(['active', 'cleanup-unconfirmed']) }).strict()
const policy = Buffer.from(JSON.stringify({ schema: 1, cli: 'minimax' }))
const state = (value: 'active' | 'cleanup-unconfirmed') => Buffer.from(JSON.stringify({ policy: 1, state: value }))
const safeFailure = (error: unknown): never => fail(nativeAuthFailureCode(error) ?? 'STORE_UNAVAILABLE')
function parse<T>(root: AuthDirectory, name: string, schema: z.ZodType<T>): T {
  const bytes = root.read(name, 512)
  try {
    const result = schema.safeParse(JSON.parse(bytes.toString('utf8')))
    if (!result.success) fail('STORE_UNAVAILABLE')
    return result.data
  } catch { return fail('STORE_UNAVAILABLE') } finally { bytes.fill(0) }
}
/** Persistent per-principal groups. A crashed/uncertain owner is never expired,
 * stolen or cleared because of PID/age/Host restart. Control records are kept.
 * Operations MUST settle only after joining their owned Native work/cleanup;
 * resolving a detached callback is not evidence that its children are idle. */
export class MiniMaxAuthRefreshGroups {
  readonly #path: string
  readonly #identity: string
  private constructor(root: AuthDirectory) {
    parse(root, 'policy.json', policySchema)
    this.#path = root.path; this.#identity = root.nativeIdentity
  }
  static initialize(path: string): MiniMaxAuthRefreshGroups {
    let root: AuthDirectory | undefined
    try {
      root = createAuthDirectory(path)
      root.writeExclusive('policy.json', policy)
      return new MiniMaxAuthRefreshGroups(root)
    } catch (error) { return safeFailure(error) } finally { root?.close() }
  }
  static open(path: string): MiniMaxAuthRefreshGroups {
    let root: AuthDirectory | undefined
    try { root = AuthDirectory.open(path, true); return new MiniMaxAuthRefreshGroups(root) }
    catch (error) { return safeFailure(error) } finally { root?.close() }
  }
  #root(): AuthDirectory {
    let root: AuthDirectory | undefined
    try {
      root = AuthDirectory.open(this.#path, true)
      if (root.nativeIdentity !== this.#identity) fail('STORE_UNAVAILABLE')
      parse(root, 'policy.json', policySchema)
      return root
    } catch (error) { root?.close(); return safeFailure(error) }
  }
  async run<T>(group: string, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (typeof group !== 'string' || !/^[0-9a-f]{64}$/.test(group) || typeof operation !== 'function') fail('INVALID_INPUT')
    cancelled(signal)
    let root: AuthDirectory | undefined, directory: AuthDirectory | undefined, lease: AuthDirectory | undefined
    let quarantined = false
    try {
      root = this.#root()
      const name = `g_${group}`
      try { root.mkdir(name) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return safeFailure(error) }
      directory = root.child(name)
      try { directory.mkdir('write-lease') } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return safeFailure(error)
        const held = directory.child('write-lease')
        try {
          if (parse(held, 'state.json', stateSchema).state === 'cleanup-unconfirmed') fail('CLEANUP_UNCONFIRMED')
          fail('BUSY')
        } finally { held.close() }
      }
      lease = directory.child('write-lease')
      lease.writeExclusive('state.json', state('active'))
      cancelled(signal)
      try { return await operation() } catch (error) {
        if (isNativeAuthCleanupUnconfirmedError(error) || isProcessCleanupUnconfirmedError(error)) {
          quarantined = true
          // If recording fails, retain the live lease anyway: no subsequent
          // caller may infer clean quiescence or take over that owner.
          try { lease.replace('state.json', state('cleanup-unconfirmed')) } catch { /* remains blocked */ }
        }
        throw error
      }
    } finally {
      try {
        if (lease && directory && !quarantined) {
          try { directory.releaseLease(lease) } catch { fail('CLEANUP_UNCONFIRMED') }
        }
      } finally { lease?.close(); directory?.close(); root?.close() }
    }
  }
}
