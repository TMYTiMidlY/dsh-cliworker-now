import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { HarnessConversationStore } from '../src/host/harness-conversation-store.ts'

const directories: string[] = []
const directory = () => {
  const path = mkdtempSync(join(tmpdir(), 'cwn-bindings-'))
  directories.push(path)
  return path
}
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})
it('restores independent native identities and initial attach state without changing the CLI identity', () => {
  const root = directory(),
    store = new HarnessConversationStore(root)
  const record = {
    workerId: randomUUID(),
    parentSessionId: 'parent',
    sessionId: 'native-child',
    initialRunId: randomUUID(),
    initialPending: true,
  }
  store.save(record)
  expect(new HarnessConversationStore(root).list()).toEqual([record])
  if (process.platform !== 'win32')
    expect(statSync(join(root, 'harness-conversations.json')).mode & 0o777).toBe(0o600)
  store.save({ ...record, initialPending: false })
  expect(new HarnessConversationStore(root).list()[0]?.initialPending).toBe(false)
  expect(() => store.save({ ...record, parentSessionId: 'other' })).toThrow()
  expect(() => store.save({ ...record, sessionId: 'other-child' })).toThrow()
})
it('rolls back only the exact association and persists the removal', () => {
  const root = directory(),
    store = new HarnessConversationStore(root)
  const record = { workerId: randomUUID(), parentSessionId: 'parent', sessionId: 'native-child' }
  store.save(record)
  expect(() => store.remove({ ...record, workerId: randomUUID() })).toThrow()
  expect(store.list()).toEqual([record])
  store.remove(record)
  expect(new HarnessConversationStore(root).list()).toEqual([])
})
it('atomically replaces only the current owned association and preserves every retired Session reference', () => {
  const root = directory(),
    store = new HarnessConversationStore(root)
  const old = { workerId: randomUUID(), parentSessionId: 'parent', sessionId: randomUUID() }
  store.save(old)
  const replacement = { ...old, sessionId: randomUUID(), retiredSessionIds: [old.sessionId] }
  expect(() => store.replace({ ...old, parentSessionId: 'other' }, replacement)).toThrow()
  expect(() => store.replace(old, { ...replacement, retiredSessionIds: [] })).toThrow()
  store.replace(old, replacement)
  expect(new HarnessConversationStore(root).list()).toEqual([replacement])
  expect(() => store.replace(old, replacement)).toThrow()
  const rollback = { ...old, retiredSessionIds: [replacement.sessionId] }
  store.replace(replacement, rollback)
  expect(new HarnessConversationStore(root).list()).toEqual([rollback])
})
function stagedUnpublished() {
  const root = directory(), store = new HarnessConversationStore(root)
  const prior = { workerId: randomUUID(), parentSessionId: 'synthetic-parent', sessionId: randomUUID(),
    initialPending: false, retiredSessionIds: [randomUUID()], turnRuns: [{ turn: 1, runId: randomUUID() }] }
  store.save(prior)
  const candidate = { workerId: prior.workerId, parentSessionId: prior.parentSessionId, sessionId: randomUUID(),
    initialRunId: randomUUID(), initialPending: true, retiredSessionIds: [...prior.retiredSessionIds, prior.sessionId] }
  store.replace(prior, candidate)
  return { root, store, prior, candidate }
}
it('internal unpublished rollback restores exact captured prior and retired set without weakening ordinary replacement', () => {
  const { root, store, prior, candidate } = stagedUnpublished()
  expect(() => store.replace(candidate, prior)).toThrow('历史引用')
  store.restoreUnpublished(candidate, prior)
  expect(store.list()).toEqual([prior]); expect(new HarnessConversationStore(root).list()).toEqual([prior])
  expect(() => store.restoreUnpublished(candidate, prior)).toThrow()
})
it.each(['worker', 'parent', 'turn', 'retired', 'candidate'] as const)('rejects changed %s in the complete rollback CAS', kind => {
  const { store, prior, candidate } = stagedUnpublished()
  const wrong = structuredClone(prior), next = structuredClone(candidate)
  if (kind === 'worker') wrong.workerId = randomUUID()
  if (kind === 'parent') wrong.parentSessionId = 'foreign-parent'
  if (kind === 'turn') wrong.turnRuns[0]!.turn++
  if (kind === 'retired') wrong.retiredSessionIds.push(randomUUID())
  if (kind === 'candidate') next.initialRunId = randomUUID()
  expect(() => store.restoreUnpublished(next, wrong)).toThrow('精确身份或内容')
  expect(store.list()).toEqual([candidate])
})
it.each(['same-value-revision', 'new-turn', 'cold-store'] as const)('rejects %s without rewriting candidate or any previous run', kind => {
  const { root, store, prior, candidate } = stagedUnpublished()
  if (kind === 'same-value-revision') store.save({ ...candidate })
  if (kind === 'new-turn') store.save({ ...candidate, turnRuns: [{ turn: 2, runId: candidate.initialRunId }] })
  const active = kind === 'cold-store' ? new HarnessConversationStore(root) : store
  const before = active.list()
  expect(() => active.restoreUnpublished(candidate, prior)).toThrow('精确身份或内容')
  expect(active.list()).toEqual(before)
})
it('failed unpublished rollback commit does not publish prior or remove the candidate', () => {
  const { root, store, prior, candidate } = stagedUnpublished()
  const save = vi.spyOn(store as any, 'commit').mockImplementationOnce(() => { throw new Error('synthetic denied commit') })
  try {
    expect(() => store.restoreUnpublished(candidate, prior)).toThrow('denied commit')
    expect(store.list()).toEqual([candidate]); expect(new HarnessConversationStore(root).list()).toEqual([candidate])
  } finally { save.mockRestore() }
})
it('persists projection-only admitted runs without exposing mutable internal arrays', () => {
  const root = directory(),
    store = new HarnessConversationStore(root)
  const pending = { requestId: randomUUID(), runId: randomUUID() }
  const record = {
    workerId: randomUUID(),
    parentSessionId: 'parent',
    sessionId: 'native-child',
    pendingRuns: [pending],
  }
  store.save(record)
  const exposed = store.list()[0]!
  exposed.pendingRuns!.splice(0)
  expect(store.list()[0]!.pendingRuns).toEqual([pending])
  expect(new HarnessConversationStore(root).list()[0]!.pendingRuns).toEqual([pending])
  expect(() => store.save({ ...record, pendingRuns: Array(257).fill(pending) })).toThrow()
})
it.skipIf(process.platform === 'win32')('refuses a symlinked association file', () => {
  const root = directory(),
    target = directory()
  symlinkSync(join(target, 'missing'), join(root, 'harness-conversations.json'))
  expect(() => new HarnessConversationStore(root)).toThrow()
})

it('durably saves per-input intent and acceptance without retaining prompt bodies or leaking mutable records', () => {
  const root = directory(),
    store = new HarnessConversationStore(root)
  const input = {
    requestId: randomUUID(),
    promptHash: 'a'.repeat(64),
    batchId: randomUUID(),
    accepted: false,
  }
  const record = {
    workerId: randomUUID(),
    parentSessionId: 'parent',
    sessionId: 'native-child',
    nativeInputs: [input],
  }
  store.save(record)
  expect(new HarnessConversationStore(root).list()).toEqual([record])
  const exposed = store.list()[0]!
  exposed.nativeInputs![0]!.accepted = true
  expect(store.list()[0]!.nativeInputs).toEqual([input])
  const accepted = { ...record, nativeInputs: [{ ...input, accepted: true }] }
  store.save(accepted)
  expect(new HarnessConversationStore(root).list()).toEqual([accepted])
  expect(() => store.save({ ...record, nativeInputs: [{ ...input, promptHash: 'invalid' }] })).toThrow()
  expect(() => store.save({ ...record, nativeInputs: Array(10001).fill(input) })).toThrow()
  const unknown = {
    ...record,
    nativeInputs: [{ ...input, delivery: 'steer' as const, steeringState: 'unknown' as const }],
  }
  store.save(unknown)
  expect(new HarnessConversationStore(root).list()).toEqual([unknown])
})
