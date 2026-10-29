import { homedir } from 'node:os'
import { lstat, readlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Stats } from 'node:fs'
import { readFirstPartyJson } from './first-party-models.ts'
import { safePiOmpAncestors } from './pi-omp-native.ts'

const same = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino &&
  a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs &&
  a.uid === b.uid && a.mode === b.mode && a.nlink === b.nlink
const owned = (s: Stats) => process.getuid === undefined || s.uid === process.getuid()
const unavailable = () => new Error('Antigravity 共享设置链接不受支持或读取期间已变化；未修改账号')

/** Settings-only exception for the documented lxy HOME; never used to read credentials. */
export async function readAgySettings(home = homedir(), parentHome = homedir()): Promise<Record<string, any>> {
  const path = join(home, '.gemini', 'antigravity-cli', 'settings.json')
  let link: Stats
  try { link = await lstat(path) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return readFirstPartyJson(path)
    throw error
  }
  if (!link.isSymbolicLink()) return readFirstPartyJson(path)
  // Do not generalize the exception to arbitrary aliases, accounts, or token files.
  if (resolve(home) !== resolve(parentHome, '.agy-homes', 'lxy') || !owned(link) || link.nlink !== 1)
    throw unavailable()
  await safePiOmpAncestors(dirname(path))
  const destination = join(parentHome, '.gemini', 'antigravity-cli', 'settings.json')
  const targetText = await readlink(path)
  if (resolve(dirname(path), targetText) !== resolve(destination)) throw unavailable()
  const target = await lstat(destination)
  if (!target.isFile() || target.isSymbolicLink() || target.nlink !== 1 || !owned(target)) throw unavailable()
  // The allowed target still receives the existing bounded, no-follow, stable-read checks.
  const settings = await readFirstPartyJson(destination)
  const [afterLink, afterTarget, afterText] = await Promise.all([
    lstat(path), lstat(destination), readlink(path),
  ])
  if (!same(link, afterLink) || !same(target, afterTarget) || targetText !== afterText) throw unavailable()
  return settings
}
