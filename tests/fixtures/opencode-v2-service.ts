// Explicit synthetic OpenCode 2.0.31 service. Never invokes native OpenCode or a model.
import { createServer, type ServerResponse } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { vi } from 'vitest'
import type { ProcessBackend } from '../../src/host/process.ts'

export async function syntheticOpenCodeV2() {
  const root = mkdtempSync(join(process.cwd(), '.cache/opencode-v2-owned-synthetic-'))
  const project = join(root, 'project'), state = join(root, 'plugin'), nativeState = join(root, 'native-state')
  for (const path of [project, state, join(nativeState, 'opencode')]) mkdirSync(path, { recursive: true, mode: 0o700 })
  for (const key of ['OPENCODE_DB', 'OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG_CONTENT', 'OPENCODE_SERVER', 'OPENCODE_SERVER_URL', 'OPENCODE_PASSWORD', 'OPENCODE_SERVER_PASSWORD', 'OPENCODE_HOME', 'OPENCODE_DATA_DIR']) vi.stubEnv(key, '')
  vi.stubEnv('XDG_STATE_HOME', nativeState)
  const sessions = new Map<string, any>(), records: any[] = [], children: any[] = [], requests: any[] = []
  const globalStreams = new Set<ServerResponse>(), logStreams = new Map<string, Set<ServerResponse>>(), waiters = new Map<string, ServerResponse[]>()
  const payloads: any[] = [], bridgeRequests: any[] = [], spawnSpecs: any[] = []
  let intercept: undefined | ((path: string, body: any, response: ServerResponse, method: string) => boolean)
  let disconnectedOnce = false, admissionTimeoutMs: number | undefined
  let mode = 'success', source = 'cred_synthetic_A', defaultAgent = 'native-custom-default', changedPID = false, waitDelay = 0, base: string, server: ReturnType<typeof createServer>, password = 'PRIVATE_SERVICE_PASSWORD'
  const send = (res: ServerResponse, data: any, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)) }
  const event = (res: ServerResponse, value: any) => res.write(`event: message\r\ndata: ${JSON.stringify(value)}\r\n\r\n`)
  const global = (type: string, data = {}) => { for (const res of globalStreams) event(res, { id: 'evt_' + randomUUID(), type, data }) }
  const row = (session: any, type: string, data: any) => {
    // Legitimate aggregate seq gaps represent non-session filtered durable rows.
    const seq = (session.seq += 2)
    const value = { id: 'evt_' + randomUUID(), created: Date.now(), type, durable: { aggregateID: session.info.id, seq, version: 1 }, location: { directory: project }, data: { sessionID: session.info.id, ...data } }
    session.log.push(value)
    for (const res of logStreams.get(session.info.id) ?? []) event(res, value)
    global(type, value.data)
    return value
  }
  const idle = (session: any) => {
    session.active = false
    for (const res of waiters.get(session.info.id) ?? []) { res.writeHead(204); res.end() }
    waiters.delete(session.info.id)
  }
  const finish = (session: any, type = 'session.execution.succeeded') => {
    if (session.finished) return
    session.finished = true
    if (mode !== 'missing-terminal') row(session, type, type.endsWith('interrupted') ? { reason: 'user' } : type.endsWith('failed') ? { error: { type: 'provider.auth', message: 'PRIVATE_NATIVE_ERROR', response: { body: 'PRIVATE_ERROR_BODY' } } } : {})
    session.info.outcome = type.split('.').at(-1)
    if (waitDelay) setTimeout(() => idle(session), waitDelay)
    else idle(session)
  }
  function api() {
    return createServer(async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk
      const body = raw ? JSON.parse(raw) : undefined, url = new URL(req.url!, base), path = url.pathname
      requests.push({ path, method: req.method, body, authMatches: req.headers.authorization === `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` })
      if (path === '/api/credential' || !path.startsWith('/api/')) return send(res, { error: 'PRIVATE_FORBIDDEN' }, 500)
      if (req.headers.authorization !== `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`) return send(res, { error: 'PRIVATE_AUTH_FAILURE' }, 401)
      if (intercept?.(path, body, res, req.method!)) return
      if (path === '/api/info') return send(res, { pid: changedPID ? process.pid + 1 : process.pid, version: '2.0.31', urls: [base], paths: { tmp: '/synthetic/tmp' } })
      if (path === '/api/event') {
        res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders(); globalStreams.add(res)
        event(res, { id: 'evt_connected', type: 'server.connected', data: {} })
        res.once('close', () => globalStreams.delete(res)); return
      }
      const location = { directory: project }
      if (path === '/api/integration') return send(res, { location, data: [{ id: 'own', name: 'Own synthetic', methods: [], connections: [{ type: 'credential', id: source, label: 'PRIVATE_ACCOUNT_LABEL', method: 'oauth' }] }] })
      if (path === '/api/provider') return send(res, { location, data: [{ id: 'own', name: 'Synthetic', integrationID: 'own', activation: 'auto', package: 'synthetic' }] })
      if (path === '/api/model') return send(res, { location, data: ['G', 'a'].map(id => ({ id, modelID: `upstream-${id}`, providerID: 'own', name: `Synthetic ${id}`, enabled: true, variants: [{ id: '' }, { id: 'custom/#' }] })) })
      if (path === '/api/agent') return send(res, { location, data: [{ id: defaultAgent, name: 'Native user default', request: {}, system: 'PRIVATE_NATIVE_SYSTEM', mode: 'primary', hidden: false, permissions: [{ action: '*', resource: '*', effect: 'allow' }] }, { id: 'build', name: 'Not the native default', request: {}, mode: 'primary', hidden: false, permissions: [] }] })
      if (path === '/api/session/active') return send(res, { data: Object.fromEntries([...sessions].filter(([, s]) => s.active).map(([id]) => [id, { type: 'running' }])) })
      if (path === '/api/session' && req.method === 'POST') {
        payloads.push(body)
        if (mode === 'collision') {
          const existing = { ...body, id: body.id, location, parentID: 'ses_other_user', metadata: { notOurs: true }, projectID: 'project_synthetic', time: { created: 1, updated: 1 }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }
          sessions.set(body.id, { info: existing, log: [], seq: -1, inbox: [], users: new Map(), active: false })
          return send(res, { data: existing })
        }
        if (!sessions.has(body.id)) {
          const info = { ...body, ...(mode === 'echo-wrong' ? { model: { providerID: 'own', id: 'wrong-native-echo' } } : {}), projectID: 'project_synthetic', time: { created: 1, updated: 1 }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }
          const session = { info, seq: -1, log: [], inbox: [], users: new Map(), active: false, finished: false }
          sessions.set(body.id, session); row(session, 'session.created', { projectID: 'project_synthetic', location, ...body })
        }
        return send(res, { data: sessions.get(body.id).info })
      }
      const match = /^\/api\/(experimental\/)?session\/(ses[A-Za-z0-9_-]+)(?:\/(.*))?$/.exec(path)
      if (!match) return send(res, { message: 'PRIVATE_UNKNOWN_PATH' }, 404)
      const session = sessions.get(match[2]!)
      if (!session) return send(res, { message: 'PRIVATE_UNKNOWN_SESSION' }, 404)
      const operation = match[3]
      if (!operation && req.method === 'GET') return send(res, { data: session.info })
      if (operation === 'inbox' && req.method === 'GET') return send(res, { data: session.inbox })
      if (operation?.startsWith('message/')) {
        const message = session.users.get(operation.slice(8)); return send(res, message ? { data: message } : { message: 'PRIVATE_NOT_DELIVERED' }, message ? 200 : 404)
      }
      if (operation === 'log') {
        res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders(); res.write(': synthetic durable log\n\n')
        const after = url.searchParams.has('after') ? Number(url.searchParams.get('after')) : -1
        const values = session.log.filter((value: any) => value.durable.seq > after)
        if (mode === 'disconnect-once' && url.searchParams.get('follow') === 'true' && !disconnectedOnce) {
          disconnectedOnce = true
          for (const value of values.slice(0, 3)) event(res, value)
          event(res, { type: 'log.synced', aggregateID: session.info.id, seq: values[2]?.durable.seq ?? after })
          return res.end()
        }
        for (const value of values) event(res, value)
        event(res, { type: 'log.synced', aggregateID: session.info.id, ...(session.seq >= 0 ? { seq: session.seq } : {}) })
        if (url.searchParams.get('follow') === 'false' || mode === 'missing-terminal') return res.end()
        const streams = logStreams.get(session.info.id) ?? new Set(); streams.add(res); logStreams.set(session.info.id, streams)
        res.once('close', () => streams.delete(res)); return
      }
      if (operation === 'wait' && req.method === 'POST') {
        if (mode === 'wait-error') return send(res, { message: 'PRIVATE_WAIT_FAILURE' }, 503)
        if (!session.active) { res.writeHead(204); return res.end() }
        const pending = waiters.get(session.info.id) ?? []; pending.push(res); waiters.set(session.info.id, pending); return
      }
      if (operation?.startsWith('inbox/') && req.method === 'DELETE') {
        const id = operation.slice(6), found = session.inbox.find((x: any) => x.id === id)
        if (found) { session.inbox = session.inbox.filter((x: any) => x !== found); row(session, 'session.inbox.cancelled', { inboxID: id }) }
        res.writeHead(204); return res.end()
      }
      if (operation === 'interrupt') {
        const active = session.active
        if (active) finish(session, 'session.execution.interrupted')
        return send(res, { interrupted: active })
      }
      if (operation === 'prompt') {
        const admit = () => {
        records.push({ sessionId: session.info.id, ...body }); session.finished = false
        const item = { id: body.id, sessionID: session.info.id, time: { created: Date.now() }, type: 'user', payload: { text: body.text, metadata: body.metadata }, delivery: body.delivery }
        session.inbox.push(item); row(session, 'session.inbox.enqueued', { inboxID: body.id, item: { type: 'user', payload: item.payload, delivery: body.delivery } })
        session.active = true; row(session, 'session.execution.started', {})
        if (mode !== 'pending') {
          session.inbox = []; session.users.set(body.id, { id: body.id, type: 'user', text: body.text, metadata: body.metadata, time: { created: Date.now() } })
          row(session, 'session.inbox.delivered', { inboxID: body.id })
          const aid = `msg_assistant_${records.length}`
          if (mode !== 'no-step') row(session, 'session.step.started', { assistantMessageID: aid, agent: defaultAgent, model: mode === 'wrong-model' ? { providerID: 'own', id: 'other' } : session.info.model, started: Date.now() })
          if (mode === 'local-tool') {
            row(session, 'session.tool.called', { assistantMessageID: aid, id: 'synthetic-local-tool', input: { PRIVATE_TOOL: 'PRIVATE_INPUT' }, executed: false })
            row(session, 'session.tool.success', { assistantMessageID: aid, id: 'synthetic-local-tool', content: [{ type: 'text', text: 'PRIVATE_TOOL_RESULT' }], executed: false })
          }
          if (mode === 'switch-aba') { source = 'cred_synthetic_B'; global('credential.switched', { integrationID: 'own', credentialID: source }); source = 'cred_synthetic_A'; global('credential.switched', { integrationID: 'own', credentialID: source }) }
          if (mode === 'agent-change') { defaultAgent = 'changed-native-agent'; global('agent.updated', { PRIVATE_EVENT: 'PRIVATE_CHANGE' }) }
          if (mode === 'watch-gap') for (const response of globalStreams) response.end()
          if (!['hold', 'delayed-admission', 'switch-aba', 'agent-change', 'watch-gap', 'wrong-model'].includes(mode)) {
            if (mode !== 'no-text') row(session, 'session.text.ended', { assistantMessageID: aid, ordinal: 0, text: mode === 'empty-body' ? '' : `原生模拟正文${records.length}`, state: { signature: 'PRIVATE_PROVIDER_STATE' } })
            if (mode === 'duplicate-ended' || mode === 'conflicting-ended') row(session, 'session.text.ended', { assistantMessageID: aid, ordinal: 0, text: mode === 'conflicting-ended' ? '冲突的原生最终正文' : `原生模拟正文${records.length}` })
            row(session, 'session.step.ended', { assistantMessageID: aid, finish: 'stop', cost: 0, tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } }, providerState: 'PRIVATE_PROVIDER_STATE' })
            finish(session, mode === 'native-error' ? 'session.execution.failed' : 'session.execution.succeeded')
          }
        }
        if (mode === 'pid-change') changedPID = true
        if (mode === 'ack-lost') return res.destroy()
        if (mode === 'ack-unknown') { session.inbox = []; session.users.delete(body.id); session.log = []; session.seq = 100; session.active = false; return res.destroy() }
        if (!res.destroyed) return send(res, { data: item })
        }
        if (mode === 'delayed-admission') { setTimeout(admit, 350); return }
        return admit()
      }
      send(res, { message: 'PRIVATE_UNSUPPORTED_OPERATION' }, 404)
    })
  }
  async function listen() {
    server = api(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as any).port}`
    writeFileSync(join(nativeState, 'opencode/service.json'), JSON.stringify({ version: '2.0.31', pid: process.pid, url: base, password }), { mode: 0o600 })
  }
  await listen()
  const backend: ProcessBackend = {
    resolveExecutable: async name => name,
    spawn(spec) {
      if (spec.argv.at(-1) === '--version') return { stdout: Readable.from(['2.0.31\n']), stderr: Readable.from([]), done: Promise.resolve({ exitCode: 0, signal: null }), terminate() {}, waitForExit: async () => true } as any
      if (spec.argv[0] !== process.execPath || !spec.argv[1]?.endsWith('/native-bridge.mjs')) throw Error('Synthetic backend refuses native CLI/model commands')
      const request = JSON.parse(readFileSync(spec.argv.at(-1)!, 'utf8'))
      if (admissionTimeoutMs !== undefined) { request.opencodeV2.admissionTimeoutMs = admissionTimeoutMs; writeFileSync(spec.argv.at(-1)!, JSON.stringify(request), { mode: 0o600 }) }
      bridgeRequests.push(request)
      spawnSpecs.push({ argv: [...spec.argv], env: spec.env })
      const child = spawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, env: { ...process.env, ...spec.env }, stdio: ['ignore', 'pipe', 'pipe'] })
      children.push(child)
      const done = new Promise<any>((resolve, reject) => { child.once('error', reject); child.once('close', (exitCode, signal) => resolve({ exitCode, signal })) })
      return { stdout: child.stdout, stderr: child.stderr, done, terminate() { child.kill('SIGTERM') }, async waitForExit() { await done; return true } } as any
    },
  }
  return { root, project, state, backend, requests, records, payloads, sessions, children, bridgeRequests, spawnSpecs,
    intercept(fn: typeof intercept) { intercept = fn },
    completeForeignInput(sid: string) {
      const session = sessions.get(sid), id = 'msg_foreign_' + randomUUID().replaceAll('-', '')
      row(session, 'session.inbox.enqueued', { inboxID: id, item: { type: 'user', payload: { text: 'PRIVATE_COMPLETED_FOREIGN_INPUT' }, delivery: 'steer' } })
      row(session, 'session.execution.started', {}); row(session, 'session.inbox.delivered', { inboxID: id })
      row(session, 'session.step.started', { assistantMessageID: 'msg_foreign_assistant', agent: defaultAgent, model: session.info.model, started: Date.now() })
      row(session, 'session.text.ended', { assistantMessageID: 'msg_foreign_assistant', ordinal: 0, text: 'PRIVATE_COMPLETED_FOREIGN_REPLY' })
      row(session, 'session.execution.succeeded', {})
      session.users.set(id, { id, type: 'user', text: 'PRIVATE_COMPLETED_FOREIGN_INPUT', time: { created: Date.now() } })
      session.active = false; session.inbox = []
    },
    viewed(sid: string) { row(sessions.get(sid), 'session.viewed', { idle: 0 }) },
    setAdmissionTimeout(ms: number) { admissionTimeoutMs = ms },
    setMode(value: string) { mode = value }, setWaitDelay(ms: number) { waitDelay = ms }, global,
    async restart() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); password += '_restart'; await listen() },
    async close() { for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) },
  }
}
