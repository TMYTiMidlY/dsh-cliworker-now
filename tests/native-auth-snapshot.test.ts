import { expect, it } from 'vitest'
import { chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { observeNativeAuthFiles, withNativeAuthSnapshot } from '../src/host/native-auth-snapshot.ts'
import { NativeAuthStore } from '../src/host/native-auth-store.ts'

const marker = 'SYNTHETIC_SECRET_MARKER_NOT_REAL'
function fixture() {
  mkdirSync('.cache', { recursive: true })
  const root = mkdtempSync(join(process.cwd(), '.cache/auth-profile-snapshot-synthetic-'))
  const source = join(root, 'source'); mkdirSync(source, { mode: 0o700 })
  writeFileSync(join(source, 'auth.json'), marker, { mode: 0o600 })
  writeFileSync(join(source, 'state.json'), 'SYNTHETIC_EPOCH_1', { mode: 0o600 })
  return { root, source }
}
const files = [{ path: 'auth.json', maxBytes: 128 }, { path: 'state.json', maxBytes: 128 }]

it('bounded mutually consistent bytes are owned copies, wiped after callback, without source mutation', async () => {
  const { source } = fixture(), before = lstatSync(join(source, 'auth.json'), { bigint: true })
  let retained!: Buffer
  const value = await observeNativeAuthFiles({ root: source, files }, async snapshot => {
    retained = snapshot.get('auth.json')!
    expect(retained.toString()).toBe(marker)
    expect(snapshot.size).toBe(2)
    return 'synthetic-safe-result'
  })
  expect(value).toEqual({ verified: false, value: 'synthetic-safe-result' }); expect(retained.every(x => x === 0)).toBe(true)
  expect(readFileSync(join(source, 'auth.json'), 'utf8')).toBe(marker)
  const after = lstatSync(join(source, 'auth.json'), { bigint: true })
  expect([after.ino, after.size, after.mtimeNs, after.ctimeNs]).toEqual([before.ino, before.size, before.mtimeNs, before.ctimeNs])
})

it.each(['symlink', 'hardlink', 'mode', 'directory', 'ancestor-symlink'])('rejects unsafe %s before returning any credential', async kind => {
  const { root, source } = fixture(), path = join(source, 'auth.json')
  if (kind === 'mode') chmodSync(path, 0o644)
  else if (kind === 'hardlink') linkSync(path, join(root, 'synthetic-link'))
  else if (kind === 'ancestor-symlink') { renameSync(source, join(root, 'retained-source')); symlinkSync(join(root, 'retained-source'), source) }
  else { renameSync(path, `${path}.retained`); if (kind === 'symlink') symlinkSync(`${path}.retained`, path); else mkdirSync(path, { mode: 0o700 }) }
  let called = false
  await expect(observeNativeAuthFiles({ root: source, files }, async () => { called = true })).rejects.toMatchObject({ code: 'UNSAFE_SOURCE' })
  expect(called).toBe(false)
})

it.each(['file-write', 'file-aba', 'parent-aba', 'epoch'])('rejects %s across the entire multi-file validation window', async kind => {
  const { source } = fixture()
  await expect(observeNativeAuthFiles({ root: source, files }, async () => {
    const auth = join(source, 'auth.json')
    if (kind === 'file-write') writeFileSync(auth, 'SYNTHETIC_CHANGED', { mode: 0o600 })
    if (kind === 'epoch') writeFileSync(join(source, 'state.json'), 'SYNTHETIC_EPOCH_2', { mode: 0o600 })
    if (kind === 'file-aba') { renameSync(auth, `${auth}.retained`); writeFileSync(auth, 'SYNTHETIC_B', { mode: 0o600 }); renameSync(auth, `${auth}.interloper`); renameSync(`${auth}.retained`, auth) }
    if (kind === 'parent-aba') { renameSync(source, `${source}.retained`); mkdirSync(source, { mode: 0o700 }); renameSync(source, `${source}.interloper`); renameSync(`${source}.retained`, source) }
    return 'must-not-publish'
  })).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
})

it.each(['too-large', 'total', 'missing', 'traversal', 'duplicate', 'prefix', 'abort'])('fails bounded/safe on %s', async kind => {
  const { source } = fixture()
  const selected = kind === 'too-large' ? [{ path: 'auth.json', maxBytes: 2 }]
    : kind === 'traversal' ? [{ path: '../auth.json', maxBytes: 128 }]
    : kind === 'duplicate' ? [files[0], files[0]]
    : kind === 'prefix' ? [files[0], { path: 'auth.json/nested', maxBytes: 128 }]
    : kind === 'missing' ? [{ path: 'missing.json', maxBytes: 128 }] : files
  await expect(observeNativeAuthFiles({ root: source, files: selected, maxTotalBytes: kind === 'total' ? 1 : undefined, signal: kind === 'abort' ? AbortSignal.abort(marker) : undefined }, async () => marker)).rejects.toBeDefined()
})

it('callback exceptions are fixed errors; no hostile marker, private path or raw cause escapes', async () => {
  const { source } = fixture()
  try { await observeNativeAuthFiles({ root: source, files }, async () => { throw new Error(`${marker} ${source}`) }); expect.unreachable() } catch (error) {
    expect(String(error)).toBe('NativeAuthError: AUTH_VALIDATION_FAILED')
    expect(JSON.stringify(error)).not.toContain(marker); expect(JSON.stringify(error)).not.toContain(source)
    expect(error).not.toHaveProperty('cause')
  }
})

it('strict snapshot refuses before borrowing bytes or invoking projection, including unknown source paths', async () => {
  const { source } = fixture(); let called = false
  for (const path of [source, join(source, 'SYNTHETIC_MISSING')]) {
    await expect(withNativeAuthSnapshot({ root: path, files }, async () => { called = true; return marker })).rejects.toMatchObject({ code: 'UNSUPPORTED' })
  }
  expect(called).toBe(false)
  expect(readFileSync(join(source, 'auth.json'), 'utf8')).toBe(marker)
})

it('unproved strict snapshots cannot publish a material or reach native validation', async () => {
  const { root, source } = fixture(), store = NativeAuthStore.initialize(join(root, 'store')); let verified = false
  await expect(store.import({ cli: 'minimax', label: 'Synthetic', requestId: 'strict-refusal' }, () => withNativeAuthSnapshot({ root: source, files }, async snapshot => ({
    identity: { kind: 'native-principal' as const, value: 'SYNTHETIC_PRINCIPAL' },
    files: [...snapshot].map(([path, bytes]) => ({ path, bytes: Buffer.from(bytes) })),
  })), async () => { verified = true; return { kind: 'native-principal', value: 'SYNTHETIC_PRINCIPAL' } })).rejects.toMatchObject({ code: 'UNSUPPORTED' })
  expect(verified).toBe(false)
  expect(NativeAuthStore.open(join(root, 'store')).list()).toEqual([])
  expect(readFileSync(join(source, 'auth.json'), 'utf8')).toBe(marker)
})
