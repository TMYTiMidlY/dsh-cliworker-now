import { expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { assertMiniMaxBuiltinTree } from '../src/host/native-auth-minimax-builtins.ts'

// Synthetic canonical records. Capability shape only, not Native-generated
// prompt provenance, actual initialization or an authorized user agent tree.
const tools = {
  explore: ['bash', 'read', 'grep', 'glob', 'web_fetch'],
  worker: ['read', 'write', 'edit', 'bash', 'task_query', 'task_output', 'task_stop', 'grep', 'glob', 'todowrite', 'web_fetch', 'website_deploy'],
  verifier: ['read', 'grep', 'glob', 'bash', 'task_query', 'task_output', 'task_stop', 'web_fetch'],
}
const names = ['mavis', 'explore', 'worker', 'verifier'] as const
function record(name: typeof names[number]): Record<string, unknown> {
  return { name, description: `SYNTHETIC_${name}`, features: { mavis: name === 'mavis' || name === 'worker', delegation: name === 'mavis', webSearch: true }, ...(name !== 'mavis' ? { tools: tools[name] } : {}), ...(['explore', 'verifier'].includes(name) ? { skills: [] } : {}) }
}
function fixture() {
  mkdirSync('.cache', { recursive: true }); const root = mkdtempSync(join(process.cwd(), '.cache/auth-minimax-builtins-synthetic-'))
  const write = (name: typeof names[number], value = record(name)) => {
    const dir = join(root, 'agents/.builtin', name); mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(join(dir, 'agent.md'), `---\n${JSON.stringify(value)}\n---\nSYNTHETIC_BODY_NOT_NATIVE_PROMPT\n`, { mode: 0o600 })
  }
  return { root, write, init: () => { for (const name of names) write(name) } }
}
it('allows fresh absence only before Native initialization', () => {
  const f = fixture(); expect(() => assertMiniMaxBuiltinTree(f.root, true)).not.toThrow()
  expect(() => assertMiniMaxBuiltinTree(f.root, false)).toThrow(/^AUTH_/)
})
it('accepts only the standard four generated capability shapes', () => {
  const f = fixture(); f.init(); expect(() => assertMiniMaxBuiltinTree(f.root, false)).not.toThrow()
})
it('permits a non-writable public builtin leaf under a verified private root', () => {
  const f = fixture(); f.init(); chmodSync(join(f.root, 'agents/.builtin/mavis/agent.md'), 0o644)
  expect(() => assertMiniMaxBuiltinTree(f.root, false)).not.toThrow()
})
it.each(['permission', 'custom', 'extra-builtin', 'symlink', 'capability', 'mcp', 'features', 'workspace', 'blank-description', 'blank-effort', 'blank-display'])('rejects generated-tree drift %s', kind => {
  const f = fixture(); f.init()
  if (kind === 'permission') writeFileSync(join(f.root, 'agents/.builtin/mavis/permission.json'), '{}', { mode: 0o600 })
  if (kind === 'custom') mkdirSync(join(f.root, 'agents/SYNTHETIC_BUSINESS'), { mode: 0o700 })
  if (kind === 'extra-builtin') mkdirSync(join(f.root, 'agents/.builtin/main'), { mode: 0o700 })
  if (kind === 'symlink') { mkdirSync(join(f.root, 'other'), { mode: 0o700 }); symlinkSync(join(f.root, 'other'), join(f.root, 'agents/.builtin/mavis/unexpected')) }
  const value: any = record('mavis')
  if (kind === 'capability') value.tools = ['bash']
  if (kind === 'mcp') value.mcpServers = [{ command: 'SYNTHETIC_DO_NOT_EXECUTE' }]
  if (kind === 'features') value.features.delegation = false
  if (kind === 'workspace') value['x-mavis'] = { defaultWorkspaceDir: '/SYNTHETIC_BUSINESS' }
  if (kind === 'blank-description') value.description = ' '
  if (kind === 'blank-effort') value.effort = '\t'
  if (kind === 'blank-display') value['x-mavis'] = { displayName: ' ' }
  if (['capability', 'mcp', 'features', 'workspace', 'blank-description', 'blank-effort', 'blank-display'].includes(kind)) f.write('mavis', value)
  expect(() => assertMiniMaxBuiltinTree(f.root, false)).toThrow(/^AUTH_/)
})
