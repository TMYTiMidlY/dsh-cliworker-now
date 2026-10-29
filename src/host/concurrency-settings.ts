import { constants, lstatSync, fstatSync, openSync, closeSync, readSync, writeFileSync, fsyncSync, renameSync, realpathSync, type Stats } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { MAX_CONCURRENCY } from '../shared/scheduling.ts'
export const concurrencyLimitSchema = z.number().int().min(1).max(MAX_CONCURRENCY)
const schema = z.object({ policy: z.literal(1), limit: concurrencyLimitSchema }).strict()
const unavailable = () => new Error('全局并发设置无法安全核验；未更改预算，请检查私有设置记录')
const stamp = (s: Stats) => [s.dev, s.ino, s.size, s.mode, s.uid, s.nlink, s.mtimeMs, s.ctimeMs].join(':')
const privateMode = (s: Stats) => process.platform === 'win32' || (s.mode & 0o077) === 0 && s.uid === process.getuid?.()
/** No credentials or user content. A malformed record is never treated as absence. */
export class ConcurrencySettings {
  private readonly root: string
  private readonly identity: string
  constructor(root: string) {
    this.root = root
    const info = lstatSync(root)
    if (!info.isDirectory() || info.isSymbolicLink() || !privateMode(info)) throw unavailable()
    this.identity = [info.dev, info.ino, realpathSync(root)].join(':')
  }
  private directory() {
    const info = lstatSync(this.root)
    if (!info.isDirectory() || info.isSymbolicLink() || !privateMode(info) ||
      [info.dev, info.ino, realpathSync(this.root)].join(':') !== this.identity) throw unavailable()
  }
  private record(): { value?: number; stamp?: string } {
    this.directory()
    const path = join(this.root, 'concurrency.json')
    let before: Stats
    try { before = lstatSync(path) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw unavailable()
    }
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 1024 || !privateMode(before)) throw unavailable()
    let fd: number | undefined
    const bytes = Buffer.alloc(1025)
    try {
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      const opened = fstatSync(fd)
      let length = 0
      while (length < bytes.length) { const n = readSync(fd, bytes, length, bytes.length - length, null); if (!n) break; length += n }
      if (length !== before.size || stamp(before) !== stamp(opened) || stamp(opened) !== stamp(fstatSync(fd)) || stamp(before) !== stamp(lstatSync(path))) throw unavailable()
      this.directory()
      return { value: schema.parse(JSON.parse(bytes.subarray(0, length).toString('utf8'))).limit, stamp: stamp(before) }
    } catch { throw unavailable() } finally { bytes.fill(0); if (fd !== undefined) closeSync(fd) }
  }
  read(): number | undefined { return this.record().value }
  save(input: number): void {
    const limit = concurrencyLimitSchema.parse(input)
    const prior = this.record()
    const path = join(this.root, 'concurrency.json'), temp = join(this.root, `concurrency-${randomUUID()}.tmp`)
    // A failed write leaves only an exclusive private staging record; never
    // remove an unknown path or overwrite an invalid target to repair it.
    const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try { writeFileSync(fd, JSON.stringify({ policy: 1, limit })); fsyncSync(fd) } finally { closeSync(fd) }
    this.directory()
    if (this.record().stamp !== prior.stamp) throw unavailable()
    renameSync(temp, path)
  }
}
