import { expect, it, vi } from 'vitest'
import { runNativeAcp } from '../src/host/native-acp.mjs'
import { createNativeHarnessTools } from '../src/host/native-harness-tools.ts'
// In-memory synthetic ACP peer and real loopback Host catalogue only. Never
// starts a native CLI/model, executes a tool, reads credentials or writes files.
it.each(['mcp-allow-once', 'deny-hook', 'deny-default', 'late-hook'] as const)('keeps %s approval/default behavior separate from local-denial observation', async scenario => {
  const execute = vi.fn(async () => ({ content: [] }))
  const lease = scenario === 'mcp-allow-once' ? await createNativeHarnessTools({ binding: { cli: 'grok', parentSessionId: 'synthetic-parent', harnessSessionId: 'synthetic-child', workerId: 'synthetic-worker', runId: 'synthetic-run' }, tools: [{ name: 'synthetic_read', description: 'Synthetic', inputSchema: {}, execution: 'host' }], executionReady: true, authorize() {}, execute }) : undefined
  try {
    const sid = 'synthetic-session', replies: any[] = [], hook = vi.fn()
    let receive: (message: any) => Promise<void>, result: any[] = []
    const peer = { send: async (message: any) => { replies.push(message) }, close: async () => {}, end() {}, request: async (method: string, _params: any, requestOptions: any) => {
      if (method === 'initialize') return { protocolVersion: 1 }
      if (method === 'session/new') return { sessionId: sid }
      if (method === 'session/prompt') {
        if (scenario === 'late-hook') {
          await receive({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: sid, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'synthetic body' } } } })
          await receive({ jsonrpc: '2.0', id: requestOptions.id, result: { stopReason: 'end_turn' } })
        }
        await receive({ jsonrpc: '2.0', id: 'synthetic-permission', method: 'session/request_permission', params: { sessionId: sid, toolCall: { toolCallId: 'opaque-tool-id', name: 'mcp__dsh_worker_tools__synthetic_read', title: 'PRIVATE_TITLE', content: [{ type: 'content', content: { type: 'text', text: 'PRIVATE_REASON' } }] }, options: [{ kind: 'allow_once', optionId: 'native-allow' }, { kind: 'reject_once', optionId: 'native-reject' }] } })
        await receive({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: sid, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'synthetic body' } } } })
        return { stopReason: 'end_turn' }
      }
      throw new Error('Unexpected synthetic method')
    } }
    await runNativeAcp({ cli: 'grok', argv: ['synthetic'], project: '/synthetic', preference: { model: 'synthetic', effort: 'default' }, mode: 'accept-edits', ...(lease ? { harnessTools: lease.connection } : {}) }, { signal: new AbortController().signal, native() {}, session() {}, event() {}, result: (...args: any[]) => { result = args }, openStdio: async (_argv: any, options: any) => { receive = options.onMessage; return peer } }, { name: 'Synthetic ACP', fencePromptResult: true, argv: () => ['synthetic'], configure: async (_peer: any, _sid: string, state: any) => state, ...(scenario === 'deny-default' ? {} : { permissionDenied: hook }) })
    expect(replies.find(r => r.id === 'synthetic-permission')?.result).toEqual({ outcome: { outcome: 'selected', optionId: scenario === 'mcp-allow-once' ? 'native-allow' : 'native-reject' } })
    expect(result[0]).toBe(scenario === 'mcp-allow-once' || scenario === 'late-hook' ? 'SUCCESS' : 'ERROR')
    if (scenario === 'deny-hook') { expect(hook).toHaveBeenCalledExactlyOnceWith('opaque-tool-id', sid); expect(JSON.stringify(hook.mock.calls)).not.toContain('PRIVATE_') }
    else expect(hook).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled() // Approval is not duplicate execution.
  } finally { await lease?.close() }
})
