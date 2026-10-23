import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { resolveKimiCredential, kimiDeclaredEnvironment, assertKimiEnvironment } from '../src/host/kimi-credentials.ts'
import { readKimiAccount } from '../src/host/kimi-accounts.ts'
import { parseKimiModelSources, kimiModelEnvironment, firstPartyEnvironment } from '../src/host/first-party-models.ts'
import { readCliAccountBinding } from '../src/host/cli-account-binding.ts'
import { prepareNativeWorker } from '../src/host/native-worker.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'
import { WorkerRuntime } from '../src/host/runtime.ts'
import { WorkerStorage } from '../src/host/storage.ts'
import { AccountManager } from '../src/host/accounts.ts'
import { ACCOUNT_CHANGED } from '../src/host/authorized-catalog.ts'

// Synthetic Kimi 2.2.0 contracts only: no native CLI, credential file, model or HTTP request.
// Generated private fixture roots remain under ignored .cache; no user files are removed.
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
const signal = () => new AbortController().signal
const ownKey = 'synthetic-private-own-key'
const otherKey = 'synthetic-private-other-key'
const raw = (provider: Record<string, unknown>) => ({
  providers: { own: { type: 'kimi', baseUrl: 'https://synthetic.example.invalid/v1', ...provider } },
  models: { alias: { provider: 'own', model: 'synthetic-model' } },
})
const status = (provider: Record<string, unknown>, env: NodeJS.ProcessEnv = {}) =>
  readKimiAccount(JSON.stringify(raw(provider)), signal(), { env, home: '/synthetic/no-real-credentials' })

describe('Kimi native explicit credential classifier (synthetic)', () => {
  it.each([
    ['kimi', 'KIMI_API_KEY'], ['openai', 'OPENAI_API_KEY'], ['openai_responses', 'OPENAI_API_KEY'],
    ['anthropic', 'ANTHROPIC_API_KEY'], ['google-genai', 'GOOGLE_API_KEY'],
  ])('uses the exact %s provider config-env key %s', async (type, name) => {
    const provider = { type, env: { [name]: `  ${ownKey}  ` } }
    expect(resolveKimiCredential(provider, {})).toEqual({ kind: 'api', source: 'provider-env', key: ownKey })
    const result = await status(provider)
    expect(result).toMatchObject({ state: 'configured', verification: 'local', authMethod: 'api' })
    expect(JSON.stringify(result)).not.toContain(ownKey)
    if (type !== 'google-genai') {
      const sources = parseKimiModelSources(raw(provider), '/synthetic/config.toml', {})
      expect(sources[0]?.credential).toEqual({ type: 'api', key: ownKey })
    }
  })
  it.each(['openai', 'openai_responses', 'anthropic', 'vertexai', 'unknown'])('does not borrow a Kimi config key for %s', async type => {
    const provider = { type, env: { KIMI_API_KEY: otherKey } }
    expect(resolveKimiCredential(provider, { OPENAI_API_KEY: ownKey, KIMI_API_KEY: ownKey }).kind).toBe('none')
    expect((await status(provider)).state).toBe('unconfigured')
    expect(parseKimiModelSources(raw(provider), '/synthetic', {})).toEqual([])
  })
  it('does not use any undeclared ambient provider key', () => {
    expect(resolveKimiCredential({ type: 'openai' }, { OPENAI_API_KEY: ownKey }).kind).toBe('none')
  })
  it('normalizes declared inline values and gives them native precedence', () => {
    expect(resolveKimiCredential({ type: 'kimi', apiKey: ` ${ownKey} `, env: { KIMI_API_KEY: otherKey } }, {}))
      .toEqual({ kind: 'api', source: 'inline', key: ownKey })
    expect(resolveKimiCredential({ type: 'kimi', apiKey: ' ', apiKeyEnv: ' ', env: { KIMI_API_KEY: ownKey } }, {}).kind).toBe('api')
  })
  it.each(['$KEY', '{env:KEY}', '!command', 'your_key'])('never falls back from a selected rejected inline value %s', value => {
    expect(resolveKimiCredential({ type: 'kimi', apiKey: value, env: { KIMI_API_KEY: otherKey } }, {}).kind).toBe('invalid')
    expect(parseKimiModelSources(raw({ apiKey: value, env: { KIMI_API_KEY: otherKey } }), '/synthetic', {})).toEqual([])
  })
  it('preserves Google first-raw-hit then trim semantics without inventing vertexai mapping', () => {
    expect(resolveKimiCredential({ type: 'google-genai', env: { VERTEXAI_API_KEY: ' ', GOOGLE_API_KEY: ownKey } }, {}).kind).toBe('none')
    expect(resolveKimiCredential({ type: 'google-genai', env: { VERTEXAI_API_KEY: ownKey, GOOGLE_API_KEY: otherKey } }, {}))
      .toMatchObject({ kind: 'api', key: ownKey })
    expect(resolveKimiCredential({ type: 'vertexai', env: { VERTEXAI_API_KEY: ownKey } }, {}).kind).toBe('none')
  })
  it.each([
    { apiKey: ownKey, apiKeyEnv: 'EXPLICIT' },
    { apiKey: '$PLACEHOLDER', apiKeyEnv: 'EXPLICIT' },
    { apiKey: ownKey, oauth: {} },
    { apiKeyEnv: 'EXPLICIT', oauth: {} },
    { env: { KIMI_API_KEY: ownKey }, oauth: {} },
  ])('rejects native credential conflicts before selecting any fallback: %j', async provider => {
    expect(resolveKimiCredential({ type: 'kimi', ...provider }, { EXPLICIT: otherKey }).kind).toBe('conflict')
    expect((await status(provider, { EXPLICIT: otherKey })).state).toBe('unavailable')
    expect(parseKimiModelSources(raw(provider), '/synthetic', { EXPLICIT: otherKey })).toEqual([])
  })
  it('does not invent shell expansion or accept snake-case TOML as CLI metadata', () => {
    expect(resolveKimiCredential({ type: 'kimi', api_key: ownKey }, {}).kind).toBe('none')
    expect(resolveKimiCredential({ type: 'kimi', apiKeyEnv: '$EXPLICIT' }, { EXPLICIT: ownKey }).kind).toBe('unresolved')
  })
})

describe('Kimi declared environment references and privacy (synthetic)', () => {
  it('reads only the exact declared variable, not config-env or other Host secrets', async () => {
    const provider = { apiKeyEnv: ' EXPLICIT ', env: { KIMI_API_KEY: otherKey } }
    const env = { EXPLICIT: ` ${ownKey} `, UNRELATED_TOKEN: otherKey }
    expect(resolveKimiCredential(provider, env)).toMatchObject({ kind: 'api', source: 'declared-env', key: ownKey, reference: 'EXPLICIT' })
    expect(kimiDeclaredEnvironment(raw(provider), env)).toEqual({ EXPLICIT: ownKey })
    const sources = parseKimiModelSources(raw(provider), '/synthetic', env)
    expect(kimiModelEnvironment(sources, 'alias')).toEqual({ EXPLICIT: ownKey })
    expect(sources[0]?.credential).toEqual({ type: 'api', key: ownKey })
    expect(sources[0]?.sourceIds).toContain('native:kimi:declared-env:EXPLICIT')
    const safe = await status(provider, env)
    expect(safe).toMatchObject({ state: 'configured', authMethod: 'api', verification: 'local' })
    expect(JSON.stringify(safe)).not.toMatch(/synthetic-private|EXPLICIT|apiKeyEnv|environment/)
  })
  it.each([undefined, '', '   '])('missing or empty declared value %j remains configured but cannot bind or fall back', async value => {
    const provider = { apiKeyEnv: 'EXPLICIT', env: { KIMI_API_KEY: otherKey } }, env = { EXPLICIT: value }
    expect(resolveKimiCredential(provider, env).kind).toBe('unresolved')
    expect((await status(provider, env)).state).toBe('configured')
    expect(parseKimiModelSources(raw(provider), '/synthetic', env)).toEqual([])
    expect(kimiDeclaredEnvironment(raw(provider), env)).toEqual({})
  })
  it.each(['DSH_PRIVATE_TOKEN', 'CLIWORKER_HARNESS_TOOLS', 'ELECTRON_RUN_AS_NODE', 'electron_run_as_node', 'Electron_Run_As_Node', 'bad=name', 'bad\0name'])('does not restore reserved or unsafe reference %s', name => {
    const provider = { apiKeyEnv: name }
    expect(resolveKimiCredential(provider, { [name]: ownKey }).kind).toBe('unsupported')
    expect(kimiDeclaredEnvironment(raw(provider), { [name]: ownKey })).toEqual({})
  })
  it('restores only the selected model reference and refuses ambiguous or absent model sources', () => {
    const metadata = raw({ apiKeyEnv: 'EXPLICIT' }) as any
    metadata.providers.other = { type: 'openai', apiKeyEnv: 'OTHER', baseUrl: 'https://other.example.invalid/v1' }
    metadata.models.otherAlias = { provider: 'other', model: 'other-model' }
    const sources = parseKimiModelSources(metadata, '/synthetic', { EXPLICIT: ownKey, OTHER: otherKey })
    expect(kimiModelEnvironment(sources, 'alias')).toEqual({ EXPLICIT: ownKey })
    expect(kimiModelEnvironment(sources, 'otherAlias')).toEqual({ OTHER: otherKey })
    expect(() => kimiModelEnvironment(sources, 'missing')).toThrow('凭据配置')
    expect(() => kimiModelEnvironment([...sources, sources[0]!], 'alias')).toThrow('凭据配置')
  })
  it('rejects model-level credential references rather than binding a provider fallback', () => {
    const metadata = raw({ apiKey: ownKey }) as any
    metadata.models.alias.apiKeyEnv = 'MODEL_ONLY'
    expect(parseKimiModelSources(metadata, '/synthetic', { MODEL_ONLY: otherKey })).toEqual([])
  })
  it('bounds terminal environment aggregation and never partially returns an overbudget map', () => {
    const metadata: any = { providers: {} }, env: NodeJS.ProcessEnv = {}
    for (let i = 0; i < 65; i++) { metadata.providers[i] = { apiKeyEnv: `DECLARED_${i}` }; env[`DECLARED_${i}`] = ownKey }
    expect(() => kimiDeclaredEnvironment(metadata, env)).toThrow('凭据配置')
    expect(() => kimiDeclaredEnvironment(raw({ apiKeyEnv: 'BIG' }), { BIG: 'a'.repeat(65536) })).toThrow('凭据配置')
  })
  it('consistently refuses native global model overlays, without suppressing user settings', async () => {
    const env = { KIMI_MODEL_NAME: 'synthetic-global-override' }
    expect(() => assertKimiEnvironment(env)).toThrow('全局环境模型覆盖')
    expect(() => parseKimiModelSources(raw({ apiKey: ownKey }), '/synthetic', env)).toThrow('全局环境模型覆盖')
    expect((await status({ apiKey: ownKey }, env)).state).toBe('unavailable')
    vi.stubEnv('KIMI_MODEL_NAME', env.KIMI_MODEL_NAME)
    expect(() => firstPartyEnvironment('kimi')).toThrow('全局环境模型覆盖')
    expect(firstPartyEnvironment('claude')).toEqual({})
  })
  it('does not treat unmanaged OAuth as logged out or read another slot as authenticated', async () => {
    expect((await status({ oauth: { storage: 'file', key: 'not-managed' } })).state).toBe('unknown')
  })
})

function bindingFixture(metadata: ReturnType<typeof raw>) {
  const root = mkdtempSync(join(process.cwd(), '.cache/kimi-credentials-synthetic-'))
  const home = join(root, 'native-home')
  vi.stubEnv('KIMI_CODE_HOME', home)
  const backend: ProcessBackend = {
    resolveExecutable: async () => process.execPath,
    spawn: () => ({ stdin: new PassThrough(), stdout: Readable.from([JSON.stringify(metadata)]), stderr: Readable.from([]),
      done: Promise.resolve({ exitCode: 0, signal: null }), terminate() {}, waitForExit: async () => true }),
  }
  return { root, home, backend, config: { ...DEFAULT_CONFIG, kimiExecutable: process.execPath } }
}

function runtimeFixture(aba: boolean) {
  const metadata = raw({ apiKeyEnv: 'SYNTHETIC_EXPLICIT_KEY' }), f = bindingFixture(metadata)
  vi.stubEnv('SYNTHETIC_EXPLICIT_KEY', ownKey)
  const fetch = vi.fn(async (url: unknown, options: RequestInit = {}) => {
    expect(String(url)).toBe('https://synthetic.example.invalid/v1/models')
    expect(new Headers(options.headers).get('authorization')).toBe(`Bearer ${ownKey}`)
    return new Response(JSON.stringify({ data: [{ id: 'synthetic-model' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetch)
  const bridges: Parameters<ProcessBackend['spawn']>[0][] = [], requests: unknown[] = []
  let preparing = false, capturedB = false, restoredA = false
  const backend: ProcessBackend = {
    resolveExecutable: async () => {
      if (aba && capturedB && !restoredA) { vi.stubEnv('SYNTHETIC_EXPLICIT_KEY', ownKey); restoredA = true }
      return process.execPath
    },
    spawn(spec) {
      const bridge = spec.argv.some(value => value.replaceAll('\\', '/').endsWith('/native-bridge.mjs'))
      if (bridge) { bridges.push(spec); requests.push(JSON.parse(readFileSync(spec.argv.at(-1)!, 'utf8'))) }
      else {
        expect(spec.argv.slice(1)).toEqual(['provider', 'list', '--json'])
        if (preparing) capturedB = true
      }
      const payload = bridge ? [
        { type: 'session', id: 'synthetic-session', model: 'alias' },
        { type: 'event', event: { kind: 'assistant', step: 0, text: 'Synthetic native answer' } },
        { type: 'result', status: 'SUCCESS', response: 'Synthetic native answer' },
      ].map(value => JSON.stringify(value) + '\n').join('') : JSON.stringify(metadata)
      return { stdin: new PassThrough(), stdout: Readable.from([payload]), stderr: Readable.from([]),
        done: Promise.resolve({ exitCode: 0, signal: null }), terminate() {}, waitForExit: async () => true }
    },
  }
  const storage = new WorkerStorage(join(f.root, 'state')), runtime = new WorkerRuntime(storage, backend, f.config)
  if (aba) runtime.setHarnessPreparation(async () => {
    preparing = true
    vi.stubEnv('SYNTHETIC_EXPLICIT_KEY', otherKey)
    return { close: async () => {} }
  })
  return { ...f, backend, runtime, storage, bridges, requests, restored: () => restoredA }
}

it.each([false, true])('real runtime pins the private prepared Kimi source, A→B→A=%s (synthetic backend)', async aba => {
  const f = runtimeFixture(aba)
  try {
    const result = await f.runtime.submit('synthetic-parent', f.root, 'Synthetic Kimi credential contract',
      'Synthetic greeting only', { cli: 'kimi', model: 'alias', effort: 'default' }, 'accept-edits').done
    if (aba) {
      expect(f.restored()).toBe(true)
      expect(result).toMatchObject({ status: 'failed', error: expect.stringContaining(ACCOUNT_CHANGED) })
      expect(f.bridges).toHaveLength(0)
    } else {
      expect(result).toMatchObject({ status: 'completed', transport: 'kimi-acp-v1' })
      expect(f.bridges).toHaveLength(1)
      expect(f.bridges[0]?.env).toMatchObject({ SYNTHETIC_EXPLICIT_KEY: ownKey })
      expect(JSON.stringify(f.requests)).not.toMatch(/synthetic-private|SYNTHETIC_EXPLICIT_KEY/)
    }
    expect(JSON.stringify(f.runtime.snapshot('synthetic-parent', result.id))).not.toMatch(/synthetic-private/)
  } finally { await f.runtime.close() }
})

it('account terminal restores only explicitly declared native references (synthetic allocation, no terminal started)', async () => {
  const f = bindingFixture(raw({ apiKeyEnv: 'SYNTHETIC_EXPLICIT_KEY' }))
  vi.stubEnv('SYNTHETIC_EXPLICIT_KEY', ownKey)
  vi.stubEnv('UNRELATED_TOKEN', otherKey)
  const terminals: any[] = []
  const backend = { ...f.backend, spawnTerminal: async (spec: unknown) => { terminals.push(spec); throw new Error('Synthetic terminal allocation') } }
  const manager = new AccountManager(backend, { ...f.config, stateDirectory: join(f.root, 'account-state') })
  try {
    await expect(manager.start('synthetic-parent', 'kimi', 'manage', f.root, signal())).rejects.toThrow()
    expect(terminals).toHaveLength(1)
    expect(terminals[0].env).toMatchObject({ SYNTHETIC_EXPLICIT_KEY: ownKey })
    expect(terminals[0].env.UNRELATED_TOKEN).toBeUndefined()
    expect(JSON.stringify(terminals[0].argv)).not.toMatch(/synthetic-private/)
  } finally { await manager.close() }
})

it('keeps the CLI quarantined when pre-terminal metadata cleanup is unconfirmed (synthetic range)', async () => {
  const f = bindingFixture(raw({ apiKeyEnv: 'SYNTHETIC_EXPLICIT_KEY' }))
  vi.stubEnv('SYNTHETIC_EXPLICIT_KEY', ownKey)
  const terminal = vi.fn(async () => { throw new Error('Synthetic terminal must not start') })
  const backend: ProcessBackend = { ...f.backend,
    spawn: spec => ({ ...f.backend.spawn(spec), waitForExit: async () => false }), spawnTerminal: terminal }
  const blocked = vi.fn()
  const manager = new AccountManager(backend, { ...f.config, stateDirectory: join(f.root, 'account-state') }, undefined, blocked)
  try {
    await expect(manager.start('synthetic-parent', 'kimi', 'manage', f.root, signal())).rejects.toThrow('尚未确认')
    expect(manager.isBusy('kimi')).toBe(true)
    expect(manager.isBusy('claude')).toBe(false)
    expect(blocked).toHaveBeenCalledOnce()
    expect(blocked.mock.calls[0]?.[0]).toBe('kimi')
    expect((await manager.status('kimi', f.root, signal())).state).toBe('unavailable')
    expect(() => manager.start('synthetic-parent', 'kimi', 'manage', f.root, signal())).toThrow(ProcessCleanupUnconfirmedError)
    expect(terminal).not.toHaveBeenCalled()
  } finally { await manager.close() }
})

describe('Kimi private prepared source and subprocess contract (synthetic)', () => {
  it('fingerprints the prepared source as well as current state across A→B→A', async () => {
    const metadata = raw({ apiKeyEnv: 'SYNTHETIC_EXPLICIT_KEY' }), f = bindingFixture(metadata)
    const sourceId = join(f.home, 'config.toml')
    vi.stubEnv('SYNTHETIC_EXPLICIT_KEY', ownKey)
    const a = parseKimiModelSources(metadata, sourceId)
    const admitted = await readCliAccountBinding('kimi', f.backend, f.config, f.root, signal(), undefined, a)
    vi.stubEnv('SYNTHETIC_EXPLICIT_KEY', otherKey)
    const b = parseKimiModelSources(metadata, sourceId)
    vi.stubEnv('SYNTHETIC_EXPLICIT_KEY', ownKey)
    const current = await readCliAccountBinding('kimi', f.backend, f.config, f.root, signal())
    const prepared = await readCliAccountBinding('kimi', f.backend, f.config, f.root, signal(), undefined, b)
    expect(current).toBe(admitted)
    expect(prepared).not.toBe(admitted)
    expect(kimiModelEnvironment(b, 'alias')).toEqual({ SYNTHETIC_EXPLICIT_KEY: otherKey })
    expect(admitted).not.toContain(ownKey)
    await expect(readCliAccountBinding('claude', f.backend, f.config, f.root, signal(), undefined, a)).rejects.toThrow()
  })
  it('survives the real Harness secret scrub only by explicit env and keeps bridge request/argv free of keys', async () => {
    const f = bindingFixture(raw({ apiKeyEnv: 'SYNTHETIC_EXPLICIT_KEY' }))
    vi.stubEnv('SYNTHETIC_EXPLICIT_KEY', ownKey)
    vi.stubEnv('UNRELATED_TOKEN', otherKey)
    expect(scrubbedParentEnv().SYNTHETIC_EXPLICIT_KEY).toBeUndefined()
    const sources = parseKimiModelSources(raw({ apiKeyEnv: 'SYNTHETIC_EXPLICIT_KEY' }), join(f.home, 'config.toml'))
    const environment = kimiModelEnvironment(sources, 'alias')
    const prepared = await prepareNativeWorker({ argv: [process.execPath, 'acp'], env: environment }, {
      cli: 'kimi', project: f.root, preference: { cli: 'kimi', model: 'alias', effort: 'default' }, mode: 'accept-edits',
      prompt: 'Synthetic greeting only', stateDirectory: f.root,
    }, f.config)
    try {
      const effective = { ...scrubbedParentEnv(), ...prepared.env }
      expect(effective.SYNTHETIC_EXPLICIT_KEY).toBe(ownKey)
      expect(effective.UNRELATED_TOKEN).toBeUndefined()
      expect(JSON.stringify(prepared.argv)).not.toMatch(/synthetic-private/)
      expect(readFileSync(prepared.argv[2]!, 'utf8')).not.toMatch(/synthetic-private|SYNTHETIC_EXPLICIT_KEY|UNRELATED_TOKEN/)
    } finally { await prepared.cleanup() }
  })
})
