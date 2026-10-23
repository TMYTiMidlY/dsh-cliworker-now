// Synthetic Cursor ACP v1 fixture only. Never loads a CLI, account or model.
import { createInterface } from 'node:readline'
const scenario = process.env.CURSOR_SYNTHETIC_SCENARIO
const out = v => process.stdout.write(JSON.stringify(v) + '\n')
const state = { sessionId: 'cursor-synthetic-process', configOptions: [
  { id: 'model', type: 'select', currentValue: 'default[]', options: [{ value: 'default[]', name: 'Auto' }, { value: 'kimi-k3[reasoning=max]', name: 'Kimi synthetic' }] },
  { id: 'mode', type: 'select', currentValue: 'ask', options: ['agent', 'plan', 'ask'].map(value => ({ value, name: value })) },
] }
const reply = (q, result) => out({ jsonrpc: '2.0', id: q.id, result })
const update = (kind, extra) => out({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: state.sessionId, update: { sessionUpdate: kind, ...extra } } })
let pending
createInterface({ input: process.stdin }).on('line', line => {
  const q = JSON.parse(line)
  out({ jsonrpc: '2.0', method: 'synthetic/request', params: { request: q } })
  if (q.method === 'initialize') return reply(q, { protocolVersion: 1, agentCapabilities: { loadSession: true } })
  if (q.method === 'session/new' || q.method === 'session/load') return reply(q, state)
  if (q.method === 'session/set_config_option') {
    if (typeof q.params.value !== 'string') process.exit(21)
    state.configOptions.find(x => x.id === q.params.configId).currentValue = q.params.value
    return reply(q, { configOptions: state.configOptions })
  }
  if (q.method === 'session/prompt') {
    if (scenario === 'malformed') return process.stdout.write('INVALID JSON\n')
    if (scenario === 'rpc-error') return out({ jsonrpc: '2.0', id: q.id, error: { code: -1, message: 'SYNTHETIC_PRIVATE_AUTH' } })
    if (scenario === 'nonzero') { reply(q, { stopReason: 'end_turn' }); process.exit(23) }
    update('agent_message_chunk', { content: { type: 'text', text: 'HELLO SYNTHETIC' } })
    if (scenario === 'cancel') { pending = q; return }
    return reply(q, { stopReason: 'end_turn' })
  }
  if (q.method === 'session/cancel' && pending) { reply(pending, { stopReason: 'cancelled' }); pending = undefined }
})
