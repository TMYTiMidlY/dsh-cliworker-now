import { isAbsolute } from 'node:path'
import { assertMiniMaxProfileProtection } from './minimax-profile-protection.mjs'
import { runNativeAcp } from './native-acp.mjs'
import { configureMiniMax, minimaxState, validMiniMaxModel } from './minimax-state.mjs'

export function minimaxAcpArgv(config) {
  if (config.mode !== 'accept-edits') throw new Error('MiniMax Code Plan 延迟生效，当前不支持规划模式')
  if (!Array.isArray(config.argv) || config.argv.length !== 2 || typeof config.argv[0] !== 'string' || !config.argv[0] || config.argv[1] !== 'acp' || !isAbsolute(config.project)) throw new Error('MiniMax Code 需要原生 ACP 与明确任务目录')
  if (!validMiniMaxModel(config.preference?.model) || !config.preference.model.startsWith('m:minimax:')) throw new Error('MiniMax Code 模型必须来自当前原生 ACP 选项')
  if (config.attachments?.length || config.harnessTools || config.forkOperation || config.forkSource || config.controlNonce) throw new Error('MiniMax Code 的附件、工具注入、会话分支和引导尚未验证')
  if (config.preference?.authProfile || config.minimaxProfile) {
    if (!config.preference?.authProfile || !config.minimaxProfile) throw new Error('MiniMax 私有账号固定上下文缺失')
    assertMiniMaxProfileProtection(config.minimaxProfile, { ...process.env, ...config.env })
  }
  return [...config.argv]
}
export async function runNativeMiniMax(config, io) {
  let confirmed
  try {
    // Run before opening stdio so unsupported Plan cannot start a model process.
    minimaxAcpArgv(config)
    return await runNativeAcp(config, io, {
      name: 'MiniMax Code', agentName: 'minimax-code', argv: minimaxAcpArgv,
      editMode: undefined, encode: v => v, allowHarnessPermissions: false, rejectClientRequests: true,
      onInitialized: initialized => {
        if (config.minimaxProfile && initialized.agentInfo?.version !== config.minimaxProfile.version) throw new Error('MiniMax 私有账号原生合同版本不符')
      },
      validateState: state => { minimaxState(state) },
      configure: async (...args) => {
        const state = await configureMiniMax(...args)
        confirmed = minimaxState(state)
        return state
      },
      onReady: state => {
        if (config.minimaxProfile) assertMiniMaxProfileProtection(config.minimaxProfile, { ...process.env, ...config.env })
        const current = minimaxState(state)
        if (current.model !== config.preference.model || current.permission !== 'default' || current.mode !== 'default') throw new Error('MiniMax 原生选型未确认')
      },
      validateUpdate: update => {
        for (const option of update.configOptions ?? []) {
          const expected = option.id === 'model' ? confirmed.model : option.id === 'permissionMode' ? 'default' : option.id === 'thinkingEffort' ? confirmed.effort : undefined
          if (expected !== undefined && option.currentValue !== expected) throw new Error('MiniMax 选型漂移')
        }
      },
      onResult: result => { if (!['end_turn', 'cancelled', 'max_turn_requests'].includes(result?.stopReason)) throw new Error('MiniMax 本轮终态缺失') },
    })
  } catch {
    throw new Error(io.signal.aborted ? 'MiniMax Code 任务已停止' : 'MiniMax Code ACP 执行或清理失败，请在原生 CLI 检查登录、模型和权限后重试')
  }
}
