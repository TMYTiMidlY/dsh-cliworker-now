import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNativeIO } from '../src/host/native-transport.mjs'
import { createNativeStopControl } from '../src/host/pi-omp-control.mjs'
import { runNativeMiniMax } from '../src/host/native-minimax.mjs'
import { projectMiniMaxAccountSettings } from '../src/host/native-auth-minimax-settings.ts'

const fixture = fileURLToPath(new URL('./fixtures/minimax-acp.mjs', import.meta.url))
const params = (scenario: string, continuation = false) => ({ cli: 'minimax', project: process.cwd(), argv: [fixture, 'acp'], prompt: 'SYNTHETIC ONLY',
  preference: { model: 'm:minimax:MiniMax-M3.1-Flash:u', effort: 'high' }, mode: 'accept-edits', timeoutMs: 1000,
  maxLineBytes: 1024 * 1024, maxRunBytes: 4 * 1024 * 1024, env: { MINIMAX_SYNTHETIC_SCENARIO: scenario },
  ...(continuation ? { conversationId: 'minimax-synthetic-process' } : {}) })
// The only subprocess below is our Node synthetic protocol fixture, NEVER a native CLI/model.
describe('MiniMax synthetic owned native runner', () => {
  it.each(['success', 'tool', 'cancel', 'rpc-error', 'nonzero', 'wrong-agent', 'unconfirmed-model', 'unconfirmed-permissionMode', 'unconfirmed-thinkingEffort', 'permission', 'fs', 'terminal', 'question', 'missing', 'empty', 'limit', 'drift', 'plan'])('confirms lifecycle, public data and outcome for %s', async scenario => {
    const controller = new AbortController(), frames: any[] = [], stderr: string[] = [], pids: number[] = []
    const config = params(scenario)
    const io = createNativeIO(config, (line: string) => { const f = JSON.parse(line); frames.push(f); if (scenario === 'cancel' && f.event?.kind === 'assistant') controller.abort() }, controller.signal, (chunk: Buffer) => stderr.push(String(chunk)))
    const open = io.openStdio.bind(io)
    io.openStdio = async (_argv: string[], options: any) => { const peer = await open([process.execPath, fixture, 'acp'], options); pids.push(peer.process.pid); return peer }
    let error
    try { await runNativeMiniMax(config, io) } catch(e) { error = e }
    await io.close(error)
    expect(frames.at(-1).status).toBe(['success', 'tool'].includes(scenario) ? 'SUCCESS' : scenario === 'empty' ? 'UNCERTAIN' : 'ERROR')
    expect(JSON.stringify({ frames, stderr })).not.toContain('PRIVATE_')
    expect(frames.some(f => f.type === 'native')).toBe(false)
    if (scenario === 'tool') expect(JSON.stringify(frames)).toContain('PUBLIC TOOL')
    for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow()
  })
  it('resumes exact ID/cwd and excludes history from this turn', async () => {
    const frames: any[] = [], config = params('success', true), controller = new AbortController()
    const io = createNativeIO(config, (line: string) => frames.push(JSON.parse(line)), controller.signal)
    const open = io.openStdio.bind(io)
    io.openStdio = (_argv: string[], options: any) => open([process.execPath, fixture, 'acp'], options)
    await runNativeMiniMax(config, io); await io.close()
    expect(frames.at(-1)).toMatchObject({ status: 'SUCCESS', response: 'HELLO SYNTHETIC' })
    expect(JSON.stringify(frames)).not.toContain('OLD HISTORY')
  })
  it('runs with exact current model/max without forbidden redundant setters', async () => {
    const frames: any[] = [], config = { ...params('exact-current'), preference: { ...params('exact-current').preference, effort: 'max' } }, controller = new AbortController()
    const io = createNativeIO(config, (line: string) => frames.push(JSON.parse(line)), controller.signal)
    const open = io.openStdio.bind(io); io.openStdio = (_argv: string[], options: any) => open([process.execPath, fixture, 'acp'], options)
    await runNativeMiniMax(config, io); await io.close()
    expect(frames.at(-1)).toMatchObject({ status: 'SUCCESS', response: 'HELLO SYNTHETIC' }); expect(JSON.stringify(frames)).not.toContain('PRIVATE_')
  })
  it.each(['success', 'private-profile-drift', 'private-wrong-version', 'private-missing-expectation'])('enforces fixed profile protection at Native spawn/init/prompt for %s', async scenario => {
    const root = mkdtempSync(resolve('.cache/minimax-profile-bridge-synthetic-')), settings = projectMiniMaxAccountSettings(undefined, 'cn')
    writeFileSync(join(root, 'config.yaml'), settings.bytes, { mode: 0o600 })
    const config: any = { ...params(scenario), minimaxProfile: { root, region: 'cn', configDigest: settings.digest, version: '0.6.12' },
      preference: { ...params(scenario).preference, authProfile: { id: 'ap_11111111-1111-4111-8111-111111111111', materialRevision: 'm_22222222-2222-4222-8222-222222222222' } },
      env: { ...params(scenario).env, MINIMAX_DATA_DIR: root, MAVIS_DATA_DIR: root, MAVIS_REGION: 'cn', MAVIS_BUILD_ENV: 'prod', SYNTHETIC_PROTECTION_ROOT: root } }
    if (scenario === 'private-missing-expectation') delete config.minimaxProfile
    const frames: any[] = [], methods: string[] = [], controller = new AbortController()
    const io = createNativeIO(config, (line: string) => frames.push(JSON.parse(line)), controller.signal)
    const open = io.openStdio.bind(io)
    io.openStdio = async (_argv: string[], options: any) => { const peer = await open([process.execPath, fixture, 'acp'], options), request = peer.request.bind(peer)
      peer.request = (method: string, ...args: any[]) => { methods.push(method); return request(method, ...args) }; return peer }
    let error: unknown
    try { await runNativeMiniMax(config, io) } catch (caught) { error = caught }
    await io.close(error)
    expect(frames.at(-1).status).toBe(scenario === 'success' ? 'SUCCESS' : 'ERROR')
    if (scenario !== 'success') expect(methods).not.toContain('session/prompt')
    if (scenario === 'private-wrong-version') expect(methods).toEqual(['initialize'])
    if (scenario === 'private-missing-expectation') expect(methods).toEqual([])
  })
  it('rejects planning before any spawn', async () => {
    let spawned = false
    await expect(runNativeMiniMax({ ...params('success'), mode: 'plan' }, { signal: new AbortController().signal, openStdio: () => { spawned = true } })).rejects.toThrow()
    expect(spawned).toBe(false)
  })
})

describe('Full native bridge private-wire policy (synthetic subprocesses only)', () => {
  it('checks the actual inherited environment when private request intentionally omits env', async () => {
    const root = mkdtempSync(resolve('.cache/minimax-inherited-env-synthetic-')), settings = projectMiniMaxAccountSettings(undefined, 'cn')
    writeFileSync(join(root, 'config.yaml'), settings.bytes, { mode: 0o600 })
    const control = await createNativeStopControl(join(root, 'stop')), request = join(root, 'request.json'), marker = join(root, 'spawn-marker')
    const config: any = { ...params('success'), preference: { ...params('success').preference, authProfile: { id: 'ap_11111111-1111-4111-8111-111111111111', materialRevision: 'm_22222222-2222-4222-8222-222222222222' } }, minimaxProfile: { root, region: 'cn', configDigest: settings.digest, version: '0.6.12' }, stopDirectory: join(root, 'stop'), stopNonce: control.nonce }
    delete config.env; writeFileSync(request, JSON.stringify(config), { mode: 0o600 }); chmodSync(fixture, 0o755)
    let stdout = ''
    const child = spawn(process.execPath, [fileURLToPath(new URL('../src/host/native-bridge.mjs', import.meta.url)), request], { env: { ...process.env, MINIMAX_DATA_DIR: root, MAVIS_DATA_DIR: root, MAVIS_REGION: 'en', MAVIS_BUILD_ENV: 'prod', SYNTHETIC_NATIVE_SPAWN_MARKER: marker, MINIMAX_SYNTHETIC_SCENARIO: 'success' }, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', chunk => { stdout += chunk }); child.stderr.resume()
    const code = await new Promise((ok, no) => { child.once('error', no); child.once('exit', ok) }); await control.close()
    expect(code).toBe(0); expect(stdout.trim().split('\n').map(line => JSON.parse(line)).at(-1).status).toBe('ERROR')
    expect(existsSync(marker)).toBe(false)
  })
  it('does not leak the host launcher ELECTRON_RUN_AS_NODE mode into the vendor child', async () => {
    const root = mkdtempSync(resolve('.cache/minimax-electron-flag-synthetic-')), settings = projectMiniMaxAccountSettings(undefined, 'cn')
    writeFileSync(join(root, 'config.yaml'), settings.bytes, { mode: 0o600 })
    const control = await createNativeStopControl(join(root, 'stop')), request = join(root, 'request.json'), dump = join(root, 'env-dump.json')
    const config: any = { ...params('success'), preference: { ...params('success').preference, authProfile: { id: 'ap_11111111-1111-4111-8111-111111111111', materialRevision: 'm_22222222-2222-4222-8222-222222222222' } }, minimaxProfile: { root, region: 'cn', configDigest: settings.digest, version: '0.6.12' }, env: { MINIMAX_DATA_DIR: root, MAVIS_DATA_DIR: root, MAVIS_REGION: 'cn', MAVIS_BUILD_ENV: 'prod' }, stopDirectory: join(root, 'stop'), stopNonce: control.nonce }
    writeFileSync(request, JSON.stringify(config), { mode: 0o600 }); chmodSync(fixture, 0o755)
    let stdout = ''
    const child = spawn(process.execPath, [fileURLToPath(new URL('../src/host/native-bridge.mjs', import.meta.url)), request], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SYNTHETIC_ENV_DUMP: dump, MINIMAX_SYNTHETIC_SCENARIO: 'success' }, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', chunk => { stdout += chunk }); child.stderr.resume()
    const code = await new Promise((ok, no) => { child.once('error', no); child.once('exit', ok) }); await control.close()
    expect(code).toBe(0); expect(stdout.trim().split('\n').map(line => JSON.parse(line)).at(-1).status).toBe('SUCCESS')
    expect(JSON.parse(readFileSync(dump, 'utf8'))).toEqual(['MAVIS_BUILD_ENV', 'MAVIS_DATA_DIR', 'MAVIS_REGION', 'MINIMAX_DATA_DIR', 'MINIMAX_SYNTHETIC_SCENARIO'])
  })
  it.each([['minimax', 'success'], ['minimax', 'rpc-error'], ['cursor', 'success'], ['cursor', 'rpc-error']])('no raw auth data escapes %s/%s including stderr', async (cli, scenario) => {
    const root = mkdtempSync(resolve('.cache/minimax-bridge-test-'))
    const control = await createNativeStopControl(join(root, 'stop'))
    const request = join(root, 'request.json')
    chmodSync(fixture, 0o755)
    const config = { ...params(scenario), cli,
      preference: cli === 'cursor' ? { model: 'default[]', effort: 'default' } : params(scenario).preference,
      stopDirectory: join(root, 'stop'), stopNonce: control.nonce }
    // Native child inherits test-only environment, not copied real credentials.
    writeFileSync(request, JSON.stringify(config), { mode: 0o600 })
    let stdout = '', stderr = ''
    const child = spawn(process.execPath, [fileURLToPath(new URL('../src/host/native-bridge.mjs', import.meta.url)), request], {
      env: { ...process.env, SYNTHETIC_CLI: cli, MINIMAX_SYNTHETIC_SCENARIO: scenario }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', chunk => { stdout += chunk }); child.stderr.on('data', chunk => { stderr += chunk })
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
    await control.close()
    expect(code).toBe(0)
    expect(stdout + stderr).not.toContain('PRIVATE_')
    const frames = stdout.trim().split('\n').map(line => JSON.parse(line))
    expect(frames.at(-1).status).toBe(scenario === 'success' ? 'SUCCESS' : 'ERROR')
    expect(frames.some(f => f.type === 'native')).toBe(false)
    if (scenario === 'success') expect(stdout).toContain('HELLO SYNTHETIC')
  })
})
