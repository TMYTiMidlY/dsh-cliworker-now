import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { WorkerRuntime } from '../src/host/runtime.ts'
import { WorkerStorage } from '../src/host/storage.ts'
import { DEFAULT_CONFIG } from '../src/host/process.ts'
import { readCliAccountBinding } from '../src/host/cli-account-binding.ts'
import { readOwnedLedger, unsettledOwnedLedgers, verifySettlement, saveOwnedLedger, signSettlement } from '../src/host/opencode-v2-ledger.mjs'
import { visibleModelChoices } from '../src/shared/model-presentation.ts'
import { bridgedFeatureSupport } from '../src/shared/conversation-features.ts'
import { workerPermissionOptions } from '../src/shared/worker-permissions.ts'
import { syntheticOpenCodeV2 } from './fixtures/opencode-v2-service.ts'

const closes: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); vi.unstubAllEnvs() })
async function setup(mode = 'success') {
  const service = await syntheticOpenCodeV2(); service.setMode(mode); closes.push(service.close)
  const config = { ...DEFAULT_CONFIG, opencodeExecutable: process.execPath, stateDirectory: service.state, timeoutMs: 15000, graceMs: 1000 }
  const storage = new WorkerStorage(service.state), runtime = new WorkerRuntime(storage, service.backend, config)
  closes.push(() => runtime.close())
  const preference = { cli: 'opencode' as const, model: `opencode-v2:${Buffer.from(JSON.stringify(['own', 'G', null])).toString('base64url')}`, effort: 'default' as const }
  const submit = (prompt = '明确模拟的纯文本请求', workerId?: string) => runtime.submit('synthetic-parent', service.project, 'v2 owned synthetic', prompt, preference, 'plan', workerId)
  return { ...service, config, storage, runtime, preference, submit }
}
it('real Host→bridge→v2 synthetic HTTP creates an owned deny-all session, exact model and one durable input', async () => {
  const f = await setup(), result = await f.submit().done
  expect(result.status, result.error).toBe('completed')
  expect(result.transport).toBe('opencode-http-v2')
  expect(result.lastResult).toBe('原生模拟正文1')
  expect(f.payloads).toHaveLength(1)
  expect(f.payloads[0].model).toEqual({ providerID: 'own', id: 'G' })
  expect(f.payloads[0]).toMatchObject({ agent: 'native-custom-default', model: { providerID: 'own', id: 'G' }, permissions: [{ action: '*', resource: '*', effect: 'deny' }], location: { directory: f.project } })
  expect(f.records).toHaveLength(1)
  expect(JSON.stringify(f.bridgeRequests)).not.toMatch(/PRIVATE_|password|Authorization|127\.0\.0\.1/)
  expect(f.spawnSpecs[0].env.CLIWORKER_OPENCODE_V2_SERVICE).toContain('PRIVATE_SERVICE_PASSWORD')
  expect(f.spawnSpecs[0].argv.join(' ')).not.toContain('PRIVATE_')
  expect(f.records[0]).toMatchObject({ delivery: 'steer', resume: true, text: '明确模拟的纯文本请求' })
  expect(f.records[0].id).toMatch(/^msg_/)
  const ledger = await readOwnedLedger(f.state, result.id)
  expect(ledger.status).toBe('settled'); expect(ledger.sessionId).toBe(result.conversationId)
  expect(ledger.run.terminal).toBe('session.execution.succeeded')
  expect(await unsettledOwnedLedgers(f.state)).toEqual([])
  expect(f.requests.every(x => x.authMatches)).toBe(true)
  expect(f.requests.some(x => x.path.includes('credential') || x.method === 'PATCH' || x.path.endsWith('/background'))).toBe(false)
  expect(workerPermissionOptions(result).map(x => x.value)).toEqual(['plan'])
  expect(bridgedFeatureSupport(result).fork.supported).toBe(false)
  const raw = readFileSync(f.storage.rawPath(result), 'utf8') + (existsSync(f.storage.rawPath(result) + '.stderr') ? readFileSync(f.storage.rawPath(result) + '.stderr', 'utf8') : '')
  expect(raw).not.toMatch(/PRIVATE_|signature|providerState|Authorization|password|\/api\/info/)
  expect(JSON.stringify(f.runtime.get('synthetic-parent', result.id))).not.toContain('PRIVATE_')
})
it('resumes only its owned marker and exact native session with a fresh own input', async () => {
  const f = await setup(), first = await f.submit().done, second = await f.submit('第二轮模拟请求', first.id).done
  expect([first.status, second.status]).toEqual(['completed', 'completed'])
  expect(second.conversationId).toBe(first.conversationId)
  expect(f.payloads).toHaveLength(1); expect(f.records).toHaveLength(2)
  expect(f.records[0].id).not.toBe(f.records[1].id)
  expect(second.lastResult).toBe('原生模拟正文2')
})
it('stable credential-source binding survives an ordinary settled-service restart while per-run epoch changes', async () => {
  const f = await setup(), first = await f.submit().done, before = await readOwnedLedger(f.state, first.id)
  const binding = await readCliAccountBinding('opencode', f.backend, f.config, f.project, new AbortController().signal)
  await f.restart()
  expect(await readCliAccountBinding('opencode', f.backend, f.config, f.project, new AbortController().signal)).toBe(binding)
  const second = await f.submit('服务重启后的明确新请求', first.id).done, after = await readOwnedLedger(f.state, first.id)
  expect(second.status, second.error).toBe('completed'); expect(after.epoch).not.toBe(before.epoch)
  expect(after.sessionId).toBe(before.sessionId)
})
it('opaque native G/a identities survive the actual shared picker without lowercasing collision', () => {
  const values = ['G', 'a'].map(id => ({ id: `opencode-v2:${Buffer.from(JSON.stringify(['own', id, null])).toString('base64url')}`, label: `Native ${id}`, efforts: ['default' as const], opaqueIdentity: true }))
  expect(values[0].id.toLowerCase()).toBe(values[1].id.toLowerCase())
  expect(visibleModelChoices(values).map(x => x.id)).toEqual(values.map(x => x.id))
})
it.each(['collision', 'wrong-model', 'switch-aba', 'agent-change', 'watch-gap'])('rejects %s without adopting history, switching account or replaying prompt', async mode => {
  const f = await setup(mode), result = await f.submit().done
  expect(['failed', 'uncertain']).toContain(result.status)
  expect(f.records.length).toBeLessThanOrEqual(mode === 'collision' ? 0 : 1)
  expect(f.requests.some(x => x.method === 'DELETE' && !x.path.includes('/inbox/'))).toBe(false)
  expect(result.lastResult ?? '').not.toContain('PRIVATE_')
})
it('lost prompt ACK reconciles exact own durable input rather than POSTing again', async () => {
  const f = await setup('ack-lost'), result = await f.submit().done
  expect(result.status, result.error).toBe('completed')
  expect(f.records).toHaveLength(1)
  expect(f.requests.some(x => x.path.endsWith('/message/' + f.records[0].id))).toBe(true)
})
it.each(['missing-terminal'])('keeps %s model result unknown but accepts fresh same-PID cleanup proof, never automatic replay', async mode => {
  const f = await setup(mode), result = await f.submit().done
  expect(result.status, result.error).toBe('uncertain'); expect(f.records).toHaveLength(1)
  expect((await readOwnedLedger(f.state, result.id)).status).toBe('settled')
  expect(() => f.runtime.assertCliEnabled('opencode')).not.toThrow()
})
it.each(['pid-change', 'wait-error', 'ack-unknown'])('quarantines %s despite local bridge exit, without blocking another CLI', async mode => {
  const f = await setup(mode), result = await f.submit().done
  expect(result.status).toBe('uncertain')
  expect((await readOwnedLedger(f.state, result.id)).status).toBe('uncertain')
  expect(() => f.runtime.assertCliEnabled('opencode')).toThrow('停止尚未确认')
  expect(() => f.runtime.assertCliEnabled('claude')).not.toThrow()
})
it('stop waits for native settled hook/map removal rather than interrupt ACK or local exit', async () => {
  const f = await setup('hold'); f.setWaitDelay(250)
  const task = f.submit()
  await vi.waitFor(() => expect(f.records).toHaveLength(1))
  const start = Date.now(), stop = f.runtime.stop('synthetic-parent', task.worker.id)
  await new Promise(resolve => setTimeout(resolve, 70))
  expect(f.sessions.get(f.records[0].sessionId).active).toBe(true)
  const result = await stop
  expect(Date.now() - start).toBeGreaterThanOrEqual(200)
  expect(result.status, result.error).toBe('interrupted')
  expect((await readOwnedLedger(f.state, result.id)).status).toBe('settled')
  expect(f.requests.filter(x => x.method === 'DELETE').every(x => x.path.endsWith('/inbox/' + f.records[0].id))).toBe(true)
})
it('bridge kill immediately after admission defaults to quarantine; explicit cleanup-only stop settles without replay', async () => {
  const f = await setup('hold'), task = f.submit()
  await vi.waitFor(() => expect(f.records).toHaveLength(1))
  f.children.at(-1).kill('SIGKILL')
  const result = await task.done
  expect(result.status).toBe('uncertain'); expect(f.sessions.get(result.conversationId).active).toBe(true)
  expect(() => f.runtime.assertCliEnabled('opencode')).toThrow()
  expect((await readOwnedLedger(f.state, result.id)).status).toBe('uncertain')
  const cleaned = await f.runtime.stop('synthetic-parent', result.id)
  expect(cleaned.status).toBe('interrupted'); expect(f.records).toHaveLength(1)
  expect(f.sessions.get(result.conversationId).active).toBe(false)
  expect(() => f.runtime.assertCliEnabled('opencode')).not.toThrow()
})
it.each(['timeout', 'stop'])('unknown delayed native preparation remains quarantined after %s, even though early interrupt/wait saw idle', async trigger => {
  const f = await setup('delayed-admission'); f.setAdmissionTimeout(trigger === 'timeout' ? 35 : 5000)
  const task = f.submit()
  if (trigger === 'stop') { await vi.waitFor(() => expect(f.requests.some(x => x.path.endsWith('/prompt'))).toBe(true)); await f.runtime.stop('synthetic-parent', task.worker.id) }
  const result = await task.done
  expect(result.status, result.error).toBe('uncertain')
  expect((await readOwnedLedger(f.state, result.id)).status).toBe('uncertain')
  expect(() => f.runtime.assertCliEnabled('opencode')).toThrow()
  await vi.waitFor(() => expect(f.records).toHaveLength(1))
  expect(f.sessions.get(f.records[0].sessionId).active).toBe(true)
  expect(f.requests.filter(x => x.path.endsWith('/prompt'))).toHaveLength(1)
  const cleaned = await f.runtime.stop('synthetic-parent', result.id)
  expect(cleaned.status).toBe('interrupted')
  expect(f.sessions.get(f.records[0].sessionId).active).toBe(false)
  expect(f.records).toHaveLength(1)
})
it('source event headers stalled before any prompt can be cancelled without hanging', async () => {
  const f = await setup()
  f.intercept((path, _body, _res) => path === '/api/event')
  const task = f.submit()
  await vi.waitFor(() => expect(f.requests.some(x => x.path === '/api/event')).toBe(true))
  const began = Date.now(), result = await f.runtime.stop('synthetic-parent', task.worker.id)
  expect(Date.now() - began).toBeLessThan(2000)
  expect(result.status, result.error).toBe('interrupted')
  expect(f.records).toHaveLength(0)
})
it.each(['no-step', 'no-text', 'empty-body'])('does not call execution.succeeded a verified model result for %s', async mode => {
  const f = await setup(mode), result = await f.submit().done
  expect(result.status, result.error).toBe('uncertain')
  expect((await readOwnedLedger(f.state, result.id)).status).toBe('settled')
})
it('local tool executed:false is providerExecuted, never evidence the tool was not run', async () => {
  const f = await setup('local-tool'), result = await f.submit().done
  expect(result.status).toBe('uncertain')
  expect((await readOwnedLedger(f.state, result.id)).run.policyViolation).toBe(true)
  expect(() => f.runtime.assertCliEnabled('opencode')).toThrow()
  expect(readFileSync(f.storage.rawPath(result), 'utf8')).not.toContain('PRIVATE_')
})
it.each(['disconnect-once', 'duplicate-ended'])('recovers/deduplicates %s without another prompt or repeated final text', async mode => {
  const f = await setup(mode), result = await f.submit().done
  expect(result.status, result.error).toBe('completed')
  expect(result.lastResult).toBe('原生模拟正文1')
  expect(f.records).toHaveLength(1)
})
it('model.updated and other private source mutations cancel this run, never silently adopt', async () => {
  const f = await setup('hold'), task = f.submit()
  await vi.waitFor(() => expect(f.records).toHaveLength(1))
  f.global('model.updated', { PRIVATE_MODEL_SETTINGS: 'PRIVATE_ENDPOINT' })
  const result = await task.done
  expect(['failed', 'uncertain']).toContain(result.status)
  expect(f.records).toHaveLength(1)
  expect(readFileSync(f.storage.rawPath(result), 'utf8')).not.toContain('PRIVATE_')
})
it('writes pending before backend spawn failure and persists quarantine without any native prompt', async () => {
  const f = await setup(), original = f.backend.spawn
  f.backend.spawn = spec => { if (spec.argv.some(x => x.endsWith('/native-bridge.mjs'))) throw Error('SYNTHETIC_SPAWN_UNCERTAIN'); return original(spec) }
  const result = await f.submit().done
  expect(result.status).toBe('uncertain')
  expect((await readOwnedLedger(f.state, result.id)).status).toBe('uncertain')
  expect(f.records).toHaveLength(0)
})
it('a cold Host recovers the durable remote quarantine instead of treating local process death as cleanup', async () => {
  const f = await setup('hold'), task = f.submit()
  await vi.waitFor(() => expect(f.records).toHaveLength(1)); f.children.at(-1).kill('SIGKILL')
  const result = await task.done
  await f.runtime.close()
  const storage = new WorkerStorage(f.state), runtime = new WorkerRuntime(storage, f.backend, f.config)
  closes.push(() => runtime.close())
  await (runtime as any).remoteOpenCodeRecovery
  expect(() => runtime.assertCliEnabled('opencode')).toThrow()
  expect(() => runtime.assertCliEnabled('claude')).not.toThrow()
  const cleaned = await runtime.stop('synthetic-parent', result.id)
  expect(cleaned.status).toBe('interrupted'); expect(f.records).toHaveLength(1)
})
it('validates the native model echo before any prompt rather than silently replacing the chosen ref', async () => {
  const f = await setup('echo-wrong'), result = await f.submit().done
  expect(result.status).toBe('failed'); expect(f.records).toHaveLength(0)
  expect(f.requests.some(x => x.method === 'DELETE' && !x.path.includes('/inbox/'))).toBe(false)
})
it.each(['config.updated', 'plugin.updated', 'mcp.tools.changed', 'location.shutdown'])('source watcher cancels %s without projecting its private metadata', async type => {
  const f = await setup('hold'), task = f.submit()
  await vi.waitFor(() => expect(f.records).toHaveLength(1)); f.global(type, { PRIVATE_CONFIG: 'PRIVATE_SECRET' })
  const result = await task.done
  expect(['failed', 'uncertain']).toContain(result.status)
  expect(f.records).toHaveLength(1); expect(readFileSync(f.storage.rawPath(result), 'utf8')).not.toContain('PRIVATE_')
})
it('foreign input is never deleted and unrelated native global text never enters public records', async () => {
  const f = await setup('hold'), task = f.submit()
  await vi.waitFor(() => expect(f.records).toHaveLength(1))
  const sid = f.records[0].sessionId, foreign = 'msg_FOREIGN_NATIVE_INPUT'
  f.global('session.text.ended', { sessionID: 'ses_other_native_user', assistantMessageID: 'msg_other', ordinal: 0, text: 'PRIVATE_OTHER_SESSION' })
  f.sessions.get(sid).inbox.push({ id: foreign, sessionID: sid, type: 'user', payload: { text: 'PRIVATE_FOREIGN_INPUT' }, delivery: 'queue' })
  f.global('session.inbox.enqueued', { sessionID: sid, inboxID: foreign })
  const result = await task.done
  expect(result.status).toBe('uncertain')
  expect(f.sessions.get(sid).inbox[0].id).toBe(foreign)
  expect(f.requests.filter(x => x.method === 'DELETE').every(x => x.path.endsWith('/inbox/' + f.records[0].id))).toBe(true)
  expect(readFileSync(f.storage.rawPath(result), 'utf8')).not.toContain('PRIVATE_')
})
it.each(['bad-json', 'agent-auth'])('private metadata %s is refused without stderr/body/header/credential leakage', async mode => {
  const f = await setup()
  f.intercept((path, _body, res) => {
    if (path !== '/api/agent') return false
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(mode === 'bad-json' ? '{"PRIVATE_JSON":"PRIVATE_BODY"' : JSON.stringify({ location: { directory: f.project }, data: [{ id: 'native-custom-default', name: 'Synthetic', mode: 'primary', hidden: false, permissions: [], request: { headers: { Authorization: 'PRIVATE_AUTH' } } }] }))
    return true
  })
  const result = await f.submit().done
  expect(result.status).toBe('failed'); expect(f.records).toHaveLength(0)
  expect(JSON.stringify(result)).not.toContain('PRIVATE_')
})
it('runtime rejects editable mode and attachments before native creation or harness preparation', async () => {
  const f = await setup(), preparation = vi.fn(async () => undefined)
  f.runtime.setHarnessPreparation(preparation)
  const editable = await f.runtime.submit('synthetic-parent', f.project, 'unsupported edits', '明确模拟编辑请求', f.preference, 'accept-edits').done
  expect(editable.status).toBe('failed'); expect(preparation).not.toHaveBeenCalled(); expect(f.payloads).toHaveLength(0)
  const attachment = { kind: 'file' as const, name: 'must-not-read.txt', path: join(f.root, 'NONEXISTENT_ATTACHMENT'), bytes: 1 }
  const attached = await f.runtime.submit('synthetic-parent', f.project, 'unsupported attachment', '明确模拟附件请求', f.preference, 'plan', undefined, undefined, undefined, undefined, undefined, undefined, [attachment]).done
  expect(attached.status).toBe('failed'); expect(f.payloads).toHaveLength(0); expect(f.records).toHaveLength(0)
})
it('native provider failures reveal neither response body nor provider state in public/raw output', async () => {
  const f = await setup('native-error'), result = await f.submit().done
  expect(result.status).toBe('failed'); expect((await readOwnedLedger(f.state, result.id)).status).toBe('settled')
  expect(JSON.stringify(result) + readFileSync(f.storage.rawPath(result), 'utf8')).not.toContain('PRIVATE_')
})
it('refuses a completed foreign native turn between owned runs even when idle, marker, model and deny-all still match', async () => {
  const f = await setup(), first = await f.submit().done
  f.completeForeignInput(first.conversationId!)
  const historyLength = f.sessions.get(first.conversationId).log.length
  const second = await f.submit('不得静默使用外部修改的历史', first.id).done
  expect(second.status, second.error).toBe('failed')
  expect(f.records).toHaveLength(1)
  expect(f.sessions.get(first.conversationId).log).toHaveLength(historyLength)
  expect((await readOwnedLedger(f.state, first.id)).invalid).toBe(true)
  expect(f.requests.some(x => x.method === 'DELETE' && !x.path.includes('/inbox/'))).toBe(false)
  expect(JSON.stringify(second)).not.toContain('PRIVATE_')
})
it('allows acknowledged non-content viewed housekeeping across an owned continuation', async () => {
  const f = await setup(), first = await f.submit().done
  f.viewed(first.conversationId!)
  const second = await f.submit('查看后续聊', first.id).done
  expect(second.status, second.error).toBe('completed'); expect(f.records).toHaveLength(2)
})
it.each(['', 'custom/#'])('preserves native execution variant %j as a model ref, never an invented effort', async variant => {
  const f = await setup()
  f.preference.model = `opencode-v2:${Buffer.from(JSON.stringify(['own', 'G', variant])).toString('base64url')}`
  const result = await f.submit().done
  expect(result.status, result.error).toBe('completed')
  expect(f.payloads[0].model).toEqual({ providerID: 'own', id: 'G', variant })
  expect(result.preference.effort).toBe('default')
})
it('conflicting final snapshots are a model-result uncertainty even when foreground cleanup is proven', async () => {
  const f = await setup('conflicting-ended'), result = await f.submit().done
  expect(result.status, result.error).toBe('uncertain')
  const ledger = await readOwnedLedger(f.state, result.id)
  expect(ledger.status).toBe('settled'); expect(ledger.run.resultUnknown).toBe(true)
  expect(result.lastResult).not.toContain('冲突的原生最终正文')
})
it('settlement HMAC cannot be reused across input/run/source/service epochs', async () => {
  const f = await setup(), result = await f.submit().done, ledger = await readOwnedLedger(f.state, result.id), key = 'synthetic-private-proof-key'
  ledger.run.keyHash = (await import('../src/host/opencode-v2-service.mjs')).digest(key)
  ledger.run.proof = signSettlement(ledger, key)
  expect(verifySettlement(ledger, key)).toBe(true)
  for (const mutate of [(x: any) => { x.epoch += 'changed' }, (x: any) => { x.sourcePin = '0'.repeat(64) }, (x: any) => { x.run.inputId += 'x' }, (x: any) => { x.run.id += 'x' }, (x: any) => { x.run.payloadDigest = '1'.repeat(64) }]) {
    const changed = structuredClone(ledger); mutate(changed); expect(verifySettlement(changed, key)).toBe(false)
  }
  expect(JSON.stringify(ledger)).not.toMatch(/PRIVATE_|password|Authorization|127\.0\.0\.1/)
})
