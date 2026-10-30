import { expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, lstatSync, readdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { MiniMaxAuthRefreshGroups } from '../src/host/native-auth-minimax-refresh.ts'
import { NativeAuthError } from '../src/host/native-auth-files.ts'
import { ProcessCleanupUnconfirmedError } from '../src/host/process.ts'

// Synthetic operations and opaque groups only: not Native processes, tokens,
// actual refresh-family detection, owned cleanup or real CLI integration.
const A = 'a'.repeat(64), B = 'b'.repeat(64)
function fixture() {
  mkdirSync('.cache', { recursive: true })
  const parent = mkdtempSync(join(process.cwd(), '.cache/auth-minimax-refresh-synthetic-'))
  const root = join(parent, 'groups'), groups = MiniMaxAuthRefreshGroups.initialize(root)
  return { parent, root, groups }
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void
  const promise = new Promise<T>((ok, bad) => { resolve = ok; reject = bad })
  return { promise, resolve, reject }
}
it('holds one group across the entire async operation and excludes a second manager', async () => {
  const f = fixture(), task = deferred<string>(), entered = deferred<void>()
  const first = f.groups.run(A, async () => { entered.resolve(); return task.promise })
  await entered.promise
  const blocked = vi.fn(async () => 'WRONG')
  await expect(MiniMaxAuthRefreshGroups.open(f.root).run(A, blocked)).rejects.toMatchObject({ code: 'BUSY' })
  expect(blocked).not.toHaveBeenCalled()
  expect(await f.groups.run(B, async () => 'other group')).toBe('other group')
  task.resolve('done'); expect(await first).toBe('done')
  expect(await MiniMaxAuthRefreshGroups.open(f.root).run(A, async () => 'next')).toBe('next')
})
it('normal callback failure releases only its own settled group', async () => {
  const f = fixture(), error = new Error('SYNTHETIC_CALLBACK_FAILURE')
  await expect(f.groups.run(A, async () => { throw error })).rejects.toBe(error)
  expect(await f.groups.run(A, async () => 2)).toBe(2)
})
it.each(['auth', 'process'] as const)('persists %s cleanup uncertainty and refuses reuse after cold open', async kind => {
  const f = fixture(), error = kind === 'auth' ? new NativeAuthError('CLEANUP_UNCONFIRMED') : new ProcessCleanupUnconfirmedError()
  await expect(f.groups.run(A, async () => { throw error })).rejects.toBe(error)
  const blocked = vi.fn(async () => 'WRONG')
  await expect(MiniMaxAuthRefreshGroups.open(f.root).run(A, blocked)).rejects.toMatchObject({ code: 'CLEANUP_UNCONFIRMED' })
  expect(blocked).not.toHaveBeenCalled()
  expect(await f.groups.run(B, async () => 'different')).toBe('different')
})
it('does not quarantine a spoofed cleanup error name/code', async () => {
  const f = fixture(), error = Object.assign(new Error('SYNTHETIC_SPOOF'), { name: 'ProcessCleanupUnconfirmedError', code: 'CLI_CLEANUP_UNCONFIRMED' })
  await expect(f.groups.run(A, async () => { throw error })).rejects.toBe(error)
  expect(await f.groups.run(A, async () => 1)).toBe(1)
})
it('a caller abort cannot release the group while its operation is still pending', async () => {
  const f = fixture(), abort = new AbortController(), entered = deferred<void>(), task = deferred<void>()
  const first = f.groups.run(A, async () => { entered.resolve(); await task.promise }, abort.signal)
  await entered.promise; abort.abort()
  await expect(f.groups.run(A, async () => 'WRONG')).rejects.toMatchObject({ code: 'BUSY' })
  task.resolve(); await first
  expect(await f.groups.run(A, async () => 1)).toBe(1)
})
it('pre-abort performs no Native work or group acquisition', async () => {
  const f = fixture(), abort = new AbortController(); abort.abort()
  const work = vi.fn(async () => 'WRONG')
  await expect(f.groups.run(A, work, abort.signal)).rejects.toMatchObject({ code: 'CANCELLED' })
  expect(work).not.toHaveBeenCalled(); expect(readdirSync(f.root)).toEqual(['policy.json'])
})
it.each(['../other', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)])('rejects an untrusted group selector %s before creating resources', async group => {
  const f = fixture(), work = vi.fn(async () => 'WRONG')
  await expect(f.groups.run(group, work)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  expect(work).not.toHaveBeenCalled(); expect(readdirSync(f.root)).toEqual(['policy.json'])
})
it('does not follow an existing group directory link', async () => {
  const f = fixture(), other = join(f.parent, 'unrelated'); mkdirSync(other, { mode: 0o700 })
  symlinkSync(other, join(f.root, `g_${A}`))
  const work = vi.fn(async () => 'WRONG')
  await expect(f.groups.run(A, work)).rejects.toBeInstanceOf(NativeAuthError)
  expect(work).not.toHaveBeenCalled(); expect(readdirSync(other)).toEqual([])
})
it('creates private group/lease files and retains released control records without deleting data', async () => {
  const f = fixture()
  await f.groups.run(A, async () => {
    expect(lstatSync(join(f.root, `g_${A}`)).mode & 0o777).toBe(0o700)
    expect(lstatSync(join(f.root, `g_${A}`, 'write-lease')).mode & 0o777).toBe(0o700)
    expect(lstatSync(join(f.root, `g_${A}`, 'write-lease', 'state.json')).mode & 0o777).toBe(0o600)
  })
  const names = readdirSync(join(f.root, `g_${A}`))
  expect(names).toHaveLength(1); expect(names[0]).toMatch(/^released-lease-/)
})
