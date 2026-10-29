// Internal trusted Host primitives, NOT a tool/Gateway arbitrary-files API.
import {
  constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readSync, renameSync, watch, writeSync, type BigIntStats, type FSWatcher,
} from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

export type NativeAuthErrorCode = 'UNSUPPORTED' | 'INVALID_INPUT' | 'UNSAFE_SOURCE' | 'SOURCE_CHANGED' |
  'STORE_UNAVAILABLE' | 'CLEANUP_UNCONFIRMED' | 'BUSY' | 'CONFLICT' | 'IDENTITY_MISMATCH' | 'DISABLED' | 'NOT_FOUND' | 'CANCELLED' | 'VALIDATION_FAILED'
const codes: readonly string[] = ['UNSUPPORTED', 'INVALID_INPUT', 'UNSAFE_SOURCE', 'SOURCE_CHANGED', 'STORE_UNAVAILABLE', 'CLEANUP_UNCONFIRMED', 'BUSY', 'CONFLICT', 'IDENTITY_MISMATCH', 'DISABLED', 'NOT_FOUND', 'CANCELLED', 'VALIDATION_FAILED']
const nativeFailures = new WeakMap<object, NativeAuthErrorCode>()
export class NativeAuthError extends Error {
  readonly code: NativeAuthErrorCode
  constructor(code: NativeAuthErrorCode) {
    const normalized = codes.includes(code) ? code : 'STORE_UNAVAILABLE'
    super(`AUTH_${normalized}`)
    this.name = 'NativeAuthError'
    this.code = normalized
    nativeFailures.set(this, normalized)
  }
}
/** Constructor-owned code; never reads a thrown object's mutable code,
 * prototype, message or cause, including proxies and forged prototypes. */
export function nativeAuthFailureCode(value: unknown): NativeAuthErrorCode | undefined {
  return value !== null && (typeof value === 'object' || typeof value === 'function') ? nativeFailures.get(value as object) : undefined
}
export function isNativeAuthCleanupUnconfirmedError(value: unknown): value is NativeAuthError {
  return nativeAuthFailureCode(value) === 'CLEANUP_UNCONFIRMED'
}
export function fail(code: NativeAuthErrorCode): never { throw new NativeAuthError(code) }
export function cancelled(signal?: AbortSignal) { if (signal?.aborted) fail('CANCELLED') }
export function platformSupport(platform: NodeJS.Platform = process.platform): void {
  // Node has no portable openat. No mode-only Windows ACL approximation, and
  // no unproved /dev/fd directory traversal fallback on macOS/BSD.
  if (platform !== 'linux' || typeof process.getuid !== 'function' || !constants.O_NOFOLLOW) fail('UNSUPPORTED')
}
export const stamp = (s: BigIntStats) => [s.dev, s.ino, s.uid, s.gid, s.mode, s.nlink, s.size, s.mtimeNs, s.ctimeNs].join(':')
export const inode = (s: BigIntStats) => `${s.dev}:${s.ino}`
const identity = (s: BigIntStats) => [s.dev, s.ino, s.uid, s.gid, s.mode].join(':')
const stat = (fd: number) => fstatSync(fd, { bigint: true })
export const fdPath = (fd: number, name?: string) => `/proc/self/fd/${fd}${name ? `/${name}` : ''}`
export function relativeParts(path: string): string[] {
  if (typeof path !== 'string' || path.length > 512 || isAbsolute(path) || path.includes('\\') || path.includes('\0')) fail('INVALID_INPUT')
  const parts = path.split('/')
  if (parts.length > 16 || parts.some(p => !/^[A-Za-z0-9_.-]{1,128}$/.test(p) || p === '.' || p === '..')) fail('INVALID_INPUT')
  return parts
}
export function checkPaths(paths: readonly string[]): void {
  if (paths.length < 1 || paths.length > 16) fail('INVALID_INPUT')
  for (const path of paths) relativeParts(path)
  const names = new Set(paths)
  if (names.size !== paths.length) fail('INVALID_INPUT')
  for (const path of paths) {
    const parts = relativeParts(path)
    for (let i = 1; i < parts.length; i++) if (names.has(parts.slice(0, i).join('/'))) fail('INVALID_INPUT')
  }
}
export function safeDir(info: BigIntStats, privateLeaf: boolean, leaf: boolean) {
  const uid = BigInt(process.getuid!())
  if (!info.isDirectory() || (info.uid !== uid && (leaf || info.uid !== 0n)) || (info.mode & 0o022n) !== 0n ||
    (privateLeaf && (info.mode & 0o777n) !== 0o700n)) fail('UNSAFE_SOURCE')
}
export function safeFile(info: BigIntStats, maxBytes: number) {
  if (!info.isFile() || info.uid !== BigInt(process.getuid!()) || info.nlink !== 1n ||
    (info.mode & 0o777n) !== 0o600n || info.size < 0n || info.size > BigInt(maxBytes)) fail('UNSAFE_SOURCE')
}

/** Every component is opened relative to an already held directory FD. */
export class AuthDirectory {
  readonly #nodes: Array<{ fd: number; path: string; before: BigIntStats }> = []
  readonly #private: boolean
  private constructor(readonly path: string, privateLeaf: boolean) { this.#private = privateLeaf }
  static open(path: string, privateLeaf = false): AuthDirectory {
    platformSupport()
    if (!isAbsolute(path) || resolve(path) !== path || path.split('/').length > 48) fail('INVALID_INPUT')
    const chain = new AuthDirectory(path, privateLeaf)
    try {
      const parts = path.split('/').filter(Boolean)
      let current = '/'
      for (let i = -1; i < parts.length; i++) {
        const parent = chain.#nodes.at(-1)
        if (i >= 0) current = join(current, parts[i])
        const fd = openSync(parent ? fdPath(parent.fd, parts[i]) : '/', constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
        chain.#nodes.push({ fd, path: current, before: stat(fd) })
        safeDir(stat(fd), privateLeaf && i === parts.length - 1, i === parts.length - 1)
      }
      chain.verify(true)
      return chain
    } catch (error) { chain.close(); if (error instanceof NativeAuthError) throw error; fail('UNSAFE_SOURCE') }
  }
  get fd() { return this.#nodes.at(-1)!.fd }
  /** Host-private metadata for the bounded kernel guard; never a public DTO. */
  guardNodes(): ReadonlyArray<{ fd: number; path: string }> { return this.#nodes.map(({ fd, path }) => ({ fd, path })) }
  get nativeIdentity() { return inode(stat(this.fd)) }
  verify(strict: boolean): void {
    for (let i = 0; i < this.#nodes.length; i++) {
      const node = this.#nodes[i], opened = stat(node.fd), named = lstatSync(node.path, { bigint: true })
      safeDir(opened, this.#private && i === this.#nodes.length - 1, i === this.#nodes.length - 1)
      if (identity(opened) !== identity(node.before) || identity(opened) !== identity(named) ||
        (strict && (stamp(opened) !== stamp(node.before) || stamp(opened) !== stamp(named)))) fail('SOURCE_CHANGED')
    }
  }
  /** Experimental observation only. Inotify can complement coalesced ctime
   * stamps, but Node does not prove queue drain or report every overflow.
   * Observed errors reject; absence of an event is NOT a clean snapshot.
   */
  observe(changed: () => void): FSWatcher[] {
    const watchers: FSWatcher[] = []
    try {
      for (let i = 0; i < this.#nodes.length; i++) {
        const node = this.#nodes[i], next = this.#nodes[i + 1]?.path.split('/').at(-1)
        const watcher = watch(fdPath(node.fd), { persistent: false }, (_event, name) => {
          if (next === undefined || name === null || name.toString() === next) changed()
        })
        watcher.on('error', changed)
        watchers.push(watcher)
      }
      this.verify(true)
      return watchers
    } catch (error) { for (const watcher of watchers) watcher.close(); throw error }
  }
  close() { for (const node of this.#nodes.splice(0).reverse()) closeSync(node.fd) }
  /** Only fixed or validated relative names; never follows an existing link. */
  mkdir(name: string): void {
    const parts = relativeParts(name)
    if (parts.length !== 1) fail('INVALID_INPUT')
    this.verify(false)
    mkdirSync(fdPath(this.fd, name), { mode: 0o700 })
    this.verify(false)
    fsyncSync(this.fd)
  }
  child(name: string): AuthDirectory {
    if (relativeParts(name).length !== 1) fail('INVALID_INPUT')
    this.verify(false)
    return AuthDirectory.open(join(this.path, name), true)
  }
  writeExclusive(name: string, bytes: Uint8Array): void {
    if (relativeParts(name).length !== 1) fail('INVALID_INPUT')
    this.verify(false)
    const fd = openSync(fdPath(this.fd, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try {
      let offset = 0
      while (offset < bytes.byteLength) { const n = writeSync(fd, bytes, offset); if (!n) fail('STORE_UNAVAILABLE'); offset += n }
      safeFile(stat(fd), bytes.byteLength)
      fsyncSync(fd)
    } finally { closeSync(fd) }
    this.verify(false); fsyncSync(this.fd)
  }
  read(name: string, maxBytes: number): Buffer {
    if (relativeParts(name).length !== 1) fail('INVALID_INPUT')
    this.verify(false)
    const path = fdPath(this.fd, name), before = lstatSync(path, { bigint: true })
    safeFile(before, maxBytes)
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const bytes = readBounded(fd, maxBytes)
      try {
        if (stamp(before) !== stamp(stat(fd)) || stamp(before) !== stamp(lstatSync(path, { bigint: true }))) fail('SOURCE_CHANGED')
        this.verify(false)
        return bytes
      } catch (error) { bytes.fill(0); throw error }
    } finally { closeSync(fd) }
  }
  replace(name: string, bytes: Uint8Array): void {
    if (relativeParts(name).length !== 1) fail('INVALID_INPUT')
    const temp = `write-${randomUUID()}.json`
    this.writeExclusive(temp, bytes)
    this.verify(false)
    // Both paths stay anchored to the same verified owned root. The old
    // registry is replaced only by a complete fsynced signed transaction.
    renameSync(fdPath(this.fd, temp), fdPath(this.fd, name))
    fsyncSync(this.fd); this.verify(false)
  }
  releaseLease(lock: AuthDirectory): void {
    this.verify(false)
    lock.verify(false)
    if (lock.path !== join(this.path, 'write-lease')) fail('STORE_UNAVAILABLE')
    renameSync(fdPath(this.fd, 'write-lease'), fdPath(this.fd, `released-lease-${randomUUID()}`))
    fsyncSync(this.fd)
  }
}
export function readBounded(fd: number, maxBytes: number): Buffer {
  safeFile(stat(fd), maxBytes)
  const bytes = Buffer.alloc(maxBytes + 1)
  try {
    let length = 0
    while (length < bytes.length) { const n = readSync(fd, bytes, length, bytes.length - length, null); if (!n) break; length += n }
    if (length > maxBytes || BigInt(length) !== stat(fd).size) fail('UNSAFE_SOURCE')
    return Buffer.from(bytes.subarray(0, length))
  } finally { bytes.fill(0) }
}

/** Caller owns the returned directory and must close it. No implicit recovery. */
export function createAuthDirectory(path: string): AuthDirectory {
  platformSupport()
  if (!isAbsolute(path) || resolve(path) !== path) fail('INVALID_INPUT')
  const parentPath = resolve(path, '..'), name = path.slice(parentPath === '/' ? 1 : parentPath.length + 1)
  const parent = AuthDirectory.open(parentPath)
  try { parent.mkdir(name); return AuthDirectory.open(path, true) } finally { parent.close() }
}
