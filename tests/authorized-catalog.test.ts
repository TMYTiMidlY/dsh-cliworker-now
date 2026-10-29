import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { catalogFor } from '../src/host/adapters.ts'
import { readCliAccountBinding } from '../src/host/cli-account-binding.ts'
import { authorizedCatalog, authorizeSelection } from '../src/host/authorized-catalog.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'
import { CodexCatalogError } from '../src/host/codex-models.ts'
import { CLI_IDS } from '../src/shared/types.ts'

vi.mock('../src/host/adapters.ts', async (original) => ({
  ...(await original<object>()),
  catalogFor: vi.fn(),
  resolveCliExecutable: vi.fn(async () => '/synthetic/qoder'),
}))
vi.mock('../src/host/cli-account-binding.ts', () => ({ readCliAccountBinding: vi.fn() }))
// The full Qoder source/transport proof is exercised in qoder-accounts.test.ts.
vi.mock('../src/host/qoder-accounts.ts', async (original) => ({
  ...(await original<object>()),
  withQoderCatalogSnapshot: async (_backend: unknown, _config: unknown, _executable: unknown, _project: unknown, _signal: unknown, operation: () => Promise<unknown>) => operation(),
}))
// Only metadata doubles; no accounts, network or native processes.
const backend = { spawn: vi.fn(), resolveExecutable: vi.fn() } as unknown as ProcessBackend
const signal = () => new AbortController().signal
beforeEach(() => {
  vi.mocked(readCliAccountBinding).mockResolvedValue('synthetic-account-a')
  vi.mocked(catalogFor).mockImplementation(async (cli) => ({
    cli,
    notice: 'Synthetic owned account scope',
    models: [{ id: 'synthetic/model', label: 'Fixture', efforts: ['low'] }],
  }))
})
afterEach(() => vi.resetAllMocks())

it.each(CLI_IDS)('%s cannot discover or select using only another CLI/Host account', async (cli) => {
  vi.mocked(readCliAccountBinding).mockRejectedValue(new Error('本 CLI 未登录'))
  const resolver = vi.fn(async () => 'synthetic-other-key')
  const config = { ...DEFAULT_CONFIG, zaiCredentialRef: 'SYNTHETIC_HOST', resolveCredential: resolver }
  await expect(authorizedCatalog(cli, backend, config, '/synthetic', signal())).rejects.toThrow('未登录')
  await expect(
    authorizeSelection(
      { cli, model: 'synthetic/model', effort: 'low' },
      backend,
      config,
      '/synthetic',
      signal(),
    ),
  ).rejects.toThrow('未登录')
  expect(catalogFor).not.toHaveBeenCalled()
  expect(resolver).not.toHaveBeenCalled()
  expect(backend.spawn).not.toHaveBeenCalled()
})

it('rejects an account change while the model directory is loading', async () => {
  vi.mocked(readCliAccountBinding)
    .mockResolvedValueOnce('synthetic-account-a')
    .mockResolvedValueOnce('synthetic-account-b')
  await expect(authorizedCatalog('pi', backend, DEFAULT_CONFIG, '/synthetic', signal())).rejects.toThrow(
    '账号已变更',
  )
})

it('rejects an obsolete displayed account before querying the replacement account', async () => {
  await expect(
    authorizedCatalog('pi', backend, DEFAULT_CONFIG, '/synthetic', signal(), 'old-account'),
  ).rejects.toThrow('账号已变更')
  expect(catalogFor).not.toHaveBeenCalled()
})

it('rejects revoked model and effort, empty and cross-CLI metadata', async () => {
  await expect(
    authorizeSelection(
      { cli: 'pi', model: 'removed', effort: 'low' },
      backend,
      DEFAULT_CONFIG,
      '/synthetic',
      signal(),
    ),
  ).rejects.toThrow()
  await expect(
    authorizeSelection(
      { cli: 'pi', model: 'synthetic/model', effort: 'max' },
      backend,
      DEFAULT_CONFIG,
      '/synthetic',
      signal(),
    ),
  ).rejects.toThrow()
  vi.mocked(catalogFor).mockResolvedValueOnce({ cli: 'pi', models: [], notice: '' })
  await expect(authorizedCatalog('pi', backend, DEFAULT_CONFIG, '/synthetic', signal())).rejects.toThrow(
    '暂无',
  )
  vi.mocked(catalogFor).mockResolvedValueOnce({ cli: 'omp', models: [], notice: '' })
  await expect(authorizedCatalog('pi', backend, DEFAULT_CONFIG, '/synthetic', signal())).rejects.toThrow(
    '身份不匹配',
  )
})

it.each(['scope-unknown', 'quota', 'authentication'] as const)('a cleaned Codex %s failure still rechecks and reports a confirmed outer account change', async reason => {
  vi.mocked(readCliAccountBinding).mockResolvedValueOnce('synthetic-account-a').mockResolvedValueOnce('synthetic-account-b')
  vi.mocked(catalogFor).mockRejectedValueOnce(new CodexCatalogError(reason))
  await expect(authorizedCatalog('codex', backend, DEFAULT_CONFIG, '/synthetic', signal())).rejects.toThrow('账号已变更')
  expect(readCliAccountBinding).toHaveBeenCalledTimes(2)
  expect(catalogFor).toHaveBeenCalledOnce(); expect(backend.spawn).not.toHaveBeenCalled()
})

it('preserves the original bounded Codex reason when error-path account binding is unchanged', async () => {
  const error = new CodexCatalogError('scope-unknown')
  vi.mocked(catalogFor).mockRejectedValueOnce(error)
  await expect(authorizedCatalog('codex', backend, DEFAULT_CONFIG, '/synthetic', signal())).rejects.toBe(error)
  expect(readCliAccountBinding).toHaveBeenCalledTimes(2)
})

it.each(['scope-unknown', 'quota'] as const)('a %s error followed by unconfirmed binding never invents ACCOUNT_CHANGED or retries', async reason => {
  const bindingError = new Error('SYNTHETIC_BINDING_UNCONFIRMED')
  vi.mocked(readCliAccountBinding).mockResolvedValueOnce('synthetic-account-a').mockRejectedValueOnce(bindingError)
  vi.mocked(catalogFor).mockRejectedValueOnce(new CodexCatalogError(reason))
  await expect(authorizedCatalog('codex', backend, DEFAULT_CONFIG, '/synthetic', signal())).rejects.toBe(bindingError)
  expect(readCliAccountBinding).toHaveBeenCalledTimes(2); expect(catalogFor).toHaveBeenCalledOnce()
})

it('preserves real cancellation identity during the cleaned error-path binding recheck', async () => {
  const control = new AbortController(), reason = { private: 'SYNTHETIC_BINDING_CANCEL' }
  vi.mocked(readCliAccountBinding).mockResolvedValueOnce('synthetic-account-a').mockImplementationOnce(async () => { control.abort(reason); return 'synthetic-account-a' })
  vi.mocked(catalogFor).mockRejectedValueOnce(new CodexCatalogError('scope-unknown'))
  await expect(authorizedCatalog('codex', backend, DEFAULT_CONFIG, '/synthetic', control.signal)).rejects.toBe(reason)
  expect(readCliAccountBinding).toHaveBeenCalledTimes(2); expect(catalogFor).toHaveBeenCalledOnce()
})

it('does not mask cleanup uncertainty or start a binding recheck after cancellation', async () => {
  const control = new AbortController(), cleanup = new ProcessCleanupUnconfirmedError()
  vi.mocked(catalogFor).mockImplementationOnce(async () => { control.abort({ private: 'SYNTHETIC_CANCEL' }); throw cleanup })
  await expect(authorizedCatalog('codex', backend, DEFAULT_CONFIG, '/synthetic', control.signal)).rejects.toBe(cleanup)
  expect(readCliAccountBinding).toHaveBeenCalledOnce()
  const cancelled = new AbortController(), reason = { private: 'SYNTHETIC_CANCEL_2' }
  vi.mocked(catalogFor).mockImplementationOnce(async () => { cancelled.abort(reason); throw new CodexCatalogError('scope-unknown') })
  await expect(authorizedCatalog('codex', backend, DEFAULT_CONFIG, '/synthetic', cancelled.signal)).rejects.toBe(reason)
  expect(readCliAccountBinding).toHaveBeenCalledTimes(2)
})

it('the Codex-specific error recheck does not inspect opaque Proxy errors or change other CLI contracts', async () => {
  const trap = vi.fn(() => { throw new Error('SYNTHETIC_PRIVATE_TRAP') })
  const held = Proxy.revocable(new Error(), { get: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap })
  held.revoke()
  vi.mocked(catalogFor).mockRejectedValueOnce(held.proxy)
  const outcome = await authorizedCatalog('codex', backend, DEFAULT_CONFIG, '/synthetic', signal()).then(() => ({ error: undefined }), error => ({ error }))
  expect(outcome.error === held.proxy).toBe(true); expect(trap).not.toHaveBeenCalled()
  expect(readCliAccountBinding).toHaveBeenCalledOnce()
  vi.mocked(catalogFor).mockRejectedValueOnce(new CodexCatalogError('scope-unknown'))
  await expect(authorizedCatalog('pi', backend, DEFAULT_CONFIG, '/synthetic', signal())).rejects.toThrow('scope-unknown')
  expect(readCliAccountBinding).toHaveBeenCalledTimes(2)
})

it('accepts a stable own account and checks cancellation after directory completion', async () => {
  expect(
    (
      await authorizeSelection(
        { cli: 'pi', model: 'synthetic/model', effort: 'low' },
        backend,
        DEFAULT_CONFIG,
        '/synthetic',
        signal(),
      )
    ).binding,
  ).toBe('synthetic-account-a')
  const controller = new AbortController()
  vi.mocked(catalogFor).mockImplementationOnce(async (cli) => {
    controller.abort(new Error('Synthetic cancelled'))
    return { cli, notice: '', models: [] }
  })
  await expect(
    authorizedCatalog('pi', backend, DEFAULT_CONFIG, '/synthetic', controller.signal),
  ).rejects.toThrow('Synthetic cancelled')
})
