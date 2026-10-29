import { afterEach, describe, expect, it, vi } from 'vitest'
import { PassThrough, Writable } from 'node:stream'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'
import { CodexCatalogError, discoverCodexModels, readCodexNativeModels } from '../src/host/codex-models.ts'
import { readCodexOwnAccountSource } from '../src/host/cli-account-binding.ts'
import { probeAccountModels } from '../src/host/account-models.mjs'

vi.mock('../src/host/cli-account-binding.ts', () => ({ readCodexOwnAccountSource: vi.fn() }))
vi.mock('../src/host/account-models.mjs', () => ({ probeAccountModels: vi.fn() }))
afterEach(() => vi.resetAllMocks())
// Synthetic app-server and account service: never read native auth or contact a server.
const entry = (model: string, extra: Record<string, unknown> = {}) => ({
  model,
  displayName: model,
  hidden: false,
  supportedReasoningEfforts: [
    { reasoningEffort: 'low' },
    { reasoningEffort: 'high' },
    { reasoningEffort: 'invented' },
  ],
  ...extra,
})
function fixture(
  pages: unknown[][],
  options: { stall?: boolean; cleanup?: boolean; repeated?: boolean; userAgent?: string } = {},
) {
  const stdout = new PassThrough(),
    stderr = new PassThrough(),
    messages: any[] = []
  let finish!: (result: SubprocessOutcome) => void,
    page = 0
  const done = new Promise<SubprocessOutcome>((resolve) => {
    finish = resolve
  })
  const child: SubprocessHandle = {
    stdin: new Writable({
      write(chunk, _encoding, callback) {
        const message = JSON.parse(String(chunk))
        messages.push(message)
        callback()
        if (options.stall) return
        if (message.method === 'initialize')
          stdout.write(JSON.stringify({ id: message.id, result: { userAgent: options.userAgent ?? 'cli_worker_models/0.162.1 (synthetic)' } }) + '\n')
        if (message.method === 'model/list') {
          stdout.write(
            JSON.stringify({
              id: message.id,
              result: {
                data: pages[page++] ?? [],
                nextCursor: options.repeated ? 'repeat' : page < pages.length ? `cursor-${page}` : null,
              },
            }) + '\n',
          )
        }
      },
    }),
    stdout,
    stderr,
    done,
    control: undefined,
    collected: {},
    terminate: vi.fn(() => {
      stdout.end()
      stderr.end()
      finish({ exitCode: 0, signal: null })
    }),
    waitForExit: vi.fn(async () => options.cleanup !== false),
  }
  const backend: ProcessBackend = { resolveExecutable: vi.fn(), spawn: vi.fn(() => child) }
  return {
    backend,
    child,
    messages,
    run: (signal = new AbortController().signal) =>
      readCodexNativeModels(backend, DEFAULT_CONFIG, '/synthetic/codex', '/synthetic', signal),
  }
}
it.each(['constructor', '__proto__', 'toString', 'SYNTHETIC_UNKNOWN_REASON'])('rejects the runtime non-closed catalog reason %s', reason => {
  expect(() => new CodexCatalogError(reason as any)).toThrow('Invalid Codex catalog reason')
})

describe('Codex stable-source fresh query sequences (synthetic, no CLI or HTTP)', () => {
  const models = Array.from({ length: 7 }, (_, n) => `synthetic-model-${n}`)
  const own = (extra: Record<string, unknown> = {}) => ({ provider: 'openai-codex', credential: { type: 'oauth', access: 'SYNTHETIC_ACCESS', accountId: 'SYNTHETIC_PRINCIPAL' }, sourceIds: ['/synthetic/codex'], sourceIdentity: 'SYNTHETIC_STABLE_SOURCE_A', nativeRouteConfirmed: true, baseUrl: 'https://chatgpt.com/backend-api', ...extra })
  const allowed = () => ({ state: 'supported' as const, source: 'account-models' as const, models: models.map(id => ({ id, cost: 'unknown' as const })) })
  function sequence(count: number) {
    const processes = Array.from({ length: count }, () => fixture([models.map(id => entry(id))]))
    let at = 0
    const backend = { resolveExecutable: vi.fn(), spawn: vi.fn((spec: any) => processes[at++]!.backend.spawn(spec)) } as ProcessBackend
    const run = (signal = new AbortController().signal) => discoverCodexModels(backend, DEFAULT_CONFIG, '/synthetic/codex', '/synthetic', signal)
    return { processes, backend, run }
  }
  it('same valid source can return the exact seven-model catalog repeatedly with fresh owned children and no prompt', async () => {
    const f = sequence(4); vi.mocked(readCodexOwnAccountSource).mockResolvedValue(own() as any)
    vi.mocked(probeAccountModels).mockResolvedValue(allowed())
    for (let i = 0; i < 4; i++) expect((await f.run()).map(m => m.id)).toEqual(models)
    expect(f.backend.spawn).toHaveBeenCalledTimes(4)
    for (const p of f.processes) {
      expect(p.child.waitForExit).toHaveBeenCalledOnce()
      expect(p.messages.some(m => /thread|turn|prompt/.test(m.method))).toBe(false)
    }
  })
  it('uses the exact new supported scope on a second query rather than retaining old listed permissions', async () => {
    const f = sequence(2); vi.mocked(readCodexOwnAccountSource).mockResolvedValue(own() as any)
    vi.mocked(probeAccountModels).mockResolvedValueOnce(allowed()).mockResolvedValueOnce({ state: 'supported', source: 'account-models', models: [
      { id: models[3]!, cost: 'unknown' },
      { id: 'synthetic-remote-new', name: 'Synthetic remote capability', cost: 'paid', reasoningEfforts: ['high'] },
    ] })
    expect(await f.run()).toHaveLength(7)
    expect(await f.run()).toEqual([
      { id: models[3], label: models[3], efforts: ['low', 'high'] },
      { id: 'synthetic-remote-new', label: 'Synthetic remote capability', efforts: ['high'], cost: 'paid' },
    ])
    expect(f.backend.spawn).toHaveBeenCalledTimes(2)
    for (const p of f.processes) expect(p.messages.some(m => /thread|turn|prompt/.test(m.method))).toBe(false)
  })
  it.each([1, 2, 3])('valid displayed catalog followed by unknown fresh scope at check %i stays unavailable without inventing quota', async unknownAt => {
    const f = sequence(unknownAt + 1); vi.mocked(readCodexOwnAccountSource).mockResolvedValue(own() as any)
    let at = 0; vi.mocked(probeAccountModels).mockImplementation(async () => at++ === unknownAt ? { state: 'unknown', source: 'unknown', models: [] } : allowed())
    for (let i = 0; i < unknownAt; i++) expect(await f.run()).toHaveLength(7)
    await expect(f.run()).rejects.toThrow('CODEX_CATALOG_UNCONFIRMED:scope-unknown')
    expect(f.backend.spawn).toHaveBeenCalledTimes(unknownAt + 1)
    for (const p of f.processes) expect(p.messages.some(m => /thread|turn|prompt/.test(m.method))).toBe(false)
  })
  it.each([
    [{ state: 'denied', source: 'unknown', models: [] }, 'scope-denied-unclassified'],
    [{ state: 'supported', source: 'account-models', models: [] }, 'catalog-empty'],
    [{ state: 'supported', source: 'account-models', models: [{ id: 'remote-without-capabilities', cost: 'unknown' }] }, 'capability-intersection-empty'],
  ] as const)('distinguishes unavailable scope/capabilities using only bounded reasons: %s', async (scope, reason) => {
    const f = sequence(1); vi.mocked(readCodexOwnAccountSource).mockResolvedValue(own() as any)
    vi.mocked(probeAccountModels).mockResolvedValue(scope as any)
    await expect(f.run()).rejects.toThrow(`CODEX_CATALOG_UNCONFIRMED:${reason}`)
    expect(f.processes[0]!.child.waitForExit).toHaveBeenCalledOnce()
  })
  it('same-principal OAuth token rotation uses the refreshed token without an account-change assertion', async () => {
    const f = sequence(1)
    vi.mocked(readCodexOwnAccountSource).mockResolvedValueOnce(own() as any).mockResolvedValueOnce(own({ credential: { type: 'oauth', access: 'SYNTHETIC_ROTATED_ACCESS', accountId: 'SYNTHETIC_PRINCIPAL' } }) as any)
    vi.mocked(probeAccountModels).mockResolvedValue(allowed())
    expect(await f.run()).toHaveLength(7)
    expect(probeAccountModels).toHaveBeenCalledWith(expect.objectContaining({ credential: expect.objectContaining({ access: 'SYNTHETIC_ROTATED_ACCESS' }) }), expect.anything())
  })
  it.each(['provider', 'root', 'principal'] as const)('does not mix pre/post native %s sources or call scope B using native capabilities A', async changed => {
    const f = sequence(1), after = changed === 'provider' ? own({ provider: 'openai', credential: { type: 'api', key: 'SYNTHETIC_API' }, baseUrl: 'https://api.openai.com/v1' }) : changed === 'root' ? own({ sourceIds: ['/synthetic/other'] }) : own({ credential: { type: 'oauth', access: 'SYNTHETIC_ROTATED_ACCESS', accountId: 'SYNTHETIC_OTHER_PRINCIPAL' } })
    after.sourceIdentity = 'SYNTHETIC_CHANGED_SOURCE_B'
    vi.mocked(readCodexOwnAccountSource).mockResolvedValueOnce(own() as any).mockResolvedValueOnce(after as any)
    vi.mocked(probeAccountModels).mockResolvedValue(allowed())
    await expect(f.run()).rejects.toThrow('CODEX_SOURCE_CHANGED')
    expect(probeAccountModels).not.toHaveBeenCalled(); expect(f.processes[0]!.child.waitForExit).toHaveBeenCalledOnce()
  })
})

describe('Codex native capability intersection', () => {
  it('pages native metadata and rejects hidden, restricted and unsupported effort candidates', async () => {
    const f = fixture([
      [entry('allowed'), entry('hidden', { hidden: true })],
      [entry('restricted', { availabilityNux: { message: 'upgrade' } }), entry('other')],
    ])
    expect(await f.run()).toEqual(
      ['allowed', 'other'].map((id) => ({ id, label: id, efforts: ['low', 'high'] })),
    )
    expect(f.messages.map((value) => value.method)).toEqual([
      'initialize',
      'initialized',
      'model/list',
      'model/list',
    ])
    expect(f.messages[3].params.cursor).toBe('cursor-1')
    expect(f.child.terminate).toHaveBeenCalledOnce()
    expect(f.child.waitForExit).toHaveBeenCalledOnce()
  })
  it('does not trust the native metadata or old cache without current account permissions', async () => {
    const f = fixture([[entry('allowed'), entry('not-entitled')]])
    const token = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.synthetic`
    vi.mocked(readCodexOwnAccountSource).mockResolvedValue({
      provider: 'openai-codex',
      credential: { type: 'oauth', access: token, accountId: 'synthetic-account' },
      sourceIds: ['/synthetic/codex'],
      sourceIdentity: 'SYNTHETIC_OWN_SOURCE', nativeRouteConfirmed: true,
      baseUrl: 'https://chatgpt.com/backend-api',
    } as any)
    vi.mocked(probeAccountModels).mockResolvedValue({
      state: 'supported',
      source: 'account-models',
      models: [
        { id: 'allowed', cost: 'unknown' },
        { id: 'server-only', cost: 'unknown' },
      ],
    })
    expect(
      await discoverCodexModels(
        f.backend,
        DEFAULT_CONFIG,
        '/synthetic/codex',
        '/synthetic',
        new AbortController().signal,
      ),
    ).toEqual([{ id: 'allowed', label: 'allowed', efforts: ['low', 'high'] }])
    expect(probeAccountModels).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai-codex',
        credential: expect.objectContaining({ accountId: 'synthetic-account' }),
      }),
      expect.anything(),
    )
  })
  it('uses the actual server version and current remote capabilities when the native catalog is stale', async () => {
    const f = fixture([[entry('gpt-5.6-sol')]])
    vi.mocked(readCodexOwnAccountSource).mockResolvedValue({
      provider: 'openai-codex', credential: { type: 'oauth', access: 'synthetic-token' },
      sourceIdentity: 'SYNTHETIC_OWN_SOURCE', nativeRouteConfirmed: true, baseUrl: 'https://chatgpt.com/backend-api',
    } as any)
    vi.mocked(probeAccountModels).mockResolvedValue({
      state: 'supported', source: 'account-models', models: [
        { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', cost: 'paid', reasoningEfforts: ['low', 'high', 'max', 'invented'] },
        { id: 'remote-id-without-capabilities', cost: 'unknown' },
      ],
    })
    expect(await discoverCodexModels(f.backend, DEFAULT_CONFIG, '/synthetic/codex', '/synthetic', new AbortController().signal))
      .toEqual([{ id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', efforts: ['low', 'high', 'max'], cost: 'paid' }])
    expect(probeAccountModels).toHaveBeenCalledWith(expect.objectContaining({ codexClientVersion: '0.162.1' }), expect.anything())
    expect(f.messages.some((message) => /thread|turn/.test(message.method))).toBe(false)
  })
  it('does not guess a Codex query version when the native handshake is unsupported', async () => {
    const f = fixture([[entry('cached')]], { userAgent: 'unsupported-server' })
    vi.mocked(readCodexOwnAccountSource).mockResolvedValue({
      provider: 'openai-codex', credential: { type: 'oauth', access: 'synthetic-token' },
      sourceIdentity: 'SYNTHETIC_OWN_SOURCE', nativeRouteConfirmed: true, baseUrl: 'https://chatgpt.com/backend-api',
    } as any)
    await expect(discoverCodexModels(f.backend, DEFAULT_CONFIG, '/synthetic/codex', '/synthetic', new AbortController().signal))
      .rejects.toThrow('版本无法确认')
    expect(probeAccountModels).not.toHaveBeenCalled()
    expect(f.child.waitForExit).toHaveBeenCalledOnce()
  })
  it('unknown/denied account scope never exposes native or cached choices', async () => {
    const f = fixture([[entry('public')]])
    vi.mocked(readCodexOwnAccountSource).mockResolvedValue({
      provider: 'openai-codex',
      credential: { type: 'oauth', access: 'opaque' },
      sourceIds: ['/synthetic'],
      sourceIdentity: 'SYNTHETIC_OWN_SOURCE', nativeRouteConfirmed: true,
      baseUrl: 'https://chatgpt.com/backend-api',
    } as any)
    vi.mocked(probeAccountModels).mockResolvedValue({ state: 'denied', source: 'unknown', models: [] })
    await expect(
      discoverCodexModels(
        f.backend,
        DEFAULT_CONFIG,
        '/synthetic/codex',
        '/synthetic',
        new AbortController().signal,
      ),
    ).rejects.toThrow('scope-denied-unclassified')
    expect(f.backend.spawn).toHaveBeenCalledOnce()
  })
  it.each([
    ['quota', 'Codex 当前账号额度已用尽，请等待额度恢复后刷新'],
    ['authentication', 'Codex 当前账号认证不可用或访问被拒绝，请检查登录后刷新'],
  ] as const)(
    'reports confirmed %s denial without publishing native model capabilities',
    async (denialReason, message) => {
      const f = fixture([[entry('public')]])
      vi.mocked(readCodexOwnAccountSource).mockResolvedValue({
        provider: 'openai-codex',
        credential: { type: 'oauth', access: 'synthetic-never-displayed' },
        sourceIds: ['/synthetic'],
        sourceIdentity: 'SYNTHETIC_OWN_SOURCE', nativeRouteConfirmed: true,
        baseUrl: 'https://chatgpt.com/backend-api',
      } as any)
      vi.mocked(probeAccountModels).mockResolvedValue({
        state: 'denied',
        source: 'unknown',
        models: [],
        denialReason,
      })
      await expect(
        discoverCodexModels(
          f.backend,
          DEFAULT_CONFIG,
          '/synthetic/codex',
          '/synthetic',
          new AbortController().signal,
        ),
      ).rejects.toThrow(message)
      expect(f.child.waitForExit).toHaveBeenCalledOnce()
    },
  )
  it('rereads the same confirmed default file API routing after native preparation', async () => {
    const f = fixture([[entry('allowed')]])
    vi.mocked(readCodexOwnAccountSource)
      .mockResolvedValueOnce({
        provider: 'openai',
        credential: { type: 'api', key: 'own-file-api' },
        sourceIds: ['/synthetic'],
        baseUrl: 'https://api.openai.com/v1',
        sourceIdentity: 'SYNTHETIC_OWN_SOURCE', nativeRouteConfirmed: true,
      } as any)
      .mockResolvedValueOnce({
        provider: 'openai',
        credential: { type: 'api', key: 'own-file-api' },
        sourceIds: ['/synthetic'],
        sourceIdentity: 'SYNTHETIC_OWN_SOURCE', nativeRouteConfirmed: true,
        baseUrl: 'https://api.openai.com/v1',
      } as any)
    vi.mocked(probeAccountModels).mockResolvedValue({
      state: 'supported',
      source: 'account-models',
      models: [{ id: 'allowed', cost: 'unknown' }],
    })
    expect(
      await discoverCodexModels(
        f.backend,
        DEFAULT_CONFIG,
        '/synthetic/codex',
        '/synthetic',
        new AbortController().signal,
      ),
    ).toHaveLength(1)
    expect(readCodexOwnAccountSource).toHaveBeenCalledTimes(2)
    expect(probeAccountModels).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://api.openai.com/v1',
        credential: { type: 'api', key: 'own-file-api' },
      }),
      expect.anything(),
    )
  })
  it('unconfirmed native cleanup prevents both post-source read and a pending unknown scope probe', async () => {
    const f = fixture([[entry('allowed')]], { cleanup: false })
    vi.mocked(readCodexOwnAccountSource).mockResolvedValue({ provider: 'openai-codex', credential: { type: 'oauth', access: 'SYNTHETIC_PRIVATE_ACCESS' }, sourceIdentity: 'SYNTHETIC_PRIVATE_IDENTITY', nativeRouteConfirmed: true, baseUrl: 'https://chatgpt.com/backend-api' } as any)
    vi.mocked(probeAccountModels).mockResolvedValue({ state: 'unknown', source: 'unknown', models: [] })
    await expect(discoverCodexModels(f.backend, DEFAULT_CONFIG, '/synthetic/codex', '/synthetic', new AbortController().signal)).rejects.toThrow('cleanup')
    expect(readCodexOwnAccountSource).toHaveBeenCalledOnce(); expect(probeAccountModels).not.toHaveBeenCalled()
    expect(f.child.waitForExit).toHaveBeenCalledOnce()
  })
  it('rejects broken pagination and unconfirmed child exit', async () => {
    await expect(fixture([[entry('public')]], { repeated: true }).run()).rejects.toThrow('分页')
    await expect(fixture([[entry('public')]], { cleanup: false }).run()).rejects.toThrow('cleanup')
  })
  it('cancels a stalled metadata process and confirms its cleanup', async () => {
    const f = fixture([], { stall: true }),
      controller = new AbortController(),
      result = f.run(controller.signal)
    controller.abort()
    await expect(result).rejects.toThrow('取消')
    expect(f.child.waitForExit).toHaveBeenCalledOnce()
  })
})
