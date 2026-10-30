// Closed public request contracts. No private transport, credential, policy,
// executable, backend or business-agent migration option is model-controlled.
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { fail } from './native-auth-files.ts'
const id = z.string().regex(/^ap_[0-9a-f-]{36}$/)
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const requestId = z.string().min(1).max(128)
const label = z.string().min(1).max(100)
const importSchema = z.object({
  cli: z.literal('minimax'), sourceRoot: z.string().min(1).max(4096).refine(value => !value.includes('\0') && isAbsolute(value) && resolve(value) === value),
  region: z.enum(['cn', 'en']), label, requestId, id: id.optional(), expectedRecordRevision: revision.optional(),
}).strict().refine(value => (value.id !== undefined) === (value.expectedRecordRevision !== undefined))
const manageSchema = z.object({ cli: z.literal('minimax'), id, expectedRecordRevision: revision, requestId,
  label: label.optional(), enabled: z.boolean().optional(),
}).strict().refine(value => value.label !== undefined || value.enabled !== undefined)
function cli(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_INPUT')
  const input = value as Record<string, unknown>, selected = input.cli
  if (typeof selected !== 'string' || !['minimax', 'minimax code', 'mmx', 'mcode'].includes(selected.trim().toLowerCase())) fail('UNSUPPORTED')
  return { ...input, cli: 'minimax' }
}
export function parseAuthImportRequest(value: unknown) {
  const result = importSchema.safeParse(cli(value)); if (!result.success) fail('INVALID_INPUT'); return result.data
}
export function parseAuthManageRequest(value: unknown) {
  const result = manageSchema.safeParse(cli(value)); if (!result.success) fail('INVALID_INPUT'); return result.data
}
export function parseAuthRequestJson(value: string): unknown {
  if (typeof value !== 'string' || value.length > 8192) fail('INVALID_INPUT')
  try { return JSON.parse(value) } catch { return fail('INVALID_INPUT') }
}
