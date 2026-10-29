import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { createNativeIO } from '../src/host/native-transport.mjs'
import { runNativeCursor } from '../src/host/native-cursor.mjs'
import { BridgeProtocol } from '../src/host/bridge-protocol.ts'
// Real owned subprocess, entirely synthetic ACP frames: no CLI, native account or model.
const sid = 'cursor-synthetic-process'
const frame = (update: any, sessionId = sid) => ({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } })
const text = (t: string, extra = {}) => frame({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t }, ...extra })
const open = (id = 't', kind = 'search', rawInput = {}) => frame({ sessionUpdate: 'tool_call', toolCallId: id, kind, title: 'synthetic native tool', status: 'pending', rawInput })
const complete = (rawOutput: any, extra = {}) => frame({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed', rawOutput, ...extra })
const permission = (toolCallId = 't', sessionId = sid, options: any[] = [{ kind: 'reject_once', optionId: 'reject-synthetic' }]) => ({ jsonrpc: '2.0', id: 'synthetic-denial', method: 'session/request_permission', params: { sessionId, toolCall: { toolCallId, title: 'PRIVATE_PERMISSION_TITLE', kind: 'execute', content: [{ type: 'content', content: { type: 'text', text: 'PRIVATE_PERMISSION_REASON' } }] }, options } })
async function run(updates: any[], options: { scenario?: string; replay?: any[]; ended?: any[]; response?: Record<string, unknown>; cleanup?: boolean } = {}) {
  const controller = new AbortController(), frames: any[] = [], events: any[] = [], pids: number[] = [], requests: any[] = []
  const protocol = new BridgeProtocol((e: any) => events.push(e), () => {}, 1024 * 1024)
  const params = { cli: 'cursor', project: process.cwd(), argv: ['/synthetic/cursor-agent', 'acp'], prompt: 'SYNTHETIC ONLY', preference: { model: 'kimi-k3[reasoning=max]', effort: 'default' }, mode: 'plan', timeoutMs: 1500, maxLineBytes: 1024 * 1024, maxRunBytes: 4 * 1024 * 1024, env: { CURSOR_SYNTHETIC_SCENARIO: options.scenario || 'success', CURSOR_SYNTHETIC_UPDATES: JSON.stringify(updates), CURSOR_SYNTHETIC_REPLAY: JSON.stringify(options.replay || []), CURSOR_SYNTHETIC_ENDED: JSON.stringify(options.ended || []), ...(options.response ? { CURSOR_SYNTHETIC_RESPONSE: JSON.stringify(options.response) } : {}) } }
  const io = createNativeIO(params, (line: string) => { const f = JSON.parse(line); frames.push(f); protocol.feed(line); if (options.scenario === 'cancel' && f.event?.kind === 'assistant') controller.abort() }, controller.signal)
  const original = io.openStdio.bind(io)
  io.openStdio = async (_argv: any, opts: any) => {
    const peer = await original([process.execPath, fileURLToPath(new URL('./fixtures/cursor-acp.mjs', import.meta.url)), 'acp'], { ...opts, onMessage: (message: any) => { if (message.method === 'synthetic/request') requests.push(message.params.request); return opts.onMessage(message) } })
    pids.push(peer.process.pid)
    if (options.cleanup === false) { const close = peer.close.bind(peer); peer.close = async () => { await close(); throw new Error('SYNTHETIC_PRIVATE_CLEANUP') } }
    return peer
  }
  let error: any; try { await runNativeCursor(params, io) } catch (e) { error = e }
  await io.close(error); protocol.end()
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow()
  return { frames, events, requests, result: protocol.result!, tools: events.filter(e => e.kind === 'tool') }
}
describe('Cursor post-dedupe → native IO → bridge protocol outcomes', () => {
  it.each(['absent', 'empty', 'text-only', 'image-like'])('read completed with %s evidence stays UNKNOWN through real synthetic ACP', async variant => {
    const content = variant === 'empty' ? [] : variant === 'text-only' ? [{ type: 'content', content: { type: 'text', text: 'ordinary error words' } }] : [{ type: 'content', content: { type: 'image', mimeType: 'image/png', data: 'SYNTHETIC_IMAGE' } }]
    const r = await run([open('t', 'read', { path: '/synthetic/opaque' } as any), frame({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed', ...(variant === 'absent' ? {} : { content }) }), open('neighbor', 'execute', { command: 'synthetic' } as any), complete({ exitCode: 0, stdout: 'normal', stderr: '' }, { toolCallId: 'neighbor' }), text('current body')])
    expect(r.result).toMatchObject({ status: 'UNCERTAIN', response: 'current body' }); expect(r.tools.filter(t => t.toolCall.callId === 't').at(-1).state).toBe('UNKNOWN'); expect(r.tools.filter(t => t.toolCall.callId === 'neighbor').at(-1).state).toBe('COMPLETED')
  })
  it.each([{ content: '' }, { content: '{"error":"normal file"}' }, { totalDiagnostics: 0, totalFiles: 0 }])('retains known read success %j and ordinary content through the bridge', async raw => {
    const r = await run([open('t', 'read'), complete(raw), frame({ sessionUpdate: 'tool_call_update', toolCallId: 't', title: 'metadata only' }), text('body')])
    expect(r.result.status).toBe('SUCCESS'); expect(r.tools.at(-1)).toMatchObject({ state: 'COMPLETED', toolCall: { output: raw } })
  })
  it.each(['native-failed', 'local-denied', 'independent', 'cleanup', 'cancel'])('read missing evidence cannot hide %s hard failure', async variant => {
    const updates: any[] = [open('t', 'read', { path: '/synthetic/opaque' } as any)]
    if (variant === 'local-denied') updates.push(permission())
    updates.push(frame({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: variant === 'native-failed' ? 'failed' : 'completed' }))
    if (variant === 'independent') updates.push(open('hard', 'search'), complete({ error: '' }, { toolCallId: 'hard' }))
    updates.push(text('body'))
    const r = await run(updates, { cleanup: variant !== 'cleanup', scenario: variant === 'cancel' ? 'cancel' : undefined })
    expect(r.result.status).toBe('ERROR')
    if (variant === 'local-denied') { expect(r.result.error).toBe('CLI 请求的额外权限已拒绝'); expect(r.tools.at(-1).state).toBe('FAILED') }
    if (variant === 'cleanup') expect(r.result.error).toContain('清理失败')
  })
  it.each(['empty', 'zero', 'output-conflict', 'cancel-option'])('local permission denial of one owned tool survives %s through a real synthetic process', async variant => {
    const terminal = (value: string) => frame({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: value } }] })
    const updates: any[] = [open('t', 'execute', { command: 'synthetic denied' } as any), open('neighbor', 'read', { path: 'synthetic' } as any)]
    if (variant === 'output-conflict') updates.push(terminal('ordinary before denial'))
    updates.push(permission('t', sid, variant === 'cancel-option' ? [] : undefined))
    updates.push(variant === 'zero' ? complete({ exitCode: 0, stdout: 'PRIVATE_ZERO', stderr: '' }) : variant === 'output-conflict' ? terminal('PRIVATE_AFTER') : frame({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed', content: [] }))
    updates.push(complete({ content: 'neighbor content' }, { toolCallId: 'neighbor' }), text('current body'))
    const r = await run(updates)
    expect(r.result).toMatchObject({ status: 'ERROR', response: 'current body', error: 'CLI 请求的额外权限已拒绝' })
    expect(r.tools.filter(t => t.toolCall.callId === 't').at(-1)).toMatchObject({ state: 'FAILED' })
    expect(r.tools.filter(t => t.toolCall.callId === 't').slice(0, -1).every(t => !['COMPLETED', 'FAILED'].includes(t.state))).toBe(true)
    expect(r.tools.filter(t => t.toolCall.callId === 'neighbor').at(-1)).toMatchObject({ state: 'COMPLETED', toolCall: { output: { content: 'neighbor content' } } })
    expect(JSON.stringify(r.frames)).not.toContain('PRIVATE_')
    expect(r.requests.find(q => q.id === 'synthetic-denial')?.result?.outcome).toEqual(variant === 'cancel-option' ? { outcome: 'cancelled' } : { outcome: 'selected', optionId: 'reject-synthetic' })
  })
  it.each(['reuse-before', 'reuse-after', 'orphan'])('denied but %s identity cannot forge a FAILED merged card', async variant => {
    const updates: any[] = variant === 'orphan' ? [complete(undefined), open('t', 'execute', { command: 'synthetic' } as any)] : [open('t', 'execute', { command: 'synthetic' } as any)]
    if (variant === 'reuse-before') updates.push(open('t', 'execute', { command: 'different' } as any))
    updates.push(permission())
    if (variant === 'reuse-after') updates.push(open('t', 'execute', { command: 'different' } as any))
    updates.push(complete({ exitCode: 0, stdout: '', stderr: '' }), text('current body'))
    const r = await run(updates)
    expect(r.result).toMatchObject({ status: 'ERROR', error: 'CLI 请求的额外权限已拒绝' }); expect(r.tools.at(-1).state).toBe('UNKNOWN')
    expect(r.tools.every(t => !['COMPLETED', 'FAILED'].includes(t.state))).toBe(true)
  })
  it.each(['wrong-session', 'wrong-id', 'preprompt', 'ended', 'no-opening'])('keeps %s denial out of unrelated tool evidence', async variant => {
    const p = permission(variant === 'wrong-id' ? 'foreign-id' : 't', variant === 'wrong-session' ? 'foreign-session' : sid)
    const updates: any[] = [open('t', 'execute', { command: 'synthetic' } as any)]
    if (variant === 'no-opening') updates.unshift(p)
    if (variant === 'wrong-id' || variant === 'wrong-session') updates.push(p)
    updates.push(complete({ exitCode: 0, stdout: '', stderr: '' }), text('body'))
    const r = await run(updates, { replay: variant === 'preprompt' ? [p] : [], ended: variant === 'ended' ? [p] : [] })
    if (variant === 'ended' && r.result.status === 'ERROR') {
      // A real post-result reply can race EOF/cleanup. Never suppress that hard
      // transport error just to make an ended notification look successful.
      expect(r.result.error).toMatch(/执行|清理/)
      expect(r.tools.every(t => t.state !== 'FAILED')).toBe(true)
      expect(r.events.some(e => e.kind === 'diagnostic' && e.text.includes('权限'))).toBe(false)
    } else {
      expect(r.result.status, JSON.stringify(r.result)).toBe(variant === 'wrong-id' || variant === 'no-opening' ? 'ERROR' : 'SUCCESS')
      expect(r.tools.at(-1).state).toBe('COMPLETED')
    }
  })
  it.each(['Please sign in to continue', 'Upgrade your plan to continue', 'Add a payment method to continue', 'Check your settings to continue', 'Error: synthetic failure'])('keeps full current body, %s is uncertain and has no fabricated response metadata', async diagnostic => {
    const body = 'current partial\n\n' + diagnostic
    const r = await run([text(body)])
    expect(r.result).toMatchObject({ status: 'UNCERTAIN', response: body }); expect(r.events.some(e => e.response)).toBe(false)
    expect(r.events.filter(e => e.kind === 'assistant').map(e => e.text).join('')).toBe(body)
  })
  it('keeps ordinary content successful and ignores load/foreign/eventId replay', async () => {
    const r = await run([text('A', { eventId: 'x' }), text('\n\nError: duplicate', { eventId: 'x' }), frame({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '\n\nPlease sign in to continue' } }, 'foreign'), text('{"error":"ordinary"}')], { replay: [text('OLD RESULT\n\nError: old')] })
    expect(r.result).toMatchObject({ status: 'SUCCESS', response: 'A{"error":"ordinary"}' })
  })
  it('ignores ended notifications and preserves a separate independent strict failure', async () => {
    const ended = await run([text('current')], { ended: [text('\n\nError: too late'), open(), complete({ error: 'PRIVATE_ENDED' })] })
    expect(ended.result, JSON.stringify(ended.result)).toMatchObject({ status: 'SUCCESS', response: 'current' }); expect(ended.tools).toHaveLength(0)
    const r = await run([open(), complete({ error: '' }), complete({ success: true }), open('independent'), complete({ error: '' }, { toolCallId: 'independent' }), text('body')])
    expect(r.result.status).toBe('ERROR')
    expect(r.tools.filter(t => t.toolCall.callId === 't').every(t => t.state !== 'FAILED')).toBe(true)
    expect(r.tools.filter(t => t.toolCall.callId === 'independent').at(-1).state).toBe('FAILED')
  })
  it.each([
    ['method-empty', { result: { stopReason: 'end_turn' }, method: '' }], ['method-null', { result: { stopReason: 'end_turn' }, method: null }],
    ['method-false', { result: { stopReason: 'end_turn' }, method: false }], ['method-zero', { result: { stopReason: 'end_turn' }, method: 0 }],
    ['mixed-null', { result: { stopReason: 'end_turn' }, error: null }], ['mixed-false', { result: { stopReason: 'end_turn' }, error: false }],
    ['mixed-object', { result: { stopReason: 'end_turn' }, error: { code: -1, message: 'PRIVATE_RPC_ERROR' } }],
    ['missing-both', {}], ['error-null', { error: null }], ['error-false', { error: false }],
    ['error-code', { error: { code: 'bad', message: 'PRIVATE_RPC_ERROR' } }], ['error-message', { error: { code: -1, message: null, data: 'PRIVATE_RPC_ERROR' } }],
    ['error-array', { error: [] }],
  ])('fails closed synchronously for malformed owned prompt response %s without late body pollution', async (_label, response) => {
    const r = await run([text('BEFORE')], { response: response as Record<string, unknown>, ended: [text('LATE'), open(), complete({ error: 'PRIVATE_LATE' })] })
    expect(r.result.status).toBe('ERROR'); expect(r.result.response).toBe('BEFORE')
    expect(r.events.filter(e => e.kind === 'assistant').map(e => e.text).join('')).toBe('BEFORE')
    expect(r.tools).toHaveLength(0); expect(JSON.stringify(r.frames)).not.toMatch(/PRIVATE_RPC_ERROR|PRIVATE_LATE/)
  })
  it('retains valid RPC error and cleanup hard failure over any fence proposal', async () => {
    const rpc = await run([text('BEFORE')], { response: { error: { code: -1, message: 'PRIVATE_RPC_ERROR' } }, ended: [text('LATE')] })
    expect(rpc.result).toMatchObject({ status: 'ERROR', response: 'BEFORE' }); expect(JSON.stringify(rpc.frames)).not.toContain('PRIVATE_RPC_ERROR')
    const cleanup = await run([text('BEFORE')], { response: { method: false, result: { stopReason: 'end_turn' } }, ended: [text('LATE')], cleanup: false })
    expect(cleanup.result).toMatchObject({ status: 'ERROR', response: 'BEFORE' }); expect(cleanup.result.error).toContain('清理失败')
  })
  it('synchronously fences only the active prompt, never old/unrelated response IDs', async () => {
    let receive: (m: any) => Promise<void>; let result: any[] = []
    const options = { sessionId: sid, configOptions: [
      { id: 'model', type: 'select', currentValue: 'synthetic', options: [{ value: 'synthetic', name: 'Synthetic' }] },
      { id: 'mode', type: 'select', currentValue: 'agent', options: ['agent', 'plan', 'ask'].map(value => ({ value, name: value })) },
    ] }
    const peer = { send: async () => {}, end: () => {}, close: async () => {}, request: async (method: string, _params: any, requestOptions: any) => {
      if (method === 'initialize') return { protocolVersion: 1, agentCapabilities: {} }
      if (method === 'session/new') return options
      if (method === 'session/prompt') {
        expect(requestOptions.id).toMatch(/^[a-f0-9-]{36}$/)
        await receive(text('A'))
        const response = { jsonrpc: '2.0', id: requestOptions.id, result: { stopReason: 'end_turn' } }
        for (const invalid of [ { ...response, id: 'old-load-id' }, { ...response, id: 'unrelated', method: null }, { ...response, id: 'old', error: null }, { jsonrpc: '2.0', id: 'unknown', error: 'not-RPC-error' } ]) {
          await receive(invalid); await receive(text('B'))
        }
        await receive({ jsonrpc: '2.0', id: response.id, method: 'session/request_permission', params: { sessionId: 'foreign', options: [] } })
        await receive(text('C'))
        await receive(response); await receive(text('MUST_NOT_ADMIT'))
        return response.result
      }
      throw new Error('Unexpected synthetic request')
    } }
    await runNativeCursor({ argv: ['/synthetic/cursor', 'acp'], mode: 'accept-edits', preference: { model: 'synthetic', effort: 'default' } }, {
      signal: new AbortController().signal, session: () => {}, native: () => {}, event: () => {}, result: (...args: any[]) => { result = args },
      openStdio: async (_argv: any, opts: any) => { receive = opts.onMessage; return peer },
    })
    expect(result.slice(0, 2)).toEqual(['SUCCESS', 'ABBBBC'])
  })
  it('leaves missing tool terminal UNKNOWN without masking the common hard error', async () => {
    const r = await run([open(), text('body')])
    expect(r.result.status).toBe('ERROR'); expect(r.tools.at(-1).state).toBe('UNKNOWN')
  })
  it('does not deduplicate repeated tokens lacking native identity', async () => {
    expect((await run([text('A'), text('A')])).result.response).toBe('AA')
  })
  it.each(['negative-positive', 'positive-negative', 'reuse', 'kind', 'orphan'])('never prematurely settles inferred terminal through %s conflict', async scenario => {
    const updates = scenario === 'orphan' ? [complete({ error: '' }), open()] : [open(), complete(scenario === 'positive-negative' ? { success: true } : { error: 'SYNTHETIC_PRIVATE_NEGATIVE' })]
    if (scenario === 'negative-positive') updates.push(complete({ success: true }))
    if (scenario === 'positive-negative') updates.push(complete({ error: '' }))
    if (scenario === 'reuse') updates.push(open('t', 'read', { path: 'different' } as any))
    if (scenario === 'kind') updates.push(frame({ sessionUpdate: 'tool_call_update', toolCallId: 't', kind: 'execute' }))
    // A missing common native terminal remains a hard error, independent of raw
    // ambiguity. Complete the reopened card to isolate the identity counterexample.
    if (scenario === 'reuse' || scenario === 'orphan') updates.push(complete({ content: 'ordinary final output' }))
    updates.push(text('current body'))
    const r = await run(updates)
    expect(r.result).toMatchObject({ status: 'UNCERTAIN', response: 'current body' })
    expect(r.tools.every(e => !['COMPLETED', 'FAILED'].includes(e.state))).toBe(true)
    expect(JSON.stringify(r.frames)).not.toContain('SYNTHETIC_PRIVATE_NEGATIVE')
  })
  it.each(['edit', 'delete', 'other'])('content-only %s contradictory terminal stays UNKNOWN through the real synthetic bridge', async kind => {
    const content = (newText: string) => kind === 'other' ? [{ type: 'content', content: { type: 'text', text: newText } }] : [{ type: 'diff', path: '/synthetic', oldText: null, newText }]
    const terminal = (value: string) => frame({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed', content: content(value) })
    const r = await run([open('t', kind), terminal('ONE'), frame({ sessionUpdate: 'tool_call_update', toolCallId: 't', title: 'metadata only' }), terminal('TWO'), text('current body')])
    expect(r.result).toMatchObject({ status: 'UNCERTAIN', response: 'current body' })
    expect(r.tools.every(e => !['COMPLETED', 'FAILED'].includes(e.state))).toBe(true)
    expect(r.tools.at(-1).toolCall.output).toBe('Cursor 工具结果待核实，未重新执行')
    const hard = await run([open('t', kind), terminal('ONE'), terminal('TWO'), open('hard'), complete({ error: '' }, { toolCallId: 'hard' }), text('body')])
    expect(hard.result.status).toBe('ERROR')
    expect(hard.tools.filter(e => e.toolCall.callId === 't').at(-1).state).toBe('UNKNOWN')
  })
  it('content-only nonterminal progress, equal replay and missing metadata do not invent uncertainty', async () => {
    const content = [{ type: 'diff', path: '/synthetic', oldText: '', newText: 'TWO' }]
    const r = await run([open('t', 'edit'), frame({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'in_progress', content: [{ ...content[0], newText: 'ONE' }] }), frame({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed', content }), frame({ sessionUpdate: 'tool_call_update', toolCallId: 't', locations: [{ path: 'metadata' }] }), frame({ sessionUpdate: 'tool_call_update', toolCallId: 't', content: [{ newText: 'TWO', oldText: '', path: '/synthetic', type: 'diff' }] }), text('body')])
    expect(r.result.status).toBe('SUCCESS'); expect(r.tools.at(-1)).toMatchObject({ state: 'COMPLETED', toolCall: { output: content } })
    expect(r.tools.slice(0, -1).every(e => !['COMPLETED', 'FAILED'].includes(e.state))).toBe(true)
  })
  it('deduplicates repeated negative update before evidence observation', async () => {
    const r = await run([open(), complete({ success: true }, { eventId: 'done' }), complete({ error: 'PRIVATE' }, { eventId: 'done' }), text('ok')])
    expect(r.result.status).toBe('SUCCESS'); expect(r.tools.at(-1).state).toBe('COMPLETED')
  })
  it('preserves negative evidence through metadata and publishes terminal only at complete run settlement', async () => {
    const r = await run([open(), complete({ error: '' }), frame({ sessionUpdate: 'tool_call_update', toolCallId: 't', title: 'metadata title' }), text('body')])
    expect(r.result).toMatchObject({ status: 'ERROR', response: 'body' }); expect(r.tools.at(-1).state).toBe('FAILED')
    expect(r.tools.slice(0, -1).some(e => e.state === 'FAILED')).toBe(false)
    const failedIndex = r.frames.findIndex(f => f.event?.state === 'FAILED')
    const lastTextIndex = r.frames.findIndex(f => f.event?.text === 'body')
    expect(failedIndex).toBeGreaterThan(lastTextIndex)
  })
  it.each(['cancel', 'rpc-error', 'nonzero', 'missing-terminal'])('preserves hard %s over source-shaped unknown', async scenario => {
    const r = await run([text('partial\n\nError: unknown')], { scenario })
    expect(r.result.status).toBe('ERROR'); expect(JSON.stringify(r.result)).not.toContain('SYNTHETIC_PRIVATE_AUTH')
  })
  it('preserves cleanup failure over an uncertain proposed result', async () => {
    const r = await run([text('partial\n\nError: unknown')], { cleanup: false })
    expect(r.result.status).toBe('ERROR'); expect(r.result.response).toContain('partial'); expect(JSON.stringify(r.result)).not.toContain('SYNTHETIC_PRIVATE_CLEANUP')
  })
  it('does not undo native failed or permission denial with contradictory raw evidence', async () => {
    const denied = { jsonrpc: '2.0', id: 'deny', method: 'session/request_permission', params: { sessionId: sid, options: [{ kind: 'reject_once', optionId: 'reject' }] } }
    for (const hard of [complete({ success: true }, { status: 'failed' }), denied]) {
      const r = await run([open(), complete({ error: '' }), hard, text('body')]); expect(r.result.status).toBe('ERROR')
    }
  })
})
