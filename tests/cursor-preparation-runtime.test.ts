import { afterEach, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { readCliAccountBinding } from '../src/host/cli-account-binding.ts'
import { WorkerRuntime } from '../src/host/runtime.ts'
import { WorkerStorage } from '../src/host/storage.ts'
import { DEFAULT_CONFIG, ProcessCleanupUnconfirmedError, type ProcessBackend } from '../src/host/process.ts'
import type { Worker } from '../src/shared/types.ts'
// Actual runtime preparation guard + actual binding/status capture. All handles
// and identities are synthetic; no native CLI, credential/profile or network.
const closes: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close() })
it.each(['resolve', 'spawn', 'exit', 'cleanup', 'cancel'] as const)('preserves old worker/run/preference and zero prompt on preparation %s', async stage => {
  const root = join(fileURLToPath(new URL('..', import.meta.url)), '.cache/cursor-preparation-runtime')
  mkdirSync(root, { recursive: true })
  const project = realpathSync(mkdtempSync(join(root, 'run-')))
  let mode = 'ok'
  const marker = 'PRIVATE_PREPARATION_DRIVER'
  const driver = () => Object.assign(new Error(marker), { code: 'EACCES', name: marker, cause: marker })
  const backend: ProcessBackend = {
    resolveExecutable: vi.fn(async name => { if (mode === 'resolve') throw driver(); return name }),
    spawn: vi.fn(spec => {
      expect(spec.argv.slice(1)).toEqual(['status', '--format', 'json'])
      if (mode === 'spawn') throw driver()
      return { stdout: Readable.from([JSON.stringify({ status: 'authenticated', isAuthenticated: true, hasAccessToken: true, hasRefreshToken: true, userInfo: { userId: 71 } })]), stderr: Readable.from([marker]), done: Promise.resolve({ exitCode: mode === 'exit' || mode === 'cleanup' ? 7 : 0 }), terminate: () => {}, waitForExit: async () => mode !== 'cleanup' } as any
    }),
  }
  const config = { ...DEFAULT_CONFIG, cursorExecutable: '/synthetic/cursor-agent' }
  const binding = await readCliAccountBinding('cursor', backend, config, project, new AbortController().signal)
  const storage = new WorkerStorage(join(project, 'state'))
  const preference = { cli: 'cursor' as const, model: 'grok-synthetic[reasoning=high]', effort: 'default' as const }
  storage.setPreference(project, preference)
  const worker: Worker = { id: randomUUID(), runId: randomUUID(), parentSessionId: 'parent', project, title: 'synthetic existing worker', preference, mode: 'plan', status: 'completed', transport: 'cursor-acp-v1', conversationId: 'synthetic-old-native', lastResult: 'PREVIOUS RESULT', createdAt: '2026-10-25T00:00:00Z', updatedAt: '2026-10-25T00:00:00Z' }
  storage.save(worker); storage.bindAccount(worker.id, binding)
  const before = structuredClone(storage.workers.get(worker.id)), beforeCalls = (backend.spawn as any).mock.calls.length, beforeResolve = (backend.resolveExecutable as any).mock.calls.length
  const runtime = new WorkerRuntime(storage, backend, config); closes.push(() => runtime.close())
  mode = stage
  const controller = new AbortController(), cancel = new Error('PRIVATE_CALLER_CONTROL')
  if (stage === 'cancel') controller.abort(cancel)
  let error: any
  try { await runtime.prepareFollowup('parent', worker.id, controller.signal, own => readCliAccountBinding('cursor', backend, config, project, own)) } catch (e) { error = e }
  if (stage === 'cleanup') {
    expect(error).toBeInstanceOf(ProcessCleanupUnconfirmedError)
    expect(storage.cleanupBlockState('cursor')).toBe('blocked')
    expect(() => runtime.assertCliEnabled('cursor')).toThrow('元数据进程清理')
    expect(() => runtime.assertCliEnabled('codex')).not.toThrow()
  } else if (stage === 'cancel') {
    expect(error).toBe(cancel)
    expect((backend.resolveExecutable as any).mock.calls.length).toBe(beforeResolve)
  } else {
    expect(error).toMatchObject({ name: 'CursorMetadataError', phase: stage })
    expect(String(error) + JSON.stringify(error)).not.toMatch(/PRIVATE_|登录|登出|额度/)
    expect(storage.cleanupBlockState('cursor')).toBe('none')
  }
  expect(storage.workers.get(worker.id)).toEqual(before)
  expect(storage.preference(project, 'cursor')).toEqual(preference)
  expect(storage.accountBinding(worker.id)).toBe(binding)
  expect(storage.history(worker.id)).toHaveLength(0)
  expect((backend.spawn as any).mock.calls.length - beforeCalls).toBe(stage === 'resolve' || stage === 'spawn' || stage === 'cancel' ? stage === 'spawn' ? 1 : 0 : 1)
  if (stage === 'cleanup') {
    await runtime.close() // Release the real store lock before cold reopening.
    const restored = new WorkerRuntime(new WorkerStorage(storage.directory), backend, config); closes.push(() => restored.close())
    expect(() => restored.assertCliEnabled('cursor')).toThrow('元数据进程清理')
    expect(() => restored.assertCliEnabled('codex')).not.toThrow()
  }
})
