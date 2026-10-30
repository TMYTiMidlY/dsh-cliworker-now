import { beforeAll, afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { PassThrough, Writable } from 'node:stream'
import { buildNativeAuthGuard } from '../scripts/build-native-auth-guard.mjs'
import { NativeAuthStore, miniMaxAccountProfileIdentity } from '../src/host/native-auth-store.ts'
import { MiniMaxAuthRefreshGroups } from '../src/host/native-auth-minimax-refresh.ts'
import { MiniMaxNativeTargetVerifier } from '../src/host/native-auth-minimax-target.ts'
import { projectMiniMaxAccountSettings } from '../src/host/native-auth-minimax-settings.ts'
import { miniMaxIdentityPrincipal } from '../src/host/minimax-identity.ts'
import { DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'

// Real private store and Linux config/auth guards. All OAuth/UID/ACP responses
// and builtin records are SYNTHETIC: no vendor process/model/network is used.
let assets = ''
const parent = () => { mkdirSync('.cache', { recursive: true }); return mkdtempSync(join(process.cwd(), '.cache/auth-minimax-target-synthetic-')) }
beforeAll(() => { const p = parent(); assets = join(p, 'assets'); buildNativeAuthGuard({ root: process.cwd(), outDir: assets }) })
afterEach(() => vi.unstubAllEnvs())
const principal = miniMaxIdentityPrincipal('SYNTHETIC_TARGET_UID')!
const token = 'SYNTHETIC_OLD_ACCESS', nextToken = 'SYNTHETIC_NEW_ACCESS'
const rows = {
  mavis: undefined,
  explore: ['bash', 'read', 'grep', 'glob', 'web_fetch'],
  worker: ['read', 'write', 'edit', 'bash', 'task_query', 'task_output', 'task_stop', 'grep', 'glob', 'todowrite', 'web_fetch', 'website_deploy'],
  verifier: ['read', 'grep', 'glob', 'bash', 'task_query', 'task_output', 'task_stop', 'web_fetch'],
}
function generated(root: string) {
  for (const [name, tools] of Object.entries(rows)) {
    const dir = join(root, 'agents/.builtin', name); mkdirSync(dir, { recursive: true, mode: 0o700 })
    const value = { name, description: 'SYNTHETIC_GENERATED', features: { mavis: name === 'mavis' || name === 'worker', delegation: name === 'mavis', webSearch: true }, ...(tools ? { tools } : {}), ...(['explore', 'verifier'].includes(name) ? { skills: [] } : {}) }
    writeFileSync(join(dir, 'agent.md'), `---\n${JSON.stringify(value)}\n---\nSYNTHETIC_NOT_NATIVE_PROMPT\n`, { mode: 0o600 })
  }
}
function fixture(scenario = 'success') {
  const root = parent(), store = NativeAuthStore.initialize(join(root, 'store')), groups = MiniMaxAuthRefreshGroups.initialize(join(root, 'groups'))
  const workspace = join(root, 'verification-workspace'); mkdirSync(workspace, { mode: 0o700 })
  if (scenario === 'dirty-workspace') writeFileSync(join(workspace, 'SYNTHETIC_PROJECT_RULES.md'), 'SYNTHETIC_UNEXPECTED_CONTEXT', { mode: 0o600 })
  const settings = projectMiniMaxAccountSettings(Buffer.from('{"dataContribution":{"enabled":false},"memory":{"enabled":false}}'), 'cn')
  const identity = miniMaxAccountProfileIdentity(principal, 'cn', settings.digest)
  const group = (identity as any).identityPolicy.refreshGroup
  let nativeRoot = '', authPath = '', statePath = '', credential: any, state: any, key = '', exits = 0
  const calls: any[] = [], frames: any[] = [], authorizations: string[] = []
  const config = { ...DEFAULT_CONFIG, minimaxExecutable: '/SYNTHETIC_MCODE', timeoutMs: 1000, graceMs: 10 }
  const fetchImpl = vi.fn(async (_url: any, input: any) => {
    authorizations.push(input.headers.Authorization)
    if (scenario === 'late-custom' && authorizations.length === 2) mkdirSync(join(nativeRoot, 'agents/SYNTHETIC_LATE_CUSTOM'), { mode: 0o700 })
    return new Response(JSON.stringify({ data: { userInfo: { realUserID: scenario === 'wrong-uid' ? 'SYNTHETIC_OTHER_UID' : 'SYNTHETIC_TARGET_UID' } } }))
  })
  const backend: ProcessBackend = {
    resolveExecutable: async name => name,
    spawn(spec) {
      calls.push(spec)
      const stdout = new PassThrough(), stderr = new PassThrough(); let doneResolve!: (value: any) => void
      const done = new Promise<any>(ok => { doneResolve = ok })
      const finish = () => { stdout.end(); stderr.end(); doneResolve({ exitCode: 0, signal: null }) }
      const stdin = new Writable({ write(chunk, _encoding, next) {
        const request = JSON.parse(String(chunk)); frames.push(request)
        queueMicrotask(() => {
          let result: any
          if (request.method === 'initialize') result = { protocolVersion: 1, agentInfo: { name: 'minimax-code', version: scenario === 'wrong-version' ? '9.9.9' : '0.6.12' }, agentCapabilities: { loadSession: true } }
          else {
            generated(nativeRoot)
            if (scenario === 'refresh') {
              credential = { ...credential, accessToken: nextToken, generation: 2, expiresAtMs: Date.now() + 600000 }
              state = { ...state, generation: 2, expiresAtMs: credential.expiresAtMs }
              for (const [p, value] of [[authPath, { schemaVersion: 1, records: { [key]: credential } }], [statePath, state]] as const) {
                writeFileSync(p + '.synthetic-new', JSON.stringify(value), { mode: 0o600 }); renameSync(p + '.synthetic-new', p)
              }
            }
            if (scenario === 'config-aba') {
              const p = join(nativeRoot, 'config.yaml'); renameSync(p, p + '.retained')
              writeFileSync(p, '{}', { mode: 0o600 }); renameSync(p, p + '.interloper')
            }
            if (scenario === 'vendor-normalize' || scenario === 'vendor-drift') {
              // mcode 0.6.12 rewrites the config to its own serialization during
              // ACP startup, re-adding the provider advertisement.
              const owned = scenario === 'vendor-drift' ? { enabled: true } : { enabled: false }
              const p = join(nativeRoot, 'config.yaml')
              writeFileSync(p + '.synthetic-new', JSON.stringify({ logLevel: 'info', permissionMode: 'default', dataContribution: owned, memory: { enabled: false }, skipWindowsHardSafetyChecks: false, skipParentDeathGuard: false, defaultModel: 'minimax/MiniMax-M3.1-Flash', provider: { minimax: { options: { apiKey: 'sk-xxx', baseURL: 'https://agent.minimaxi.com/mavis/api/v1/llm/v1' } } } }), { mode: 0o600 })
              renameSync(p + '.synthetic-new', p)
            }
            if (scenario === 'permission-aba') {
              // Remains present at the postcondition: the PRE/POST guard design
              // cannot see a transient create+remove during the owned range
              // (the vendor legitimately rewrites its config there); a grant
              // that persists to publication must still be rejected.
              const p = join(nativeRoot, 'permission.json'); writeFileSync(p, '{}', { mode: 0o600 })
            }
            result = { sessionId: 'SYNTHETIC_SESSION', modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }] }, configOptions: [
              { id: 'model', category: 'model', type: 'select', currentValue: 'm:minimax:SYNTHETIC_MODEL:u', options: [{ value: 'm:minimax:SYNTHETIC_MODEL:u', name: 'Synthetic' }] },
              { id: 'permissionMode', category: '_permission', type: 'select', currentValue: 'default', options: [{ value: 'default', name: 'Ask' }], _meta: { 'minimax-code/scope': 'process' } },
            ] }
          }
          stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n')
        }); next()
      } })
      return { stdin, stdout, stderr, done, terminate() { exits++; finish() }, waitForExit: async () => scenario !== 'cleanup' } as any
    },
  }
  const verifier = new MiniMaxNativeTargetVerifier({ backend, config, executable: config.minimaxExecutable, workspace, identity: { fetchImpl }, snapshotBackend: { assetsDirectory: assets, timeoutMs: 5000 } })
  const run = () => groups.run(group, () => store.import({ cli: 'minimax', label: 'Synthetic target', requestId: 'target-1' }, async context => {
    nativeRoot = context.nativeRoot; const prefix = 'auth/prod/cn/mcode-public'
    key = `com.minimax.mcode.oauth.prod.cn\0${createHash('sha256').update(join(nativeRoot, 'auth') + '\0mcode-public').digest('base64url')}`
    const common = { clientId: 'mcode-public', audience: 'agent-backend', scopes: ['agent.default'], generation: 1, expiresAtMs: Date.now() + (['refresh', 'still-expired'].includes(scenario) ? -1000 : 600000) }
    credential = { schemaVersion: 1, tokenType: 'Bearer', accessToken: token, refreshToken: 'SYNTHETIC_REFRESH', ...common }
    state = { schemaVersion: 2, status: 'authenticated', storeKind: 'file', buildEnv: 'prod', region: 'cn', ...common }
    authPath = join(nativeRoot, prefix, 'auth.json'); statePath = join(nativeRoot, prefix, 'auth-state.json')
    const configBytes = scenario === 'bad-config' ? Buffer.from('{"permissionMode":"bypassPermissions"}') : settings.bytes
    return { identity, files: [{ path: `${prefix}/auth.json`, bytes: Buffer.from(JSON.stringify({ schemaVersion: 1, records: { [key]: credential } })) }, { path: `${prefix}/auth-state.json`, bytes: Buffer.from(JSON.stringify(state)) }, { path: 'config.yaml', bytes: configBytes }] }
  }, context => verifier.verify(context, new AbortController().signal)))
  return { root, store, groups, group, run, calls, frames, authorizations, fetchImpl, exits: () => exits, nativeRoot: () => nativeRoot }
}
it('uses fixed protected target metadata and fresh UID before publication, without a prompt', async () => {
  const f = fixture(), descriptor = await f.run()
  expect(f.store.list()).toEqual([descriptor]); expect(f.calls).toHaveLength(1); expect(f.exits()).toBe(1)
  expect(f.calls[0].env.MAVIS_REGION).toBe('cn'); expect(f.calls[0].env.MINIMAX_DATA_DIR).toBe(f.nativeRoot())
  expect(f.authorizations).toEqual([`Bearer ${token}`, `Bearer ${token}`]); expect(f.frames.some(frame => frame.method === 'session/prompt')).toBe(false)
})
it('allows Native to renew expired target A before any UID request and accepts only its fresh result', async () => {
  const f = fixture('refresh'); await f.run()
  expect(f.authorizations).toEqual([`Bearer ${nextToken}`]); expect(f.exits()).toBe(1)
  expect(JSON.parse(readFileSync(join(f.nativeRoot(), 'auth/prod/cn/mcode-public/auth-state.json'), 'utf8')).generation).toBe(2)
})
it.each(['bad-config', 'wrong-uid', 'dirty-workspace'])('rejects %s before any Native metadata process', async kind => {
  const f = fixture(kind); await expect(f.run()).rejects.toMatchObject({ code: kind === 'wrong-uid' ? 'IDENTITY_MISMATCH' : 'UNSUPPORTED' })
  expect(f.calls).toEqual([]); expect(f.store.list()).toEqual([])
})
it.each(['still-expired', 'wrong-version', 'config-aba', 'permission-aba', 'late-custom'])('rejects target %s with no publication', async kind => {
  const f = fixture(kind); await expect(f.run()).rejects.toBeInstanceOf(Error)
  expect(f.store.list()).toEqual([]); expect(f.calls).toHaveLength(1); expect(f.exits()).toBeGreaterThanOrEqual(1)
  if (kind === 'wrong-version') expect(f.frames.map(frame => frame.method)).toEqual(['initialize'])
  if (kind === 'still-expired') expect(f.fetchImpl).not.toHaveBeenCalled()
})
it('accepts the vendor config normalization that mcode performs during ACP startup', async () => {
  const f = fixture('vendor-normalize'), descriptor = await f.run()
  expect(f.store.list()).toEqual([descriptor]); expect(f.exits()).toBe(1)
  expect(JSON.parse(readFileSync(join(f.nativeRoot(), 'config.yaml'), 'utf8')).permissionMode).toBe('default')
})
it('rejects a vendor-form rewrite that flips an owned privacy field', async () => {
  const f = fixture('vendor-drift'); await expect(f.run()).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' })
  expect(f.store.list()).toEqual([]); expect(f.exits()).toBe(1)
})
it('preserves genuine metadata cleanup uncertainty and the persistent group barrier', async () => {
  const f = fixture('cleanup'); await expect(f.run()).rejects.toMatchObject({ code: 'CLEANUP_UNCONFIRMED' })
  await expect(MiniMaxAuthRefreshGroups.open(join(f.root, 'groups')).run(f.group, async () => 'WRONG')).rejects.toMatchObject({ code: 'CLEANUP_UNCONFIRMED' })
  expect(f.store.list()).toEqual([])
})
it('refuses builtin-assets environment override without touching target credentials or Native', async () => {
  vi.stubEnv('MAVIS_BUILTIN_AGENTS_V2_DIR', '/SYNTHETIC_FOREIGN_ASSETS')
  const f = fixture(); await expect(f.run()).rejects.toMatchObject({ code: 'UNSUPPORTED' })
  expect(f.fetchImpl).not.toHaveBeenCalled(); expect(f.calls).toEqual([])
})
