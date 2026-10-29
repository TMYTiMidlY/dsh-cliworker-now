// Trusted adapter building block only: adapters own source authorization,
// filename whitelist, schema/epoch coherence and native identity validation.
import { constants, closeSync, fstatSync, lstatSync, openSync, type FSWatcher } from 'node:fs'
import { dirname, join } from 'node:path'
import { AuthDirectory, NativeAuthError, cancelled, checkPaths, fail, fdPath, platformSupport, readBounded, safeFile, stamp } from './native-auth-files.ts'
import { strictNativeAuthSnapshot, type NativeAuthKernelBackend, type NativeAuthSnapshotGuard } from './native-auth-kernel.ts'
export type { NativeAuthSnapshotGuard } from './native-auth-kernel.ts'

/** Trusted adapter-selected dependencies only. A symlink is metadata, never a
 * credential reader: its root-relative target MUST also be selected in files.
 * Adapters still own the settings-only filename/alias authorization policy. */
export type NativeAuthSnapshotMetadata =
  | Readonly<{ kind: 'absent'; path: string }>
  | Readonly<{ kind: 'symlink'; path: string; target: string }>
export interface NativeAuthSnapshotInput {
  root: string
  files: readonly { path: string; maxBytes: number }[]
  metadata?: readonly NativeAuthSnapshotMetadata[]
  maxTotalBytes?: number
  signal?: AbortSignal
}
/** Guarded Linux/x64 local-FS sampling, never an arbitrary model-facing file
 * importer. Missing/unproved assets or platform/FS remain UNSUPPORTED. The
 * callback is protected until the helper's SEAL linearization point; this is
 * not a cross-directory transaction with a later registry publication. Store
 * orchestration MUST await guard.seal() at the end of its verify callback,
 * before returning the identity and before publishing. Merely nesting an
 * import inside this callback is NOT safe. Caller-owned work must honor
 * guard.signal and await its own process cleanup; helper exit proves no more.
 */
export async function withNativeAuthSnapshot<T>(input: NativeAuthSnapshotInput,
  validate: (files: ReadonlyMap<string, Buffer>, guard: NativeAuthSnapshotGuard) => Promise<T> | T,
  backend?: NativeAuthKernelBackend): Promise<T> {
  return strictNativeAuthSnapshot(input, validate, backend)
}

export interface UnverifiedNativeAuthObservation<T> {
  readonly verified: false
  readonly value: T
}
/** Diagnostic/experimental observation ONLY, never publication authorization.
 * Holds every required file and ancestor FD through the complete callback.
 * No source write, recursion, config discovery or native process occurs here.
 * Bytes are borrowed and wiped on exit; retained projections must copy bytes.
 * The explicit unverified wrapper prevents accidental NativeAuthMaterial use.
 */
export async function observeNativeAuthFiles<T>(input: NativeAuthSnapshotInput,
  validate: (files: ReadonlyMap<string, Buffer>) => Promise<T> | T): Promise<UnverifiedNativeAuthObservation<T>> {
  platformSupport()
  const dirs: AuthDirectory[] = [], opened: Array<{ fd: number; path: string; before: string }> = [], bytes = new Map<string, Buffer>()
  const watchers: FSWatcher[] = []
  let validating = false, verifying = false, changed = false
  const observe = (dir: AuthDirectory) => { watchers.push(...dir.observe(() => { changed = true })) }
  try {
    cancelled(input.signal)
    if (input.metadata !== undefined) {
      if (!Array.isArray(input.metadata)) fail('INVALID_INPUT')
      if (input.metadata.length) fail('UNSUPPORTED')
    }
    checkPaths(input.files.map(file => file.path))
    const total = input.maxTotalBytes ?? 4 * 1024 * 1024
    if (!Number.isSafeInteger(total) || total < 1 || total > 4 * 1024 * 1024 || input.files.some(file =>
      !Number.isSafeInteger(file.maxBytes) || file.maxBytes < 1 || file.maxBytes > 1024 * 1024) ||
      input.files.reduce((n, file) => n + file.maxBytes, 0) > total) fail('INVALID_INPUT')
    dirs.push(AuthDirectory.open(input.root)); observe(dirs[0])
    // Open ALL files before reading ANY. Per-file checks alone permit mixed
    // generations. Directory ctimeNs catches rename-away-and-back (ABA).
    for (const file of input.files) {
      const directory = AuthDirectory.open(dirname(join(input.root, file.path)))
      dirs.push(directory); observe(directory)
      const path = fdPath(directory.fd, file.path.split('/').at(-1)!)
      const info = lstatSync(path, { bigint: true }); safeFile(info, file.maxBytes)
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      opened.push({ fd, path, before: stamp(info) })
      if (stamp(info) !== stamp(fstatSync(fd, { bigint: true }))) fail('SOURCE_CHANGED')
    }
    for (let i = 0; i < input.files.length; i++) {
      cancelled(input.signal)
      bytes.set(input.files[i].path, readBounded(opened[i].fd, input.files[i].maxBytes))
    }
    const verify = () => {
      for (const directory of dirs) directory.verify(true)
      for (const file of opened) if (file.before !== stamp(fstatSync(file.fd, { bigint: true })) ||
        file.before !== stamp(lstatSync(file.path, { bigint: true }))) fail('SOURCE_CHANGED')
    }
    verifying = true; verify(); verifying = false
    validating = true
    const result = await validate(bytes)
    validating = false
    cancelled(input.signal)
    // Give observed events a chance to arrive. This is NOT a drained-queue
    // proof and never upgrades the result to a verified snapshot. Overflow
    // or a delayed event may be invisible through Node's public watch API.
    await new Promise<void>(resolve => setImmediate(resolve))
    await new Promise<void>(resolve => setImmediate(resolve))
    cancelled(input.signal)
    verifying = true; verify()
    if (changed) fail('SOURCE_CHANGED')
    return Object.freeze({ verified: false, value: result })
  } catch (error) {
    if (validating) fail('VALIDATION_FAILED')
    if (error instanceof NativeAuthError) throw error
    return fail(verifying ? 'SOURCE_CHANGED' : 'UNSAFE_SOURCE')
  } finally {
    for (const watcher of watchers) watcher.close()
    for (const buffer of bytes.values()) buffer.fill(0)
    for (const file of opened.reverse()) closeSync(file.fd)
    for (const directory of dirs.reverse()) directory.close()
  }
}
