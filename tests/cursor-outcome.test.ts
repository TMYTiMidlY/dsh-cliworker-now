import { describe, expect, it } from 'vitest'
import { createCursorOutcomeTracker, cursorSourceDiagnostic } from '../src/host/cursor-outcome.mjs'
// Entire matrix is synthetic, derived from the fixed source-contract, not a native/model acceptance.
const session = 'opaque/native:session'
const opening = (id = 'tool:1', kind = 'read', rawInput: any = { paths: ['file'] }) => ({ sessionUpdate: 'tool_call', toolCallId: id, kind, title: 'synthetic', status: 'pending', rawInput })
const update = (rawOutput: any, extra: any = {}) => ({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', status: 'completed', rawOutput, ...extra })
const event = (u: any) => ({ kind: 'tool', step: 1, text: 'synthetic', state: u.status === 'failed' ? 'FAILED' : u.status === 'completed' ? 'COMPLETED' : 'RUNNING', detail: JSON.stringify(u), toolCall: { callId: u.toolCallId, ...(Object.hasOwn(u, 'rawInput') ? { input: u.rawInput } : {}), ...(Object.hasOwn(u, 'rawOutput') ? { output: u.rawOutput } : u.content ? { output: u.content } : {}) } })
function fixture(kind = 'read', input: any = { paths: ['file'] }) {
  const tracker = createCursorOutcomeTracker(); tracker.start(session)
  const send = (u: any, s = session) => { tracker.accept(u, s); return tracker.projectTool(event(u), u, s) }
  send(opening('tool:1', kind, input))
  return { tracker, send, finish: () => tracker.finalize({ status: 'SUCCESS' }), final: () => tracker.finalEvents() }
}
const actions = ['Please sign in to continue', 'Upgrade your plan to continue', 'Add a payment method to continue', 'Check your settings to continue']
describe('helper final state agrees with an unfinished tool card', () => {
  it.each([{ kind: 'execute', visible: false }, { kind: 'execute', visible: true }, { kind: 'other', visible: false }, { kind: 'other', visible: true }])('keeps unfinished $kind visible=$visible uncertain without weakening the common hard error', ({ kind, visible }) => {
    const f = fixture(kind, kind === 'execute' ? { command: 'synthetic' } : undefined)
    f.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', status: 'in_progress', ...(visible ? { rawOutput: kind === 'execute' ? { exitCode: 0, stdout: '', stderr: '' } : { success: true } } : {}) })
    expect(f.final().at(-1).state).toBe('UNKNOWN')
    expect(f.finish()).toMatchObject({ status: 'UNCERTAIN' })
    expect(f.tracker.finalize({ status: 'ERROR' })).toBeUndefined()
  })
})
describe('fixed Cursor source diagnostic families, not generic error detection', () => {
  it.each([...actions, 'Error: native failure', 'Error: [unauthenticated] Backend rejected authentication. Verify this is a User API Key for the same endpoint/environment, then rerun with --debug for request-level auth logs.'])('keeps source-shaped %s and indistinguishable quotation uncertain', text => {
    for (const prefix of ['', 'partial response', 'Here is a legal quote:']) {
      const t = createCursorOutcomeTracker(); t.start(session)
      t.accept({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: prefix + '\n\n' + text } }, session)
      expect(t.finalize({ status: 'SUCCESS' })).toMatchObject({ status: 'UNCERTAIN' })
    }
  })
  it.each(['ordinary error text', '{"error":"business JSON"}', 'Error: ordinary quotation without native prefix', '\nError: one newline', '\n\nError: ', 'Please sign in to continue'])('does not misclassify %j', text => {
    expect(cursorSourceDiagnostic(text)).toBe(false)
  })
  it('scans big-chunk front before truncating carry and spans every prefix split', () => {
    for (const diagnostic of actions.map(s => '\n\n' + s).concat('\n\nError: x')) for (let i = 1; i < diagnostic.length; i++) {
      const t = createCursorOutcomeTracker(); t.start(session)
      for (const text of [diagnostic.slice(0, i), diagnostic.slice(i) + 'x'.repeat(100000)]) t.accept({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }, session)
      expect(t.finalize({ status: 'SUCCESS' })).toMatchObject({ status: 'UNCERTAIN' })
    }
  })
})
describe('local permission denial is causal only for one owned, unique opening', () => {
  const deny = (t: ReturnType<typeof createCursorOutcomeTracker>, id = 'tool:1', sid = session) => t.permissionDenied(id, sid)
  it.each(['empty', 'zero', 'conflict-before', 'conflict-after'])('retains a local denial through %s, without settling its association early', variant => {
    const f = fixture('execute', { command: 'synthetic' })
    const content = (text: string) => ({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text } }] })
    if (variant.startsWith('conflict')) f.send(content('PRIVATE_ONE'))
    if (variant === 'conflict-before') f.send(content('PRIVATE_TWO'))
    deny(f.tracker)
    const p = variant === 'zero' ? f.send(update({ exitCode: 0, stdout: 'PRIVATE_ZERO', stderr: '' })) : f.send(variant.startsWith('conflict') ? content('PRIVATE_TWO') : { sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', status: 'completed', content: [] })
    expect(p.state).toBe('UNKNOWN')
    expect(f.final().at(-1)).toMatchObject({ state: 'FAILED' })
    expect(f.final().at(-1).toolCall.output).toContain('未重新执行')
    expect(JSON.stringify(f.final())).not.toContain('PRIVATE_')
    expect(f.tracker.finalize({ status: 'ERROR' })).toBeUndefined() // Preserve the common permission error.
    expect(f.tracker.finalize({ status: 'INTERRUPTED' })).toBeUndefined()
  })
  it.each(['before', 'after'])('does not paste denial onto a %s reused ID', order => {
    const f = fixture('execute', { command: 'synthetic' })
    if (order === 'before') f.send(opening('tool:1', 'execute', { command: 'different' }))
    deny(f.tracker)
    if (order === 'after') f.send(opening('tool:1', 'execute', { command: 'different' }))
    f.send(update({ exitCode: 0, stdout: '', stderr: '' }))
    expect(f.final().at(-1).state).toBe('UNKNOWN')
    f.send(update({}, { status: 'failed' }))
    expect(f.final().at(-1).state).toBe('FAILED') // Independent native failed stays hard.
  })
  it.each(['kind', 'subtype'])('distinguishes %s identity drift from an ordinary output conflict', variant => {
    const f = fixture('execute', { command: 'synthetic' }); deny(f.tracker)
    f.send(update({ success: true }, variant === 'kind' ? { kind: 'other' } : { rawInput: { shellId: 1, chars: 'x' } }))
    expect(f.final().at(-1).state).toBe('UNKNOWN')
  })
  it('ignores foreign session/ID, prestart, missing and orphan openings', () => {
    for (const [id, sid] of [['foreign', session], ['tool:1', 'foreign']]) {
      const f = fixture('execute', { command: 'synthetic' }); deny(f.tracker, id, sid); f.send(update({ exitCode: 0, stdout: '', stderr: '' })); expect(f.final().at(-1).state).toBe('COMPLETED')
    }
    const t = createCursorOutcomeTracker(); deny(t); t.start(session); deny(t)
    const u = opening(); t.accept(u, session); t.projectTool(event(u), u, session)
    const done = update({ content: 'normal' }); t.accept(done, session); t.projectTool(event(done), done, session)
    expect(t.finalEvents().at(-1)?.state).toBe('COMPLETED')
    const orphan = createCursorOutcomeTracker(); orphan.start(session); orphan.accept(done, session); deny(orphan); orphan.accept(u, session); orphan.projectTool(event(u), u, session)
    expect(orphan.finalEvents().at(-1)?.state).toBe('UNKNOWN')
  })
  it('isolates denial to its target rather than poisoning the neighboring successful tool', () => {
    const f = fixture('execute', { command: 'synthetic' }); f.send(opening('other', 'execute', { command: 'different' })); deny(f.tracker)
    f.send(update({ exitCode: 0, stdout: '', stderr: '' })); f.send(update({ exitCode: 0, stdout: 'normal', stderr: '' }, { toolCallId: 'other' }))
    expect(f.final().map(e => [e.toolCall.callId, e.state])).toEqual([['tool:1', 'FAILED'], ['other', 'COMPLETED']])
  })
})
describe('only read needs a fixed-source positive receipt, never a filename or Host read', () => {
  it.each([undefined, [], [{ type: 'content', content: { type: 'text', text: 'ordinary error JSON is not status' } }], [{ type: 'content', content: { type: 'image', mimeType: 'image/png', data: 'SYNTHETIC_NOT_NATIVE_IMAGE' } }]])('keeps unsupported/missing read evidence %j UNKNOWN, not ERROR or SUCCESS', content => {
    const f = fixture('read', { path: '/synthetic/opaque' })
    expect(f.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', status: 'completed', ...(content ? { content } : {}) }).state).toBe('UNKNOWN')
    expect(f.finish()).toMatchObject({ status: 'UNCERTAIN' }); expect(f.final().at(-1).state).toBe('UNKNOWN')
  })
  it.each([{ content: '' }, { content: '{"error":"ordinary file text"}' }, { totalDiagnostics: 0, totalFiles: 0 }])('preserves valid read raw positive %j across omitted metadata', raw => {
    const f = fixture('read', { path: '/synthetic/opaque' }); f.send(update(raw)); f.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', title: 'metadata only' })
    expect(f.finish()).toBeUndefined(); expect(f.final().at(-1)).toMatchObject({ state: 'COMPLETED', toolCall: { output: raw } })
  })
  it('does not borrow foreign read evidence or poison a normal adjacent execute tool', () => {
    const f = fixture('read', { path: '/synthetic/opaque' }); f.tracker.accept(update({ content: 'foreign' }), 'foreign')
    f.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', status: 'completed' }); f.send(opening('neighbor', 'execute', { command: 'synthetic' })); f.send(update({ exitCode: 0, stdout: '', stderr: '' }, { toolCallId: 'neighbor' }))
    expect(f.finish()).toMatchObject({ status: 'UNCERTAIN' }); expect(f.final().map(e => [e.toolCall.callId, e.state])).toEqual([['tool:1', 'UNKNOWN'], ['neighbor', 'COMPLETED']])
  })
  it.each(['native', 'local', 'independent'])('retains known %s failure ahead of missing read evidence', variant => {
    const f = fixture('read', { path: '/synthetic/opaque' })
    if (variant === 'local') f.tracker.permissionDenied('tool:1', session)
    f.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', status: variant === 'native' ? 'failed' : 'completed' })
    if (variant === 'independent') { f.send(opening('other', 'search', {})); f.send(update({ error: '' }, { toolCallId: 'other' })) }
    expect(f.finish()).toMatchObject({ status: 'ERROR' }); expect(f.final().find(e => e.toolCall.callId === (variant === 'independent' ? 'other' : 'tool:1'))?.state).toBe('FAILED')
  })
})
describe('typed raw shapes, only associated per-run evidence', () => {
  it.each([
    ['read', { paths: [] }, { error: '' }], ['search', {}, { error: 'PRIVATE_ERROR' }], ['other', {}, { rejected: true }],
    ['search', {}, { rejected: true, reason: '' }], ['fetch', {}, { rejected: true, reason: 'PRIVATE\nMULTILINE' }], ['other', {}, { permissionDenied: true }],
    ['execute', { shellId: 1, chars: '\n' }, { error: 'PRIVATE' }],
    ['execute', { command: 'echo x' }, { exitCode: -2147483648, stdout: '', stderr: 'PRIVATE' }],
    ['execute', { command: 'echo x' }, { exitCode: 2147483647, stdout: '', stderr: '' }],
  ])('classifies strict %s negative %j only after full run settlement', (kind, input, raw) => {
    const f = fixture(kind as string, input)
    const projected = f.send(update(raw))
    expect(projected.state).toBe('UNKNOWN') // Never settle a reversible inferred failure early.
    expect(JSON.stringify(projected)).not.toMatch(/PRIVATE|rawOutput/)
    expect(f.finish()).toMatchObject({ status: 'ERROR' })
    expect(f.final().at(-1).state).toBe('FAILED')
  })
  it.each([
    ['read', {}, { content: '{"error":"normal content"}' }], ['read', {}, { totalDiagnostics: 1, totalFiles: 2 }],
    ['search', {}, { totalMatches: 1, truncated: false }], ['search', {}, { resultCount: 0 }], ['search', {}, { totalFiles: 3, truncated: true }],
    ['search', {}, { success: true }], ['other', {}, { success: true }], ['fetch', {}, { success: true }], ['search', {}, { referenceCount: 0 }],
    ['other', {}, { durationMs: 1, isBackground: false }], ['other', {}, { filePath: '/synthetic/video', durationSeconds: 1.5 }],
    ['execute', { command: 'anything' }, { exitCode: 0, stdout: '{"error":"normal stdout"}', stderr: 'error' }], ['execute', { shellId: 1, chars: 'x' }, { success: true }],
  ])('preserves source success object for %s: %j', (kind, input, raw) => {
    const f = fixture(kind as string, input); const p = f.send(update(raw))
    expect(p.state).toBe('UNKNOWN'); expect(p.toolCall.output).toEqual(raw)
    expect(f.finish()).toBeUndefined(); expect(f.final().at(-1)).toMatchObject({ state: 'COMPLETED', toolCall: { output: raw } })
  })
  it.each([
    { error: { text: 'PRIVATE' } }, { error: null }, { error: 'x'.repeat(8193) }, { error: '', success: true }, { error: 'PRIVATE', content: 'x' },
    { rejected: false }, { rejected: true, reason: 1 }, { permissionDenied: true, reason: 'PRIVATE' }, { permissionDenied: false },
    { exitCode: 1 }, { exitCode: 1, stdout: '', stderr: '', success: true }, { exitCode: 2147483648, stdout: '', stderr: '' },
    { exitCode: -2147483649, stdout: '', stderr: '' }, { exitCode: 0.5, stdout: '', stderr: '' }, { exitCode: '1', stdout: '', stderr: '' },
  ])('does not turn malformed/mixed/foreign shape into definite failure', raw => {
    const f = fixture('execute', { command: 'echo' }); const p = f.send(update(raw))
    expect(f.finish()).toMatchObject({ status: 'UNCERTAIN' }); expect(f.final().at(-1).state).toBe('UNKNOWN')
    expect(JSON.stringify(p)).not.toContain('PRIVATE')
  })
  it('uses the fixed protobuf uint32 stdin identity rather than guessing a string or safe-integer union', () => {
    for (const shellId of [0, 4294967295]) {
      const f = fixture('execute', { shellId, chars: '\n' }); f.send(update({ error: '' })); expect(f.finish()).toMatchObject({ status: 'ERROR' })
    }
    for (const shellId of ['1', -1, 4294967296, 0.5, null]) {
      const f = fixture('execute', { shellId, chars: '\n' }); f.send(update({ error: '' })); expect(f.finish()).toMatchObject({ status: 'UNCERTAIN' })
    }
  })
  it('does not admit an empty or missing task success discriminator as a known other-tool result', () => {
    for (const raw of [{}, { durationMs: 1 }]) {
      const f = fixture('other'); f.send(update(raw)); expect(f.finish()).toMatchObject({ status: 'UNCERTAIN' })
    }
    const f = fixture('other'); f.send(update({ isBackground: false })); expect(f.finish()).toBeUndefined()
  })
  it('requires typed kind and command input, never a run/shell title or unrelated execute tool', () => {
    for (const [kind, input] of [['read', { path: 'x' }], ['execute', { action: 'click', coordinate: [0, 0], text: 'x' }], ['execute', { shellId: 1, chars: 'x' }]]) {
      const f = fixture(kind as string, input)
      f.send(update({ exitCode: 2, stdout: '', stderr: 'PRIVATE' }, { title: 'run bash execute shell' }))
      expect(f.finish()).toMatchObject({ status: 'UNCERTAIN' })
    }
  })
  it('inherits typed kind/status/raw evidence across legitimate metadata-only refresh', () => {
    const f = fixture('search'); f.send(update({ error: '' })); f.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', title: 'new title', locations: [{ path: 'x' }] })
    expect(f.finish()).toMatchObject({ status: 'ERROR' }); expect(f.final().at(-1).state).toBe('FAILED')
  })
  it.each(['positive-after-negative', 'negative-after-positive', 'kind-drift', 'conflict-opening', 'terminal-regression'])('keeps per-tool %s ambiguous and never settles inference early', scenario => {
    const f = fixture('search'); const projections = [f.send(update(scenario === 'negative-after-positive' ? { success: true } : { error: '' }))]
    if (scenario === 'positive-after-negative') projections.push(f.send(update({ success: true })))
    if (scenario === 'negative-after-positive') projections.push(f.send(update({ error: '' })))
    if (scenario === 'kind-drift') projections.push(f.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', kind: 'execute' }))
    if (scenario === 'conflict-opening') projections.push(f.send(opening('tool:1', 'read', { path: 'different' })))
    if (scenario === 'terminal-regression') projections.push(f.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', status: 'in_progress' }))
    expect(projections.every(p => !['COMPLETED', 'FAILED'].includes(p.state))).toBe(true)
    expect(f.finish()).toMatchObject({ status: 'UNCERTAIN' }); expect(f.final().at(-1).state).toBe('UNKNOWN')
    f.send(opening('independent', 'search', {})); f.send(update({ error: '' }, { toolCallId: 'independent' }))
    expect(f.finish()).toMatchObject({ status: 'ERROR' })
  })
  it.each([[{ error: '' }, { error: 'different failure' }], [{ totalMatches: 1, truncated: false }, { totalMatches: 2, truncated: false }]])('treats conflicting terminal raw values as ambiguous, but not a reordered identical object', (first, second) => {
    const f = fixture('search'); f.send(update(first)); f.send(update(second))
    expect(f.finish()).toMatchObject({ status: 'UNCERTAIN' })
    const stable = fixture('search'); stable.send(update({ totalMatches: 1, truncated: false })); stable.send(update({ truncated: false, totalMatches: 1 }))
    expect(stable.finish()).toBeUndefined()
  })
  it('isolates foreign sessions/new run, and never retroactively associates orphan failures', () => {
    const t = createCursorOutcomeTracker(); t.start(session)
    t.accept(update({ error: '' }), 'foreign'); expect(t.finalize({ status: 'SUCCESS' })).toBeUndefined()
    t.accept(update({ error: '' }), session); t.accept(opening('tool:1', 'search'), session)
    expect(t.finalize({ status: 'SUCCESS' })).toMatchObject({ status: 'UNCERTAIN' })
    expect(createCursorOutcomeTracker().finalize({ status: 'SUCCESS' })).toBeUndefined()
  })
  it('retains no-raw watch and edit/delete diff without generalizing the read evidence rule', () => {
    for (const kind of ['other', 'edit', 'delete']) {
      const f = fixture(kind); const diff = [{ type: 'diff', path: '/x', oldText: 'error', newText: 'ok' }]
      const p = f.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', status: 'completed', ...(kind === 'edit' || kind === 'delete' ? { content: diff } : {}) })
      expect(f.finish()).toBeUndefined(); expect(f.final().at(-1).state).toBe('COMPLETED')
      if (kind === 'edit' || kind === 'delete') expect(p.toolCall.output).toEqual(diff)
    }
  })
  it.each(['edit', 'delete', 'read', 'other'])('freezes first %s content-only terminal and rejects conflicting later content without premature settlement', kind => {
    const f = fixture(kind)
    const content = (value: string) => kind === 'edit' || kind === 'delete' ? [{ type: 'diff', path: '/x', oldText: null, newText: value }] : [{ type: 'content', content: { type: 'text', text: value } }]
    const send = (value: string) => f.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', status: 'completed', content: content(value) })
    expect(send('ONE').state).toBe('UNKNOWN'); expect(send('TWO').state).toBe('UNKNOWN')
    expect(f.finish()).toMatchObject({ status: 'UNCERTAIN' }); expect(f.final().at(-1).state).toBe('UNKNOWN')
  })
  it.each(['edit', 'delete'])('treats %s equivalent terminal replay/key reordering and omitted content metadata as idempotent', kind => {
    const f = fixture(kind), content = [{ type: 'diff', path: '/x', oldText: 'error', newText: 'ONE' }]
    f.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', status: 'completed', content })
    f.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', title: 'new title', locations: [{ path: 'changed metadata' }] })
    f.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', content: [{ newText: 'ONE', oldText: 'error', path: '/x', type: 'diff' }] })
    expect(f.finish()).toBeUndefined(); expect(f.final().at(-1)).toMatchObject({ state: 'COMPLETED', toolCall: { output: content } })
  })
  it.each([true, false])('allows changing nonterminal progress; first terminal carries content=%s', hasTerminalContent => {
    const f = fixture('edit'), content = (newText: string) => [{ type: 'diff', path: '/x', oldText: '', newText }]
    for (const value of ['ONE', 'TWO']) f.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', status: 'in_progress', content: content(value) })
    f.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', status: 'completed', ...(hasTerminalContent ? { content: content('THREE') } : {}) })
    const expected = hasTerminalContent ? 'THREE' : 'TWO'
    f.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', content: content(expected) })
    expect(f.finish()).toBeUndefined(); expect(f.final().at(-1).toolCall.output).toEqual(content(expected))
  })
  it('freezes inherited progress at terminal even when the completion omits content', () => {
    const f = fixture('edit'), content = (text: string) => [{ type: 'content', content: { type: 'text', text } }]
    f.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', status: 'in_progress', content: content('ONE') })
    f.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', status: 'completed' })
    f.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', content: content('TWO') })
    expect(f.finish()).toMatchObject({ status: 'UNCERTAIN' })
  })
  it('snapshots terminal structure without aliasing a reused mutable input and preserves array order semantics', () => {
    const f = fixture('edit'), content = [{ type: 'diff', path: '/x', oldText: '', newText: 'ONE' }]
    f.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', status: 'completed', content })
    content[0].newText = 'TWO'
    f.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', content })
    expect(f.finish()).toMatchObject({ status: 'UNCERTAIN' })
    const g = fixture('other'), blocks = [{ type: 'content', content: { type: 'text', text: 'A' } }, { type: 'content', content: { type: 'text', text: 'B' } }]
    g.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', status: 'completed', content: blocks })
    g.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', content: [...blocks].reverse() })
    expect(g.finish()).toMatchObject({ status: 'UNCERTAIN' })
  })
  it('does not expose the private terminal snapshot through mutable input or projected output references', () => {
    const f = fixture('edit'), content = [{ type: 'diff', path: '/x', oldText: '', newText: 'ONE' }]
    const projected = f.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', status: 'completed', content })
    content[0].newText = 'INPUT MUTATION'
    projected.toolCall.output[0].newText = 'OUTPUT MUTATION'
    expect(f.final().at(-1).toolCall.output[0].newText).toBe('ONE')
    expect(f.finish()).toBeUndefined()
  })
  it('keeps independent strict or native failed priority over content-only conflict', () => {
    const f = fixture('edit'), content = (newText: string) => [{ type: 'diff', path: '/x', oldText: '', newText }]
    for (const value of ['ONE', 'TWO']) f.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', status: 'completed', content: content(value) })
    expect(f.finish()).toMatchObject({ status: 'UNCERTAIN' })
    f.send(opening('independent', 'search', {})); f.send(update({ error: '' }, { toolCallId: 'independent' }))
    expect(f.finish()).toMatchObject({ status: 'ERROR' })
    f.send({ sessionUpdate: 'tool_call_update', toolCallId: 'tool:1', status: 'failed' })
    expect(f.final().find(e => e.toolCall.callId === 'tool:1').state).toBe('FAILED')
    expect(f.tracker.finalize({ status: 'ERROR', failure: 'hard native failure' })).toBeUndefined()
  })
  it('never downgrades hard native failure or other non-success results', () => {
    const f = fixture(); f.send(update({ error: '' })); f.send(update({ content: 'ok' }, { status: 'failed' }))
    expect(f.final().at(-1).state).toBe('FAILED')
    expect(f.tracker.finalize({ status: 'ERROR', failure: 'hard' })).toBeUndefined()
    expect(f.tracker.finalize({ status: 'UNCERTAIN' })).toBeUndefined()
  })
})
