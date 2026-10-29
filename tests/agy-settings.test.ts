import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, symlink, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readAgySettings } from '../src/host/agy-settings.ts'
import { assertAgyNativeAccountRoute } from '../src/host/agy-models.ts'
import { localAccountIdentity } from '../src/host/account-identity.ts'
import * as strict from '../src/host/first-party-models.ts'

// Synthetic isolated fixture only; never touches a user's account or invokes a CLI.
let root: string, home: string, shared: string, alias: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cwn-agy-shared-settings-'))
  home = join(root, '.agy-homes/lxy')
  shared = join(root, '.gemini/antigravity-cli/settings.json')
  alias = join(home, '.gemini/antigravity-cli/settings.json')
  await mkdir(join(root, '.gemini/antigravity-cli'), { recursive: true })
  await mkdir(join(home, '.gemini/antigravity-cli'), { recursive: true })
  await writeFile(shared, '{"theme":"synthetic"}', { mode: 0o600 })
})
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) })

it('retains normal settings and missing-file behavior', async () => {
  expect(await readAgySettings(root, root)).toEqual({ theme: 'synthetic' })
  expect(await readAgySettings(home, root)).toEqual({})
})
it('allows exactly the lxy settings alias but not the generic reader', async () => {
  await symlink(shared, alias)
  expect(await readAgySettings(home, root)).toEqual({ theme: 'synthetic' })
  await expect(strict.readFirstPartyJson(alias)).rejects.toThrow('账号配置文件不可用')
})
it('refuses an arbitrary settings target', async () => {
  const other = join(root, 'other.json')
  await writeFile(other, '{}')
  await symlink(other, alias)
  await expect(readAgySettings(home, root)).rejects.toThrow('共享设置链接')
})
it('refuses the same target from an unrecognized account home', async () => {
  const otherHome = join(root, '.agy-homes/other')
  await mkdir(join(otherHome, '.gemini/antigravity-cli'), { recursive: true })
  await symlink(shared, join(otherHome, '.gemini/antigravity-cli/settings.json'))
  await expect(readAgySettings(otherHome, root)).rejects.toThrow('共享设置链接')
})
it('refuses a second-hop target symlink', async () => {
  const actual = join(root, 'actual.json')
  await writeFile(actual, '{}')
  await unlink(shared)
  await symlink(actual, shared)
  await symlink(shared, alias)
  await expect(readAgySettings(home, root)).rejects.toThrow('共享设置链接')
})
it('still rejects unsupported custom routes in shared settings', async () => {
  vi.stubEnv('HOME', root)
  await writeFile(shared, '{"modelProvider":"external-synthetic"}')
  await symlink(shared, alias)
  await expect(assertAgyNativeAccountRoute(new AbortController().signal, home)).rejects.toThrow('自定义模型来源')
})
it('does not extend the exception to credentials', async () => {
  const token = join(root, 'synthetic-token')
  await writeFile(token, JSON.stringify({auth_method:'consumer',token:{refresh_token:'synthetic'}}))
  await symlink(token, join(home, '.gemini/antigravity-cli/antigravity-oauth-token'))
  const identity = await localAccountIdentity({home})('antigravity', new AbortController().signal)
  expect(identity?.state).not.toBe('authenticated')
})
it('rejects replacing the alias while reading its allowed target', async () => {
  await symlink(shared, alias)
  const original = strict.readFirstPartyJson
  vi.spyOn(strict, 'readFirstPartyJson').mockImplementationOnce(async path => {
    const data = await original(path)
    await unlink(alias)
    await symlink(shared, alias)
    return data
  })
  await expect(readAgySettings(home, root)).rejects.toThrow('共享设置链接')
})
