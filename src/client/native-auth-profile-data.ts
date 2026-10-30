import { validAuthProfilePin, type AuthProfilePin } from '../shared/auth-profiles.ts'
import { EFFORTS, type Effort, type ModelChoice, type Preference } from '../shared/types.ts'
export interface SafeAuthProfile extends AuthProfilePin { cli: 'minimax'; label: string; recordRevision: number; enabled: boolean; state: 'available' | 'disabled' }
export interface AuthTaskSettings { profiles: SafeAuthProfile[]; current: Preference | null; writable: boolean; importSupported: boolean }
export interface AuthTaskCatalog { source: string; pin?: AuthProfilePin; catalog: { cli: 'minimax'; models: (ModelChoice & { efforts: Effort[] })[]; notice?: string }; preference: Preference | null }
const object = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x)
const invalid = () => new Error('账号档案回执不完整或来源不匹配，请刷新重试')
export function readSafeAuthProfile(value: unknown): SafeAuthProfile {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'cli,enabled,id,label,materialRevision,recordRevision,state' ||
      !validAuthProfilePin({ id: value.id, materialRevision: value.materialRevision }) || value.cli !== 'minimax' || typeof value.label !== 'string' ||
      !value.label.trim() || value.label.length > 100 || !Number.isSafeInteger(value.recordRevision) || value.recordRevision < 1 ||
      typeof value.enabled !== 'boolean' || value.state !== (value.enabled ? 'available' : 'disabled')) throw invalid()
  return value as unknown as SafeAuthProfile
}
function preference(value: unknown, pin?: AuthProfilePin): Preference | null {
  if (value === null) return null
  if (!object(value) || value.cli !== 'minimax' || typeof value.model !== 'string' || !value.model || value.model.length > 16384 ||
      !EFFORTS.includes(value.effort) || value.agyAccount !== undefined || (pin ? !validAuthProfilePin(value.authProfile) || value.authProfile.id !== pin.id || value.authProfile.materialRevision !== pin.materialRevision : value.authProfile !== undefined)) throw invalid()
  return { cli: 'minimax', model: value.model, effort: value.effort, ...(pin ? { authProfile: { ...pin } } : {}) }
}
export function readAuthTaskSettings(raw: string): AuthTaskSettings {
  const value = JSON.parse(raw)
  if (!object(value) || value.controlApiVersion !== 1 || !Array.isArray(value.profiles) || value.profiles.length > 1000 || typeof value.writable !== 'boolean' || typeof value.importSupported !== 'boolean') throw invalid()
  const profiles = value.profiles.map(readSafeAuthProfile), pin = value.current?.authProfile
  if (pin !== undefined && !validAuthProfilePin(pin)) throw invalid()
  return { profiles, current: preference(value.current, pin), writable: value.writable, importSupported: value.importSupported }
}
export function readAuthTaskCatalog(raw: string, source: string): AuthTaskCatalog {
  const value = JSON.parse(raw)
  if (!object(value) || value.controlApiVersion !== 1 || value.source !== source || (source === 'native' ? value.pin !== undefined : !validAuthProfilePin(value.pin) || value.pin.id !== source) ||
      value.catalog?.cli !== 'minimax' || !Array.isArray(value.catalog.models) || value.catalog.models.length > 1000) throw invalid()
  for (const model of value.catalog.models) if (!object(model) || typeof model.id !== 'string' || !model.id || typeof model.label !== 'string' ||
    model.efforts !== undefined && (!Array.isArray(model.efforts) || !model.efforts.length || model.efforts.some((e: unknown) => !EFFORTS.includes(e as any)))) throw invalid()
  const catalog = { ...value.catalog, models: value.catalog.models.map((m: ModelChoice) => ({ ...m, efforts: m.efforts ?? ['default'] })) }
  return { source, ...(value.pin ? { pin: { ...value.pin } } : {}), catalog, preference: preference(value.preference, value.pin) }
}
export function readAuthTaskApplied(raw: string, source: string, pin: AuthProfilePin | undefined, model: string, effort: Effort): Preference {
  const value = JSON.parse(raw)
  if (!object(value) || value.controlApiVersion !== 1 || value.source !== source || value.executed !== false) throw invalid()
  const result = preference(value.preference, pin); if (!result || result.model !== model || result.effort !== effort) throw invalid(); return result
}
export function authProfileMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : ''
  const messages: Record<string, string> = { AUTH_UNSUPPORTED: '此来源格式、保护配置或宿主平台暂不支持', AUTH_INVALID_INPUT: '请填写完整的宿主原生目录、区域和账号名称', AUTH_UNSAFE_SOURCE: '来源文件或权限不符合安全要求，未导入', AUTH_SOURCE_CHANGED: '来源在验证期间发生变化，未导入，请稍后重试', AUTH_VALIDATION_FAILED: '原生账号或必要保护未通过验证；请检查登录是否仍有效', AUTH_BUSY: '账号正在使用或验证，请等待完成后重试', AUTH_DISABLED: '该档案已停用，不能用于新任务', AUTH_NOT_FOUND: '档案或固定版本不可用，请刷新', AUTH_CONFLICT: '档案已被其他操作修改，请刷新后重试', AUTH_IDENTITY_MISMATCH: '账号身份与原档案不符，请新建独立档案', AUTH_CLEANUP_UNCONFIRMED: '原生清理未确认，已隔离此来源，不能继续尝试', AUTH_CANCELLED: '操作已取消；若导入提交结果不确定，请刷新列表确认', AUTH_STORE_UNAVAILABLE: '私有档案存储不可用，请勿重复导入' }
  const code = text.match(/AUTH_[A-Z_]+/)?.[0]
  return code && messages[code] ? messages[code] : '操作失败，请刷新重试；未自动切换其他账号'
}
