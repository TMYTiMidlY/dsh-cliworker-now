import { expect, it } from 'vitest'
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AuthDirectory, NativeAuthError, checkPaths, createAuthDirectory, platformSupport, safeDir, safeFile } from '../src/host/native-auth-files.ts'
import { NativeAuthStore } from '../src/host/native-auth-store.ts'
import { observeNativeAuthFiles } from '../src/host/native-auth-snapshot.ts'

const identity = { kind: 'native-principal' as const, value: 'SYNTHETIC_IDENTITY' }
function fixture() {
  mkdirSync('.cache', { recursive: true })
  return mkdtempSync(join(process.cwd(), '.cache/auth-profile-files-synthetic-'))
}
it.each(['win32', 'darwin', 'freebsd'] as const)('refuses unproved platform %s instead of loose secret permissions', platform => {
  expect(() => platformSupport(platform)).toThrowError('AUTH_UNSUPPORTED')
})
it('owner, hardlink, type and private mode are all necessary even when bytes appear valid', () => {
  const root = fixture(), path = join(root, 'auth.json')
  writeFileSync(path, 'SYNTHETIC_AUTH', { mode: 0o600 })
  const info = lstatSync(path, { bigint: true })
  expect(() => safeFile(info, 128)).not.toThrow()
  for (const change of [{ uid: info.uid + 1n }, { nlink: 2n }, { mode: (info.mode & ~0o777n) | 0o644n }, { size: 129n }, { isFile: () => false }]) {
    expect(() => safeFile(Object.assign(Object.create(Object.getPrototypeOf(info)), info, change), 128)).toThrowError('AUTH_UNSAFE_SOURCE')
  }
})
it('leaf directories require current UID; only non-leaf ancestors may be root-owned', () => {
  const info = lstatSync(fixture(), { bigint: true })
  const foreign = Object.assign(Object.create(Object.getPrototypeOf(info)), info, { uid: info.uid + 1n })
  expect(() => safeDir(foreign, true, true)).toThrowError('AUTH_UNSAFE_SOURCE')
  expect(() => safeDir(foreign, false, true)).toThrowError('AUTH_UNSAFE_SOURCE')
  const rootOwned = Object.assign(Object.create(Object.getPrototypeOf(info)), info, { uid: 0n })
  expect(() => safeDir(rootOwned, false, false)).not.toThrow()
  expect(() => safeDir(info, true, true)).not.toThrow()
})
it('non-adjacent lexicographic path prefixes are rejected before any material write', () => {
  expect(() => checkPaths(['a', 'a-x', 'a/b'])).toThrowError('AUTH_INVALID_INPUT')
  expect(() => checkPaths(['a/b', 'a/b-x', 'a/b/c'])).toThrowError('AUTH_INVALID_INPUT')
  expect(() => checkPaths(['a-x', 'a/b', 'a/c'])).not.toThrow()
})
it('directories/files are exclusive private writes, and failure never overwrites a prior file', () => {
  const root = join(fixture(), 'owned'), directory = createAuthDirectory(root)
  try {
    directory.writeExclusive('auth.json', Buffer.from('SYNTHETIC_FIRST'))
    expect(() => directory.writeExclusive('auth.json', Buffer.from('SYNTHETIC_SECOND'))).toThrow()
    expect(readFileSync(join(root, 'auth.json'), 'utf8')).toBe('SYNTHETIC_FIRST')
    expect(lstatSync(root).mode & 0o777).toBe(0o700)
    expect(lstatSync(join(root, 'auth.json')).mode & 0o777).toBe(0o600)
    expect(() => directory.writeExclusive('../escape', Buffer.from('SYNTHETIC'))).toThrowError('AUTH_INVALID_INPUT')
  } finally { directory.close() }
})
it('insecure source root/ancestor are rejected, not chmod-repaired', async () => {
  const root = fixture(), source = join(root, 'source'); mkdirSync(source, { mode: 0o700 })
  writeFileSync(join(source, 'auth.json'), 'SYNTHETIC', { mode: 0o600 })
  chmodSync(root, 0o777)
  await expect(observeNativeAuthFiles({ root: source, files: [{ path: 'auth.json', maxBytes: 128 }] }, async () => undefined)).rejects.toMatchObject({ code: 'UNSAFE_SOURCE' })
  expect(lstatSync(root).mode & 0o777).toBe(0o777)
})
it('snapshot cancellation during async schema validation wipes borrowed bytes', async () => {
  const root = fixture(), file = join(root, 'auth.json'), controller = new AbortController()
  writeFileSync(file, 'SYNTHETIC', { mode: 0o600 }); let borrowed!: Buffer
  await expect(observeNativeAuthFiles({ root, files: [{ path: 'auth.json', maxBytes: 128 }], signal: controller.signal }, async files => {
    borrowed = files.get('auth.json')!; controller.abort('SYNTHETIC_PRIVATE_REASON'); return true
  })).rejects.toMatchObject({ code: 'CANCELLED' })
  expect(borrowed.every(x => x === 0)).toBe(true)
})
it('request source identity and operation kind are bound to replay, with no adapter rerun', async () => {
  const root = join(fixture(), 'store'), store = NativeAuthStore.initialize(root); let called = 0
  const prepare = async () => { called++; return { identity, files: [{ path: 'auth.json', bytes: Buffer.from('SYNTHETIC') }] } }
  const input = { cli: 'codex' as const, label: 'Synthetic', requestId: 'source-1', sourceKey: 'SYNTHETIC_SOURCE_A' }
  const first = await store.import(input, prepare, async () => identity)
  expect(await NativeAuthStore.open(root).import(input, prepare, async () => identity)).toEqual(first)
  expect(called).toBe(1)
  await expect(store.import({ ...input, sourceKey: 'SYNTHETIC_SOURCE_B' }, prepare, async () => identity)).rejects.toMatchObject({ code: 'CONFLICT' })
  expect(called).toBe(1)
})
it.each(['empty', 'malformed', 'too-many', 'too-large', 'duplicate', 'nested-prefix'])('bad projected material %s yields a safe failure and no half publication', async kind => {
  const root = join(fixture(), 'store'), store = NativeAuthStore.initialize(root)
  const file = { path: 'auth.json', bytes: Buffer.from('SYNTHETIC') }
  const files = kind === 'empty' ? [] : kind === 'too-many' ? Array.from({ length: 17 }, (_, i) => ({ ...file, path: `file-${i}` }))
    : kind === 'too-large' ? [{ ...file, bytes: Buffer.alloc(1024 * 1024 + 1) }]
    : kind === 'duplicate' ? [file, file] : kind === 'nested-prefix' ? [file, { ...file, path: 'auth.json/child' }] : [file]
  await expect(store.import({ cli: 'codex', label: 'Synthetic', requestId: 'malformed' }, async () => kind === 'malformed' ? undefined as never : { identity, files }, async () => identity)).rejects.toBeInstanceOf(NativeAuthError)
  expect(NativeAuthStore.open(root).list()).toEqual([])
})
it('successful callback schema/projection does not authorize extra source files or recurse a HOME', async () => {
  const root = fixture(); writeFileSync(join(root, 'auth.json'), 'SYNTHETIC', { mode: 0o600 })
  mkdirSync(join(root, 'history'), { mode: 0o700 }); writeFileSync(join(root, 'history', 'private.txt'), 'SYNTHETIC_HISTORY_NOT_IMPORTED', { mode: 0o600 })
  const selected = await observeNativeAuthFiles({ root, files: [{ path: 'auth.json', maxBytes: 128 }] }, async files => [...files.keys()])
  expect(selected).toEqual({ verified: false, value: ['auth.json'] })
  expect(readdirSync(root)).toContain('history')
  const directory = AuthDirectory.open(root); directory.close()
})
