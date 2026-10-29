// Build-time ONLY. Never imported by Host runtime; no runtime compiler fallback.
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export function buildNativeAuthGuard({ root, outDir, platform = process.platform, arch = process.arch }) {
  const source = join(resolve(root), 'src/host/native-auth-guard.c'), output = resolve(outDir)
  // A failed/repeated narrow build must not overwrite any prior asset set.
  mkdirSync(output, { mode: 0o700 })
  // Source/ABI manifest is auditable package data, never credentials.
  copyFileSync(source, join(output, 'native-auth-guard.c'))
  chmodSync(join(output, 'native-auth-guard.c'), 0o600)
  const manifest = { schema: 1, protocol: 1, platform, arch, sourceSha256: hash(readFileSync(source)), supported: false }
  const glibc = process.report?.getReport().header.glibcVersionRuntime
  if (platform === 'linux' && arch === 'x64' && typeof glibc === 'string') {
    const binary = join(output, 'guard-linux-x64')
    execFileSync('/usr/bin/cc', [
      '-std=c11', '-O2', '-Wall', '-Wextra', '-Wpedantic', '-Werror', '-fPIE', '-pie',
      '-fstack-protector-strong', '-D_FORTIFY_SOURCE=2', '-Wl,-z,relro,-z,now,-z,noexecstack',
      source, '-o', binary,
    ], { stdio: 'pipe', env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TMPDIR: output } })
    chmodSync(binary, 0o700)
    Object.assign(manifest, { supported: true, libc: 'glibc', buildGlibc: glibc, binarySha256: hash(readFileSync(binary)) })
  }
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest) + '\n', { mode: 0o600, flag: 'wx' })
  return manifest
}
