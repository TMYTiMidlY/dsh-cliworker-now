// Synthetic parent-death regression only, never imported by production.
import { spawn } from 'node:child_process'
import { withNativeAuthSnapshot } from '../../src/host/native-auth-snapshot.ts'
let pid: number | undefined
try {
  await withNativeAuthSnapshot({ root: process.argv[2], files: [{ path: 'auth.json', maxBytes: 128 }] }, async () => {
    process.send?.({ ready: true, guardPid: pid })
    await new Promise<void>(() => {})
  }, { assetsDirectory: process.argv[3], timeoutMs: 10000, spawn: (file, args, options) => {
    const child = spawn(file, args, options); pid = child.pid; return child
  } })
} catch { process.exitCode = 1 }
finally { process.disconnect?.() }
