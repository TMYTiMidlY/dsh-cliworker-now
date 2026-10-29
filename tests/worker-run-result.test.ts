import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { WorkerStorage } from '../src/host/storage.ts'
import { workerRunResult } from '../src/host/worker-result.ts'
import type { Worker } from '../src/shared/types.ts'

// Synthetic public history only. No native CLI/model/auth or private real session is read.
const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
function setup() {
  mkdirSync('.cache', { recursive: true })
  const root = mkdtempSync(join(process.cwd(), '.cache/worker-result-synthetic-'))
  const storage = new WorkerStorage(join(root, 'state'))
  cleanups.push(() => storage.close())
  const worker: Worker = { id: randomUUID(), runId: randomUUID(), parentSessionId: 'synthetic-parent', project: root, title: 'Synthetic',
    preference: { cli: 'antigravity', model: 'SYNTHETIC_ARGON', effort: 'default' }, mode: 'plan', status: 'running',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastResult: 'MUST_NOT_BORROW_PREVIOUS_RESULT' }
  storage.save(worker)
  const append = (event: Parameters<WorkerStorage['append']>[1]) => storage.append(worker, event)
  const begin = () => { append({ kind: 'user', text: 'SYNTHETIC_REQUEST' }); append({ kind: 'status', text: 'queued', state: 'queued', runConfiguration: { preference: { ...worker.preference }, mode: worker.mode } }) }
  const end = (status: Worker['status'] = 'completed', cleanup: 'confirmed' | 'unconfirmed' | 'unknown' = 'confirmed') => {
    worker.status = status; storage.save(worker)
    append({ kind: 'status', text: status, state: status, runOutcome: { status, cleanup, ...(status === 'failed' ? { error: 'SYNTHETIC_STREAM_INTERRUPTED' } : {}) } })
  }
  return { root, storage, worker, append, begin, end }
}
it('returns immutable per-run configuration and native observation after the Worker is reconfigured', () => {
  const f = setup(); f.begin()
  f.append({ kind: 'status', text: 'native init', observedModel: 'SYNTHETIC_ARGON' })
  f.append({ kind: 'assistant', text: 'Argon answer', step: 0 }); f.end()
  const firstRun = f.worker.runId
  f.worker.preference = { ...f.worker.preference, model: 'SYNTHETIC_OPUS' }; f.storage.save(f.worker)
  expect(workerRunResult(f.storage, f.worker, { runId: firstRun })).toMatchObject({ configuredModel: 'SYNTHETIC_ARGON', observedModel: 'SYNTHETIC_ARGON', modelMatchesConfigured: true, status: 'completed', body: 'Argon answer' })
  f.worker.runId = randomUUID(); f.worker.status = 'running'; f.storage.save(f.worker); f.begin()
  expect(workerRunResult(f.storage, f.worker)).toMatchObject({ configuredModel: 'SYNTHETIC_OPUS', observedModel: null, modelEvidence: 'unknown', body: '', status: 'running' })
  expect(workerRunResult(f.storage, f.worker, { runId: firstRun }).body).toBe('Argon answer')
})
it.each(['failed', 'interrupted', 'uncertain'] as const)('preserves %s public segments without reasoning, tool payloads, bad aggregate or old lastResult', status => {
  const f = setup(); f.begin()
  f.append({ kind: 'reasoning', text: 'PRIVATE_REASONING' }); f.append({ kind: 'tool', text: 'tool', detail: 'PRIVATE_TOOL' })
  f.append({ kind: 'assistant', text: 'first ', step: 0 }); f.append({ kind: 'assistant', text: 'segment', step: 0 })
  f.append({ kind: 'assistant', text: 'second', step: 1 }); f.append({ kind: 'result', text: 'STALE_AGGREGATE', state: 'ERROR' })
  f.end(status, status === 'uncertain' ? 'unconfirmed' : 'confirmed')
  const value = workerRunResult(f.storage, f.worker)
  expect(value).toMatchObject({ status, partial: true, body: 'first segment\n\nsecond' })
  expect(JSON.stringify(value)).not.toMatch(/PRIVATE_|STALE_AGGREGATE|MUST_NOT_BORROW/)
})
it('no-body timeout is empty, not the previous success', () => {
  const f = setup(); f.begin(); f.end('failed')
  expect(workerRunResult(f.storage, f.worker)).toMatchObject({ body: '', error: 'SYNTHETIC_STREAM_INTERRUPTED', partial: true })
})
it('legacy records have unknown configuration/cleanup even when the latest Worker has a preference', () => {
  const f = setup(); f.append({ kind: 'user', text: 'legacy' }); f.append({ kind: 'assistant', text: 'legacy reply' }); f.append({ kind: 'status', text: 'completed', state: 'completed' })
  expect(workerRunResult(f.storage, f.worker)).toMatchObject({ body: 'legacy reply', configuredModel: null, configuredEffort: null, configurationEvidence: 'unknown', cleanup: 'unknown' })
})
it('native mismatch remains distinct from requested configuration', () => {
  const f = setup(); f.begin(); f.append({ kind: 'status', text: 'init', observedModel: 'SYNTHETIC_OTHER_MODEL' }); f.end('failed')
  expect(workerRunResult(f.storage, f.worker)).toMatchObject({ configuredModel: 'SYNTHETIC_ARGON', observedModel: 'SYNTHETIC_OTHER_MODEL', modelMatchesConfigured: false, status: 'failed' })
})
it.each(['wrong', 'conflicting'] as const)('historically completed %s model evidence is not verified target-model completion', kind => {
  const f = setup(); f.begin()
  f.append({ kind: 'status', text: 'init', observedModel: 'SYNTHETIC_OTHER_MODEL' })
  if (kind === 'conflicting') f.append({ kind: 'status', text: 'other init', observedModel: 'SYNTHETIC_ARGON' })
  f.append({ kind: 'assistant', text: 'A body does not prove Opus' }); f.end()
  const result = workerRunResult(f.storage, f.worker)
  expect(result.status).toBe('completed'); expect(result.targetModelVerified).toBe(false); expect(result.notice).toContain('不得计为目标模型完成')
  expect(result.modelEvidence).toBe(kind === 'conflicting' ? 'conflicting' : 'native')
})
it('accepts a successful explicitly run-scoped body without stream assistant while refusing ERROR or unscoped fallbacks', () => {
  const f = setup(); f.worker.preference.cli = 'codex'; f.begin()
  f.append({ kind: 'result', text: 'SYNTHETIC_SCOPED_SUCCESS', state: 'SUCCESS', resultScope: 'run' }); f.end()
  expect(workerRunResult(f.storage, f.worker)).toMatchObject({ body: 'SYNTHETIC_SCOPED_SUCCESS', bodyEvidence: 'successful-run-result' })
  for (const state of ['ERROR', 'SUCCESS']) {
    f.worker.runId = randomUUID(); f.storage.save(f.worker); f.begin()
    f.append({ kind: 'result', text: 'MUST_NOT_BORROW_UNSCOPED_OR_FAILED', state }); f.end(state === 'ERROR' ? 'failed' : 'completed')
    expect(workerRunResult(f.storage, f.worker)).toMatchObject({ body: '', bodyEvidence: 'unknown-result-scope', completeness: 'unknown' })
  }
})
it.each(['completed', 'failed'] as const)('unscoped SUCCESS cannot extend %s run public text with an older-session suffix', status => {
  const f = setup(); f.begin()
  f.append({ kind: 'assistant', text: 'CURRENT', step: 0 })
  f.append({ kind: 'result', text: 'CURRENT\nOLD_SESSION_TEXT', state: 'SUCCESS' })
  f.end(status)
  expect(workerRunResult(f.storage, f.worker)).toMatchObject({ status, body: 'CURRENT', bodyEvidence: 'public-assistant' })
})
it('snapshot paging survives appended output, a later run and a storage restart without gaps or duplicate text', () => {
  const f = setup(); f.begin()
  const body = '合成🙂abcdef'.repeat(5000)
  f.append({ kind: 'assistant', text: body, step: 0 })
  const firstRun = f.worker.runId, first = workerRunResult(f.storage, f.worker, { limit: 511 })
  f.append({ kind: 'assistant', text: 'APPENDED_AFTER_WATERMARK', step: 0 }); f.end()
  f.worker.runId = randomUUID(); f.worker.preference.model = 'SYNTHETIC_OPUS'; f.storage.save(f.worker); f.begin()
  f.storage.close(); const restored = new WorkerStorage(f.storage.directory); cleanups.push(() => restored.close())
  const current = restored.workers.get(f.worker.id)!
  let result = first, combined = first.body, pages = 1
  while (result.nextCursor) {
    const request = { cursor: result.nextCursor }
    result = workerRunResult(restored, current, request)
    expect(workerRunResult(restored, current, request)).toEqual(result)
    expect(result.runId).toBe(firstRun); expect(result.status).toBe('running')
    expect(result.snapshot).toEqual(first.snapshot); combined += result.body; pages++
  }
  expect(pages).toBeGreaterThan(50); expect(combined).toBe(body)
  if (process.platform !== 'win32') {
    expect(statSync(f.storage.directory).mode & 0o777).toBe(0o700)
    expect(statSync(join(f.storage.directory, `${f.worker.id}.events.jsonl`)).mode & 0o777).toBe(0o600)
    expect(statSync(join(f.storage.directory, 'result-cursor-key.json')).mode & 0o777).toBe(0o600)
  }
})
it.each([0, -1, 8193, 1.5, NaN])('rejects invalid page limit %s', limit => {
  const f = setup(); f.begin(); expect(() => workerRunResult(f.storage, f.worker, { limit })).toThrow()
})
it('unknown run never falls back, and malformed/forged/cross-worker/cross-run cursors are refused', () => {
  const f = setup(); f.begin(); f.append({ kind: 'assistant', text: 'abc'.repeat(1000) }); f.end()
  expect(() => workerRunResult(f.storage, f.worker, { runId: randomUUID() })).toThrow('不存在')
  const first = workerRunResult(f.storage, f.worker, { limit: 10 })
  for (const cursor of ['', '../private', 'x'.repeat(2049), first.nextCursor!.slice(0, -1) + (first.nextCursor!.endsWith('0') ? '1' : '0')])
    expect(() => workerRunResult(f.storage, f.worker, { cursor })).toThrow()
  expect(() => workerRunResult(f.storage, { ...f.worker, id: randomUUID() }, { cursor: first.nextCursor! })).toThrow()
  expect(() => workerRunResult(f.storage, f.worker, { cursor: first.nextCursor!, runId: randomUUID() })).toThrow()
  expect(() => workerRunResult(f.storage, f.worker, { cursor: first.nextCursor!, limit: 20 })).toThrow()
})
