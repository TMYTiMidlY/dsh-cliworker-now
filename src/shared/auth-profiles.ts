/** Public opaque selection only. Native paths, policies, credentials and
 * principal/group digests never belong in a Preference or Worker DTO. */
export interface AuthProfilePin { id: string; materialRevision: string }
export const authProfileIdPattern = /^ap_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const authMaterialRevisionPattern = /^m_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export function validAuthProfilePin(value: unknown): value is AuthProfilePin {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const pin = value as Record<string, unknown>
  return Object.keys(pin).length === 2 && typeof pin.id === 'string' && authProfileIdPattern.test(pin.id) &&
    typeof pin.materialRevision === 'string' && authMaterialRevisionPattern.test(pin.materialRevision)
}
