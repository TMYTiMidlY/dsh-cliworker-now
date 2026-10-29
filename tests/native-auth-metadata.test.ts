import { beforeAll, expect, it } from 'vitest'
import { chmodSync, closeSync, constants, linkSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { buildNativeAuthGuard } from '../scripts/build-native-auth-guard.mjs'
import { observeNativeAuthFiles, withNativeAuthSnapshot } from '../src/host/native-auth-snapshot.ts'

// Synthetic source bytes and retained artifacts only; no vendor CLI or auth.
type Metadata = { kind: 'absent'; path: string } | { kind: 'symlink'; path: string; target: string }
let assets = ''
const files = [{ path: 'auth.json', maxBytes: 128 }, { path: 'state.json', maxBytes: 128 }]
function fixture() {
  mkdirSync('.cache', { recursive: true })
  const root = mkdtempSync(join(process.cwd(), '.cache/auth-profile-metadata-synthetic-'))
  const source = join(root, 'source'); mkdirSync(source, { mode: 0o700 })
  writeFileSync(join(source, 'auth.json'), 'SYNTHETIC_METADATA_SECRET', { mode: 0o600 })
  writeFileSync(join(source, 'state.json'), 'SYNTHETIC_SETTINGS', { mode: 0o600 })
  return { root, source }
}
beforeAll(() => {
  const f = fixture(); assets = join(f.root, 'assets')
  buildNativeAuthGuard({ root: process.cwd(), outDir: assets })
})
const backend = () => ({ assetsDirectory: assets, timeoutMs: 3000 })
const input = (source: string, metadata: Metadata[]) => ({ root: source, files, metadata })

it('guards a missing leaf without reading it or rejecting unrelated sibling creation', async () => {
  const f = fixture()
  expect(await withNativeAuthSnapshot(input(f.source, [{ kind: 'absent', path: 'settings.json' }]), bytes => {
    expect([...bytes.keys()]).toEqual(['auth.json', 'state.json'])
    writeFileSync(join(f.source, 'unrelated.json'), 'SYNTHETIC_SIBLING', { mode: 0o600 })
    return 'SYNTHETIC_ABSENT_OK'
  }, backend())).toBe('SYNTHETIC_ABSENT_OK')
})
it.each(['file', 'dangling-link', 'directory'])('an absent declaration rejects an existing %s before callback', async kind => {
  const f = fixture(), path = join(f.source, 'settings.json'); let called = false
  if (kind === 'file') writeFileSync(path, 'SYNTHETIC_EXISTING', { mode: 0o600 })
  if (kind === 'dangling-link') symlinkSync('missing.json', path)
  if (kind === 'directory') mkdirSync(path, { mode: 0o700 })
  await expect(withNativeAuthSnapshot(input(f.source, [{ kind: 'absent', path: 'settings.json' }]), () => { called = true }, backend())).rejects.toMatchObject({ code: 'UNSAFE_SOURCE' })
  expect(called).toBe(false)
})
it.each(['missing-parent', 'file-parent'])('absence does not swallow %s as a missing leaf', async kind => {
  const f = fixture(); let called = false
  if (kind === 'file-parent') writeFileSync(join(f.source, 'parent'), 'SYNTHETIC_NOT_DIRECTORY', { mode: 0o600 })
  await expect(withNativeAuthSnapshot(input(f.source, [{ kind: 'absent', path: 'parent/settings.json' }]), () => { called = true }, backend())).rejects.toMatchObject({ code: 'UNSAFE_SOURCE' })
  expect(called).toBe(false)
})
it('raw name events reject absent create-and-remove ABA without deleting artifacts', async () => {
  const f = fixture(), path = join(f.source, 'settings.json')
  await expect(withNativeAuthSnapshot(input(f.source, [{ kind: 'absent', path: 'settings.json' }]), () => {
    writeFileSync(path, 'SYNTHETIC_TEMPORARY_SETTINGS', { mode: 0o600 })
    renameSync(path, join(f.source, 'retained-settings.json'))
    return 'MUST_NOT_PUBLISH'
  }, backend())).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
})
it.each(['absolute', 'relative'])('guards a %s link to an explicitly selected regular file', async kind => {
  const f = fixture(); symlinkSync(kind === 'absolute' ? join(f.source, 'state.json') : 'state.json', join(f.source, 'settings.json'))
  expect(await withNativeAuthSnapshot(input(f.source, [{ kind: 'symlink', path: 'settings.json', target: 'state.json' }]), bytes => {
    expect(bytes.has('settings.json')).toBe(false)
    expect(bytes.get('state.json')!.toString()).toBe('SYNTHETIC_SETTINGS')
    return 'SYNTHETIC_ALIAS_OK'
  }, backend())).toBe('SYNTHETIC_ALIAS_OK')
})
it.each(['wrong-target', 'noncanonical', 'regular', 'multi-hop'])('rejects %s settings metadata before callback', async kind => {
  const f = fixture(), path = join(f.source, 'settings.json'); let called = false
  if (kind === 'wrong-target') symlinkSync('auth.json', path)
  if (kind === 'noncanonical') symlinkSync('./state.json', path)
  if (kind === 'regular') writeFileSync(path, 'SYNTHETIC_NOT_LINK', { mode: 0o600 })
  if (kind === 'multi-hop') { symlinkSync('state.json', join(f.source, 'hop.json')); symlinkSync('hop.json', path) }
  await expect(withNativeAuthSnapshot(input(f.source, [{ kind: 'symlink', path: 'settings.json', target: 'state.json' }]), () => { called = true }, backend())).rejects.toMatchObject({ code: 'UNSAFE_SOURCE' })
  expect(called).toBe(false)
})
it('a link target must be a regular file selected in the same guard', async () => {
  const f = fixture(); let called = false
  writeFileSync(join(f.source, 'unselected.json'), 'SYNTHETIC_UNSELECTED', { mode: 0o600 })
  symlinkSync('unselected.json', join(f.source, 'settings.json'))
  await expect(withNativeAuthSnapshot(input(f.source, [{ kind: 'symlink', path: 'settings.json', target: 'unselected.json' }]), () => { called = true }, backend())).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  expect(called).toBe(false)
})
it.each(['same-target-replacement', 'original-inode-aba', 'metadata-only-ancestor-aba'])('raw metadata watch rejects %s', async kind => {
  const f = fixture(); mkdirSync(join(f.source, 'alias'), { mode: 0o700 })
  const path = join(f.source, 'alias/settings.json'); symlinkSync('../state.json', path)
  await expect(withNativeAuthSnapshot(input(f.source, [{ kind: 'symlink', path: 'alias/settings.json', target: 'state.json' }]), () => {
    if (kind === 'same-target-replacement') { symlinkSync('../state.json', `${path}.new`); renameSync(`${path}.new`, path) }
    if (kind === 'original-inode-aba') {
      renameSync(path, `${path}.retained`); symlinkSync('../state.json', path)
      renameSync(path, `${path}.interloper`); renameSync(`${path}.retained`, path)
    }
    if (kind === 'metadata-only-ancestor-aba') {
      const dir = join(f.source, 'alias'); renameSync(dir, `${dir}.retained`)
      mkdirSync(dir, { mode: 0o700 }); renameSync(dir, `${dir}.interloper`); renameSync(`${dir}.retained`, dir)
    }
    return 'MUST_NOT_PUBLISH'
  }, backend())).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
})
it('the selected target still has a real read lease, not just metadata checks', async () => {
  const f = fixture(); symlinkSync('state.json', join(f.source, 'settings.json'))
  await expect(withNativeAuthSnapshot(input(f.source, [{ kind: 'symlink', path: 'settings.json', target: 'state.json' }]), () => {
    let fd: number | undefined
    try { fd = openSync(join(f.source, 'state.json'), constants.O_WRONLY | constants.O_TRUNC | constants.O_NONBLOCK) }
    catch (error) { expect(['EAGAIN', 'EWOULDBLOCK']).toContain((error as NodeJS.ErrnoException).code) }
    finally { if (fd !== undefined) closeSync(fd) }
    return 'MUST_NOT_PUBLISH'
  }, backend())).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
  expect(readFileSync(join(f.source, 'state.json'), 'utf8')).toBe('SYNTHETIC_SETTINGS')
})
it('caller mutation cannot remove an already selected absent dependency', async () => {
  const f = fixture(), metadata: Metadata[] = [{ kind: 'absent', path: 'settings.json' }]
  await expect(withNativeAuthSnapshot(input(f.source, metadata), () => {
    metadata[0].path = 'unrelated.json'; metadata.length = 0
    writeFileSync(join(f.source, 'settings.json'), 'SYNTHETIC_CREATED', { mode: 0o600 })
    renameSync(join(f.source, 'settings.json'), join(f.source, 'retained-settings.json'))
    return 'MUST_NOT_PUBLISH'
  }, backend())).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
})
it.each(['duplicate', 'prefix', 'unknown-kind', 'unknown-field', 'too-many'])('rejects invalid combined selection: %s', async kind => {
  const f = fixture(); let called = false
  const metadata: any[] = kind === 'duplicate' ? [{ kind: 'absent', path: 'auth.json' }]
    : kind === 'prefix' ? [{ kind: 'absent', path: 'auth.json/child' }]
    : kind === 'unknown-kind' ? [{ kind: 'optional', path: 'settings.json' }]
    : kind === 'unknown-field' ? [{ kind: 'absent', path: 'settings.json', ignoreChanges: true }]
    : Array.from({ length: 16 }, (_, i) => ({ kind: 'absent', path: `missing-${i}.json` }))
  await expect(withNativeAuthSnapshot(input(f.source, metadata), () => { called = true }, backend())).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  expect(called).toBe(false)
})
it('unverified observation refuses unsupported metadata instead of silently ignoring it', async () => {
  const f = fixture(); let called = false
  await expect(observeNativeAuthFiles(input(f.source, [{ kind: 'absent', path: 'settings.json' }]), () => { called = true })).rejects.toMatchObject({ code: 'UNSUPPORTED' })
  expect(called).toBe(false)
})
it.each(['hardlinked-alias', 'writable-parent', 'unsafe-target'])('refuses unsafe metadata dependency: %s', async kind => {
  const f = fixture(); let called = false
  mkdirSync(join(f.source, 'alias'), { mode: 0o700 })
  const path = join(f.source, 'alias/settings.json'); symlinkSync('../state.json', path)
  if (kind === 'hardlinked-alias') linkSync(path, `${path}.hardlink`)
  if (kind === 'writable-parent') chmodSync(join(f.source, 'alias'), 0o777)
  if (kind === 'unsafe-target') chmodSync(join(f.source, 'state.json'), 0o644)
  await expect(withNativeAuthSnapshot(input(f.source, [{ kind: 'symlink', path: 'alias/settings.json', target: 'state.json' }]), () => { called = true }, backend())).rejects.toMatchObject({ code: 'UNSAFE_SOURCE' })
  expect(called).toBe(false)
})
it('caller selection changes during spawn cannot redirect regular byte keys, limits or metadata', async () => {
  const f = fixture(), other = fixture(), selection = {
    root: f.source, files: files.map(file => ({ ...file })),
    metadata: [{ kind: 'absent' as const, path: 'settings.json' }],
  }
  expect(await withNativeAuthSnapshot(selection, bytes => {
    expect([...bytes.keys()]).toEqual(['auth.json', 'state.json'])
    expect(bytes.get('auth.json')!.toString()).toBe('SYNTHETIC_METADATA_SECRET')
    return 'SYNTHETIC_FIXED_SELECTION'
  }, { ...backend(), spawn: (file, args, options) => {
    selection.root = other.source; selection.files[0].path = 'redirected.json'; selection.files[0].maxBytes = 1
    selection.metadata[0].path = 'unrelated.json'; selection.metadata.length = 0
    return spawn(file, args, options)
  } })).toBe('SYNTHETIC_FIXED_SELECTION')
})
it('metadata ABA after real helper READY is rejected before validation callback', async () => {
  const f = fixture(); let changed = false, called = false
  await expect(withNativeAuthSnapshot(input(f.source, [{ kind: 'absent', path: 'settings.json' }]), () => { called = true }, {
    ...backend(), spawn: (file, args, options) => {
      const child = spawn(file, args, options)
      child.stdout!.prependListener('data', chunk => {
        if (!changed && String(chunk).includes(' READY 0\n')) {
          changed = true
          writeFileSync(join(f.source, 'settings.json'), 'SYNTHETIC_DURING_READ_WINDOW', { mode: 0o600 })
          renameSync(join(f.source, 'settings.json'), join(f.source, 'retained-settings.json'))
        }
      })
      return child
    },
  })).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
  expect(changed).toBe(true); expect(called).toBe(false)
})
it.each(['valid-utf8', 'invalid-utf8'])('compares actual link bytes, including %s under a Unicode root', async kind => {
  const f = fixture(), source = join(f.root, 'source-\uFFFD'); mkdirSync(source, { mode: 0o700 })
  writeFileSync(join(source, 'auth.json'), 'SYNTHETIC_METADATA_SECRET', { mode: 0o600 })
  writeFileSync(join(source, 'state.json'), 'SYNTHETIC_SETTINGS', { mode: 0o600 })
  const canonical = Buffer.from(join(source, 'state.json')), offset = canonical.indexOf(Buffer.from('\uFFFD'))
  expect(offset).toBeGreaterThan(-1)
  const text = kind === 'valid-utf8' ? canonical : Buffer.concat([canonical.subarray(0, offset), Buffer.from([0xff]), canonical.subarray(offset + 3)])
  symlinkSync(text, join(source, 'settings.json')); let called = false
  const work = withNativeAuthSnapshot(input(source, [{ kind: 'symlink', path: 'settings.json', target: 'state.json' }]), () => { called = true; return 'SYNTHETIC_UNICODE_OK' }, backend())
  if (kind === 'valid-utf8') { expect(await work).toBe('SYNTHETIC_UNICODE_OK'); expect(called).toBe(true) }
  else { await expect(work).rejects.toMatchObject({ code: 'UNSAFE_SOURCE' }); expect(called).toBe(false) }
})
it('a successful explicit seal ends the metadata sampling window, not a registry transaction', async () => {
  const f = fixture()
  expect(await withNativeAuthSnapshot(input(f.source, [{ kind: 'absent', path: 'settings.json' }]), async (_bytes, guard) => {
    await guard.seal()
    writeFileSync(join(f.source, 'settings.json'), 'SYNTHETIC_AFTER_SEAL', { mode: 0o600 })
    return 'SYNTHETIC_SEALED'
  }, backend())).toBe('SYNTHETIC_SEALED')
})
