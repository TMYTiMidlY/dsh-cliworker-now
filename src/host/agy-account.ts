import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Preference } from '../shared/types.ts'
import type { RuntimeConfig } from './process.ts'

/** Stable, non-secret AGY account selectors. `lxy` is the isolated HOME already used by agy-lxy. */
export const AGY_ACCOUNT_IDS = ['default', 'lxy'] as const
export type AgyAccountId = (typeof AGY_ACCOUNT_IDS)[number]

const valid = (value: unknown): value is AgyAccountId => AGY_ACCOUNT_IDS.includes(value as AgyAccountId)

export function agyAccountId(preference?: Pick<Preference, 'agyAccount'>, config?: Pick<RuntimeConfig, 'agyAccount'>): AgyAccountId {
  const selected = preference?.agyAccount ?? config?.agyAccount ?? 'default'
  if (!valid(selected)) throw new Error('Antigravity 账号选择无效；可选 default 或 lxy')
  return selected
}

/** Resolve only the two allowlisted HOME roots; arbitrary paths never enter a child environment. */
export function agyHome(preference?: Pick<Preference, 'agyAccount'>, config?: Pick<RuntimeConfig, 'agyAccount'>): string {
  const home = homedir()
  return agyAccountId(preference, config) === 'lxy' ? resolve(home, '.agy-homes', 'lxy') : home
}

/** Child-only environment. The parent process and every other CLI retain their HOME. */
export function agyEnvironment(
  preference?: Pick<Preference, 'agyAccount'>,
  config?: Pick<RuntimeConfig, 'agyAccount'>,
): Record<string, string> {
  const selected = agyAccountId(preference, config)
  if (selected === 'default') return {}
  const home = agyHome(preference, config)
  return { HOME: home, USERPROFILE: home }
}

/** Bind a run's private config to its selected AGY account without mutating deployment config. */
export function agyConfigForPreference<T extends RuntimeConfig>(config: T, preference: Preference): T {
  return preference.cli === undefined || preference.cli === 'antigravity' || preference.agyAccount
    ? { ...config, agyAccount: agyAccountId(preference, config) }
    : config
}

export function agyAccountLabel(id: string | undefined): string {
  return id === 'lxy' ? 'agy-lxy' : '默认 AGY'
}

export function isAgyAccountId(value: unknown): value is AgyAccountId {
  return valid(value)
}

export const AGY_ACCOUNT_GUIDANCE = 'Antigravity 可选账号：default（默认 HOME）或 lxy（agy-lxy 隔离 HOME）；账号只影响本次 AGY 子进程，不改父进程或其他 CLI。'

// Keep this import-visible helper intentionally small; it is used by tests to assert no path escapes.
export const agyAccountHomeRelative = (id: AgyAccountId) => join('.agy-homes', id)
