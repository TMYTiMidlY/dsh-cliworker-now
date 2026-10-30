// Host-private MiniMax profile facade. Caller authorizes main/write/plan
// boundaries before entering; safe descriptors only leave this resource API.
import { authProfileIdPattern, type AuthProfilePin } from '../shared/auth-profiles.ts'
import { lstatSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { AuthDirectory, cancelled, createAuthDirectory, fail, isNativeAuthCleanupUnconfirmedError, nativeAuthFailureCode } from './native-auth-files.ts'
import { NativeAuthStore, type NativeAuthDescriptor, type NativeAuthManage } from './native-auth-store.ts'
import { MiniMaxAuthRefreshGroups } from './native-auth-minimax-refresh.ts'
import { MiniMaxNativeProfileImporter, type MiniMaxNativeImportRequest } from './native-auth-minimax-import.ts'
import { MiniMaxNativeTargetVerifier, type MiniMaxTargetDependencies } from './native-auth-minimax-target.ts'
import { MiniMaxNativeProfileResolver, type MiniMaxProfileOperation } from './native-auth-minimax-resolver.ts'
import { isProcessCleanupUnconfirmedError, type ProcessBackend, type RuntimeConfig } from './process.ts'

type MiniMaxExecutable = string | ((signal: AbortSignal) => Promise<string>)
const cleanupUnknown = (error: unknown) => isNativeAuthCleanupUnconfirmedError(error) || isProcessCleanupUnconfirmedError(error)
function safeFailure(error: unknown): never { fail(cleanupUnknown(error) ? 'CLEANUP_UNCONFIRMED' : nativeAuthFailureCode(error) ?? 'STORE_UNAVAILABLE') }
function missing(path: string): boolean {
  try { lstatSync(path); return false } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; return safeFailure(error) }
}
export class MiniMaxNativeAuthProfiles {
  readonly #storePath: string
  readonly #groupsPath: string
  readonly #workspacePath: string
  readonly #busy = new Set<string>()
  readonly #disposed = new AbortController()
  readonly #pending = new Set<Promise<unknown>>()
  #closing?: Promise<void>
  #cleanupDebt = false
  constructor(directory: string, readonly backend: ProcessBackend, readonly config: RuntimeConfig,
    /** Trusted test/private transport only, never accepted by tools/Gateway. */
    readonly dependencies: Pick<MiniMaxTargetDependencies, 'identity' | 'snapshotBackend'> = {}) {
    this.#storePath = join(directory, 'native-auth-profiles')
    this.#groupsPath = join(directory, 'native-auth-minimax-groups')
    this.#workspacePath = join(directory, 'native-auth-minimax-verify-workspace')
  }
  dispose(): Promise<void> {
    return this.#closing ??= (async () => {
      this.#disposed.abort()
      const results = await Promise.allSettled([...this.#pending])
      if (this.#cleanupDebt || results.some(result => result.status === 'rejected' && cleanupUnknown(result.reason))) fail('CLEANUP_UNCONFIRMED')
    })()
  }
  #track<T>(start: () => Promise<T>): Promise<T> {
    // Register before any synchronous resource/transport callback can call
    // dispose. Starting the async operation first leaves an ownership gap.
    const work = Promise.resolve().then(start)
    this.#pending.add(work)
    void work.then(() => this.#pending.delete(work), error => {
      if (cleanupUnknown(error)) this.#cleanupDebt = true
      this.#pending.delete(work)
    })
    return work
  }
  #resources(create: boolean) {
    if (missing(this.#storePath)) {
      if (!create) return undefined
      NativeAuthStore.initialize(this.#storePath)
    }
    const store = NativeAuthStore.open(this.#storePath)
    if (create) {
      if (missing(this.#groupsPath)) MiniMaxAuthRefreshGroups.initialize(this.#groupsPath)
      if (missing(this.#workspacePath)) { const root = createAuthDirectory(this.#workspacePath); root.close() }
    }
    return { store }
  }
  #operation() {
    const resources = this.#resources(false)
    if (!resources) fail('NOT_FOUND')
    const groups = MiniMaxAuthRefreshGroups.open(this.#groupsPath)
    const workspace = AuthDirectory.open(this.#workspacePath, true); workspace.close()
    return { ...resources, groups }
  }
  #verifier(executable: string) {
    const parent = AuthDirectory.open(this.#workspacePath, true), name = `verify-${randomUUID()}`
    try {
      parent.mkdir(name)
      return new MiniMaxNativeTargetVerifier({ backend: this.backend, config: this.config, executable,
        workspace: join(this.#workspacePath, name), ...this.dependencies })
    } finally { parent.close() }
  }
  /** Registration/enablement is not a fresh credential/remote availability check. */
  list(): readonly NativeAuthDescriptor[] {
    try { cancelled(this.#disposed.signal); return this.#resources(false)?.store.list().filter(row => row.cli === 'minimax') ?? [] }
    catch (error) { return safeFailure(error) }
  }
  /** Resolve the registry head once for an explicit NEW selection; no Native
   * proof is claimed until run(). Existing Workers never call this by ID. */
  select(id: string): Readonly<AuthProfilePin> {
    if (typeof id !== 'string' || !authProfileIdPattern.test(id)) fail('INVALID_INPUT')
    const descriptor = this.list().find(row => row.id === id)
    if (!descriptor) fail('NOT_FOUND')
    if (!descriptor.enabled) fail('DISABLED')
    if (descriptor.state !== 'available') fail('NOT_FOUND')
    return Object.freeze({ id, materialRevision: descriptor.materialRevision })
  }
  import(input: Omit<MiniMaxNativeImportRequest, 'scope'>, executable: MiniMaxExecutable): Promise<NativeAuthDescriptor> {
    return this.#track(() => this.#performImport(input, executable))
  }
  async #performImport(input: Omit<MiniMaxNativeImportRequest, 'scope'>, executable: MiniMaxExecutable): Promise<NativeAuthDescriptor> {
    const active = input.signal ? AbortSignal.any([input.signal, this.#disposed.signal]) : this.#disposed.signal
    try {
      cancelled(active)
      if (input.id && this.#busy.has(input.id)) fail('BUSY')
      this.#resources(true)
      const resources = this.#operation()
      const importer = new MiniMaxNativeProfileImporter({ ...resources, ...this.dependencies,
        // Exact committed replay and unsupported source must not depend on
        // locating a Native program or create a fresh target verification cwd.
        verifyTarget: async (context, signal) => {
          const path = typeof executable === 'string' ? executable : await executable(signal)
          return this.#verifier(path).verify(context, signal)
        } })
      if (input.id) this.#busy.add(input.id)
      try { return await importer.import({ ...input, scope: 'account-only', signal: active }) }
      finally { if (input.id) this.#busy.delete(input.id) }
    } catch (error) { return safeFailure(error) }
  }
  manage(input: NativeAuthManage): NativeAuthDescriptor {
    try {
      cancelled(this.#disposed.signal)
      if (this.#busy.has(input.id)) fail('BUSY')
      const resources = this.#resources(false)
      if (!resources || !resources.store.list().some(row => row.id === input.id && row.cli === 'minimax')) fail('NOT_FOUND')
      return resources.store.manage(input)
    } catch (error) { return safeFailure(error) }
  }
  /** The operation itself must settle only after actual owned cleanup; this
   * facade does not turn a detached callback into Native quiescence proof. */
  run<T>(selection: { id: string; materialRevision?: string }, executable: string,
    operation: (context: MiniMaxProfileOperation) => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.#track(() => this.#performRun(selection, executable, operation, signal))
  }
  async #performRun<T>(selection: { id: string; materialRevision?: string }, executable: string,
    operation: (context: MiniMaxProfileOperation) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const active = signal ? AbortSignal.any([signal, this.#disposed.signal]) : this.#disposed.signal
    cancelled(active)
    if (this.#busy.has(selection.id)) fail('BUSY')
    this.#busy.add(selection.id)
    try {
      const resources = this.#operation(), verifier = this.#verifier(executable)
      return await new MiniMaxNativeProfileResolver({ ...resources, verifyTarget: (context, signal) => verifier.verify(context, signal) })
        .run(selection, this.config, operation, active)
    } finally { this.#busy.delete(selection.id) }
  }
}
