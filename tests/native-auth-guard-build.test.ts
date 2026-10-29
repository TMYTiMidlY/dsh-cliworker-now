import { beforeAll, expect, it } from 'vitest'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildNativeAuthGuard } from '../scripts/build-native-auth-guard.mjs'
import { withNativeAuthSnapshot } from '../src/host/native-auth-snapshot.ts'

// Narrow helper/ABI assets only, not an application build or installation.
const require = createRequire(import.meta.url)
let root = '', assets = '', source = '', lib = ''
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
beforeAll(() => {
  mkdirSync('.cache', { recursive: true }); root = mkdtempSync(join(process.cwd(), '.cache/auth-profile-build-synthetic-'))
  lib = join(root, 'synthetic-package', 'lib'); mkdirSync(lib, { recursive: true, mode: 0o700 })
  source = join(root, 'source'); mkdirSync(source, { mode: 0o700 }); writeFileSync(join(source, 'auth.json'), 'SYNTHETIC_BUILD_CREDENTIAL', { mode: 0o600 })
  assets = join(lib, 'native-auth-snapshot'); buildNativeAuthGuard({ root: process.cwd(), outDir: assets })
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--ignoreConfig', '--types', 'node', '--target', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--skipLibCheck', '--rewriteRelativeImportExtensions', '--rootDir', 'src', '--outDir', join(lib, 'types'),
    'src/host/native-auth-files.ts', 'src/host/native-auth-kernel.ts', 'src/host/native-auth-snapshot.ts'], { cwd: process.cwd() })
  // Exercise the bundled-entry import.meta layout without a full bundle build.
  copyFileSync(join(lib, 'types/host/native-auth-kernel.js'), join(lib, 'index.js'))
  copyFileSync(join(lib, 'types/host/native-auth-files.js'), join(lib, 'native-auth-files.js'))
})
function compiled(entry: string, expected = 'SYNTHETIC_COMPILED_OK') {
  const code = `const m=await import(process.argv[1]);const fn=m.withNativeAuthSnapshot??m.strictNativeAuthSnapshot;try{await fn({root:process.argv[2],files:[{path:'auth.json',maxBytes:128}]},async b=>{if(b.get('auth.json').toString()!=='SYNTHETIC_BUILD_CREDENTIAL')throw Error('synthetic');return true});console.log('SYNTHETIC_COMPILED_OK')}catch(e){console.log(e.code)}`
  expect(execFileSync(process.execPath, ['--input-type=module', '-e', code, pathToFileURL(entry).href, source], { encoding: 'utf8' }).trim()).toBe(expected)
}
it('auditable source, ABI manifest and executable binary hashes match, and a repeat build never overwrites', () => {
  const manifest = JSON.parse(readFileSync(join(assets, 'manifest.json'), 'utf8'))
  expect(manifest).toMatchObject({ schema: 1, protocol: 1, platform: 'linux', arch: 'x64', libc: 'glibc', supported: true })
  expect(manifest.sourceSha256).toBe(hash(readFileSync('src/host/native-auth-guard.c')))
  expect(manifest.binarySha256).toBe(hash(readFileSync(join(assets, 'guard-linux-x64'))))
  expect(statSync(join(assets, 'guard-linux-x64')).mode & 0o777).toBe(0o700)
  expect(() => buildNativeAuthGuard({ root: process.cwd(), outDir: assets })).toThrow()
  expect(hash(readFileSync(join(assets, 'guard-linux-x64')))).toBe(manifest.binarySha256)
})
it.each(['types/host/native-auth-snapshot.js', 'index.js'])('real emitted package layout resolves exactly its own assets: %s', entry => { compiled(join(lib, entry)) })
it('corrupt primary assets never execute a valid adjacent package or typed-local alternative', () => {
  const adjacent = join(root, 'native-auth-snapshot'), typedLocal = join(lib, 'types/host/native-auth-snapshot')
  buildNativeAuthGuard({ root: process.cwd(), outDir: adjacent }); buildNativeAuthGuard({ root: process.cwd(), outDir: typedLocal })
  const manifestPath = join(assets, 'manifest.json'), original = readFileSync(manifestPath)
  writeFileSync(manifestPath, 'SYNTHETIC_CORRUPT_PACKAGE_MANIFEST', { mode: 0o600 })
  try { compiled(join(lib, 'index.js'), 'UNSUPPORTED'); compiled(join(lib, 'types/host/native-auth-snapshot.js'), 'UNSUPPORTED') }
  finally { writeFileSync(manifestPath, original, { mode: 0o600 }) }
})
it('helper-only tar/extraction preserves owner execute permission and is runtime usable', async () => {
  const archive = join(root, 'synthetic-helper-assets.tar'), extracted = join(root, 'extracted-assets'); mkdirSync(extracted, { mode: 0o700 })
  execFileSync('/usr/bin/tar', ['-cf', archive, '-C', assets, 'manifest.json', 'native-auth-guard.c', 'guard-linux-x64'])
  execFileSync('/usr/bin/tar', ['-xf', archive, '-C', extracted])
  expect(statSync(join(extracted, 'guard-linux-x64')).mode & 0o777).toBe(0o700)
  expect(await withNativeAuthSnapshot({ root: source, files: [{ path: 'auth.json', maxBytes: 128 }] }, async () => 'SYNTHETIC_TAR_OK', { assetsDirectory: extracted })).toBe('SYNTHETIC_TAR_OK')
})
it('unsupported build targets ship only explicit unsupported ABI metadata and source', async () => {
  const target = join(root, 'unsupported-assets')
  expect(buildNativeAuthGuard({ root: process.cwd(), outDir: target, platform: 'darwin', arch: 'arm64' })).toMatchObject({ supported: false, platform: 'darwin' })
  await expect(withNativeAuthSnapshot({ root: source, files: [{ path: 'auth.json', maxBytes: 128 }] }, async () => true, { assetsDirectory: target })).rejects.toMatchObject({ code: 'UNSUPPORTED' })
})
it('typecheck-only returns before helper compile, and preview stages the builder', () => {
  const build = readFileSync('scripts/build.mjs', 'utf8'), preview = readFileSync('scripts/build-preview.mjs', 'utf8')
  expect(build.indexOf('process.exit(0)')).toBeLessThan(build.indexOf('buildNativeAuthGuard({'))
  expect(preview).toContain("'scripts/build-native-auth-guard.mjs'")
  expect(JSON.parse(readFileSync('package.json', 'utf8')).files).toContain('lib')
})
it('ASan/UBSan instrumented self-authored helper passes the real guard protocol', async () => {
  const target = join(root, 'sanitized-assets'); mkdirSync(target, { mode: 0o700 })
  copyFileSync(join(assets, 'native-auth-guard.c'), join(target, 'native-auth-guard.c'))
  const binary = join(target, 'guard-linux-x64')
  execFileSync('/usr/bin/cc', ['-std=c11', '-O1', '-g', '-Wall', '-Wextra', '-Wpedantic', '-Werror', '-fno-omit-frame-pointer', '-fsanitize=address,undefined', 'src/host/native-auth-guard.c', '-o', binary], { env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TMPDIR: target } })
  chmodSync(binary, 0o700)
  const manifest = JSON.parse(readFileSync(join(assets, 'manifest.json'), 'utf8')); manifest.binarySha256 = hash(readFileSync(binary))
  writeFileSync(join(target, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 })
  expect(await withNativeAuthSnapshot({ root: source, files: [{ path: 'auth.json', maxBytes: 128 }] }, async () => 'SYNTHETIC_SANITIZED_OK', { assetsDirectory: target })).toBe('SYNTHETIC_SANITIZED_OK')
})
