import { beforeAll, expect, it } from 'vitest'
import { chmodSync, closeSync, constants, copyFileSync, linkSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { execFileSync, fork, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { NativeAuthStore } from '../src/host/native-auth-store.ts'
import { join } from 'node:path'
import { buildNativeAuthGuard } from '../scripts/build-native-auth-guard.mjs'
import { withNativeAuthSnapshot } from '../src/host/native-auth-snapshot.ts'
import { NativeAuthError } from '../src/host/native-auth-files.ts'

// All runtime artifacts are unmistakably synthetic and retained in repo cache.
let assets = '', writer = ''
function fixture() {
  mkdirSync('.cache', { recursive: true })
  const root = mkdtempSync(join(process.cwd(), '.cache/auth-profile-kernel-synthetic-'))
  const source = join(root, 'source'); mkdirSync(source, { mode: 0o700 })
  writeFileSync(join(source, 'auth.json'), 'SYNTHETIC_SECRET_KERNEL_MARKER', { mode: 0o600 })
  writeFileSync(join(source, 'state.json'), 'SYNTHETIC_STATE', { mode: 0o600 })
  return { root, source }
}
const files = [{ path: 'auth.json', maxBytes: 128 }, { path: 'state.json', maxBytes: 128 }]
const backend = () => ({ assetsDirectory: assets, timeoutMs: 3000 })
beforeAll(() => {
  const f = fixture(); assets = join(f.root, 'assets'); buildNativeAuthGuard({ root: process.cwd(), outDir: assets })
  writer = join(f.root, 'synthetic-writer')
  execFileSync('/usr/bin/cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', join(process.cwd(), 'tests/fixtures/native-auth-kernel-writer.c'), '-o', writer], { env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TMPDIR: f.root } })
})
function waitClose(child: ChildProcess) { return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => { resolve({ code, signal }) }) }) }
function clonedAssets() {
  const f = fixture(), dir = join(f.root, 'assets'); mkdirSync(dir, { mode: 0o700 })
  for (const name of ['manifest.json', 'native-auth-guard.c', 'guard-linux-x64']) copyFileSync(join(assets, name), join(dir, name))
  return dir
}
it('production strict snapshot guards all bytes and seals a real Linux callback', async () => {
  const f = fixture(); let borrowed!: Buffer
  const result = await withNativeAuthSnapshot({ root: f.source, files }, async bytes => {
    borrowed = bytes.get('auth.json')!; expect(borrowed.toString()).toBe('SYNTHETIC_SECRET_KERNEL_MARKER')
    expect(bytes.size).toBe(2); return 'SYNTHETIC_VERIFIED_RESULT'
  }, backend())
  expect(result).toBe('SYNTHETIC_VERIFIED_RESULT'); expect(borrowed.every(b => b === 0)).toBe(true)
  expect(readFileSync(join(f.source, 'state.json'), 'utf8')).toBe('SYNTHETIC_STATE')
})
it.each(['atomic', 'original-inode-aba', 'ancestor-aba'])('raw kernel watch rejects %s without a timestamp delay', async kind => {
  const f = fixture(), auth = join(f.source, 'auth.json')
  await expect(withNativeAuthSnapshot({ root: f.source, files }, async () => {
    if (kind === 'atomic') { writeFileSync(`${auth}.synthetic-new`, 'SYNTHETIC_NEW', { mode: 0o600 }); renameSync(`${auth}.synthetic-new`, auth) }
    if (kind === 'original-inode-aba') { renameSync(auth, `${auth}.retained`); writeFileSync(auth, 'SYNTHETIC_B', { mode: 0o600 }); renameSync(auth, `${auth}.interloper`); renameSync(`${auth}.retained`, auth) }
    if (kind === 'ancestor-aba') { renameSync(f.source, `${f.source}.retained`); mkdirSync(f.source, { mode: 0o700 }); renameSync(f.source, `${f.source}.interloper`); renameSync(`${f.source}.retained`, f.source) }
    return 'MUST_NOT_PUBLISH'
  }, backend())).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
})
it('preserves an actual helper SOURCE_CHANGED frame when stdin closes before its stdout listener runs', async () => {
  const f = fixture(); let injected = false, helper!: ChildProcess
  await expect(withNativeAuthSnapshot({ root: f.source, files }, async () => {
    renameSync(f.source, `${f.source}.retained`); mkdirSync(f.source, { mode: 0o700 })
    renameSync(f.source, `${f.source}.interloper`); renameSync(`${f.source}.retained`, f.source)
    return 'MUST_NOT_PUBLISH'
  }, { ...backend(), spawn: (file, args, options) => {
    helper = spawn(file, args, options)
    helper.stdout!.prependListener('data', chunk => {
      if (!injected && String(chunk).includes(' ERROR CHANGED\n')) {
        injected = true
        // Deterministic transport ordering of a real authenticated source frame,
        // not a hand-written successful guard or invented native exit evidence.
        helper.stdin!.emit('error', Object.assign(new Error('SYNTHETIC_EPIPE'), { code: 'EPIPE' }))
      }
    })
    return helper
  } })).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
  expect(injected).toBe(true); expect(helper.exitCode !== null || helper.signalCode !== null).toBe(true)
})

it.each(['protocol', 'transport-protocol', 'cancel'] as const)('an actual helper source frame cannot replace an earlier definitive %s failure', async kind => {
  const f = fixture(), control = new AbortController(); let injected = false
  await expect(withNativeAuthSnapshot({ root: f.source, files, signal: control.signal }, async () => {
    renameSync(f.source, `${f.source}.retained`); mkdirSync(f.source, { mode: 0o700 })
    renameSync(f.source, `${f.source}.interloper`); renameSync(`${f.source}.retained`, f.source)
    return 'MUST_NOT_PUBLISH'
  }, { ...backend(), spawn: (file, args, options) => {
    const child = spawn(file, args, options)
    child.stdout!.prependListener('data', chunk => {
      if (!injected && String(chunk).includes(' ERROR CHANGED\n')) {
        injected = true
        if (kind !== 'cancel') {
          if (kind === 'transport-protocol') child.stdin!.emit('error', Object.assign(new Error('SYNTHETIC_EPIPE'), { code: 'EPIPE' }))
          child.stdout!.emit('data', Buffer.from('SYNTHETIC_PRIVATE_INVALID_FRAME\n'))
        } else control.abort({ private: 'SYNTHETIC_PRIVATE_CANCEL' })
      }
    })
    return child
  } })).rejects.toMatchObject({ code: kind === 'cancel' ? 'CANCELLED' : 'VALIDATION_FAILED' })
  expect(injected).toBe(true)
})

it.each(['partial', 'wrong-nonce', 'bad-tail', 'duplicate-terminal'] as const)('a real source-error stream modified as %s is protocol failure, never trusted source proof', async kind => {
  const f = fixture(); let changed = false
  await expect(withNativeAuthSnapshot({ root: f.source, files }, async () => {
    renameSync(f.source, `${f.source}.retained`); mkdirSync(f.source, { mode: 0o700 })
    renameSync(f.source, `${f.source}.interloper`); renameSync(`${f.source}.retained`, f.source)
    return 'MUST_NOT_PUBLISH'
  }, { ...backend(), spawn: (file, args, options) => {
    const child = spawn(file, args, options), emit = child.stdout!.emit.bind(child.stdout!)
    child.stdout!.emit = ((event: string, ...args: unknown[]) => {
      if (event === 'data' && !changed && Buffer.isBuffer(args[0]) && args[0].toString().includes(' ERROR CHANGED\n')) {
        changed = true; const frame = args[0] as Buffer
        args[0] = kind === 'partial' ? frame.subarray(0, frame.length - 1)
          : kind === 'wrong-nonce' ? Buffer.from(frame.toString().replace(/AS1 [a-f0-9]{32} ERROR/, 'AS1 ' + '0'.repeat(32) + ' ERROR'))
          : kind === 'bad-tail' ? Buffer.concat([frame, Buffer.from('SYNTHETIC_PARTIAL_PRIVATE_TAIL')]) : Buffer.concat([frame, frame])
      }
      return emit(event, ...args)
    }) as NonNullable<typeof child.stdout>['emit']
    return child
  } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  expect(changed).toBe(true)
})

it('ERROR after a real SEALED frame is a protocol violation and cannot produce a result', async () => {
  const f = fixture(); let changed = false
  await expect(withNativeAuthSnapshot({ root: f.source, files }, async () => 'MUST_NOT_PUBLISH', { ...backend(), spawn: (file, args, options) => {
    const child = spawn(file, args, options), emit = child.stdout!.emit.bind(child.stdout!)
    child.stdout!.emit = ((event: string, ...args: unknown[]) => {
      if (event === 'data' && !changed && Buffer.isBuffer(args[0]) && args[0].toString().includes(' SEALED 2\n')) {
        changed = true; const frame = args[0] as Buffer
        args[0] = Buffer.concat([frame, Buffer.from(frame.toString().replace('SEALED 2', 'ERROR CHANGED'))])
      }
      return emit(event, ...args)
    }) as NonNullable<typeof child.stdout>['emit']
    return child
  } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  expect(changed).toBe(true)
})

it('EPIPE alone and a synchronous CHECK write error never invent source change', async () => {
  for (const kind of ['epipe-only', 'write-throw'] as const) {
    const f = fixture(); let child!: ChildProcess
    await expect(withNativeAuthSnapshot({ root: f.source, files }, async () => {
      child.stdin!.emit('error', Object.assign(new Error('SYNTHETIC_PRIVATE_EPIPE'), { code: 'EPIPE' }))
      return 'MUST_NOT_PUBLISH'
    }, { ...backend(), spawn: (file, args, options) => {
      child = spawn(file, args, options)
      if (kind === 'write-throw') {
        const write = child.stdin!.write.bind(child.stdin!)
        child.stdin!.write = ((...args: unknown[]) => { if (String(args[0]).includes(' CHECK 1')) throw new Error('SYNTHETIC_PRIVATE_WRITE'); return (write as any)(...args) }) as NonNullable<typeof child.stdin>['write']
      }
      return child
    } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  }
})

it('unconfirmed actual-close transport remains higher priority than a valid source error', async () => {
  const f = fixture(); let child!: ChildProcess
  await expect(withNativeAuthSnapshot({ root: f.source, files }, async () => {
    renameSync(f.source, `${f.source}.retained`); mkdirSync(f.source, { mode: 0o700 })
    renameSync(f.source, `${f.source}.interloper`); renameSync(`${f.source}.retained`, f.source)
    return 'MUST_NOT_PUBLISH'
  }, { ...backend(), spawn: (file, args, options) => {
    child = spawn(file, args, options); const emit = child.emit.bind(child)
    child.emit = ((event: string, ...args: unknown[]) => event === 'close' ? false : emit(event, ...args)) as typeof child.emit
    return child
  } })).rejects.toMatchObject({ code: 'CLEANUP_UNCONFIRMED' })
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
})

it.each(['BUSY', 'SOURCE_CHANGED'] as const)('a synchronous callback %s rejection outranks a transport microtask before catch resumes', async code => {
  const f = fixture(); let child!: ChildProcess
  await expect(withNativeAuthSnapshot({ root: f.source, files }, () => {
    queueMicrotask(() => child.stdin!.emit('error', Object.assign(new Error('SYNTHETIC_PRIVATE_EPIPE'), { code: 'EPIPE' })))
    throw new NativeAuthError(code)
  }, { ...backend(), spawn: (file, args, options) => { child = spawn(file, args, options); return child } })).rejects.toMatchObject({ code })
})

it.each(['BUSY', 'SOURCE_CHANGED', 'VALIDATION_FAILED'] as const)('teardown transport failure cannot replace a callback %s rejection', async code => {
  const f = fixture()
  await expect(withNativeAuthSnapshot({ root: f.source, files }, async () => { throw new NativeAuthError(code) }, backend())).rejects.toMatchObject({ code })
})

it('read lease rejects nonblocking in-place truncate A-B-A before any source byte can change', async () => {
  const f = fixture(), auth = join(f.source, 'auth.json'), original = readFileSync(auth)
  await expect(withNativeAuthSnapshot({ root: f.source, files }, async () => {
    let fd: number | undefined
    try { fd = openSync(auth, constants.O_WRONLY | constants.O_TRUNC | constants.O_NONBLOCK) }
    catch (error) { expect(['EAGAIN', 'EWOULDBLOCK']).toContain((error as NodeJS.ErrnoException).code) }
    finally { if (fd !== undefined) closeSync(fd) }
    return 'MUST_NOT_PUBLISH'
  }, backend())).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
  expect(readFileSync(auth)).toEqual(original)
})
it('preexisting O_RDWR descriptor refuses lease before the callback', async () => {
  const f = fixture(), fd = openSync(join(f.source, 'auth.json'), constants.O_RDWR); let called = false
  try { await expect(withNativeAuthSnapshot({ root: f.source, files }, async () => { called = true }, backend())).rejects.toBeDefined() }
  finally { closeSync(fd) }
  expect(called).toBe(false)
})
it('abort and callback exception are bounded fixed errors, borrowed bytes wiped, kernel lease released', async () => {
  for (const abort of [true, false]) {
    const f = fixture(), controller = new AbortController(); let borrowed!: Buffer
    const work = withNativeAuthSnapshot({ root: f.source, files, signal: controller.signal }, async bytes => {
      borrowed = bytes.get('auth.json')!
      if (abort) { controller.abort('SYNTHETIC_PRIVATE_ABORT'); await new Promise<void>(() => {}) }
      throw new Error(`SYNTHETIC_PRIVATE_ERROR ${f.source}`)
    }, backend())
    const error = await work.catch(e => e)
    expect(error.code).toBe(abort ? 'CANCELLED' : 'VALIDATION_FAILED')
    expect(JSON.stringify(error)).not.toContain('SYNTHETIC_PRIVATE'); expect(error).not.toHaveProperty('cause')
    expect(borrowed.every(b => b === 0)).toBe(true)
    const fd = openSync(join(f.source, 'auth.json'), constants.O_WRONLY | constants.O_NONBLOCK); closeSync(fd)
  }
})
it.each(['missing', 'nonexec', 'architecture', 'abi', 'hash', 'elf'])('unproved package backend %s remains explicitly unsupported', async kind => {
  const f = fixture(), dir = kind === 'missing' ? join(f.root, 'missing') : clonedAssets()
  if (kind === 'nonexec') chmodSync(join(dir, 'guard-linux-x64'), 0o600)
  if (['architecture', 'abi', 'hash', 'elf'].includes(kind)) {
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    if (kind === 'architecture') manifest.arch = 'arm64'
    if (kind === 'abi') manifest.libc = 'SYNTHETIC_UNKNOWN_LIBC'
    if (kind === 'hash') manifest.binarySha256 = '0'.repeat(64)
    if (kind === 'elf') {
      const bytes = readFileSync(join(dir, 'guard-linux-x64')); bytes.writeUInt16LE(183, 18)
      writeFileSync(join(dir, 'guard-linux-x64'), bytes); manifest.binarySha256 = createHash('sha256').update(bytes).digest('hex')
    }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 })
  }
  let called = false
  await expect(withNativeAuthSnapshot({ root: f.source, files }, async () => { called = true }, { assetsDirectory: dir })).rejects.toMatchObject({ code: 'UNSUPPORTED' })
  expect(called).toBe(false)
})

it('pnpm-like hardlinked code assets work, but hardlinked asset tampering still fails closed', async () => {
  const f = fixture(), origin = clonedAssets(), dir = join(f.root, 'hardlinked-assets'); mkdirSync(dir, { mode: 0o700 })
  for (const name of ['manifest.json', 'native-auth-guard.c', 'guard-linux-x64']) linkSync(join(origin, name), join(dir, name))
  expect(statSync(join(dir, 'guard-linux-x64')).nlink).toBe(2)
  expect(await withNativeAuthSnapshot({ root: f.source, files }, async () => 'SYNTHETIC_HARDLINK_OK', { assetsDirectory: dir })).toBe('SYNTHETIC_HARDLINK_OK')
  const bytes = readFileSync(join(origin, 'guard-linux-x64')); bytes[bytes.length - 1] ^= 1
  writeFileSync(join(origin, 'guard-linux-x64'), bytes)
  await expect(withNativeAuthSnapshot({ root: f.source, files }, async () => 'MUST_NOT_PUBLISH', { assetsDirectory: dir })).rejects.toMatchObject({ code: 'UNSUPPORTED' })
})

it('direct cache siblings can create a target store while the source is guarded', async () => {
  const direct = mkdtempSync(join(process.cwd(), '.cache/auth-profile-direct-source-'))
  writeFileSync(join(direct, 'auth.json'), 'SYNTHETIC_DIRECT_SOURCE', { mode: 0o600 })
  const value = await withNativeAuthSnapshot({ root: direct, files: [{ path: 'auth.json', maxBytes: 128 }] }, async () => {
    const target = mkdtempSync(join(process.cwd(), '.cache/auth-profile-direct-target-'))
    expect(NativeAuthStore.initialize(join(target, 'store')).list()).toEqual([])
    return 'SYNTHETIC_CACHE_SIBLING_OK'
  }, backend())
  expect(value).toBe('SYNTHETIC_CACHE_SIBLING_OK')
})

it('source and target-store siblings can stage private files without invalidating ancestor mtime', async () => {
  const f = fixture(); let staged = ''
  const result = await withNativeAuthSnapshot({ root: f.source, files }, async () => {
    const target = join(f.root, 'target'); mkdirSync(target, { mode: 0o700 }); staged = join(target, 'auth.json')
    writeFileSync(staged, 'SYNTHETIC_STAGING', { mode: 0o600 }); return 'SYNTHETIC_STAGED'
  }, backend())
  expect(result).toBe('SYNTHETIC_STAGED'); expect(statSync(staged).mode & 0o777).toBe(0o600)
})

it.each(['symlink', 'hardlink', 'permissions', 'ancestor-link', 'too-large', 'nonadjacent-prefix'])('strict source %s fails before bytes reach the callback', async kind => {
  const f = fixture(), auth = join(f.source, 'auth.json'); let selected = files
  if (kind === 'symlink') { renameSync(auth, `${auth}.retained`); symlinkSync(`${auth}.retained`, auth) }
  if (kind === 'hardlink') linkSync(auth, `${auth}.retained-link`)
  if (kind === 'permissions') chmodSync(auth, 0o644)
  if (kind === 'ancestor-link') { renameSync(f.source, `${f.source}.retained`); symlinkSync(`${f.source}.retained`, f.source) }
  if (kind === 'too-large') selected = [{ path: 'auth.json', maxBytes: 1 }]
  if (kind === 'nonadjacent-prefix') selected = [{ path: 'a', maxBytes: 1 }, { path: 'a-x', maxBytes: 1 }, { path: 'a/b', maxBytes: 1 }]
  let called = false
  await expect(withNativeAuthSnapshot({ root: f.source, files: selected }, async () => { called = true }, backend())).rejects.toBeDefined()
  expect(called).toBe(false)
})

it.each(['mmap', 'mprotect'])('existing MAP_SHARED capability after FD close blocks snapshot: %s', async mode => {
  const f = fixture(), peer = spawn(writer, [mode, join(f.source, 'auth.json')], { stdio: ['pipe', 'pipe', 'pipe'] }), done = waitClose(peer)
  try {
    expect(String((await once(peer.stdout!, 'data'))[0])).toContain('SYNTHETIC_READY')
    let called = false
    await expect(withNativeAuthSnapshot({ root: f.source, files }, async () => { called = true }, backend())).rejects.toMatchObject({ code: 'BUSY' })
    expect(called).toBe(false); peer.stdin!.end('x'); expect(await done).toMatchObject({ code: 0, signal: null })
  } finally { if (peer.exitCode === null && peer.signalCode === null) { peer.kill('SIGKILL'); await done } }
})

it('blocking in-place truncate A-B-A aborts import and writer resumes promptly after helper exit', async () => {
  const f = fixture(), original = readFileSync(join(f.source, 'auth.json')); let peer: ChildProcess | undefined, done: ReturnType<typeof waitClose> | undefined
  try {
    await expect(withNativeAuthSnapshot({ root: f.source, files }, async () => {
      peer = spawn(writer, ['truncate-aba', join(f.source, 'auth.json')], { stdio: ['ignore', 'pipe', 'pipe'] }); done = waitClose(peer)
      await done; return 'MUST_NOT_PUBLISH'
    }, backend())).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
    expect(await done!).toMatchObject({ code: 0, signal: null })
    expect(readFileSync(join(f.source, 'auth.json'))).toEqual(original)
  } finally { if (peer && peer.exitCode === null && peer.signalCode === null) { peer.kill('SIGKILL'); await done } }
})

it('actual raw queue overflow is rejected, not hidden behind Node watch delivery', async () => {
  const f = fixture(); let guard!: ChildProcess, trace = ''
  const limit = Number(readFileSync('/proc/sys/fs/inotify/max_queued_events', 'utf8'))
  expect(limit).toBeLessThanOrEqual(65536)
  await expect(withNativeAuthSnapshot({ root: f.source, files }, async () => {
    guard.kill('SIGSTOP')
    try {
      for (let i = 0; i < limit + 1024; i++) { const fd = openSync(join(f.source, `SYNTHETIC_OVERFLOW_${i}`), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600); closeSync(fd) }
    } finally { guard.kill('SIGCONT') }
    await new Promise<void>(() => {})
  }, { ...backend(), timeoutMs: 10000, spawn: (file, args, options) => {
    guard = spawn(file, args, options); guard.stdout!.on('data', c => { trace += String(c) }); return guard
  } })).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
  expect(trace).toContain('ERROR OVERFLOW')
}, 15000)

it('duplicate kernel watch descriptors union every relevant child-name filter', async () => {
  const f = fixture(), dir = openSync(f.source, constants.O_RDONLY | constants.O_DIRECTORY); let secondName = ''
  try {
    await expect(withNativeAuthSnapshot({ root: f.source, files }, async () => {
      expect(secondName).not.toBe('auth.json'); expect(secondName).not.toBe('state.json')
      writeFileSync(join(f.source, secondName), 'SYNTHETIC_DUPLICATE_WATCH_EVENT', { mode: 0o600 })
      return 'MUST_NOT_PUBLISH'
    }, { ...backend(), spawn: (file, args, options) => {
      const stdio = [...options.stdio as Array<any>]
      // Simulate two inherited ancestor descriptions resolving to one inode.
      // They retain different filters; later source-directory filters also
      // share that kernel wd. This injection can only demand rejection.
      stdio[3 + files.length] = dir; stdio[4 + files.length] = dir
      const child = spawn(file, args, { ...options, stdio }), write = child.stdin!.write.bind(child.stdin!)
      child.stdin!.write = ((chunk: any, ...rest: any[]) => {
        const lines = String(chunk).trimEnd().split('\n')
        if (lines[0]?.startsWith('AS1 ') && lines[0].split(' ').length === 6) {
          const first = 1 + files.length, second = first + 1 + Number(lines[first].split(' ')[1])
          secondName = Buffer.from(lines[second + 1], 'hex').toString('utf8')
        }
        return (write as any)(chunk, ...rest)
      }) as NonNullable<typeof child.stdin>['write']
      return child
    } })).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
  } finally { closeSync(dir) }
})

it('C rejects an unsupported real procfs metadata descriptor before any source read', async () => {
  const f = fixture(), proc = openSync('/proc', constants.O_RDONLY | constants.O_DIRECTORY); let called = false
  try {
    await expect(withNativeAuthSnapshot({ root: f.source, files }, async () => { called = true }, { ...backend(), spawn: (file, args, options) => {
      const stdio = [...options.stdio as Array<any>]; stdio[3 + files.length] = proc
      return spawn(file, args, { ...options, stdio })
    } })).rejects.toMatchObject({ code: 'UNSUPPORTED' })
  } finally { closeSync(proc) }
  expect(called).toBe(false)
})

it.each(['unknown-frame', 'duplicate-ready', 'unknown-sequence', 'oversized-frame', 'partial-frame', 'early-exit', 'EOF', 'timeout'])('unknown lifecycle %s yields no result and confirms helper cleanup', async kind => {
  const f = fixture(); let guard!: ChildProcess, injected = false, readyFrame = ''
  await expect(withNativeAuthSnapshot({ root: f.source, files }, async () => {
    if (kind === 'EOF') guard.stdin!.end()
    if (kind === 'duplicate-ready') guard.stdout!.emit('data', Buffer.from(readyFrame))
    if (kind === 'unknown-sequence') guard.stdout!.emit('data', Buffer.from(readyFrame.replace('READY 0', 'SEALED 99')))
    if (kind === 'oversized-frame') guard.stdout!.emit('data', Buffer.alloc(4097, 65))
    await new Promise<void>(() => {})
  }, { ...backend(), timeoutMs: kind === 'timeout' ? 100 : 1000, spawn: (file, args, options) => {
    guard = spawn(file, args, options)
    guard.stdout!.on('data', chunk => { if (String(chunk).includes('READY 0')) readyFrame = String(chunk).split('\n').find(s => s.endsWith('READY 0'))! + '\n' })
    if (kind === 'early-exit') guard.once('spawn', () => { guard.kill('SIGKILL') })
    if (kind === 'unknown-frame' || kind === 'partial-frame') guard.stdout!.prependListener('data', () => {
      if (injected) return; injected = true
      guard.stdout!.emit('data', Buffer.from(kind === 'partial-frame' ? 'SYNTHETIC_PRIVATE_PARTIAL' : 'SYNTHETIC_PRIVATE_UNKNOWN\n'))
      if (kind === 'partial-frame') guard.kill('SIGKILL')
    })
    return guard
  } })).rejects.toBeDefined()
  expect(guard.exitCode !== null || guard.signalCode !== null).toBe(true)
  const fd = openSync(join(f.source, 'auth.json'), constants.O_WRONLY | constants.O_NONBLOCK); closeSync(fd)
})

it('a helper lost during the read window cannot loan bytes to the callback without CHECKED', async () => {
  const f = fixture(); let called = false
  await expect(withNativeAuthSnapshot({ root: f.source, files }, async () => { called = true }, { ...backend(), spawn: (file, args, options) => {
    const child = spawn(file, args, options), write = child.stdin!.write.bind(child.stdin!)
    child.stdin!.write = ((chunk: any, ...rest: any[]) => {
      if (String(chunk).endsWith('CHECK 1\n')) child.kill('SIGKILL')
      return (write as any)(chunk, ...rest)
    }) as NonNullable<typeof child.stdin>['write']
    return child
  } })).rejects.toBeDefined()
  expect(called).toBe(false)
})
it('C rejects oversized numeric metadata without overflow or a successful guard', async () => {
  const f = fixture(); let called = false
  await expect(withNativeAuthSnapshot({ root: f.source, files }, async () => { called = true }, { ...backend(), spawn: (file, args, options) => {
    const child = spawn(file, args, options), write = child.stdin!.write.bind(child.stdin!)
    child.stdin!.write = ((chunk: any, ...rest: any[]) => {
      const value = String(chunk), lines = value.split('\n')
      if (lines[0].split(' ').length === 6) { const fields = lines[0].split(' '); fields[4] = '9'.repeat(200); lines[0] = fields.join(' ') }
      return (write as any)(lines.join('\n'), ...rest)
    }) as NonNullable<typeof child.stdin>['write']
    return child
  } })).rejects.toBeDefined()
  expect(called).toBe(false)
})

it('parent death releases independently owned helper leases without waiting for the kernel break timer', async () => {
  const f = fixture(), parent = fork(join(process.cwd(), 'tests/fixtures/native-auth-kernel-parent.ts'), [f.source, assets], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }), done = waitClose(parent)
  try {
    const [message] = await once(parent, 'message'); expect(message).toMatchObject({ ready: true }); expect(message.guardPid).toBeGreaterThan(0)
    parent.kill('SIGKILL'); await done
    const peer = spawn(writer, ['truncate-aba', join(f.source, 'auth.json')], { stdio: ['ignore', 'pipe', 'pipe'] }), exited = waitClose(peer)
    try { expect(await exited).toMatchObject({ code: 0, signal: null }) }
    finally { if (peer.exitCode === null && peer.signalCode === null) { peer.kill('SIGKILL'); await exited } }
  } finally { if (parent.exitCode === null && parent.signalCode === null) { parent.kill('SIGKILL'); await done } }
}, 3000)

it('strict acquisition failure cannot publish store material', async () => {
  const f = fixture(), store = NativeAuthStore.initialize(join(f.root, 'target-store')), identity = { kind: 'native-principal' as const, value: 'SYNTHETIC_PRINCIPAL' }
  await expect(store.import({ cli: 'codex', label: 'Synthetic', requestId: 'strict-fail' }, () => withNativeAuthSnapshot({ root: f.source, files }, async bytes => {
    renameSync(join(f.source, 'state.json'), join(f.source, 'state.retained'))
    return { identity, files: [...bytes].map(([path, value]) => ({ path, bytes: Buffer.from(value) })) }
  }, backend()), async () => identity)).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
  expect(NativeAuthStore.open(join(f.root, 'target-store')).list()).toEqual([])
})

it('real store publication occurs only after explicit seal plus actual helper exit in verify', async () => {
  const f = fixture(), store = NativeAuthStore.initialize(join(f.root, 'target-store')), identity = { kind: 'native-principal' as const, value: 'SYNTHETIC_PRINCIPAL' }
  let child!: ChildProcess, wire = ''
  const result = await withNativeAuthSnapshot({ root: f.source, files }, async (bytes, guard) => store.import({ cli: 'codex', label: 'Synthetic', requestId: 'seal-before-publish' }, async () => ({
    identity, files: [...bytes].map(([path, value]) => ({ path, bytes: Buffer.from(value) })),
  }), async context => {
    expect(readFileSync(join(context.nativeRoot, 'auth.json'), 'utf8')).toBe('SYNTHETIC_SECRET_KERNEL_MARKER')
    expect(store.list()).toEqual([])
    await Promise.all([guard.seal(), guard.seal()])
    expect(child.exitCode).toBe(0); expect(child.signalCode).toBe(null)
    expect(store.list()).toEqual([])
    // Simulate an independent source change after the completed sampling point.
    writeFileSync(join(f.source, 'auth.json'), 'SYNTHETIC_AFTER_SEAL', { mode: 0o600 })
    return identity
  }), { ...backend(), spawn: (file, args, options) => {
    child = spawn(file, args, options); child.stdout!.on('data', c => { wire += String(c) }); return child
  } })
  expect(result.state).toBe('available')
  expect((wire.match(/SEALED 2/g) ?? [])).toHaveLength(1)
  expect(NativeAuthStore.open(join(f.root, 'target-store')).list()).toEqual([result])
  const context = await store.resolve(result.id, 'codex', async () => identity)
  expect(readFileSync(join(context.nativeRoot, 'auth.json'), 'utf8')).toBe('SYNTHETIC_SECRET_KERNEL_MARKER')
})

it('source failure stays sticky when target verification ignores cancellation and returns late', async () => {
  const f = fixture(), store = NativeAuthStore.initialize(join(f.root, 'target-store')), identity = { kind: 'native-principal' as const, value: 'SYNTHETIC_PRINCIPAL' }
  let targetReady!: () => void, release!: () => void
  const ready = new Promise<void>(resolve => { targetReady = resolve }), gate = new Promise<void>(resolve => { release = resolve })
  let inner!: ReturnType<NativeAuthStore['import']>
  const outer = withNativeAuthSnapshot({ root: f.source, files }, async (bytes, guard) => {
    inner = store.import({ cli: 'codex', label: 'Synthetic', requestId: 'late-target' }, async () => ({ identity, files: [...bytes].map(([path, value]) => ({ path, bytes: Buffer.from(value) })) }), async () => {
      targetReady(); await gate // Deliberately ignore signal; caller must still join this work.
      await guard.seal(); return identity
    })
    return inner
  }, backend())
  await ready
  const auth = join(f.source, 'auth.json'); renameSync(auth, `${auth}.retained`); writeFileSync(auth, 'SYNTHETIC_B', { mode: 0o600 }); renameSync(auth, `${auth}.interloper`); renameSync(`${auth}.retained`, auth)
  try {
    await expect(outer).rejects.toMatchObject({ code: 'SOURCE_CHANGED' })
    expect(store.list()).toEqual([])
  } finally { release(); await expect(inner).rejects.toMatchObject({ code: 'SOURCE_CHANGED' }) }
  expect(NativeAuthStore.open(join(f.root, 'target-store')).list()).toEqual([])
})

it('explicit close aborts, waits helper exit and cannot later be converted into a successful seal', async () => {
  const f = fixture(); let closed!: Promise<void>, guardRef!: import('../src/host/native-auth-snapshot.ts').NativeAuthSnapshotGuard
  await expect(withNativeAuthSnapshot({ root: f.source, files }, async (_bytes, guard) => {
    guardRef = guard; closed = guard.close(); await closed; return 'MUST_NOT_PUBLISH'
  }, backend())).rejects.toMatchObject({ code: 'CANCELLED' })
  await closed
  await expect(guardRef.seal()).rejects.toMatchObject({ code: 'CANCELLED' })
  const fd = openSync(join(f.source, 'auth.json'), constants.O_WRONLY | constants.O_NONBLOCK); closeSync(fd)
})
