import { openOpenCodeV2Service, serviceMetadata, openCodeV2ModelRef, DENY_ALL, object, digest, OpenCodeCompatibilityError } from './opencode-v2-service.mjs'
import { readOwnedLedger, saveOwnedLedger, signSettlement, OPENCODE_V2_REMOTE_UNCERTAIN } from './opencode-v2-ledger.mjs'

const fail = message => new OpenCodeCompatibilityError(message ?? 'OpenCode v2 原生任务状态无法确认')
const modelKey = v => object(v) ? JSON.stringify([v.providerID, v.id, v.variant ?? null]) : ''
const payloadDigest = text => digest({ text, delivery: 'steer', resume: true })
const textOnlyPayload = value => object(value) && typeof value.text === 'string' && ['files', 'agents', 'skills'].every(key => value[key] === undefined || Array.isArray(value[key]) && value[key].length === 0)
const denyAllPermissions = value => Array.isArray(value) && value.length === 1 && object(value[0]) && Object.keys(value[0]).length === 3 && value[0].action === '*' && value[0].resource === '*' && value[0].effect === 'deny'
const sourceEvents = new Set(['credential.updated', 'credential.switched', 'integration.updated', 'provider.updated', 'model.updated', 'agent.updated', 'config.updated', 'plugin.updated', 'location.shutdown', 'mcp.tools.changed'])
const mutations = new Set(['session.permissions', 'session.agent.selected', 'session.model.selected', 'session.moved', 'session.metadata.updated', 'session.deleted', 'session.inbox.delivery.changed'])
/** Effect SSE has native event JSON, no outer data:event wrapper. Never emit raw frames. */
export async function consumeOpenCodeV2SSE(response, signal, limits, onFrame) {
  if (!response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) throw fail('OpenCode v2 原生事件格式不支持')
  const reader = response.body.getReader(), decoder = new TextDecoder('utf8', { fatal: true })
  let pending = '', data = [], event = 'message', frameBytes = 0
  const aborted = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', aborted, { once: true })
  const dispatch = async () => {
    if (event === 'effect/http-api/stream/failure') throw fail('OpenCode v2 原生事件观察流失败')
    if (data.length) {
      let value
      try { value = JSON.parse(data.join('\n')) }
      catch { throw Object.assign(fail('OpenCode v2 原生事件格式无法安全解析'), { protocolViolation: true }) }
      if (!object(value)) throw fail()
      await onFrame(value)
    }
    data = []; event = 'message'; frameBytes = 0
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      limits.used += value.byteLength
      if (limits.used > limits.maximum) throw fail('OpenCode v2 原生事件超过本轮限制')
      pending += decoder.decode(value, { stream: true })
      let index
      while ((index = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, index).replace(/\r$/, ''); pending = pending.slice(index + 1)
        frameBytes += Buffer.byteLength(line)
        if (frameBytes > limits.line) throw fail('OpenCode v2 原生事件帧超过限制')
        if (!line) await dispatch()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
        else if (line.startsWith('event:')) event = line.slice(6).trim()
      }
      if (Buffer.byteLength(pending) > limits.line) throw fail()
      signal.throwIfAborted()
    }
    signal.throwIfAborted()
    pending += decoder.decode()
    if (pending.trim() || data.length) throw fail('OpenCode v2 原生事件帧不完整')
  } finally { signal.removeEventListener('abort', aborted); await reader.cancel().catch(() => {}); reader.releaseLock() }
}
function validateSession(row, record, strict = true) {
  if (!object(row) || row.id !== record.sessionId || row.parentID !== undefined || row.fork !== undefined || row.location?.directory !== record.project || row.metadata?.cliworker?.marker !== record.marker || row.metadata?.cliworker?.workerId !== record.workerId) throw fail('OpenCode v2 自有会话所有权不匹配；不会采用其他会话')
  if (strict && (row.agent !== record.agent || modelKey(row.model) !== modelKey(record.model) || !denyAllPermissions(row.permissions) || row.revert !== undefined || row.time?.archived !== undefined)) throw fail('OpenCode v2 自有会话模型、agent或全工具拒绝策略已改变')
}
async function session(service, record, signal, strict = true) {
  const response = await service.json(`/api/session/${record.sessionId}`, 'GET', undefined, signal)
  validateSession(response?.data, record, strict)
  return response.data
}
const sequence = value => { if (!Number.isSafeInteger(value) || value < 0) throw fail('OpenCode v2 耐久事件序号无效'); return value }
function logState(record) {
  return { baseline: record.lastSeq, last: record.lastSeq, watermark: record.lastSeq, seen: new Map(), assistants: new Set(), bodies: new Map(), lastAssistant: undefined, segments: new Map(), started: undefined, delivered: undefined, cancelled: undefined, terminal: undefined, foreign: false, response: '' }
}
function consumeRow(row, record, state, io, baseline = false) {
  if (row.type === 'log.synced') {
    if (row.aggregateID !== record.sessionId || row.seq !== undefined && sequence(row.seq) < (state.last ?? -1)) throw fail('OpenCode v2 耐久日志水位不一致')
    state.watermark = row.seq === undefined ? state.watermark : sequence(row.seq)
    return
  }
  if (!object(row.durable) || row.durable.aggregateID !== record.sessionId || !Number.isSafeInteger(row.durable.version) || row.durable.version < 1 || typeof row.id !== 'string' || typeof row.created !== 'number' || !object(row.data) || row.data.sessionID !== record.sessionId || row.location && row.location.directory !== record.project) throw fail('OpenCode v2 耐久日志会话来源不匹配')
  const seq = sequence(row.durable.seq), key = `${seq}:${row.id}`, fingerprint = digest(row)
  if (state.seen.has(key)) { if (state.seen.get(key) !== fingerprint) throw fail(); return }
  if (state.last !== undefined && seq <= state.last) throw fail('OpenCode v2 耐久日志顺序或重复身份不一致')
  state.last = seq; state.seen.set(key, fingerprint)
  if (state.seen.size > 20000) throw fail()
  const data = row.data, type = row.type
  if (['session.inbox.enqueued', 'session.inbox.delivered', 'session.inbox.cancelled'].includes(type) && data.inboxID !== record.run.inputId) {
    if (!baseline) { state.foreign = true; throw fail('OpenCode v2 自有会话收到其他输入，已拒绝继续') }
  }
  if (baseline) {
    const ownCreation = type === 'session.created' && record.lastSeq === undefined && !state.createdSeen && data.metadata?.cliworker?.marker === record.marker && data.metadata?.cliworker?.workerId === record.workerId && data.agent === record.agent && modelKey(data.model) === modelKey(record.model) && denyAllPermissions(data.permissions) && data.location?.directory === record.project && data.parentID === undefined
    if (ownCreation) state.createdSeen = true
    else if (!['session.viewed', 'session.usage.recorded'].includes(type)) {
      record.invalid = true
      throw fail('OpenCode v2 自有会话在本轮之前出现未确认输入或历史变化，请新建任务')
    }
    return
  }
  if (row.durable.version !== 1 && /session\.(?:execution|inbox|step|text|reasoning)\./.test(type)) throw fail('OpenCode v2 耐久事件版本尚未支持')
  if (type === 'session.inbox.enqueued') {
    if (data.item?.type !== 'user' || !textOnlyPayload(data.item.payload) || payloadDigest(data.item.payload?.text) !== record.run.payloadDigest || data.item.delivery !== 'steer') throw fail('OpenCode v2 输入身份或不可变内容不匹配')
    state.enqueued = seq
  } else if (type === 'session.inbox.delivered') state.delivered = seq
  else if (type === 'session.inbox.cancelled') state.cancelled = seq
  else if (type === 'session.execution.started') {
    if (state.started !== undefined) throw fail('OpenCode v2 本轮出现多个无法关联的执行')
    state.started = seq
  } else if (['session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted'].includes(type)) {
    if (state.started === undefined || state.delivered === undefined && state.cancelled === undefined || seq <= Math.max(state.started, state.delivered ?? state.cancelled)) throw fail('OpenCode v2 终态没有关联当前自有输入')
    if (state.terminal) throw fail('OpenCode v2 本轮终态冲突')
    state.terminal = { type, seq }
  } else if (type === 'session.step.started') {
    if (state.delivered === undefined || data.agent !== record.agent || modelKey(data.model) !== modelKey(record.model) || typeof data.assistantMessageID !== 'string') throw fail('OpenCode v2 实际模型或agent与选择不一致')
    state.assistants.add(data.assistantMessageID); state.lastAssistant = data.assistantMessageID
  } else if (type === 'session.text.ended' || type === 'session.reasoning.ended') {
    if (!state.assistants.has(data.assistantMessageID) || !Number.isSafeInteger(data.ordinal) || data.ordinal < 0 || typeof data.text !== 'string') throw fail('OpenCode v2 文本不属于本轮已核验模型')
    const segment = `${type}:${data.assistantMessageID}:${data.ordinal}`
    if (state.segments.has(segment)) { if (state.segments.get(segment) !== data.text) { state.resultConflict = true; throw fail(); } return }
    state.segments.set(segment, data.text)
    if (type === 'session.text.ended') { state.response += data.text; state.bodies.set(data.assistantMessageID, (state.bodies.get(data.assistantMessageID) ?? '') + data.text) }
    io?.event({ kind: type === 'session.text.ended' ? 'assistant' : 'reasoning', text: data.text })
  } else if (/^session\.(?:shell|skill)\./.test(type) || ['session.tool.called', 'session.tool.success', 'session.tool.failed'].includes(type) || mutations.has(type)) {
    record.run.policyViolation = true
    throw fail('OpenCode v2 只读纯文本会话出现不允许的原生操作')
  }
}
async function finiteLog(service, record, state, signal, limits, io, baseline = false) {
  let synced = false
  const after = state.last === undefined ? '' : `&after=${state.last}`
  const response = await service.request(`/api/experimental/session/${record.sessionId}/log?follow=false${after}`, 'GET', undefined, signal)
  await consumeOpenCodeV2SSE(response, signal, limits, row => {
    if (row.type === 'log.synced') { if (synced) throw fail(); synced = true }
    consumeRow(row, record, state, io, baseline)
  })
  if (!synced) throw fail('OpenCode v2 耐久日志缺少同步水位')
  if (state.watermark !== undefined) state.last = Math.max(state.last ?? -1, state.watermark)
}
async function inbox(service, record, signal) {
  const value = await service.json(`/api/session/${record.sessionId}/inbox`, 'GET', undefined, signal)
  if (!Array.isArray(value?.data) || value.data.length > 1024) throw fail()
  const own = value.data.find(x => x.id === record.run.inputId)
  if (own && (own.sessionID !== record.sessionId || own.type !== 'user' || own.delivery !== 'steer' || !textOnlyPayload(own.payload) || payloadDigest(own.payload?.text) !== record.run.payloadDigest)) throw fail('OpenCode v2 当前输入内容与已保存身份不一致')
  return { own, foreign: value.data.some(x => x.id !== record.run.inputId) }
}
async function userMessage(service, record, signal) {
  try {
    const value = await service.json(`/api/session/${record.sessionId}/message/${record.run.inputId}`, 'GET', undefined, signal)
    if (value?.data?.id !== record.run.inputId || value.data.type !== 'user' || !textOnlyPayload(value.data) || payloadDigest(value.data.text) !== record.run.payloadDigest) throw fail('OpenCode v2 已投递输入与不可变内容不一致')
    return true
  } catch (error) { if (error.httpStatus === 404) return false; throw error }
}
async function assertIdle(service, record, signal) {
  const active = await service.json('/api/session/active', 'GET', undefined, signal)
  if (!object(active?.data) || active.data[record.sessionId] !== undefined) throw fail('OpenCode v2 原生会话仍在运行')
}
async function settle(service, record, state, limits, stop, io, cleanupMs = 8000) {
  const signal = AbortSignal.timeout(cleanupMs)
  await service.verify(signal)
  await session(service, record, signal, !stop)
  // Interrupt/wait cannot fence a prompt still doing async preparation BEFORE
  // native D.admit. Require positive immutable-input admission evidence BEFORE
  // this cleanup cycle, otherwise late enqueue may happen after an idle receipt.
  let before, preflightIssue
  let admissionKnown = record.run.admissionKnown === true || state.enqueued !== undefined || state.delivered !== undefined || state.cancelled !== undefined
  try {
    before = await inbox(service, record, signal)
    admissionKnown ||= !!before.own
    if (!admissionKnown) {
      await finiteLog(service, record, state, signal, limits)
      admissionKnown = state.enqueued !== undefined || state.delivered !== undefined || state.cancelled !== undefined || await userMessage(service, record, signal)
    }
  } catch (error) { preflightIssue = error }
  if (admissionKnown) { record.run.admissionKnown = true; record.run.unresolvedAdmission = false }
  if (stop) {
    // Never delete an input whose immutable payload could not be verified.
    if (before) await service.json(`/api/session/${record.sessionId}/inbox/${record.run.inputId}`, 'DELETE', undefined, signal)
    const receipt = await service.json(`/api/session/${record.sessionId}/interrupt?resume=false`, 'POST', undefined, signal)
    if (typeof receipt?.interrupted !== 'boolean') throw fail()
  }
  await service.json(`/api/experimental/session/${record.sessionId}/wait`, 'POST', undefined, signal)
  await assertIdle(service, record, signal)
  const pending = await inbox(service, record, signal)
  if (pending.own || pending.foreign) throw fail('OpenCode v2 自有会话仍有未确认输入')
  await finiteLog(service, record, state, signal, limits, io)
  await service.verify(signal)
  await assertIdle(service, record, signal)
  if (!admissionKnown) throw fail('OpenCode v2 未获得本轮输入的耐久准入证据，仍可能晚到，必须保持隔离')
  if (preflightIssue || record.run.policyViolation) throw fail('OpenCode v2 出现无法核验的操作或事件，必须保持隔离')
  // Same-process wait + fresh active/inbox checks prove foreground cleanup even
  // if the settled hook failed to publish its lifecycle row. Do not invent a
  // model terminal: retain a distinct UNKNOWN result and never replay input.
  state.resultUnknown = !state.terminal && !(state.cancelled !== undefined && state.delivered === undefined && state.started === undefined) || !!record.run.unresolvedAdmission || !!state.resultConflict || state.terminal?.type === 'session.execution.succeeded' && (!state.lastAssistant || !state.assistants.has(state.lastAssistant) || !state.bodies.get(state.lastAssistant)?.trim())
  return state
}
async function saveSettled(root, record, state, key, terminal) {
  record.status = 'settled'; record.lastSeq = state?.watermark ?? state?.last ?? record.lastSeq
  record.run.terminal = terminal ?? state?.terminal?.type ?? (state?.resultUnknown ? 'result-unknown-cleanup-confirmed' : 'input-cancelled')
  record.run.watermark = record.lastSeq
  record.run.resultUnknown = state?.resultUnknown === true
  record.run.proof = signSettlement(record, key)
  await saveOwnedLedger(root, record)
}
export async function runNativeOpenCodeV2(config, io) {
  const cfg = config.opencodeV2, key = process.env.CLIWORKER_OPENCODE_V2_PROOF_KEY
  let service, record, watcher, watcherDone, state, watchIssue, admissionAttempted = false, outputStatus = 'ERROR'
  const dirty = new AbortController(), watchControl = new AbortController(), runSignal = AbortSignal.any([io.signal, dirty.signal])
  const limits = { used: 0, maximum: config.maxRunBytes, line: config.maxLineBytes }
  let publicError = 'OpenCode v2 原生任务未完成，未重发输入'
  try {
    if (!object(cfg) || config.transport !== 'opencode-http-v2' || config.mode !== 'plan' || config.attachments?.length || !key) throw fail('OpenCode v2 当前只支持显式只读纯文本，不支持编辑、附件或工具')
    record = await readOwnedLedger(cfg.root, cfg.workerId)
    if (!record || record.status !== 'pending' || record.run.id !== cfg.runId || record.run.keyHash !== digest(key) || payloadDigest(config.prompt) !== record.run.payloadDigest || record.sessionId !== cfg.sessionId || record.epoch !== cfg.epoch) throw fail()
    const privateService = JSON.parse(process.env.CLIWORKER_OPENCODE_V2_SERVICE ?? '{}')
    service = await openOpenCodeV2Service(config.argv[0], { major: 2, version: record.version }, config.project, runSignal, { env: { ...process.env, XDG_STATE_HOME: dirnameRegistry(privateService.path) } })
    if (service.epoch !== record.epoch || privateService.fingerprint !== service.epoch) throw fail('OpenCode v2 服务epoch已改变')
    let connectedResolve, connectedReject
    const connected = new Promise((yes, no) => { connectedResolve = yes; connectedReject = no })
    const headerControl = new AbortController(), cancelHeader = () => headerControl.abort()
    const headerTimeout = setTimeout(cancelHeader, 5000)
    watchControl.signal.addEventListener('abort', cancelHeader, { once: true })
    runSignal.addEventListener('abort', cancelHeader, { once: true })
    if (runSignal.aborted) cancelHeader()
    try { watcher = await service.request('/api/event', 'GET', undefined, headerControl.signal) }
    finally { clearTimeout(headerTimeout); runSignal.removeEventListener('abort', cancelHeader) }
    let connectedSeen = false
    watcherDone = consumeOpenCodeV2SSE(watcher, watchControl.signal, limits, row => {
      if (row.type === 'server.connected') { if (connectedSeen || typeof row.id !== 'string' || !row.id.startsWith('evt_') || !object(row.data)) throw fail(); connectedSeen = true; connectedResolve(); return }
      if (!connectedSeen) throw fail('OpenCode v2 原生观察缺少连接屏障')
      if (sourceEvents.has(row.type) || row.data?.sessionID === record.sessionId && (mutations.has(row.type) || row.type === 'session.inbox.enqueued' && row.data.inboxID !== record.run.inputId)) throw fail('OpenCode v2 来源或会话策略在运行期间改变，已停止')
    }).then(() => { if (!watchControl.signal.aborted) throw fail('OpenCode v2 原生观察流意外断开') }).catch(error => {
      if (!watchControl.signal.aborted) { watchIssue = error; dirty.abort(fail('OpenCode v2 来源观察中断或改变，已停止')); connectedReject(error) }
    })
    await Promise.race([connected, new Promise((_, reject) => runSignal.addEventListener('abort', () => reject(fail()), { once: true })), new Promise((_, reject) => { const t = setTimeout(() => reject(fail('OpenCode v2 观察连接超时')), 5000); connected.finally(() => clearTimeout(t)).catch(() => {}) })])
    const metadata = await serviceMetadata(service, runSignal, { includeAgent: true })
    if (metadata.pins[config.preference.model] !== record.sourcePin || metadata.agent?.id !== record.agent || modelKey(openCodeV2ModelRef(config.preference.model)) !== modelKey(record.model)) throw fail('OpenCode v2 当前模型、账号或agent来源已改变')
    if (!record.owned) {
      let found
      try { found = await service.json(`/api/session/${record.sessionId}`, 'GET', undefined, runSignal) } catch (error) { if (error.httpStatus !== 404) throw error }
      if (found) throw fail('OpenCode v2 自有会话ID碰撞，不会采用已有原生历史')
      try {
        const created = await service.json('/api/session', 'POST', { id: record.sessionId, title: 'CLI Worker · text only', location: { directory: record.project }, agent: record.agent, model: record.model, permissions: DENY_ALL, metadata: { cliworker: { marker: record.marker, workerId: record.workerId } } }, runSignal)
        validateSession(created?.data, record)
      } catch { await session(service, record, runSignal) }
      record.owned = true; await saveOwnedLedger(cfg.root, record)
    }
    await session(service, record, runSignal)
    await assertIdle(service, record, runSignal)
    const queued = await service.json(`/api/session/${record.sessionId}/inbox`, 'GET', undefined, runSignal)
    if (!Array.isArray(queued?.data) || queued.data.length) throw fail('OpenCode v2 自有会话已有未知待投递输入')
    state = logState(record)
    await finiteLog(service, record, state, runSignal, limits, undefined, true)
    state.baseline = state.watermark ?? state.last
    record.lastSeq = state.baseline; record.run.baseline = state.baseline
    await saveOwnedLedger(cfg.root, record)
    if (watchIssue) throw watchIssue
    await service.verify(runSignal)
    io.session(record.sessionId, config.preference.model)
    admissionAttempted = true; record.run.admissionAttempted = true; await saveOwnedLedger(cfg.root, record)
    try {
      const ack = await service.json(`/api/session/${record.sessionId}/prompt`, 'POST', { id: record.run.inputId, text: config.prompt, delivery: 'steer', resume: true, metadata: { cliworkerInputDigest: record.run.payloadDigest } }, AbortSignal.any([runSignal, AbortSignal.timeout(cfg.admissionTimeoutMs ?? 5000)]))
      if (ack?.data?.id !== record.run.inputId || ack.data.sessionID !== record.sessionId || ack.data.type !== 'user' || ack.data.delivery !== 'steer' || !textOnlyPayload(ack.data.payload) || payloadDigest(ack.data.payload?.text) !== record.run.payloadDigest) throw fail()
      record.run.admissionKnown = true; await saveOwnedLedger(cfg.root, record)
    } catch {
      runSignal.throwIfAborted()
      await finiteLog(service, record, state, runSignal, limits, io)
      const pending = await inbox(service, record, runSignal), delivered = await userMessage(service, record, runSignal)
      if (state.cancelled !== undefined) throw fail('OpenCode v2 自有输入已经取消，不会重新提交')
      if (pending.foreign || !pending.own && !delivered && state.delivered === undefined) { record.run.unresolvedAdmission = true; throw fail(OPENCODE_V2_REMOTE_UNCERTAIN) }
    }
    let reconnects = 0
    while (!state.terminal && state.cancelled === undefined) {
      const logControl = new AbortController(), signal = AbortSignal.any([runSignal, logControl.signal])
      try {
        const after = state.last === undefined ? '' : `&after=${state.last}`
        const response = await service.request(`/api/experimental/session/${record.sessionId}/log?follow=true${after}`, 'GET', undefined, signal)
        await consumeOpenCodeV2SSE(response, signal, limits, async row => {
          try { consumeRow(row, record, state, io) } catch (error) { error.protocolViolation = true; throw error }
          record.lastSeq = state.last; await saveOwnedLedger(cfg.root, record)
          if (state.terminal || state.cancelled !== undefined) logControl.abort()
        })
        if (!state.terminal && state.cancelled === undefined) throw fail('OpenCode v2 耐久事件流意外结束')
      } catch (error) { if (!logControl.signal.aborted) { if (error.protocolViolation || error instanceof SyntaxError) throw error; runSignal.throwIfAborted(); if (++reconnects > 2) throw error; await service.verify(runSignal) } }
    }
    await settle(service, record, state, limits, false, io)
    if (watchIssue) throw watchIssue
    await saveSettled(cfg.root, record, state, key)
    outputStatus = state.resultUnknown ? 'UNCERTAIN' : state.terminal?.type === 'session.execution.succeeded' ? 'SUCCESS' : 'ERROR'
    publicError = outputStatus === 'SUCCESS' ? undefined : state.resultUnknown ? 'OpenCode v2 远端已确认空闲，但本轮模型结果未知；不要自动重发' : 'OpenCode v2 原生任务失败或被中断'
  } catch {
    if (record) {
      if (watchIssue || !io.signal.aborted) record.invalid = true
      try {
        if (admissionAttempted && service && state) await settle(service, record, state, limits, true, io)
        if (admissionAttempted && (!service || !state)) throw fail()
        if (watchIssue) record.invalid = true
        await saveSettled(cfg.root, record, state, key, admissionAttempted ? undefined : 'not-admitted')
        outputStatus = state?.resultUnknown ? 'UNCERTAIN' : 'ERROR'; publicError = state?.resultUnknown ? 'OpenCode v2 远端已确认空闲，但本轮模型结果未知；不要自动重发' : io.signal.aborted ? '任务已停止' : 'OpenCode v2 输入、模型或来源核验失败，未重发任务'
      } catch { record.status = 'uncertain'; await saveOwnedLedger(cfg.root, record).catch(() => {}); outputStatus = 'UNCERTAIN'; publicError = OPENCODE_V2_REMOTE_UNCERTAIN }
    }
  } finally {
    watchControl.abort(); await watcherDone; service?.close()
    io.result(outputStatus, state?.response ?? '', publicError, 'run')
  }
}
function dirnameRegistry(path) {
  if (typeof path !== 'string' || !path.endsWith('/opencode/service.json')) throw fail()
  return path.slice(0, -'/opencode/service.json'.length)
}
/** Cleanup only: no account discovery, create, prompt, native history deletion or service stop. */
export async function reconcileOpenCodeV2Owned(root, workerId, key) {
  const record = await readOwnedLedger(root, workerId)
  if (!record || !['uncertain', 'pending'].includes(record.status)) throw fail(OPENCODE_V2_REMOTE_UNCERTAIN)
  const signal = AbortSignal.timeout(10000), service = await openOpenCodeV2Service(record.executable, { major: 2, version: record.version }, record.project, signal)
  try {
    if (service.epoch !== record.epoch) throw fail(OPENCODE_V2_REMOTE_UNCERTAIN)
    const state = logState({ ...record, lastSeq: record.run.baseline ?? record.lastSeq })
    await settle(service, record, state, { used: 0, maximum: 8 * 1024 * 1024, line: 1048576 }, true)
    record.owned = true
    record.run.keyHash = digest(key)
    await saveSettled(root, record, state, key)
    return record
  } finally { service.close() }
}
