import { runNativeAcp } from './native-acp.mjs'
import { cursorState } from './cursor-state.mjs'
import { createCursorOutcomeTracker } from './cursor-outcome.mjs'

/** Dedicated native ACP entry, not Cursor IDE/print compatibility or a Qoder clone. */
export function cursorAcpArgv(config) {
  if (!Array.isArray(config.argv) || config.argv.length !== 2 || typeof config.argv[0] !== 'string' || !config.argv[0] || config.argv[1] !== 'acp')
    throw new Error('Cursor Agent 需要独立原生 ACP 入口')
  if (config.preference?.effort !== 'default') throw new Error('Cursor ACP 未公开独立思考强度，请使用默认')
  if (config.attachments?.length || config.harnessTools || config.forkOperation || config.forkSource)
    throw new Error('Cursor 的附件、工具注入和会话分支尚未验证')
  return [...config.argv]
}
export async function runNativeCursor(config, io) {
  const outcome = createCursorOutcomeTracker()
  const cursorIO = { ...io, result(status, text, error, scope) {
    // All prompt updates have drained. Until here inferred tool terminal states
    // were UNKNOWN, so downstream promises cannot consume reversible evidence.
    for (const event of outcome.finalEvents()) io.event(event)
    const final = !io.signal.aborted && outcome.finalize({ status })
    return io.result(final?.status ?? status, text, final?.error ?? error, scope)
  } }
  try {
    return await runNativeAcp(config, cursorIO, {
      name: 'Cursor Agent', argv: cursorAcpArgv, editMode: 'agent', modeConfigId: 'mode', encode: value => value,
      allowHarnessPermissions: false,
      rejectClientRequests: true,
      fencePromptResult: true,
      validateState: state => { cursorState(state) },
      acceptedUpdate: (update, sessionId) => outcome.accept(update, sessionId),
      permissionDenied: (toolCallId, sessionId) => outcome.permissionDenied(toolCallId, sessionId),
      projectTool: (event, update, sessionId) => outcome.projectTool(event, update, sessionId),
      onReady: (state, sessionId) => {
        const current = cursorState(state)
        if (current.model !== config.preference.model || current.mode !== (config.mode === 'plan' ? 'plan' : 'agent'))
          throw new Error('Cursor ACP 未确认所选模型或权限模式')
        outcome.start(sessionId)
      },
      onResult: result => {
        if (!['end_turn', 'cancelled', 'max_tokens', 'refusal'].includes(result?.stopReason))
          throw new Error('Cursor ACP 未返回已确认的本轮终态')
      },
    })
  } catch {
    // Native RPC errors can contain authentication/endpoint diagnostics. No raw
    // error payload crosses the public Worker boundary.
    throw new Error(io.signal.aborted ? 'Cursor 任务已停止' : 'Cursor ACP 执行或清理失败，请在原生 CLI 检查后重试')
  }
}
