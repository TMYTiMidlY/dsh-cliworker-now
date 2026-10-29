import { afterEach, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { WorkerRuntime } from '../src/host/runtime.ts'
import { WorkerStorage } from '../src/host/storage.ts'
import { DEFAULT_CONFIG, type ProcessBackend } from '../src/host/process.ts'
// The real Host → native-bridge → owned synthetic ACP subprocess → Host result.
// No model, actual CLI, user login/profile or history is consulted.
vi.mock('../src/host/cli-account-binding.ts', () => ({ readCliAccountBinding: async () => 'synthetic-account' }))
vi.mock('../src/host/authorized-catalog.ts', () => ({ ACCOUNT_CHANGED: 'synthetic-account-changed', authorizeSelection: async (preference: unknown) => ({ binding: 'synthetic-account', preference }) }))
const closes: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close() })
const sid = 'cursor-synthetic-process'
const update = (u: any) => ({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: sid, update: u } })
const text = (text: string) => update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
it.each(['diagnostic', 'conflict', 'read-unproven', 'local-denied'] as const)('real synthetic bridge %s pauses queued followup and preserves this run rather than old lastResult', async scenario => {
  // Retained synthetic artifacts only, no deletion or real profile reads.
  const root = join(fileURLToPath(new URL('..', import.meta.url)), '.cache/cursor-outcome-runtime')
  mkdirSync(root, { recursive: true })
  const project = realpathSync(mkdtempSync(join(root, 'run-')))
  const executable = join(project, 'cursor-agent.mjs')
  const fixture = fileURLToPath(new URL('./fixtures/cursor-acp.mjs', import.meta.url))
  writeFileSync(executable, `#!${process.execPath}\n// Synthetic ACP launcher only.\nimport ${JSON.stringify(fixture)};\n`, { mode: 0o700 })
  let updates = [text('PREVIOUS SYNTHETIC RESULT')], calls = 0
  const pids: number[] = []
  const backend: ProcessBackend = {
    resolveExecutable: async () => executable,
    spawn(spec) {
      expect(spec.argv.some(s => s.endsWith('/native-bridge.mjs'))).toBe(true)
      calls++
      const child = spawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, env: { ...process.env, ...spec.env, CURSOR_SYNTHETIC_UPDATES: JSON.stringify(updates) }, stdio: ['pipe', 'pipe', 'pipe'] })
      pids.push(child.pid!)
      const done = new Promise<any>((resolve, reject) => { child.once('error', reject); child.once('exit', (exitCode, signal) => resolve({ exitCode, signal })) })
      const stop = () => { child.kill('SIGTERM') }
      spec.signal?.addEventListener('abort', stop, { once: true })
      void done.finally(() => spec.signal?.removeEventListener('abort', stop))
      return { stdout: child.stdout!, stderr: child.stderr!, done, terminate: stop, waitForExit: async () => { await done; return true } } as any
    },
  }
  const storage = new WorkerStorage(join(project, 'state'))
  const runtime = new WorkerRuntime(storage, backend, { ...DEFAULT_CONFIG, cursorExecutable: executable, timeoutMs: 4000 })
  closes.push(() => runtime.close())
  const preference = { cli: 'cursor' as const, model: 'kimi-k3[reasoning=max]', effort: 'default' as const }
  const first = await runtime.submit('parent', project, 'synthetic first', 'synthetic only', preference, 'plan').done
  expect(first.status, first.error).toBe('completed')
  expect(first.lastResult).toBe('PREVIOUS SYNTHETIC RESULT')
  updates = scenario === 'diagnostic' ? [text('CURRENT BODY\n\nPlease sign in to continue')] : scenario === 'read-unproven' ? [
    update({ sessionUpdate: 'tool_call', toolCallId: 't', kind: 'read', title: 'synthetic read', status: 'pending', rawInput: { path: '/synthetic/opaque' } }),
    update({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed' }), text('CURRENT BODY'),
  ] : scenario === 'local-denied' ? [
    update({ sessionUpdate: 'tool_call', toolCallId: 't', kind: 'execute', title: 'synthetic execute', status: 'pending', rawInput: { command: 'synthetic only, never executed' } }),
    { jsonrpc: '2.0', id: 'synthetic-denied', method: 'session/request_permission', params: { sessionId: sid, toolCall: { toolCallId: 't' }, options: [{ kind: 'reject_once', optionId: 'reject' }] } } as any,
    update({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed', content: [] }), text('CURRENT BODY'),
  ] : [
    update({ sessionUpdate: 'tool_call', toolCallId: 't', kind: 'search', title: 'synthetic tool', status: 'pending', rawInput: {} }),
    update({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed', rawOutput: { error: 'PRIVATE_NATIVE_DIAGNOSTIC' } }),
    update({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed', rawOutput: { success: true } }), text('CURRENT BODY'),
  ]
  const run = runtime.submit('parent', project, 'synthetic current', 'synthetic continuation', preference, 'plan', first.id)
  runtime.queueFollowup('parent', first.id, 'MUST NOT AUTO RUN', run.worker.runId!, randomUUID())
  const result = await run.done
  const expectedStatus = scenario === 'local-denied' ? 'failed' : 'uncertain'
  expect(result.status, result.error).toBe(expectedStatus)
  expect(result.lastResult).toBe(scenario === 'diagnostic' ? 'CURRENT BODY\n\nPlease sign in to continue' : 'CURRENT BODY')
  expect(result.lastResult).not.toContain('PREVIOUS')
  expect(result.runId).not.toBe(first.runId)
  expect(runtime.snapshot('parent', first.id).queuedFollowups).toMatchObject([{ state: 'paused', prompt: 'MUST NOT AUTO RUN' }])
  expect(calls).toBe(2)
  expect(storage.history(first.id).filter(e => e.runId === result.runId).at(-1)).toMatchObject({ runOutcome: { status: expectedStatus, cleanup: 'confirmed' } })
  const history = storage.history(first.id).filter(e => e.runId === result.runId)
  expect(JSON.stringify(history)).not.toContain('PRIVATE_NATIVE_DIAGNOSTIC')
  if (scenario === 'conflict' || scenario === 'read-unproven') expect(history.filter(e => e.kind === 'tool').every(e => !['COMPLETED', 'FAILED'].includes(e.state!))).toBe(true)
  if (scenario === 'local-denied') { expect(result.error).toContain('CLI 请求的额外权限已拒绝'); expect(history.filter(e => e.kind === 'tool').at(-1)?.state).toBe('FAILED') }
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow()
})
