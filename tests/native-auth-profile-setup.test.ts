import { expect, it } from 'vitest'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { WorkerStorage, type DispatchSetup } from '../src/host/storage.ts'
const pin = { id: 'ap_11111111-1111-4111-8111-111111111111', materialRevision: 'm_22222222-2222-4222-8222-222222222222' }
const other = { ...pin, materialRevision: 'm_33333333-3333-4333-8333-333333333333' }
function fixture() { mkdirSync('.cache', { recursive: true }); const root = mkdtempSync(join(process.cwd(), '.cache/auth-profile-setup-synthetic-')); return new WorkerStorage(join(root, 'state')) }
const setup = (profile = false): DispatchSetup => ({ preference: { cli: 'minimax', model: profile ? 'SYNTHETIC_PROFILE_MODEL' : 'SYNTHETIC_NATIVE_MODEL', effort: 'default', ...(profile ? { authProfile: pin } : {}) }, role: null, binding: profile ? 'SYNTHETIC_PROFILE_BINDING' : 'SYNTHETIC_NATIVE_BINDING' })
// Actual private setup persistence only; no account proof, Native or model.
it('keeps project defaults and profile-domain complete choices separate across cold read', () => {
  const storage: any = fixture(); try {
    storage.setDispatchSetup('/SYNTHETIC_PROJECT', setup()); storage.setDispatchSetup('/SYNTHETIC_PROJECT', setup(true))
    expect(storage.dispatchSetup('/SYNTHETIC_PROJECT', 'minimax')).toEqual(setup())
    expect(storage.dispatchSetup('/SYNTHETIC_PROJECT', 'minimax', pin)).toEqual(setup(true))
    expect(storage.dispatchSetup('/SYNTHETIC_PROJECT', 'minimax', other)).toBeUndefined()
  } finally { storage.close() }
})
it('retains explicit current source while restoring only matching parent/project/profile domains', () => {
  const storage: any = fixture(); try {
    storage.setConversationSetup('SYNTHETIC_PARENT', '/SYNTHETIC_PROJECT', setup())
    storage.setConversationSetup('SYNTHETIC_PARENT', '/SYNTHETIC_PROJECT', setup(true))
    expect(storage.conversationSetup('SYNTHETIC_PARENT', '/SYNTHETIC_PROJECT', 'minimax')).toEqual(setup(true))
    expect(storage.conversationSetup('SYNTHETIC_PARENT', '/SYNTHETIC_PROJECT', 'minimax', null)).toEqual(setup())
    expect(storage.conversationSetup('SYNTHETIC_PARENT', '/SYNTHETIC_PROJECT', 'minimax', pin)).toEqual(setup(true))
    expect(storage.conversationSetup('SYNTHETIC_PARENT', '/SYNTHETIC_PROJECT', 'minimax', other)).toBeUndefined()
    expect(storage.conversationSetup('SYNTHETIC_OTHER_PARENT', '/SYNTHETIC_PROJECT', 'minimax', pin)).toBeUndefined()
    expect(storage.conversationSetup('SYNTHETIC_PARENT', '/SYNTHETIC_OTHER_PROJECT', 'minimax', pin)).toBeUndefined()
  } finally { storage.close() }
})
it('separates identical model ids with distinct complete effort and non-null role authority', () => {
  const storage: any = fixture()
  const native = { ...setup(), role: { name: 'Synthetic native role', summary: 'Native only', prompt: 'SYNTHETIC_NATIVE_ROLE' } }
  const profile = { ...setup(true), preference: { ...setup(true).preference, model: native.preference.model, effort: 'high' }, role: { name: 'Synthetic profile role', summary: 'Profile only', prompt: 'SYNTHETIC_PROFILE_ROLE' } }
  try {
    storage.setDispatchSetup('/SYNTHETIC_PROJECT', native); storage.setDispatchSetup('/SYNTHETIC_PROJECT', profile)
    storage.setConversationSetup('SYNTHETIC_PARENT', '/SYNTHETIC_PROJECT', native); storage.setConversationSetup('SYNTHETIC_PARENT', '/SYNTHETIC_PROJECT', profile)
    expect(storage.dispatchSetup('/SYNTHETIC_PROJECT', 'minimax')).toEqual(native)
    expect(storage.dispatchSetup('/SYNTHETIC_PROJECT', 'minimax', pin)).toEqual(profile)
    expect(storage.conversationSetup('SYNTHETIC_PARENT', '/SYNTHETIC_PROJECT', 'minimax', null)).toEqual(native)
    expect(storage.conversationSetup('SYNTHETIC_PARENT', '/SYNTHETIC_PROJECT', 'minimax', pin)).toEqual(profile)
  } finally { storage.close() }
})
it('does not reuse another profile revision just because its model id matches', () => {
  const storage: any = fixture(); try {
    storage.setConversationSetup('SYNTHETIC_PARENT', '/SYNTHETIC_PROJECT', setup(true))
    expect(storage.conversationSetup('SYNTHETIC_PARENT', '/SYNTHETIC_PROJECT', 'minimax', other)).toBeUndefined()
    storage.setDispatchSetup('/SYNTHETIC_PROJECT', setup(true))
    expect(storage.dispatchSetup('/SYNTHETIC_PROJECT', 'minimax', other)).toBeUndefined()
  } finally { storage.close() }
})
