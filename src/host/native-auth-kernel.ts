// Internal trusted Host transport only. No Gateway/tool accepts this backend.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { constants, closeSync, fstatSync, lstatSync, openSync, readlinkSync, readSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'
import { AuthDirectory, NativeAuthError, cancelled, checkPaths, fail, fdPath, platformSupport, readBounded, safeFile, stamp, type NativeAuthErrorCode } from './native-auth-files.ts'
import type { NativeAuthSnapshotInput } from './native-auth-snapshot.ts'

export interface NativeAuthSnapshotGuard {
  readonly files: ReadonlyMap<string, Buffer>
  readonly signal: AbortSignal
  /** Idempotent source linearization barrier, including actual helper exit.
   * Store adapters MUST await this at the end of verify, before publication. */
  seal(): Promise<void>
  /** Abort an unsealed acquisition and await owned helper exit. */
  close(): Promise<void>
}

export interface NativeAuthKernelBackend {
  /** Trusted package/test asset location, never a model-facing path. */
  assetsDirectory?: string
  timeoutMs?: number
  /** Process transport injection for rejection/lifecycle tests, not proof. */
  spawn?: (file: string, args: readonly string[], options: SpawnOptions) => ChildProcess
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const hex = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s)
const glibcVersion = () => (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined)?.header?.glibcVersionRuntime
function asset(directory: AuthDirectory, name: string, max: number): { fd: number; bytes: Buffer } {
  const path = fdPath(directory.fd, name), before = lstatSync(path, { bigint: true })
  // Package-manager CAS hardlinks are code assets, not credential sources.
  // Trust owner/non-external-write + full hashes, and execute the pinned FD.
  if (!before.isFile() || before.nlink < 1n || (before.uid !== BigInt(process.getuid!()) && before.uid !== 0n) ||
    (before.mode & 0o022n) !== 0n || before.size < 1n || before.size > BigInt(max)) fail('UNSUPPORTED')
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  const bytes = Buffer.alloc(Number(before.size) + 1)
  try {
    let n = 0
    while (n < bytes.length) { const count = readSync(fd, bytes, n, bytes.length - n, n); if (!count) break; n += count }
    if (BigInt(n) !== before.size || stamp(before) !== stamp(fstatSync(fd, { bigint: true })) || stamp(before) !== stamp(lstatSync(path, { bigint: true }))) fail('UNSUPPORTED')
    directory.verify(false)
    return { fd, bytes: bytes.subarray(0, n) }
  } catch { bytes.fill(0); closeSync(fd); return fail('UNSUPPORTED') }
}
export function packagedNativeAuthAssets(moduleUrl: string): string {
  // Only two emitted package layouts are supported. Never blindly try a
  // relative alternative that could resolve into an adjacent package.
  const file = fileURLToPath(moduleUrl), directory = dirname(file)
  if (basename(file) === 'index.js' && basename(directory) === 'lib') return join(directory, 'native-auth-snapshot')
  if (basename(file) === 'native-auth-kernel.js' && basename(directory) === 'host' &&
    basename(dirname(directory)) === 'types' && basename(dirname(dirname(directory))) === 'lib') return join(directory, '../..', 'native-auth-snapshot')
  return fail('UNSUPPORTED')
}
function binaryAsset(override?: string): number {
  platformSupport()
  if (process.arch !== 'x64' || !glibcVersion()) fail('UNSUPPORTED')
  const path = override ?? packagedNativeAuthAssets(import.meta.url)
  {
    let dir: AuthDirectory | undefined
    const opened: Array<{ fd: number; bytes: Buffer }> = []
    try {
      dir = AuthDirectory.open(path)
      const manifestFile = asset(dir, 'manifest.json', 4096); opened.push(manifestFile)
      const manifest = JSON.parse(manifestFile.bytes.toString('utf8'))
      if (manifest.schema !== 1 || manifest.protocol !== 1 || manifest.supported !== true || manifest.platform !== 'linux' || manifest.arch !== 'x64' ||
        manifest.libc !== 'glibc' || !hex(manifest.sourceSha256) || !hex(manifest.binarySha256) || !/^\d+\.\d+$/.test(manifest.buildGlibc)) fail('UNSUPPORTED')
      const minimum = manifest.buildGlibc.split('.').map(Number), actual = glibcVersion()!.split('.').map(Number)
      if (minimum[0] !== actual[0] || minimum[1] > actual[1]) fail('UNSUPPORTED')
      const source = asset(dir, 'native-auth-guard.c', 128 * 1024); opened.push(source)
      const binary = asset(dir, 'guard-linux-x64', 1024 * 1024); opened.push(binary)
      const b = binary.bytes
      if (hash(source.bytes) !== manifest.sourceSha256 || hash(b) !== manifest.binarySha256 || b.length < 64 ||
        b.readUInt32LE(0) !== 0x464c457f || b[4] !== 2 || b[5] !== 1 || b.readUInt16LE(18) !== 62 ||
        (fstatSync(binary.fd).mode & 0o111) === 0 || (fstatSync(binary.fd).mode & 0o7000) !== 0) fail('UNSUPPORTED')
      opened.pop(); binary.bytes.fill(0)
      return binary.fd
    } catch { /* Only fixed UNSUPPORTED leaves this boundary. */ }
    finally { for (const item of opened) { item.bytes.fill(0); closeSync(item.fd) }; dir?.close() }
  }
  return fail('UNSUPPORTED')
}
function frameCode(value: string): NativeAuthErrorCode {
  if (value === 'UNSUPPORTED') return 'UNSUPPORTED'
  if (value === 'UNSAFE') return 'UNSAFE_SOURCE'
  if (value === 'BUSY') return 'BUSY'
  if (value === 'CHANGED' || value === 'OVERFLOW') return 'SOURCE_CHANGED'
  return 'VALIDATION_FAILED'
}

export async function strictNativeAuthSnapshot<T>(input: NativeAuthSnapshotInput,
  validate: (files: ReadonlyMap<string, Buffer>, guard: NativeAuthSnapshotGuard) => Promise<T> | T, backend: NativeAuthKernelBackend = {}): Promise<T> {
  cancelled(input.signal)
  const executable = binaryAsset(backend.assetsDirectory)
  const directories: AuthDirectory[] = [], files: Array<{ fd: number; path: string; before: string }> = [], owned: Buffer[] = []
  const values = new Map<string, Buffer>(), control = new AbortController()
  let child: ChildProcess | undefined, timer: ReturnType<typeof setTimeout> | undefined
  let phase: 'starting' | 'ready' | 'checking' | 'validated' | 'sealing' | 'sealed' = 'starting', buffer = '', outputBytes = 0, closed = false
  let exitResolve!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => { exitResolve = resolve })
  let readyResolve!: () => void, checkedResolve!: () => void, sealResolve!: () => void, errorReject!: (error: NativeAuthError) => void
  const ready = new Promise<void>(resolve => { readyResolve = resolve }), checked = new Promise<void>(resolve => { checkedResolve = resolve }), sealed = new Promise<void>(resolve => { sealResolve = resolve })
  const failure = new Promise<never>((_, reject) => { errorReject = reject }); void failure.catch(() => {})
  type FailureOrigin = 'transport' | 'protocol' | 'helper' | 'explicit' | 'cleanup'
  let firstError: NativeAuthError | undefined, wakeupError: NativeAuthError | undefined, firstOrigin: FailureOrigin | undefined, refinableErrorThrown = false, helperTerminal = false
  const reject = (code: NativeAuthErrorCode, origin: FailureOrigin = 'explicit') => {
    // Transport inference is provisional until owned stdout is drained. A bad
    // protocol poisons helper frames, but never replaces an explicit first cause.
    if (!firstError || (firstOrigin === 'transport' && (origin === 'protocol' || origin === 'explicit' || origin === 'helper' && code === 'SOURCE_CHANGED')) || (firstOrigin === 'helper' && origin === 'protocol')) {
      firstError = new NativeAuthError(code); firstOrigin = origin
    }
    wakeupError ??= firstError
    control.abort(); errorReject(wakeupError)
    if (child && !closed) { try { child.kill('SIGKILL') } catch { /* Actual close is checked below. */ } }
  }
  const abort = () => { reject('CANCELLED') }
  try {
    // Snapshot the trusted selection before spawn/any await. Retained caller
    // arrays/objects cannot change which names are watched or which bytes read.
    if (!Array.isArray(input.files) || input.metadata !== undefined && !Array.isArray(input.metadata) ||
      input.files.length < 1 || input.files.length + (input.metadata?.length ?? 0) > 16) fail('INVALID_INPUT')
    input = Object.freeze({ root: input.root, signal: input.signal, maxTotalBytes: input.maxTotalBytes,
      files: Object.freeze(input.files.map(f => Object.freeze({ ...f }))),
      metadata: Object.freeze((input.metadata ?? []).map(m => Object.freeze({ ...m }))),
    })
    checkPaths(input.files.map(f => f.path))
    checkPaths([...input.files.map(f => f.path), ...input.metadata!.map(m => m.path)])
    const selectedPaths = new Set(input.files.map(f => f.path))
    for (const dependency of input.metadata!) {
      if (dependency.kind !== 'absent' && dependency.kind !== 'symlink' ||
        Object.keys(dependency).some(k => !['kind', 'path', ...(dependency.kind === 'symlink' ? ['target'] : [])].includes(k))) fail('INVALID_INPUT')
      if (dependency.kind === 'symlink' && !selectedPaths.has(dependency.target)) fail('INVALID_INPUT')
    }
    const total = input.maxTotalBytes ?? 4 * 1024 * 1024, timeout = backend.timeoutMs ?? 10000
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30000 || !Number.isSafeInteger(total) || total < 1 || total > 4 * 1024 * 1024 ||
      input.files.some(f => !Number.isSafeInteger(f.maxBytes) || f.maxBytes < 1 || f.maxBytes > 1024 * 1024) || input.files.reduce((n, f) => n + f.maxBytes, 0) > total) fail('INVALID_INPUT')
    const watch = new Map<string, { fd: number; names: Set<string> }>()
    const addWatch = (dir: AuthDirectory, leaf: string) => {
      const nodes = dir.guardNodes()
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i], name = i + 1 < nodes.length ? basename(nodes[i + 1].path) : leaf
        if (Buffer.byteLength(name) > 255) fail('INVALID_INPUT')
        let entry = watch.get(node.path)
        if (!entry) { entry = { fd: node.fd, names: new Set() }; watch.set(node.path, entry) }
        entry.names.add(name)
      }
    }
    directories.push(AuthDirectory.open(input.root))
    for (const file of input.files) {
      const dir = AuthDirectory.open(dirname(join(input.root, file.path))); directories.push(dir); addWatch(dir, basename(file.path))
      const path = fdPath(dir.fd, basename(file.path)), before = lstatSync(path, { bigint: true }); safeFile(before, file.maxBytes)
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      files.push({ fd, path, before: stamp(before) })
      if (stamp(before) !== stamp(fstatSync(fd, { bigint: true }))) fail('SOURCE_CHANGED')
    }
    const metadataChecks: Array<() => void> = []
    for (const dependency of input.metadata!) {
      const dir = AuthDirectory.open(dirname(join(input.root, dependency.path)))
      directories.push(dir); addWatch(dir, basename(dependency.path))
      const path = fdPath(dir.fd, basename(dependency.path))
      if (dependency.kind === 'absent') {
        const absent = (code: 'UNSAFE_SOURCE' | 'SOURCE_CHANGED') => {
          try { lstatSync(path, { bigint: true }) }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
          fail(code)
        }
        // ENOENT is meaningful only for this leaf under the held safe parent.
        // lstat also sees dangling links, so they cannot masquerade as absence.
        absent('UNSAFE_SOURCE'); metadataChecks.push(() => absent('SOURCE_CHANGED'))
      } else {
        const before = lstatSync(path, { bigint: true })
        if (!before.isSymbolicLink() || before.uid !== BigInt(process.getuid!()) || before.nlink !== 1n ||
          before.size < 1n || before.size > 4096n) fail('UNSAFE_SOURCE')
        // Compare filesystem bytes, not lossy UTF-8 strings: an invalid byte
        // must not alias a legitimate U+FFFD character in an absolute root.
        const text = readlinkSync(path, { encoding: 'buffer' }), target = join(input.root, dependency.target)
        if (!text.equals(Buffer.from(target)) && !text.equals(Buffer.from(relative(dirname(join(input.root, dependency.path)), target)))) fail('UNSAFE_SOURCE')
        const baseline = stamp(before)
        metadataChecks.push(() => {
          try {
            if (stamp(lstatSync(path, { bigint: true })) !== baseline || !readlinkSync(path, { encoding: 'buffer' }).equals(text)) fail('SOURCE_CHANGED')
          } catch (error) {
            if (error instanceof NativeAuthError) throw error
            if (['ENOENT', 'ENOTDIR', 'EINVAL'].includes((error as NodeJS.ErrnoException).code ?? '')) fail('SOURCE_CHANGED')
            throw error // Unknown I/O is not invented source-change evidence.
          }
        })
      }
    }
    if (watch.size > 256 || [...watch.values()].some(w => w.names.size > 32)) fail('INVALID_INPUT')
    const verify = () => {
      // Relevant-name raw watches cover ancestor ABA. Unrelated sibling writes
      // may legitimately change ancestor mtime/size/nlink during target staging.
      for (const dir of directories) dir.verify(false)
      for (const file of files) if (file.before !== stamp(fstatSync(file.fd, { bigint: true })) || file.before !== stamp(lstatSync(file.path, { bigint: true }))) fail('SOURCE_CHANGED')
      for (const check of metadataChecks) check()
    }
    const watches = [...watch.values()], nonce = randomBytes(16).toString('hex')
    const stdio: SpawnOptions['stdio'] = ['pipe', 'pipe', 'pipe', ...files.map(f => f.fd), ...watches.map(w => w.fd), executable]
    // Execute the already hash-verified inode, not a replaceable package path.
    const childExecutable = `/proc/self/fd/${3 + files.length + watches.length}`
    child = (backend.spawn ?? spawn)(childExecutable, [], { cwd: '/', env: { LANG: 'C', LC_ALL: 'C' }, shell: false, windowsHide: true, stdio })
    child.once('error', () => { reject('UNSUPPORTED'); if (!child?.pid && !closed) { closed = true; exitResolve({ code: null, signal: null }) } })
    child.once('close', (code, signal) => {
      closed = true; exitResolve({ code, signal })
      if (buffer || phase === 'sealed' && (code !== 0 || signal)) reject('VALIDATION_FAILED', 'protocol')
      else if (phase !== 'sealed' || code !== 0 || signal) reject(phase === 'starting' ? 'UNSUPPORTED' : 'VALIDATION_FAILED', 'transport')
    })
    child.stdin?.on('error', () => { reject(phase === 'starting' ? 'UNSUPPORTED' : 'VALIDATION_FAILED', 'transport') })
    child.stderr?.on('data', () => { reject(phase === 'starting' ? 'UNSUPPORTED' : 'VALIDATION_FAILED', 'protocol') })
    child.stdout?.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length
      if (outputBytes > 4096 || chunk.some(b => b > 127 || b === 0)) { reject('VALIDATION_FAILED', 'protocol'); return }
      buffer += chunk.toString('ascii')
      for (;;) {
        const i = buffer.indexOf('\n'); if (i < 0) { if (buffer.length > 128) reject('VALIDATION_FAILED', 'protocol'); break }
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1)
        const pieces = line.split(' ')
        if (helperTerminal || pieces.length !== 4 || pieces[0] !== 'AS1' || pieces[1] !== nonce) { reject('VALIDATION_FAILED', 'protocol'); return }
        if (pieces[2] === 'ERROR') {
          if (!['UNSUPPORTED', 'UNSAFE', 'BUSY', 'CHANGED', 'OVERFLOW', 'PROTOCOL', 'TIMEOUT'].includes(pieces[3])) { reject('VALIDATION_FAILED', 'protocol'); return }
          helperTerminal = true
          reject(frameCode(pieces[3]), pieces[3] === 'PROTOCOL' ? 'protocol' : 'helper')
          continue
        }
        if (pieces[2] === 'READY' && pieces[3] === '0' && phase === 'starting') { phase = 'ready'; readyResolve() }
        else if (pieces[2] === 'CHECKED' && pieces[3] === '1' && phase === 'checking') { phase = 'validated'; checkedResolve() }
        else if (pieces[2] === 'SEALED' && pieces[3] === '2' && phase === 'sealing') { helperTerminal = true; phase = 'sealed'; sealResolve() }
        else { reject('VALIDATION_FAILED', 'protocol'); return }
      }
    })
    input.signal?.addEventListener('abort', abort, { once: true }); cancelled(input.signal)
    timer = setTimeout(() => { reject('VALIDATION_FAILED') }, timeout)
    let config = `AS1 ${nonce} ${process.pid} ${timeout} ${files.length} ${watches.length}\n`
    for (let i = 0; i < files.length; i++) config += `${3 + i} ${input.files[i].maxBytes}\n`
    for (let i = 0; i < watches.length; i++) config += `${3 + files.length + i} ${watches[i].names.size}\n${[...watches[i].names].map(name => Buffer.from(name).toString('hex')).join('\n')}\n`
    if (config.length > 128 * 1024 || !child.stdin?.writable || !child.stdout || !child.stderr) fail('VALIDATION_FAILED')
    child.stdin.write(config)
    await Promise.race([ready, failure])
    verify()
    for (let i = 0; i < files.length; i++) { const bytes = readBounded(files[i].fd, input.files[i].maxBytes); owned.push(bytes); values.set(input.files[i].path, bytes) }
    verify()
    phase = 'checking'; child.stdin.write(`AS1 ${nonce} CHECK 1\n`)
    await Promise.race([checked, failure])
    let sealWork: Promise<void> | undefined
    const sealGuard = (): Promise<void> => {
      if (firstError) return Promise.reject(firstError)
      return sealWork ??= (async () => {
        cancelled(input.signal); verify()
        if (phase !== 'validated') fail('VALIDATION_FAILED')
        phase = 'sealing'; child!.stdin!.write(`AS1 ${nonce} SEAL 2\n`)
        await Promise.race([sealed, failure])
        const exit = await Promise.race([exited, failure])
        if (exit.code !== 0 || exit.signal || firstError) fail('VALIDATION_FAILED')
        // SEAL is a completed sampling transaction, not a promise about later
        // source writes. A store may now publish without a retroactive abort.
        if (timer) { clearTimeout(timer); timer = undefined }
        input.signal?.removeEventListener('abort', abort)
      })().catch(error => {
        if (!firstError || error !== wakeupError && error !== firstError) reject(error instanceof NativeAuthError ? error.code : 'VALIDATION_FAILED')
        throw firstError!
      })
    }
    const guard: NativeAuthSnapshotGuard = Object.freeze({ files: values, signal: control.signal,
      seal: sealGuard,
      close: async () => {
        if (phase !== 'sealed' || firstError) reject('CANCELLED', 'cleanup')
        if (child && !closed) { child.stdin?.destroy(); child.kill('SIGKILL') }
        await exited
      },
    })
    let result: T
    try { result = await Promise.race([Promise.resolve().then(() => validate(values, guard)), failure]) }
    catch (error) {
      if (firstError) {
        if (error !== wakeupError && error !== firstError) reject(error instanceof NativeAuthError ? error.code : 'VALIDATION_FAILED')
        throw firstError
      }
      cancelled(input.signal)
      if (error instanceof NativeAuthError) throw new NativeAuthError(error.code)
      return fail('VALIDATION_FAILED')
    }
    await sealGuard()
    return result!
  } catch (error) {
    if (!firstError || error !== wakeupError && error !== firstError) reject(error instanceof NativeAuthError ? error.code : phase === 'starting' ? 'UNSAFE_SOURCE' : 'VALIDATION_FAILED')
    refinableErrorThrown = firstOrigin === 'transport' || firstOrigin === 'helper'
    throw firstError!
  } finally {
    if (timer) clearTimeout(timer)
    input.signal?.removeEventListener('abort', abort); control.abort()
    let cleanupError: NativeAuthError | undefined
    if (child && !closed) {
      child.stdin?.destroy(); try { child.kill('SIGKILL') } catch { /* Wait for actual close, never infer cleanup from kill(). */ }
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([exited, new Promise<never>((_, rejectCleanup) => { cleanupTimer = setTimeout(() => { rejectCleanup(new NativeAuthError('CLEANUP_UNCONFIRMED')) }, 1000) })])
      } catch { cleanupError = new NativeAuthError('CLEANUP_UNCONFIRMED') }
      finally { if (cleanupTimer) clearTimeout(cleanupTimer) }
    }
    for (const bytes of owned) bytes.fill(0)
    for (const file of files.reverse()) closeSync(file.fd)
    for (const dir of directories.reverse()) dir.close()
    closeSync(executable)
    if (cleanupError) throw cleanupError
    // Owned stdout is drained before actual close. Finalize only helper/transport
    // inference, never a callback rejection or an explicit first cause.
    if (refinableErrorThrown && firstError) throw firstError
  }
}
