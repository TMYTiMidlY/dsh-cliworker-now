import { afterEach, describe, expect, it, vi } from 'vitest'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { agyAccountId, agyAccountLabel, agyConfigForPreference, agyEnvironment, agyHome } from '../src/host/agy-account.ts'
import { DEFAULT_CONFIG } from '../src/host/process.ts'

afterEach(() => vi.unstubAllEnvs())

describe('Antigravity isolated account routes', () => {
  it('keeps default HOME untouched and routes lxy only to the child', () => {
    const before = process.env.HOME
    expect(agyEnvironment({ agyAccount: 'default' }, DEFAULT_CONFIG)).toEqual({})
    expect(agyEnvironment({ agyAccount: 'lxy' }, DEFAULT_CONFIG)).toEqual({
      HOME: resolve(homedir(), '.agy-homes', 'lxy'),
      USERPROFILE: resolve(homedir(), '.agy-homes', 'lxy'),
    })
    expect(process.env.HOME).toBe(before)
  })
  it('uses deployment default only when the Worker has no explicit route', () => {
    expect(agyAccountId(undefined, { agyAccount: 'lxy' })).toBe('lxy')
    expect(agyAccountId({ agyAccount: 'default' }, { agyAccount: 'lxy' })).toBe('default')
    expect(agyHome({ agyAccount: 'lxy' }, DEFAULT_CONFIG)).toBe(join(homedir(), '.agy-homes', 'lxy'))
  })
  it('does not accept path-like account selectors', () => {
    expect(() => agyAccountId({ agyAccount: '../other' as never }, DEFAULT_CONFIG)).toThrow()
    expect(() => agyAccountId({ agyAccount: 'HOME=/tmp' as never }, DEFAULT_CONFIG)).toThrow()
  })
  it('scopes config without mutating deployment settings', () => {
    const config = { ...DEFAULT_CONFIG, agyAccount: 'default' as const }
    const scoped = agyConfigForPreference(config, { cli: 'antigravity', model: 'm', effort: 'default', agyAccount: 'lxy' })
    expect(config.agyAccount).toBe('default')
    expect(scoped.agyAccount).toBe('lxy')
    expect(agyAccountLabel('lxy')).toBe('agy-lxy')
  })
})
