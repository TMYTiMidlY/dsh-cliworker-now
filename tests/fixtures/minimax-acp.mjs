#!/usr/bin/env node
// Explicitly SYNTHETIC native process. Does not load MiniMax/Cursor or any credentials.
import { createInterface } from 'node:readline'
const scenario = process.env.MINIMAX_SYNTHETIC_SCENARIO ?? 'success'
const cursor = process.env.SYNTHETIC_CLI === 'cursor'
const id = 'minimax-synthetic-process'
const out = v => process.stdout.write(JSON.stringify(v) + '\n')
const model = 'm:minimax:MiniMax-M3.1-Flash:u'
let data = cursor ? { sessionId: id, configOptions: [
  { id: 'model', type: 'select', currentValue: 'default[]', options: [{ value: 'default[]', name: 'Auto' }] },
  { id: 'mode', type: 'select', currentValue: 'ask', options: ['agent', 'plan', 'ask'].map(value => ({ value, name: value })) },
] } : { sessionId: id, modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }] }, configOptions: [
  { id: 'model', category: 'model', type: 'select', currentValue: model, options: [{ value: model, name: 'Synthetic MiniMax' }] },
  { id: 'permissionMode', category: '_permission', type: 'select', currentValue: 'auto', options: ['default', 'auto', 'bypassPermissions'].map(value => ({ value, name: value })), _meta: { 'minimax-code/scope': 'process' } },
  { id: 'thinkingEffort', category: 'thought_level', type: 'select', currentValue: 'low', options: ['low', 'high'].map(value => ({ value, name: value })) },
] }
const reply = (q, result) => out({ jsonrpc: '2.0', id: q.id, result })
const update = (kind, extra) => out({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: id, update: { sessionUpdate: kind, ...extra } } })
let pending
createInterface({ input: process.stdin }).on('line', line => {
  const q = JSON.parse(line)
  if (!q.method) return
  // Must NEVER be persisted or public. Parsed assistant/tool events below remain visible.
  out({ jsonrpc: '2.0', method: 'synthetic/private', params: { token: 'PRIVATE_RAW_AUTH' } })
  process.stderr.write('PRIVATE_STDERR_AUTH\n')
  if (q.method === 'initialize') return reply(q, { protocolVersion: 1, agentInfo: { name: scenario === 'wrong-agent' ? 'wrong' : 'minimax-code' }, agentCapabilities: { loadSession: scenario !== 'no-resume' } })
  if (q.method === 'session/new' || q.method === 'session/load') {
    if (q.method === 'session/load') update('agent_message_chunk', { content: { type: 'text', text: 'OLD HISTORY' } })
    if (scenario === 'wrong-session') return reply(q, { ...data, sessionId: 'different' })
    if (scenario === 'plan') data.modes.currentModeId = 'plan'
    return reply(q, data)
  }
  if (q.method === 'session/set_config_option') {
    if (typeof q.params.value !== 'string') process.exit(21)
    data.configOptions.find(x => x.id === q.params.configId).currentValue = scenario === 'unconfirmed-' + q.params.configId ? 'wrong' : q.params.value
    return reply(q, { configOptions: data.configOptions })
  }
  if (q.method === 'session/prompt') {
    if (scenario === 'rpc-error') return out({ jsonrpc: '2.0', id: q.id, error: { code: -32000, message: 'PRIVATE_RPC_AUTH', data: { token: 'PRIVATE_ERROR_DATA' } } })
    if (scenario === 'nonzero') { reply(q, { stopReason: 'end_turn' }); process.exit(1) }
    if (scenario === 'permission') out({ jsonrpc: '2.0', id: 'permission', method: 'session/request_permission', params: { sessionId: id, options: [{ kind: 'allow_once', optionId: 'allow' }, { kind: 'reject_once', optionId: 'reject' }] } })
    if (['fs', 'terminal', 'question'].includes(scenario)) out({ jsonrpc: '2.0', id: 'request', method: scenario === 'fs' ? 'fs/read_text_file' : scenario === 'terminal' ? 'terminal/create' : 'elicitation/create', params: { sessionId: id } })
    if (scenario === 'drift') update('config_option_update', { configOptions: [{ id: 'permissionMode', currentValue: 'bypassPermissions' }] })
    if (scenario !== 'empty') update('agent_message_chunk', { content: { type: 'text', text: 'HELLO SYNTHETIC' } })
    if (scenario === 'cancel') { pending = q; return }
    if (scenario === 'tool') { update('tool_call', { toolCallId: 'public-tool', title: 'Synthetic tool', status: 'completed', rawInput: { test: true }, rawOutput: 'PUBLIC TOOL' }) }
    return reply(q, { stopReason: scenario === 'missing' ? undefined : scenario === 'limit' ? 'max_turn_requests' : 'end_turn' })
  }
  if (q.method === 'session/cancel' && pending) { reply(pending, { stopReason: 'cancelled' }); pending = undefined }
})
