// Account-only settings projection, not an auth/UID or business-agent migration.
import { createHash } from 'node:crypto'
import { parseDocument } from 'yaml'
import { z } from 'zod'
import { fail } from './native-auth-files.ts'
import { projectMiniMaxManagedRoute } from './minimax-route.ts'

const consent = z.object({ enabled: z.boolean() }).strict()
const targetSchema = z.object({
  logLevel: z.literal('info'), permissionMode: z.literal('default'),
  dataContribution: consent, memory: consent,
  skipWindowsHardSafetyChecks: z.literal(false), skipParentDeathGuard: z.literal(false),
}).strict()
// Narrow first account-only contract. Recognized model preferences are NOT
// carried into a new account; fresh per-task selection still uses its catalog.
// Unknown privacy/permission/hook fields are never silently discarded.
const sourceSchema = z.object({
  provider: z.unknown().optional(), defaultModel: z.string().max(8192).optional(),
  defaultModelVariant: z.unknown().optional(), defaultModelThinking: z.unknown().optional(),
  defaultModelContextWindow: z.unknown().optional(), defaultProvider: z.literal('minimax').optional(),
  minimaxModelSource: z.literal('token_plan').optional(), logLevel: z.literal('info').optional(),
  permissionMode: z.enum(['default', 'auto', 'bypassPermissions']).optional(),
  dataContribution: consent.optional(), memory: consent.optional(),
  skipWindowsHardSafetyChecks: z.literal(false).optional(), skipParentDeathGuard: z.literal(false).optional(),
}).strict()
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function document(bytes: Uint8Array): unknown {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 65536) fail('UNSUPPORTED')
  try {
    const parsed = parseDocument(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), { logLevel: 'silent' })
    if (parsed.errors.length || parsed.warnings.length) fail('UNSUPPORTED')
    return parsed.toJS({ maxAliasCount: 0 })
  } catch { return fail('UNSUPPORTED') }
}
function regionValid(region: 'cn' | 'en') { if (region !== 'cn' && region !== 'en') fail('INVALID_INPUT') }
function managedRegion(value: z.infer<typeof sourceSchema>, region: 'cn' | 'en'): void {
  if (projectMiniMaxManagedRoute(value).kind !== 'managed-oauth') fail('UNSUPPORTED')
  const provider = value.provider as { minimax?: { options?: { baseURL?: unknown } } } | undefined
  const base = provider?.minimax?.options?.baseURL
  if (base === undefined) return
  if (typeof base !== 'string' || base.includes('?') || base.includes('#')) fail('UNSUPPORTED')
  let url: URL
  try { url = new URL(base) } catch { return fail('UNSUPPORTED') }
  const origins = region === 'cn' ? ['https://agent.minimaxi.com', 'https://agent.minimax.cn'] : ['https://agent.minimax.io']
  if (!origins.includes(url.origin) || url.pathname.replace(/\/$/, '') !== '/mavis/api/v1/llm/v1' ||
      url.search || url.hash || url.username || url.password) fail('UNSUPPORTED')
}
export interface MiniMaxAccountSettings { readonly bytes: Uint8Array; readonly digest: string }
/** Preserve explicitly supported privacy and safety semantics; do not carry
 * a business agent, model default/advertisement, executable path or full-access
 * setting. The new account uses Native Ask in addition to Host task controls. */
export function projectMiniMaxAccountSettings(bytes: Uint8Array | undefined, region: 'cn' | 'en'): MiniMaxAccountSettings {
  regionValid(region)
  const parsed = sourceSchema.safeParse(bytes === undefined ? {} : document(bytes))
  if (!parsed.success) fail('UNSUPPORTED')
  managedRegion(parsed.data, region)
  const protectedConfig = targetSchema.parse({
    logLevel: 'info', permissionMode: 'default',
    dataContribution: { enabled: parsed.data.dataContribution?.enabled ?? true },
    // Existing empty Native config defaults to memory enabled; absent config
    // takes the distinct first-initialization default. Never merge the modes.
    memory: { enabled: parsed.data.memory?.enabled ?? bytes !== undefined },
    skipWindowsHardSafetyChecks: false, skipParentDeathGuard: false,
  })
  return Object.freeze({ bytes: Buffer.from(JSON.stringify(protectedConfig)), digest: hash(protectedConfig) })
}
/** This is an assertion against ORIGINAL signed expectations, not the source
 * projector: target bypass/unknown settings must not be normalized away.
 * Besides the canonical projection bytes, this accepts the vendor CLI's own
 * normalized serialization, which legitimately re-adds its provider
 * advertisement and model preferences on ACP startup: the owned privacy and
 * safety fields are extracted and must match the signed digest exactly. */
export function assertMiniMaxAccountSettings(expectedDigest: string, bytes: Uint8Array, region: 'cn' | 'en'): void {
  regionValid(region)
  if (typeof expectedDigest !== 'string' || !/^[0-9a-f]{64}$/.test(expectedDigest)) fail('INVALID_INPUT')
  const parsed = sourceSchema.safeParse(document(bytes))
  if (!parsed.success) fail('UNSUPPORTED')
  managedRegion(parsed.data, region)
  const owned = targetSchema.safeParse({
    logLevel: parsed.data.logLevel, permissionMode: parsed.data.permissionMode,
    dataContribution: parsed.data.dataContribution, memory: parsed.data.memory,
    skipWindowsHardSafetyChecks: parsed.data.skipWindowsHardSafetyChecks, skipParentDeathGuard: parsed.data.skipParentDeathGuard,
  })
  if (!owned.success) fail('UNSUPPORTED')
  if (hash(owned.data) !== expectedDigest) fail('IDENTITY_MISMATCH')
}
