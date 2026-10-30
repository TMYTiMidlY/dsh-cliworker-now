// Fixed 0.6.12 fresh builtin capability/format postconditions. NOT proof of
// full prompt provenance; caller also needs its owned standard Native init.
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import { z } from 'zod'
import { AuthDirectory, fail, fdPath, nativeAuthFailureCode, stamp } from './native-auth-files.ts'

const names = ['mavis', 'explore', 'worker', 'verifier'] as const
const nonblank = z.string().min(1).max(8192).refine(value => value.trim().length > 0)
const capability = {
  explore: ['bash', 'read', 'grep', 'glob', 'web_fetch'],
  worker: ['read', 'write', 'edit', 'bash', 'task_query', 'task_output', 'task_stop', 'grep', 'glob', 'todowrite', 'web_fetch', 'website_deploy'],
  verifier: ['read', 'grep', 'glob', 'bash', 'task_query', 'task_output', 'task_stop', 'web_fetch'],
}
function exactEntries(directory: AuthDirectory, expected: readonly string[]) {
  const entries = readdirSync(fdPath(directory.fd), { encoding: 'buffer' })
  if (entries.length !== expected.length || entries.some(name => !expected.some(value => name.equals(Buffer.from(value))))) fail('UNSUPPORTED')
  directory.verify(false)
}
/** These generated official definition leaves contain no imported secrets.
 * 0644 is acceptable ONLY under the already verified 0700 material root;
 * auth/config continue to require the separate strict 0600 reader. */
function generatedLeaf(directory: AuthDirectory): Buffer {
  directory.verify(false)
  const path = fdPath(directory.fd, 'agent.md'), before = lstatSync(path, { bigint: true })
  const safe = (value: typeof before) => {
    if (!value.isFile() || value.uid !== BigInt(process.getuid!()) || value.nlink !== 1n ||
        (value.mode & 0o133n) !== 0n || value.size < 1n || value.size > 262144n) fail('UNSAFE_SOURCE')
  }
  safe(before)
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  const bytes = Buffer.alloc(Number(before.size) + 1)
  try {
    safe(fstatSync(fd, { bigint: true }))
    let length = 0
    while (length < bytes.length) { const read = readSync(fd, bytes, length, bytes.length - length, null); if (!read) break; length += read }
    if (length !== Number(before.size) || stamp(before) !== stamp(fstatSync(fd, { bigint: true })) || stamp(before) !== stamp(lstatSync(path, { bigint: true }))) fail('SOURCE_CHANGED')
    directory.verify(false)
    return bytes.subarray(0, length)
  } catch (error) { bytes.fill(0); throw error } finally { closeSync(fd) }
}
function canonical(bytes: Buffer, name: typeof names[number]) {
  let value: unknown
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text)
    if (!match || !match[2].trim()) fail('UNSUPPORTED')
    const document = parseDocument(match[1], { logLevel: 'silent' })
    if (document.errors.length || document.warnings.length) fail('UNSUPPORTED')
    value = document.toJS({ maxAliasCount: 0 })
  } catch { return fail('UNSUPPORTED') }
  const schema = z.object({
    name: z.literal(name), description: nonblank,
    features: z.object({ mavis: z.literal(name === 'mavis' || name === 'worker'), delegation: z.literal(name === 'mavis'), webSearch: z.literal(true) }).strict(),
    tools: name === 'mavis' ? z.never().optional() : z.array(z.string()).refine(values => JSON.stringify(values) === JSON.stringify(capability[name])),
    skills: name === 'explore' || name === 'verifier' ? z.array(z.never()).length(0) : z.never().optional(),
    model: z.string().max(8192).regex(/^[^/\s]+\/[^/\s]+$/).optional(), effort: nonblank.optional(),
    'x-mavis': z.object({ displayName: nonblank.optional(), contextWindow: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(), maxOutputTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional() }).strict().optional(),
  }).strict()
  if (!schema.safeParse(value).success) fail('UNSUPPORTED')
}
export function assertMiniMaxBuiltinTree(root: string, allowAbsent: boolean): void {
  if (typeof allowAbsent !== 'boolean') fail('INVALID_INPUT')
  const directories: AuthDirectory[] = []
  try {
    const material = AuthDirectory.open(root, true); directories.push(material)
    try { lstatSync(fdPath(material.fd, 'agents')) }
    catch (error) { if (allowAbsent && (error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    const agents = AuthDirectory.open(join(root, 'agents')); directories.push(agents); exactEntries(agents, ['.builtin'])
    const builtins = AuthDirectory.open(join(root, 'agents/.builtin')); directories.push(builtins); exactEntries(builtins, names)
    for (const name of names) {
      const directory = AuthDirectory.open(join(root, 'agents/.builtin', name)); directories.push(directory)
      exactEntries(directory, ['agent.md'])
      const bytes = generatedLeaf(directory)
      try { canonical(bytes, name) } finally { bytes.fill(0) }
    }
    for (const directory of directories) directory.verify(false)
  } catch (error) { fail(nativeAuthFailureCode(error) ?? 'UNSAFE_SOURCE') }
  finally { for (const directory of directories.reverse()) directory.close() }
}
