const record = v => !!v && typeof v === 'object' && !Array.isArray(v)
const text = v => typeof v === 'string' && !!v.trim() && v.length <= 8192 && !/[\x00-\x1f\x7f]/.test(v)
const invalid = () => new Error('Cursor ACP 原生模型或模式配置格式暂不支持')
/** Exact advertised plain-string select schema; model IDs remain opaque, including []. */
export function cursorState(state) {
  if (!record(state) || !Array.isArray(state.configOptions)) throw invalid()
  const select = id => {
    const matches = state.configOptions.filter(x => x?.id === id)
    if (matches.length !== 1) throw invalid()
    const value = matches[0]
    if (value.type !== 'select' || !text(value.currentValue) || !Array.isArray(value.options) ||
        !value.options.length || value.options.length > 1024) throw invalid()
    const seen = new Set()
    for (const option of value.options) {
      if (!record(option) || !text(option.value) || !text(option.name) || seen.has(option.value)) throw invalid()
      seen.add(option.value)
    }
    if (!seen.has(value.currentValue)) throw invalid()
    return value
  }
  const model = select('model'), mode = select('mode')
  if (!['agent', 'plan', 'ask'].every(id => mode.options.some(x => x.value === id)) ||
      mode.options.some(x => !['agent', 'plan', 'ask'].includes(x.value))) throw invalid()
  return { model: model.currentValue, mode: mode.currentValue,
    models: model.options.map(x => ({ id: x.value, label: x.name, efforts: ['default'] })) }
}
