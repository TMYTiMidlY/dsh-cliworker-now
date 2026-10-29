// Synthetic child-process lease probe; never discovers user config or runs CLI.
import { NativeAuthStore } from '../../src/host/native-auth-store.ts'
const store = NativeAuthStore.open(process.argv[2])
const identity = { kind: 'native-principal' as const, value: 'SYNTHETIC_CHILD_ACCOUNT' }
try {
  await store.import({ cli: 'codex', label: 'Synthetic child', requestId: 'child-request' }, async () => {
    process.send?.({ ready: true })
    await new Promise<void>(resolve => process.once('message', () => resolve()))
    return { identity, files: [{ path: 'auth.json', bytes: Buffer.from('SYNTHETIC_CHILD_TOKEN') }] }
  }, async () => identity)
  process.send?.({ completed: true })
} catch {
  process.exitCode = 1
} finally {
  process.disconnect?.()
}
