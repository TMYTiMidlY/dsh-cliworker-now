export interface MiniMaxProfileProtection { root: string; region: 'cn' | 'en'; configDigest: string; version: '0.6.12' }
/** Local bounded no-follow protection check; no Native/identity HTTP. */
export function assertMiniMaxProfileProtection(expected: MiniMaxProfileProtection, env?: Record<string, string | undefined>): void
