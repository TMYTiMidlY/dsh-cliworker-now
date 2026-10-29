import { expect, it, vi } from 'vitest'
import { publicOperationError, withPublicToolErrors } from '../src/host/public-operation-error.ts'
import { ProcessCleanupUnconfirmedError } from '../src/host/process.ts'
import { MetadataCaptureError } from '../src/host/metadata-diagnostics.ts'
import { OpenCodeRemoteUncertainError } from '../src/host/opencode-v2-launch.ts'
import { assertMiniMaxIdentityActive, isMiniMaxIdentityCancellation, MiniMaxIdentityError, requestMiniMaxIdentity } from '../src/host/minimax-identity.ts'

// Pure presentation regressions: no account, CLI, model, filesystem or HTTP work.
it.each([null, undefined, false, 17, 'PRIVATE_UNKNOWN_STRING', { private: 'PRIVATE_REASON' }])('unknown throwable %j stays opaque', value => {
  const safe = publicOperationError(value)
  expect(safe.message).toContain('CLI_OPERATION_FAILED')
  expect(String(safe)).not.toContain('PRIVATE_')
  expect(Object.hasOwn(safe, 'cause')).toBe(false)
})
it('does not touch proxy traps, including an Error proxy and a revoked proxy', () => {
  const touched = vi.fn(() => { throw new Error('PRIVATE_PROXY') })
  for (const target of [{}, new Error('PRIVATE_ERROR')]) {
    const proxy = new Proxy(target, { get: touched, getPrototypeOf: touched, getOwnPropertyDescriptor: touched, ownKeys: touched })
    expect(publicOperationError(proxy).message).toContain('CLI_OPERATION_FAILED')
  }
  const revoked = Proxy.revocable({}, {}); revoked.revoke()
  expect(publicOperationError(revoked.proxy).message).toContain('CLI_OPERATION_FAILED')
  expect(touched).not.toHaveBeenCalled()
})
it('copies ordinary data diagnostics without custom name/toString/cause or original stack', () => {
  const touched = vi.fn(() => { throw new Error('PRIVATE_ACCESSOR') }), error = new Error('PUBLIC_DOMAIN_DIAGNOSTIC')
  for (const key of ['name', 'toString', 'cause']) Object.defineProperty(error, key, { get: touched })
  const safe = publicOperationError(error)
  expect(String(safe)).toBe('Error: PUBLIC_DOMAIN_DIAGNOSTIC'); expect(safe === error).toBe(false)
  expect(Object.hasOwn(safe, 'cause')).toBe(false); expect(touched).not.toHaveBeenCalled()
})
it('does not replace a distinct failure with cancellation just because the caller was also aborted', () => {
  const controller = new AbortController(); controller.abort({ private: 'PRIVATE_CANCEL' })
  expect(publicOperationError(new AggregateError([], 'PUBLIC_CLEANUP_RANGE_UNKNOWN'), controller.signal).message).toBe('PUBLIC_CLEANUP_RANGE_UNKNOWN')
  expect(publicOperationError(controller.signal.reason, controller.signal).message).toContain('CLI_OPERATION_CANCELLED')
})
it('recognizes only the MiniMax module cancellation witness, not an arbitrary AbortError or proxy', () => {
  const control = new AbortController(); control.abort({ private: 'PRIVATE_IDENTITY_REASON' })
  let actual: unknown
  try { assertMiniMaxIdentityActive(control.signal) } catch (error) { actual = error }
  expect(isMiniMaxIdentityCancellation(actual)).toBe(true)
  expect(publicOperationError(actual, control.signal).message).toContain('CLI_OPERATION_CANCELLED')
  expect(publicOperationError(actual, control.signal).message).not.toContain('PRIVATE_IDENTITY_REASON')
  const fake = new DOMException('MiniMax Code 身份验证已取消', 'AbortError')
  expect(isMiniMaxIdentityCancellation(fake)).toBe(false)
  expect(publicOperationError(fake, control.signal).message).not.toContain('CLI_OPERATION_CANCELLED')
  const touched = vi.fn(() => { throw new Error('PRIVATE_CANCEL_PROXY') })
  const proxy = new Proxy(actual as object, { get: touched, getPrototypeOf: touched, getOwnPropertyDescriptor: touched })
  expect(isMiniMaxIdentityCancellation(proxy)).toBe(false)
  expect(publicOperationError(proxy, control.signal).message).toContain('CLI_OPERATION_FAILED'); expect(touched).not.toHaveBeenCalled()
})

it('a MiniMax internal identity deadline stays unavailable, not caller cancellation, at the public boundary', async () => {
  const caller = new AbortController()
  const failure = await requestMiniMaxIdentity('cn', 'SYNTHETIC_PRIVATE_TOKEN', caller.signal, {
    timeoutMs: 1,
    fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('PRIVATE_INTERNAL_DEADLINE')), { once: true })
    }),
  }).then(() => ({ error: undefined }), error => ({ error }))
  expect(caller.signal.aborted).toBe(false); expect(failure.error).toBeInstanceOf(MiniMaxIdentityError)
  expect(isMiniMaxIdentityCancellation(failure.error)).toBe(false)
  const safe = publicOperationError(failure.error, caller.signal)
  expect(safe.message).toContain('身份暂不可验证'); expect(safe.message).not.toMatch(/CLI_OPERATION_CANCELLED|PRIVATE_|SYNTHETIC_/)
})

it('known cleanup and safe metadata contracts survive without copying extra private fields', () => {
  const cleanup = Object.assign(new ProcessCleanupUnconfirmedError(), { private: 'PRIVATE_MARKER' })
  const metadata = Object.assign(new MetadataCaptureError('exit', 'exit', 3), { private: 'PRIVATE_MARKER' })
  expect(publicOperationError(cleanup)).toBeInstanceOf(ProcessCleanupUnconfirmedError)
  expect(publicOperationError(metadata)).toMatchObject({ phase: 'exit', reason: 'exit', exitCode: 3, code: 'CLI_METADATA_CAPTURE_FAILED' })
  expect(JSON.stringify(publicOperationError(metadata))).not.toContain('PRIVATE_MARKER')
})
it('retains the finite hint through the actual public Tool boundary, never native text or causes', async () => {
  const failure = Object.assign(new MetadataCaptureError('exit', 'exit', 1, 'native-network-text'), { private: 'PRIVATE_NATIVE_OUTPUT', cause: 'PRIVATE_CAUSE' })
  const definition = { name: 'synthetic-hint', description: 'Synthetic only', parameters: {}, output: { schema: { type: 'string' as const }, render: () => [] }, execute: vi.fn(async () => { throw failure }) }
  const wrapped = withPublicToolErrors(definition)
  const safe = await wrapped.execute({}, { signal: new AbortController().signal } as any).catch((value: unknown) => value) as Error & { hint?: string }
  expect(safe).toBeInstanceOf(MetadataCaptureError)
  expect(safe.hint).toBe('native-network-text')
  expect(safe.message).toContain('hint=native-network-text')
  expect(String(safe) + JSON.stringify(safe)).not.toContain('PRIVATE_')
  expect(Object.hasOwn(safe, 'cause')).toBe(false)
  expect(definition.execute).toHaveBeenCalledOnce()
})
it('ignores accessor and unknown metadata hints at the public boundary', () => {
  const touched = vi.fn(() => { throw new Error('PRIVATE_HINT_GETTER') })
  const accessor = new MetadataCaptureError('exit', 'exit', 1)
  Object.defineProperty(accessor, 'hint', { get: touched })
  expect(publicOperationError(accessor).message).not.toContain('hint=')
  const unknown = Object.assign(new MetadataCaptureError('exit', 'exit', 1), { hint: 'PRIVATE_BAD_HINT' })
  expect(publicOperationError(unknown).message).not.toContain('PRIVATE_')
  expect(touched).not.toHaveBeenCalled()
})
it('a real cleanup subclass retains its conservative class and message even when it is the cancellation reason', () => {
  const reason = new OpenCodeRemoteUncertainError(), control = new AbortController()
  control.abort(reason)
  const safe = publicOperationError(reason, control.signal)
  expect(safe).toBeInstanceOf(ProcessCleanupUnconfirmedError)
  expect(safe.message).toBe(reason.message)
  expect(safe.message).not.toContain('CLI_OPERATION_CANCELLED')
})
it('error projection never runs the tool again, changes declaration or suppresses a successful value after late cancellation', async () => {
  const control = new AbortController(), execute = vi.fn(async () => { control.abort({ private: 'PRIVATE_LATE' }); return 'EXACT_RECEIPT' })
  const definition = { name: 'synthetic', description: 'Synthetic only', parameters: {}, output: { schema: { type: 'string' as const }, render: () => [] }, timeoutMs: 1234, execute }
  const wrapped = withPublicToolErrors(definition)
  expect(await wrapped.execute({}, { signal: control.signal } as any)).toBe('EXACT_RECEIPT')
  expect(execute).toHaveBeenCalledTimes(1)
  expect(wrapped).toMatchObject({ name: definition.name, output: definition.output, timeoutMs: 1234 })
})
