import { afterEach, describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import { readCursorAccount } from '../src/host/cursor-accounts.ts'
import { readCliAccountBinding, CliAccountBindingError } from '../src/host/cli-account-binding.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'
// Synthetic identities and handles, never user profile/credentials or native CLI.
const marker = 'PRIVATE_cursor_endpoint_argv_userinfo'
const status = { status: 'authenticated', isAuthenticated: true, hasAccessToken: true, hasRefreshToken: true, userInfo: { userId: 71, email: 'synthetic@example.invalid' } }
const config = { ...DEFAULT_CONFIG, cursorExecutable: '/synthetic/cursor-agent' }
const driver = () => Object.assign(new Error(marker), { code: 'ENOENT', name: marker, cause: { marker } })
function fixture(o: { resolve?: 'sync' | 'async' | 'cleanup'; spawn?: boolean; cleanup?: boolean; raw?: string } = {}) {
  const backend: ProcessBackend = {
    resolveExecutable: vi.fn((name: string) => { if (o.resolve === 'sync') throw driver(); if (o.resolve === 'async') return Promise.reject(driver()); if (o.resolve === 'cleanup') return Promise.reject(new ProcessCleanupUnconfirmedError()); return Promise.resolve(name) }),
    spawn: vi.fn(() => { if (o.spawn) throw driver(); return { stdout: Readable.from([o.raw ?? JSON.stringify(status)]), stderr: Readable.from([marker]), done: Promise.resolve({ exitCode: 0 }), terminate: () => {}, waitForExit: async () => o.cleanup !== false } as any }),
  }
  return { backend, bind: (signal = new AbortController().signal) => readCliAccountBinding('cursor', backend, config, '/synthetic/project', signal) }
}
const caught = async (p: Promise<any>) => { try { await p; throw new Error('Expected rejection') } catch (e: any) { return e } }
afterEach(() => vi.unstubAllEnvs())
describe('Cursor preparation errors are safe process evidence, not logout', () => {
  it.each(['sync', 'async'] as const)('labels %s resolver failure, never spawning a status/model prompt', async resolve => {
    const f = fixture({ resolve }), e = await caught(f.bind())
    expect(e).toMatchObject({ name: 'CursorMetadataError', code: 'CLI_METADATA_QUERY_FAILED', phase: 'resolve', reason: 'ENOENT' })
    expect(String(e) + JSON.stringify(e)).not.toMatch(/PRIVATE_|登录|登出|额度/); expect(e.cause).toBeUndefined(); expect(f.backend.spawn).not.toHaveBeenCalled()
  })
  it('passes typed cleanup out of resolve without translating it to account failure', async () => {
    const f = fixture({ resolve: 'cleanup' }); expect(await caught(f.bind())).toBeInstanceOf(ProcessCleanupUnconfirmedError); expect(f.backend.spawn).not.toHaveBeenCalled()
  })
  it('has zero resolver/spawn calls for an already cancelled binding request', async () => {
    const f = fixture(), c = new AbortController(), reason = driver(); c.abort(reason)
    expect(await caught(f.bind(c.signal))).toBe(reason); expect(f.backend.resolveExecutable).not.toHaveBeenCalled(); expect(f.backend.spawn).not.toHaveBeenCalled()
  })
  it('passes trusted capture diagnostics through the binding wrapper without raw payload', async () => {
    const f = fixture({ spawn: true }), e = await caught(f.bind())
    expect(e).toMatchObject({ name: 'CursorMetadataError', phase: 'spawn', reason: 'ENOENT' }); expect(e).not.toBeInstanceOf(CliAccountBindingError)
    expect(String(e) + JSON.stringify(e)).not.toContain(marker)
  })
  it('does not let a forged diagnostic-looking driver payload bypass closed reasons/stages', async () => {
    const f = fixture(); f.backend.spawn = () => { throw { code: marker, phase: marker, reason: marker, message: marker, name: 'MetadataCaptureError' } }
    const e = await caught(f.bind()); expect(e).toMatchObject({ phase: 'spawn', reason: 'unknown' }); expect(String(e) + JSON.stringify(e)).not.toContain(marker)
  })
  it('retains real no-principal, malformed JSON and format error semantics', async () => {
    for (const raw of ['PRIVATE_INVALID_JSON', JSON.stringify({}), JSON.stringify({ status: 'unauthenticated', isAuthenticated: false, hasAccessToken: false, hasRefreshToken: false })]) {
      const f = fixture({ raw }), e = await caught(f.bind())
      expect(e.name).toBe('CursorAccountError'); expect(e.code).toBe('CLI_OWN_ACCOUNT_REQUIRED'); expect(String(e)).not.toContain('PRIVATE_')
    }
    const f = fixture(); expect((await readCursorAccount(f.backend, config, config.cursorExecutable, '/synthetic', new AbortController().signal)).identity.state).toBe('authenticated')
  })
  it('keeps cleanup priority even when stdout is unparseable', async () => {
    expect(await caught(fixture({ cleanup: false, raw: marker }).bind())).toBeInstanceOf(ProcessCleanupUnconfirmedError)
  })
})
