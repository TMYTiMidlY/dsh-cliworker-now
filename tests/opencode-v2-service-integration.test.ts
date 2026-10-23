import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { CliWorkerService } from '../src/host/index.ts'
import { HARNESS_CLI_PROVIDER } from '../src/host/harness-conversation.ts'
import { syntheticOpenCodeV2 } from './fixtures/opencode-v2-service.ts'

// Actual plugin constructor/preparation, official child AgentLoop, actual bridge
// process, and synthetic v2 HTTP only. No native CLI, model or account files.
const toolLease = vi.hoisted(() => ({ create: vi.fn(async () => { throw Error('v2 text-only must not allocate a tool/MCP lease') }) }))
vi.mock('../src/host/native-harness-tools.ts', async load => ({ ...(await load<typeof import('../src/host/native-harness-tools.ts')>()), createNativeHarnessTools: toolLease.create }))
const runtimeRequire = createRequire(realpathSync(new URL('../node_modules/@deepseek-ai/dsh/package.json', import.meta.url)))
const loadRuntime = async (name: string) => {
  const value = await import(pathToFileURL(runtimeRequire.resolve(name)).href)
  return value.default ?? value
}
const closes: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); vi.unstubAllEnvs(); toolLease.create.mockClear() })
it('plugin preparation still creates the real native DSH child, without tools, steer, model editing or attachments', async () => {
  const fixture = await syntheticOpenCodeV2(); closes.push(fixture.close)
  const ctx = new Context(); closes.push(() => ctx.fiber.dispose())
  const [AgentLoop, Projections, Persistence, Query] = await Promise.all(['@deepseek-ai/dsh-agent-loop', '@deepseek-ai/dsh-session-projection', '@deepseek-ai/dsh-session-persistence-jsonl', '@deepseek-ai/dsh-session-query'].map(loadRuntime))
  await ctx.plugin(SessionStore); await ctx.plugin(Projections)
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: fixture.root })
  await ctx.plugin(AgentRegistry); await ctx.plugin(LlmRuntime)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false }); await ctx.plugin(ToolRuntime, { mode: 'native' })
  await ctx.plugin(Persistence, { root: join(fixture.root, 'native-dsh-sessions'), compression: 'none' }); await ctx.plugin(Query)
  await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 2 })
  if (SubagentRuntime.inject?.includes('workingDirectory')) { await ctx.plugin(await loadRuntime('@deepseek-ai/dsh-fs-local')); await ctx.plugin(await loadRuntime('@deepseek-ai/dsh-working-directory')) }
  await ctx.plugin(SubagentRuntime, { maxDepth: 4, maxActiveSubagents: 8 })
  const jobs: any[] = []
  ctx.provide('jobs', { start(spec: any) { jobs.push(spec.run()); return randomUUID() } } as never)
  ctx.provide('userQuestions', {} as never)
  ctx.provide('typert', { lookups: new Map() } as never)
  ctx.provide('sessionController', {} as never)
  ctx.provide('subprocess', fixture.backend as never)
  const parent = await ctx.agents.create({ sessionId: SessionId(randomUUID()), meta: { cwd: fixture.project }, agentOptions: { provider: 'UNAVAILABLE_SYNTHETIC_ROOT_PROVIDER', model: 'NEVER_INVOKE' } })
  await ctx.plugin(CliWorkerService, { stateDirectory: fixture.state, opencodeExecutable: process.execPath, maxConcurrent: 1, graceMs: 1000, timeoutMs: 15000 })
  const service = ctx.cliworker as any
  await vi.waitFor(() => expect(service.harnessConversation).toBeDefined())
  const preference = { cli: 'opencode', model: `opencode-v2:${Buffer.from(JSON.stringify(['own', 'G', null])).toString('base64url')}`, effort: 'default' }
  const receipt = JSON.parse(await service.launch(parent.agent, 'Synthetic v2 child task', '原生DSH子会话投影的明确模拟请求', preference, 'plan', undefined, undefined, new AbortController().signal))
  await jobs[0].done
  const worker = service.runtime.get(parent.agent.id, receipt.workerId)
  expect(worker.status, worker.error).toBe('completed')
  expect(worker.transport).toBe('opencode-http-v2')
  expect(worker.harnessConversation?.sessionId).toBeDefined()
  const child = ctx.agents.get(SessionId(worker.harnessConversation.sessionId))!
  await child.whenIdle()
  expect(child.session.header).toMatchObject({ origin: 'subagent', parentSession: parent.agent.id })
  expect(worker.harnessConversation.capabilities).toMatchObject({ tools: false, skills: false, model: false, steer: false, attachments: false, fork: false, plan: true })
  expect(toolLease.create).not.toHaveBeenCalled()
  expect((await ctx.llm.resolveModelInfo(HARNESS_CLI_PROVIDER, `worker/${worker.id}`)).inputModalities).toEqual(['text'])
  expect(child.session.deriveMessages().flatMap((message: any) => message.role === 'assistant' ? message.content.filter((x: any) => x.type === 'text').map((x: any) => x.text) : [])).toEqual(['原生模拟正文1'])
  expect(() => service.runtime.configureWorker(parent.agent.id, worker.id, { ...preference, model: `opencode-v2:${Buffer.from(JSON.stringify(['own', 'a', null])).toString('base64url')}` })).toThrow('固定模型')
  await ctx.subagents.prompt({ requestId: randomUUID() as never, parentSessionId: parent.agent.id, childSessionId: child.id, mode: 'continuable', delivery: 'queue', content: [{ type: 'text', text: '真实子会话第二轮模拟输入' }] }, new AbortController().signal)
  await child.whenIdle()
  expect(fixture.records).toHaveLength(2); expect(fixture.payloads).toHaveLength(1)
  expect(toolLease.create).not.toHaveBeenCalled()
  expect(service.runtime.get(parent.agent.id, worker.id).lastResult).toBe('原生模拟正文2')
})
