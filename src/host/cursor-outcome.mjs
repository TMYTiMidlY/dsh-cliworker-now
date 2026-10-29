// Fixed official 2026.10.19-6bbf2c4 contract: see fix-cursor-outcomes/source-contract.md.
import { isDeepStrictEqual } from 'node:util'
const LIMIT = 8192
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const has = (v, k) => Object.hasOwn(v, k)
const exact = (v, required, optional = []) => record(v) && required.every(k => has(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k))
const text = v => typeof v === 'string' && v.length <= LIMIT // Empty and multiline strings are native-valid.
const count = v => Number.isSafeInteger(v) && v >= 0
const finite = v => typeof v === 'number' && Number.isFinite(v) && v >= 0
const terminal = s => s === 'completed' || s === 'failed'
// Source raw result objects contain scalar fields only. Compare the result,
// not the whole update: legitimate title/locations refreshes are not conflicts.
const sameOutput = (a, b) => record(a) && record(b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => has(b, k) && Object.is(a[k], b[k]))
const kinds = new Set(['read', 'search', 'edit', 'delete', 'execute', 'fetch', 'other', 'think', 'move', 'switch_mode'])
const UNKNOWN = 'Cursor 工具结果待核实，未重新执行'
const FAILED = 'Cursor 原生工具执行失败'
const DENIED = 'Cursor 工具权限请求已被本地拒绝，未重新执行'
const PENDING = 'Cursor 原生工具已结束，整轮待核验'
const ACTIONS = ['Please sign in to continue', 'Upgrade your plan to continue', 'Add a payment method to continue', 'Check your settings to continue']
const CARRY = Math.max(...ACTIONS.map(s => s.length + 2), 10)

/** No origin tag exists: matching user quotations remain uncertain, never failed. */
export function cursorSourceDiagnostic(value) {
  return typeof value === 'string' && (ACTIONS.some(s => value.includes(`\n\n${s}`)) || /\n\nError: [\s\S]/u.test(value))
}
const commandInput = input => exact(input, ['command']) && text(input.command)
// Fixed index.js WriteShellStdinArgs: shell_id protobuf uint32, chars string.
const stdinInput = input => exact(input, ['shellId', 'chars']) && Number.isInteger(input.shellId) && input.shellId >= 0 && input.shellId <= 4294967295 && text(input.chars)

/** No recursive inspection of content/stdout/JSON; kind comes only from the opening native card. */
function outputEvidence(raw, item) {
  if (!record(raw)) return 'unknown'
  const kind = item.kind
  const shell = kind === 'execute' && item.command
  const errorKind = ['read', 'search', 'other', 'fetch'].includes(kind) || kind === 'execute' && item.stdin
  if (exact(raw, ['error']) && errorKind && text(raw.error)) return 'negative'
  if (exact(raw, ['rejected'], ['reason']) && raw.rejected === true &&
      (kind === 'other' && !has(raw, 'reason') || ['search', 'fetch'].includes(kind) && (!has(raw, 'reason') || text(raw.reason)))) return 'negative'
  if (kind === 'other' && exact(raw, ['permissionDenied']) && raw.permissionDenied === true) return 'negative'
  if (shell && exact(raw, ['exitCode', 'stdout', 'stderr']) && Number.isInteger(raw.exitCode) && raw.exitCode >= -2147483648 && raw.exitCode <= 2147483647 && typeof raw.stdout === 'string' && typeof raw.stderr === 'string')
    return raw.exitCode === 0 ? 'visible' : 'negative' // Zero does NOT establish native ShellSuccess.
  if (kind === 'read' && exact(raw, ['content']) && typeof raw.content === 'string' ||
      kind === 'read' && exact(raw, ['totalDiagnostics', 'totalFiles']) && count(raw.totalDiagnostics) && count(raw.totalFiles) ||
      kind === 'search' && exact(raw, ['totalMatches', 'truncated']) && count(raw.totalMatches) && typeof raw.truncated === 'boolean' ||
      kind === 'search' && exact(raw, ['resultCount']) && count(raw.resultCount) ||
      kind === 'search' && exact(raw, ['totalFiles', 'truncated']) && count(raw.totalFiles) && typeof raw.truncated === 'boolean' ||
      kind === 'search' && exact(raw, ['referenceCount']) && count(raw.referenceCount) ||
      ['search', 'other', 'fetch'].includes(kind) && exact(raw, ['success']) && raw.success === true ||
      kind === 'execute' && item.stdin && exact(raw, ['success']) && raw.success === true ||
      kind === 'other' && exact(raw, ['isBackground'], ['durationMs']) && (!has(raw, 'durationMs') || finite(raw.durationMs)) && typeof raw.isBackground === 'boolean' ||
      kind === 'other' && exact(raw, ['filePath', 'durationSeconds']) && typeof raw.filePath === 'string' && finite(raw.durationSeconds)) return 'visible'
  return 'unknown'
}

/** One invocation owns one tracker. Only the ACP accepted/post-dedupe hook feeds it. */
export function createCursorOutcomeTracker() {
  let session, carry = '', diagnostic = false
  const tools = new Map()
  const start = id => { if (session !== undefined && session !== id) throw new Error('Cursor run session changed'); session = id }
  const accept = (update, currentSession) => {
    if (!session || currentSession !== session || !record(update)) return
    if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text' && typeof update.content.text === 'string') {
      // Scan BEFORE retaining only the carry; a large chunk can begin with a diagnostic.
      const whole = carry + update.content.text
      diagnostic ||= cursorSourceDiagnostic(whole)
      carry = whole.slice(-CARRY)
      return
    }
    if (!['tool_call', 'tool_call_update'].includes(update.sessionUpdate) || typeof update.toolCallId !== 'string' || !update.toolCallId.trim()) return
    const id = update.toolCallId
    let item = tools.get(id)
    if (!item) {
      item = { kind: undefined, opening: false, identityAmbiguous: false, ambiguous: false, localDenied: false, negative: false, visible: false, hard: false, status: undefined, command: false, stdin: false }
      tools.set(id, item)
    }
    if (update.sessionUpdate === 'tool_call') {
      if (item.opening || item.status !== undefined) item.identityAmbiguous = item.ambiguous = true
      item.opening = true
      if (kinds.has(update.kind) && item.kind === undefined) item.kind = update.kind
      else if (!kinds.has(update.kind) || item.kind !== update.kind) item.identityAmbiguous = item.ambiguous = true
    } else if (!item.opening) item.identityAmbiguous = item.ambiguous = true // Never retroactively bind orphan evidence.
    if (has(update, 'kind') && item.kind !== update.kind) item.identityAmbiguous = item.ambiguous = true
    if (has(update, 'rawInput')) {
      // Refreshing metadata can omit fields; don't clear a previously verified input.
      // A changed input shape cannot turn computerUse/stdin into a shell by title.
      const command = commandInput(update.rawInput), stdin = stdinInput(update.rawInput)
      if (item.inputSeen && (command !== item.command || stdin !== item.stdin)) item.identityAmbiguous = item.ambiguous = true
      item.command = command; item.stdin = stdin; item.inputSeen = true
    }
    const wasTerminal = terminal(item.status)
    if (has(update, 'status')) {
      if (!['pending', 'in_progress', 'completed', 'failed'].includes(update.status)) item.ambiguous = true
      if (terminal(item.status) && update.status !== item.status) item.ambiguous = true
      item.status = update.status
      if (update.status === 'failed') item.hard = true
    }
    if (has(update, 'rawOutput')) {
      if (wasTerminal && item.rawSeen && !sameOutput(item.lastRaw, update.rawOutput)) item.ambiguous = true
      item.lastRaw = update.rawOutput
      const evidence = outputEvidence(update.rawOutput, item)
      if (evidence === 'unknown') item.ambiguous = true
      if (evidence === 'negative') item.negative = true
      if (evidence === 'visible') item.visible = true
      if (item.negative && item.visible) item.ambiguous = true
      item.output = evidence === 'visible' ? update.rawOutput : undefined
      item.rawSeen = true
    } else if (Array.isArray(update.content) && !item.rawSeen) {
      // Compare only content values, never title/locations or the whole update.
      // Nonterminal progress is replaceable; terminal evidence is not.
      if (item.terminalContent !== undefined && !isDeepStrictEqual(item.terminalContent, update.content)) item.ambiguous = true
      item.output = update.content
    }
    if (!item.rawSeen && terminal(item.status) && item.terminalContent === undefined && Array.isArray(item.output)) {
      // A terminal can omit content and inherit the last progress value. Clone
      // once so later updates (or reused input references) cannot change it.
      item.terminalContent = structuredClone(item.output)
    }
  }
  const denied = item => item.localDenied && item.opening && item.kind && !item.identityAmbiguous
  const permissionDenied = (id, currentSession) => {
    if (!session || currentSession !== session || typeof id !== 'string') return
    const item = tools.get(id)
    // No tombstone/retroactive bind for orphan or reused identity. Output
    // conflicts are separate: they cannot erase this local causal fact.
    if (item?.opening && item.kind && !item.identityAmbiguous) item.localDenied = true
  }
  // The fixed presenter drops both read errors and nontext read successes.
  // completed alone therefore cannot establish a positive read receipt.
  const readUnproven = item => item.kind === 'read' && !item.visible && !item.negative
  const unknown = item => item.ambiguous || !item.opening || !item.kind
  const projected = (item, final) => {
    if (!item?.event) return undefined
    // Local denial has a trusted origin, but its identity can still be reused
    // later in this turn. Only the full-turn projection may settle its promise.
    const localFailure = denied(item)
    const hard = item.hard || final && localFailure
    const ended = terminal(item.status)
    const uncertain = unknown(item) || final && (!ended || readUnproven(item))
    const inferredFailure = !uncertain && item.negative
    const state = hard ? 'FAILED' : uncertain ? 'UNKNOWN' : ended ? final ? inferredFailure ? 'FAILED' : 'COMPLETED' : 'UNKNOWN' : 'RUNNING'
    const summary = item.hard ? FAILED : final && localFailure ? DENIED : final && inferredFailure ? FAILED : uncertain ? UNKNOWN : ended && !final ? PENDING : `Cursor 原生工具状态：${item.status ?? 'pending'}`
    const { output: _oldOutput, ...call } = item.event.toolCall
    // Keep the frozen value private; public consumers must not receive an alias
    // that can mutate evidence or replace the final output without a new update.
    const output = !item.rawSeen && item.terminalContent !== undefined ? structuredClone(item.terminalContent) : item.output
    return { ...item.event, state, detail: summary, toolCall: { ...call, ...(hard || localFailure || uncertain || item.negative ? { output: summary } : output !== undefined ? { output } : {}) } }
  }
  const projectTool = (event, update, currentSession) => {
    const item = currentSession === session ? tools.get(update.toolCallId) : undefined
    if (!item) return { ...event, state: 'UNKNOWN', detail: UNKNOWN, toolCall: { callId: event.toolCall.callId, name: event.toolCall.name, output: UNKNOWN } }
    // Never retain the full native update in detail. Raw errors/reasons are private.
    const { detail: _detail, toolCall, ...rest } = event
    const { output: _output, ...call } = toolCall
    item.event = { ...rest, toolCall: { ...item.event?.toolCall, ...call } }
    return projected(item, false)
  }
  const finalEvents = () => [...tools.values()].map(item => projected(item, true)).filter(Boolean)
  const finalize = ({ failure, status }) => {
    if (failure || status !== 'SUCCESS') return undefined
    if ([...tools.values()].some(item => item.hard || !unknown(item) && item.negative)) return { status: 'ERROR', error: FAILED }
    if ([...tools.values()].some(denied)) return { status: 'ERROR', error: DENIED }
    if (diagnostic || [...tools.values()].some(item => unknown(item) || !terminal(item.status) || readUnproven(item))) return { status: 'UNCERTAIN', error: 'Cursor 原生结果待核实，请核查本轮正文和产物，不要自动重试' }
    return undefined
  }
  return { start, accept, permissionDenied, projectTool, finalEvents, finalize }
}
