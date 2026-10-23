const record = v => !!v && typeof v === 'object' && !Array.isArray(v)
const text = v => typeof v === 'string' && !!v.trim() && v.length <= 8192 && !/[\x00-\x1f\x7f]/.test(v)
const invalid = () => new Error('MiniMax ACP 原生模型、强度或权限回执暂不支持')
export const MINIMAX_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
/** Select option IDs are opaque native values, not display provider/model strings. */
export function validMiniMaxModel(value) {
  if (!text(value)) return false
  const pieces = value.split(':')
  if (pieces[0] !== 'm' || !pieces[1] || !pieces[2] || !(pieces.length === 4 && pieces[3] === 'u' || pieces.length === 5 && pieces[3] === 'v')) return false
  try { return pieces.slice(1, 3).every(x => text(decodeURIComponent(x))) && (pieces[3] === 'u' || pieces[4] === '' || text(decodeURIComponent(pieces[4]))) } catch { return false }
}
export function minimaxState(state) {
  if (!record(state) || !Array.isArray(state.configOptions) || state.configOptions.length > 32) throw invalid()
  const select = (id, category, optional = false) => {
    const rows = state.configOptions.filter(x => x?.id === id)
    if (!rows.length && optional) return undefined
    if (rows.length !== 1) throw invalid()
    const item = rows[0]
    if (item.type !== 'select' || item.category !== category || !text(item.currentValue) || !Array.isArray(item.options) || !item.options.length || item.options.length > 1024) throw invalid()
    const options = item.options.flatMap(x => record(x) && Array.isArray(x.options) ? x.options : [x])
    if (options.length > 1024 || options.some(x => !record(x) || !text(x.value) || !text(x.name)) || new Set(options.map(x => x.value)).size !== options.length || !options.some(x => x.value === item.currentValue)) throw invalid()
    return { ...item, options }
  }
  const model = select('model', 'model'), permission = select('permissionMode', '_permission'), effort = select('thinkingEffort', 'thought_level', true)
  if (model.options.some(x => !validMiniMaxModel(x.value)) || permission._meta?.['minimax-code/scope'] !== 'process' ||
      !['default', 'auto', 'bypassPermissions'].includes(permission.currentValue) || !permission.options.some(x => x.value === 'default') ||
      permission.options.some(x => !['default', 'auto', 'bypassPermissions'].includes(x.value)) ||
      !record(state.modes) || !['default', 'plan'].includes(state.modes.currentModeId) ||
      state._meta?.['minimax-code/transition'] === 'next_prompt') throw invalid()
  return { model: model.currentValue, models: model.options.map(x => ({ id: x.value, label: x.name })), permission: permission.currentValue,
    mode: state.modes.currentModeId, effort: effort?.currentValue,
    efforts: effort ? effort.options.map(x => x.value).filter(x => MINIMAX_EFFORTS.includes(x)) : [] }
}
/** Set always returns a fresh complete receipt; no inherited effort option survives a model change. */
export async function configureMiniMax(peer, sessionId, state, preference) {
  const select = async (id, value) => {
    const result = await peer.request('session/set_config_option', { sessionId, configId: id, value }, { jsonrpc: true })
    state = { ...state, ...result }
    return minimaxState(state)
  }
  let current = minimaxState(state)
  if (!current.models.some(x => x.id === preference.model)) throw invalid()
  // Even identical model selection obtains this model's authoritative current effort receipt.
  current = await select('model', preference.model)
  if (current.model !== preference.model) throw invalid()
  if (preference.effort !== 'default') {
    if (!current.efforts.includes(preference.effort)) throw invalid()
    current = await select('thinkingEffort', preference.effort)
    if (current.effort !== preference.effort || current.model !== preference.model) throw invalid()
  }
  current = await select('permissionMode', 'default')
  if (current.permission !== 'default' || current.mode !== 'default' || current.model !== preference.model ||
      preference.effort !== 'default' && current.effort !== preference.effort) throw invalid()
  return state
}
