import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { LlmRuntime, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import { SubagentRuntime, SubagentError } from '@deepseek-ai/dsh-subagent'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'
import { SandboxPolicyService, setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { mkdtempSync, realpathSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { CliWorkerService } from '../src/host/index.ts'
import { HARNESS_CLI_PROVIDER } from '../src/host/harness-conversation.ts'
import type { Worker } from '../src/shared/types.ts'

// Actual Host constructor, WorkerRuntime, official AgentLoop/continuations and
// private request preparation. Account decisions, process I/O and tool transport
// lease are explicit simulations; no CLI/model/network/user state is accessed.
const leases = vi.hoisted(() => ({
  gates: [] as Array<Promise<void>>,
  closes: [] as Array<ReturnType<typeof vi.fn>>,
  options: [] as any[],
}))
vi.mock('../src/host/authorized-catalog.ts', () => ({
  ACCOUNT_CHANGED: 'synthetic account changed',
  authorizeSelection: vi.fn(async (preference: unknown) => ({ binding: 'synthetic-account', preference })),
  authorizedCatalog: vi.fn(async () => ({ models: [], notice: 'synthetic' })),
}))
vi.mock('../src/host/cli-account-binding.ts', () => ({
  readCliAccountBinding: vi.fn(async () => 'synthetic-account'),
}))
vi.mock('../src/host/extended-adapters.ts', async (original) => ({
  ...(await original<typeof import('../src/host/extended-adapters.ts')>()),
  extendedLaunch: vi.fn(
    async (cli, executable, project, preference, mode, prompt, stateDirectory, config, conversationId) => {
      const { mkdirSync } = await import('node:fs')
      const { prepareNativeWorker } = await import('../src/host/native-worker.ts')
      mkdirSync(stateDirectory, { recursive: true, mode: 0o700 })
      return prepareNativeWorker(
        { argv: [executable], env: {}, cleanup: async () => {} },
        { cli, project, preference, mode, prompt, stateDirectory, conversationId },
        config,
      )
    },
  ),
}))
vi.mock('../src/host/native-harness-tools.ts', async (original) => ({
  ...(await original<typeof import('../src/host/native-harness-tools.ts')>()),
  createNativeHarnessTools: vi.fn(async (options) => {
    leases.options.push(options)
    const gate = leases.gates.shift()
    const close = vi.fn(async () => {
      await gate
    })
    leases.closes.push(close)
    return { connection: undefined, capabilities: { ready: false, toolCount: 0, skills: false }, close }
  }),
}))
const runtimeRequire = createRequire(
  realpathSync(new URL('../node_modules/@deepseek-ai/dsh/package.json', import.meta.url)),
)
const loadRuntime = async (name: string) => {
  const module = await import(pathToFileURL(runtimeRequire.resolve(name)).href)
  const plugin = module.default ?? module
  if (plugin === module && typeof module.apply !== 'function')
    throw new Error(`Official runtime module ${name} has no plugin default or apply export`)
  return { ...module, default: plugin }
}
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
  leases.gates.length = 0
  leases.closes.length = 0
  leases.options.length = 0
})
function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function integrationFixture(hostLimit = 8, pluginLimit = 1, holdFirst = true) {
  const [{ default: AgentLoop }, { default: Projections }, { default: Persistence }, { default: Query }] =
    await Promise.all([
      loadRuntime('@deepseek-ai/dsh-agent-loop'),
      loadRuntime('@deepseek-ai/dsh-session-projection'),
      loadRuntime('@deepseek-ai/dsh-session-persistence-jsonl'),
      loadRuntime('@deepseek-ai/dsh-session-query'),
    ])
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'cwn-harness-service-')))
  const executable = join(directory, 'synthetic-opencode.mjs')
  writeFileSync(executable, '// Synthetic entry; process I/O is simulated by the backend below.\n')
  const ctx = new Context()
  const releaseFirst = deferred()
  if (holdFirst) leases.gates.push(releaseFirst.promise)
  cleanup.push(async () => {
    releaseFirst.resolve()
    await ctx.fiber.dispose()
    rmSync(directory, { recursive: true, force: true })
  })
  await ctx.plugin(SessionStore)
  await ctx.plugin(Projections)
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: directory })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  await ctx.plugin(Persistence, { root: join(directory, 'native-sessions'), compression: 'none' })
  await ctx.plugin(Query)
  await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 2 })
  // Newer official SubagentRuntime requires the actual working-directory
  // service; retain the older SDK fixture without inventing a service mock.
  if (SubagentRuntime.inject?.includes('workingDirectory')) {
    const [{ default: LocalFs }, { default: WorkingDirectory }] = await Promise.all([
      loadRuntime('@deepseek-ai/dsh-fs-local'),
      loadRuntime('@deepseek-ai/dsh-working-directory'),
    ])
    await ctx.plugin(LocalFs)
    await ctx.plugin(WorkingDirectory)
  }
  await ctx.plugin(SubagentRuntime, { maxDepth: 4, maxActiveSubagents: hostLimit })
  const calls: any[] = []
  const jobRuns: any[] = []
  ctx.provide('jobs', {
    start: (spec: any) => {
      jobRuns.push(spec.run())
      return randomUUID()
    },
  } as never)
  ctx.provide('userQuestions', {} as never)
  ctx.provide('typert', { lookups: new Map() } as never)
  ctx.provide('sessionController', {} as never)
  ctx.provide('subprocess', {
    resolveExecutable: async () => executable,
    spawn: (spec: any) => {
      const stdout = new PassThrough(),
        stderr = new PassThrough(),
        outcome = deferred<{ exitCode: number }>()
      const request = JSON.parse(readFileSync(spec.argv.at(-1), 'utf8'))
      const call = { spec, request, exited: false }
      calls.push(call)
      const close = () => {
        if (call.exited) return
        call.exited = true
        stdout.end()
        stderr.end()
        outcome.resolve({ exitCode: 0 })
      }
      queueMicrotask(() => {
        stdout.write(
          JSON.stringify({ type: 'session', id: 'synthetic-native-session', model: 'saved-model' }) + '\n',
        )
        stdout.write(
          JSON.stringify({
            type: 'event',
            event: { kind: 'assistant', step: 0, text: `reply:${request.prompt}` },
          }) + '\n',
        )
        stdout.write(
          JSON.stringify({
            type: 'result',
            status: 'SUCCESS',
            response: `reply:${request.prompt}`,
            resultScope: 'run',
          }) + '\n',
        )
        close()
      })
      return {
        stdout,
        stderr,
        done: outcome.promise,
        terminate: close,
        waitForExit: async () => {
          await outcome.promise
          return true
        },
      }
    },
  } as never)
  const parent = await ctx.agents.create({
    sessionId: SessionId(randomUUID()),
    meta: { cwd: directory },
    agentOptions: { provider: 'unavailable-real-provider', model: 'must-not-call' },
  })
  await ctx.plugin(CliWorkerService, {
    stateDirectory: join(directory, 'workers'),
    maxConcurrent: pluginLimit,
    graceMs: 100,
  })
  const service = ctx.cliworker as any
  await vi.waitFor(() => expect(service.harnessConversation).toBeDefined())
  return { ctx, service, directory, executable, parent, releaseFirst, calls, jobRuns }
}

const syntheticPreference = { cli: 'opencode', model: 'saved-model', effort: 'default' }
async function launchCapacity(f: Awaited<ReturnType<typeof integrationFixture>>, prompt: string, parent = f.parent.agent, worker?: Worker) {
  return JSON.parse(await f.service.launch(parent, 'Synthetic capacity task', prompt, syntheticPreference,
    'plan', worker?.id, undefined, new AbortController().signal))
}
async function occupyingProvider(f: Awaited<ReturnType<typeof integrationFixture>>) {
  const terminal = deferred<any>()
  const remove = f.ctx.subagents.registerProvider({ name: 'synthetic-capacity-other',
    capabilities: { agentOptions: false, outputSchema: false, depthLimit: false },
    start: async () => ({ id: SessionId(randomUUID()), result: terminal.promise,
      dispose: async () => { terminal.resolve({ output: [], stopReason: 'aborted' }) } }),
  } as any)
  const active = await f.ctx.subagents.startActivation({ provider: 'synthetic-capacity-other', delivery: 'caller',
    request: { parent: f.parent.agent, prompt: [{ type: 'text', text: 'synthetic slot only' }] }, signal: new AbortController().signal })
  cleanup.push(async () => { terminal.resolve({ output: [], stopReason: 'completed' }); await active.dispose(); remove() })
  return { active, release: () => terminal.resolve({ output: [], stopReason: 'completed' }) }
}
it('SDK Host1/plugin12 preserves the same fresh Task/run/candidate, rolls back bind and lets an independent root run', async () => {
  const f = await integrationFixture(1, 12), starts = vi.spyOn(f.ctx.subagents, 'startActivation')
  await launchCapacity(f, 'first-capacity')
  await vi.waitFor(() => expect(leases.closes[0]).toHaveBeenCalled())
  const queued = await launchCapacity(f, 'waiting-capacity'), worker = f.service.runtime.get(f.parent.agent.id, queued.workerId), run = worker.runId
  await vi.waitFor(() => expect(f.service.runtime.scheduling(worker)?.reason).toBe('host-child-capacity'))
  const candidate = starts.mock.calls.at(-1)![0].childId!
  expect(worker.harnessConversation).toBeUndefined(); expect(f.ctx.agents.get(candidate)).toBeUndefined()
  expect(f.calls).toHaveLength(1)
  expect(f.service.runtime.concurrencySnapshot(f.parent.agent.id)).toMatchObject({ limit: 12, globalActive: 1, globalQueued: 1 })
  const other = await f.ctx.agents.create({ sessionId: SessionId(randomUUID()), meta: { cwd: f.directory }, agentOptions: { provider: 'unavailable-real-provider', model: 'must-not-call' } })
  await launchCapacity(f, 'independent-root', other.agent)
  await vi.waitFor(() => expect(f.calls).toHaveLength(2))
  expect(worker.status).toBe('queued'); expect(worker.runId).toBe(run)
  f.releaseFirst.resolve()
  await vi.waitFor(() => expect(worker.status).toBe('completed'), { timeout: 5_000 })
  expect(worker.runId).toBe(run); expect(worker.harnessConversation?.sessionId).toBe(candidate)
  expect(f.calls.filter(call => call.request.prompt === 'waiting-capacity')).toHaveLength(1)
  expect(f.service.runtime.storage.history(worker.id).filter((event: any) => event.kind === 'user')).toHaveLength(1)
  expect(f.service.runtime.storage.history(worker.id).filter((event: any) => event.runOutcome)).toHaveLength(1)
})
it('SDK Host2 includes another provider and defers without changing either Host policy or global12', async () => {
  const f = await integrationFixture(2, 12), other = await occupyingProvider(f)
  await launchCapacity(f, 'held-native')
  await vi.waitFor(() => expect(leases.closes[0]).toHaveBeenCalled())
  const receipt = await launchCapacity(f, 'same-root-after-other'), worker = f.service.runtime.get(f.parent.agent.id, receipt.workerId), run = worker.runId
  await vi.waitFor(() => expect(f.service.runtime.scheduling(worker)?.reason).toBe('host-child-capacity'))
  expect(f.calls).toHaveLength(1); expect(worker.harnessConversation).toBeUndefined()
  other.release(); await other.active.result
  await vi.waitFor(() => expect(worker.status).toBe('completed'), { timeout: 5_000 })
  expect(worker.runId).toBe(run); expect(f.calls.filter(call => call.request.prompt === 'same-root-after-other')).toHaveLength(1)
  expect(f.service.runtime.concurrencySnapshot(f.parent.agent.id).limit).toBe(12)
})
it('SDK cold resume only defers preserved typed capacity and retains its durable binding and new run', async () => {
  const f = await integrationFixture(1, 12, false), receipt = await launchCapacity(f, 'cold-seed')
  const worker = f.service.runtime.get(f.parent.agent.id, receipt.workerId)
  await vi.waitFor(() => expect(worker.status).toBe('completed'))
  const binding = structuredClone(worker.harnessConversation)
  await vi.waitFor(() => expect(f.ctx.agents.get(SessionId(binding.sessionId))).toBeUndefined())
  const other = await occupyingProvider(f)
  await launchCapacity(f, 'cold-after-slot', f.parent.agent, worker); const run = worker.runId
  await vi.waitFor(() => expect(f.service.runtime.scheduling(worker)?.reason).toBe('host-child-capacity'))
  expect(worker.harnessConversation.sessionId).toBe(binding.sessionId); expect(f.calls).toHaveLength(1)
  other.release(); await other.active.result
  await vi.waitFor(() => expect(worker.status).toBe('completed'), { timeout: 5_000 })
  expect(worker.runId).toBe(run); expect(worker.harnessConversation.sessionId).toBe(binding.sessionId)
  expect(f.calls.filter(call => call.request.prompt === 'cold-after-slot')).toHaveLength(1)
})
it('SDK unpublished provider startup rollback emits no end; one-shot watchdog still admits the original queued run', async () => {
  const f = await integrationFixture(1, 12, false), entered = deferred(), fail = deferred()
  f.ctx.subagents.registerProvider({ name: 'synthetic-unpublished-capacity',
    capabilities: { agentOptions: false, outputSchema: false, depthLimit: false },
    start: async () => { entered.resolve(); await fail.promise; throw new Error('synthetic unpublished rollback') },
  } as any)
  let ends = 0; f.ctx.on('subagent/end', () => { ends++ })
  const starting = f.ctx.subagents.startActivation({ provider: 'synthetic-unpublished-capacity', delivery: 'caller',
    request: { parent: f.parent.agent, prompt: [{ type: 'text', text: 'synthetic no-model startup' }] }, signal: new AbortController().signal })
  const failed = starting.catch(error => error)
  cleanup.push(async () => { fail.resolve(); await failed })
  await entered.promise
  const receipt = await launchCapacity(f, 'after-unpublished-rollback'), worker = f.service.runtime.get(f.parent.agent.id, receipt.workerId), run = worker.runId
  await vi.waitFor(() => expect(f.service.runtime.scheduling(worker)?.reason).toBe('host-child-capacity'))
  expect(worker.harnessConversation).toBeUndefined(); expect(f.calls).toHaveLength(0)
  fail.resolve(); expect(await failed).toBeInstanceOf(Error); expect(ends).toBe(0)
  await vi.waitFor(() => expect(worker.status).toBe('completed'), { timeout: 5_000 })
  expect(worker.runId).toBe(run); expect(f.calls.filter(call => call.request.prompt === 'after-unpublished-rollback')).toHaveLength(1)
})
it('capacity during safe replacement restores the original binding without adding a retired child', async () => {
  const f = await integrationFixture(1, 12, false), receipt = await launchCapacity(f, 'seed-replacement')
  const worker = f.service.runtime.get(f.parent.agent.id, receipt.workerId)
  await vi.waitFor(() => expect(worker.status).toBe('completed'))
  const binding = structuredClone(worker.harnessConversation)
  await vi.waitFor(() => expect(f.ctx.agents.get(SessionId(binding.sessionId))).toBeUndefined())
  const other = await occupyingProvider(f)
  vi.spyOn(f.ctx.subagents, 'prompt').mockRejectedValueOnce(new RemoteError('subagent/not-resumable', 'synthetic unavailable old child', {}))
  await launchCapacity(f, 'replacement-waits', f.parent.agent, worker)
  await vi.waitFor(() => expect(f.service.runtime.scheduling(worker)?.reason, worker.error).toBe('host-child-capacity'))
  expect(worker.harnessConversation).toEqual(binding); expect(f.calls).toHaveLength(1)
  await f.service.runtime.stop(f.parent.agent.id, worker.id)
  other.release(); await other.active.result
  expect(worker.harnessConversation).toEqual(binding); expect(worker.status).toBe('interrupted')
})
it('mixed replacement-cap then cold-cap then replacement-admit retains the original candidate and run with one native prompt', async () => {
  const f = await integrationFixture(1, 12, false), receipt = await launchCapacity(f, 'mixed-seed')
  const worker = f.service.runtime.get(f.parent.agent.id, receipt.workerId)
  await vi.waitFor(() => expect(worker.status).toBe('completed'))
  const binding = structuredClone(worker.harnessConversation)
  await vi.waitFor(() => expect(f.ctx.agents.get(SessionId(binding.sessionId))).toBeUndefined())
  const other = await occupyingProvider(f), starts = vi.spyOn(f.ctx.subagents, 'startActivation')
  const actualPrompt = f.ctx.subagents.prompt.bind(f.ctx.subagents)
  let promptAttempts = 0
  vi.spyOn(f.ctx.subagents, 'prompt').mockImplementation(async (...args: any[]) => {
    promptAttempts++
    if (promptAttempts === 1 || promptAttempts === 3)
      throw new RemoteError('subagent/not-resumable', 'synthetic old child unavailable for this attempt', {})
    return actualPrompt(...args as Parameters<typeof actualPrompt>)
  })
  await launchCapacity(f, 'mixed-final-once', f.parent.agent, worker); const run = worker.runId
  await vi.waitFor(() => expect(f.service.runtime.scheduling(worker)?.reason).toBe('host-child-capacity'))
  const candidate = starts.mock.calls[0]![0].childId!
  expect(worker.harnessConversation).toEqual(binding); expect(f.ctx.agents.get(candidate)).toBeUndefined()
  await vi.waitFor(() => {
    expect(promptAttempts).toBe(2)
    expect(f.service.runtime.scheduling(worker)?.reason).toBe('host-child-capacity')
  }, { timeout: 5_000 })
  expect(starts).toHaveBeenCalledTimes(1); expect(worker.runId).toBe(run); expect(f.calls).toHaveLength(1)
  expect(worker.harnessConversation).toEqual(binding)
  other.release(); await other.active.result
  await vi.waitFor(() => expect(worker.status).toBe('completed'), { timeout: 5_000 })
  expect(starts).toHaveBeenCalledTimes(2)
  expect(starts.mock.calls[1]![0].childId).toBe(candidate)
  expect(worker.harnessConversation.sessionId).toBe(candidate); expect(worker.runId).toBe(run)
  expect(f.calls.filter(call => call.request.prompt === 'mixed-final-once')).toHaveLength(1)
  expect(f.service.runtime.storage.history(worker.id).filter((event: any) => event.runId === run && event.kind === 'user')).toHaveLength(1)
}, 10_000)
it('a typed capacity error with an existing real Agent is never converted to a retryable unpublished candidate', async () => {
  const f = await integrationFixture(1, 12, false)
  const starts = vi.spyOn(f.ctx.subagents, 'startActivation').mockImplementationOnce(async (spec: any) => {
    await f.ctx.agents.create({ sessionId: spec.childId, meta: { cwd: f.directory, origin: 'subagent', parentSession: f.parent.agent.id },
      agentOptions: { provider: 'unavailable-real-provider', model: 'must-not-call' } })
    throw new SubagentError('synthetic ambiguous existing child', 'ACTIVATION_LIMIT_REACHED')
  })
  const receipt = await launchCapacity(f, 'must-not-duplicate-child'), worker = f.service.runtime.get(f.parent.agent.id, receipt.workerId)
  await vi.waitFor(() => expect(worker.status).toBe('failed'))
  f.service.runtime.wakeHostAdmission()
  expect(f.service.runtime.scheduling(worker)).toBeUndefined(); expect(starts).toHaveBeenCalledTimes(1); expect(f.calls).toHaveLength(0)
})
it('unknown cold delivery-unavailable is not retried or misclassified as capacity', async () => {
  const f = await integrationFixture(1, 12, false), receipt = await launchCapacity(f, 'seed-unknown')
  const worker = f.service.runtime.get(f.parent.agent.id, receipt.workerId)
  await vi.waitFor(() => expect(worker.status).toBe('completed'))
  await vi.waitFor(() => expect(f.ctx.agents.get(SessionId(worker.harnessConversation.sessionId))).toBeUndefined())
  const prompt = vi.spyOn(f.ctx.subagents, 'prompt').mockRejectedValueOnce(new RemoteError('subagent/delivery-unavailable', 'synthetic unknown admission', {}))
  await launchCapacity(f, 'must-not-run', f.parent.agent, worker)
  await vi.waitFor(() => expect(worker.status).toBe('failed'))
  f.service.runtime.wakeHostAdmission()
  expect(prompt).toHaveBeenCalledTimes(1); expect(f.calls).toHaveLength(1)
  expect(f.service.runtime.scheduling(worker)).toBeUndefined()
})
it('SDK wait cancellation cleans the rolled-back candidate and late end cannot resurrect its Task', async () => {
  const f = await integrationFixture(1, 12), other = await occupyingProvider(f), starts = vi.spyOn(f.ctx.subagents, 'startActivation')
  const receipt = await launchCapacity(f, 'cancel-before-native'), worker = f.service.runtime.get(f.parent.agent.id, receipt.workerId)
  await vi.waitFor(() => expect(f.service.runtime.scheduling(worker)?.reason).toBe('host-child-capacity'))
  const candidate = starts.mock.calls.at(-1)![0].childId!
  await f.service.runtime.stop(f.parent.agent.id, worker.id)
  expect(worker.status).toBe('interrupted'); expect(worker.harnessConversation).toBeUndefined()
  expect(f.ctx.agents.get(candidate)).toBeUndefined(); expect(f.calls).toHaveLength(0)
  const attempts = starts.mock.calls.length
  other.release(); await other.active.result; f.service.runtime.wakeHostAdmission()
  await new Promise(resolve => setTimeout(resolve, 2_050))
  expect(starts).toHaveBeenCalledTimes(attempts); expect(f.calls).toHaveLength(0)
})
it('runs real native child submissions through CLI once and preserves owned cleanup and recovery', async () => {
  const { ctx, service, directory, executable, parent, releaseFirst, calls, jobRuns } = await integrationFixture()
  const receipt = JSON.parse(
    await service.launch(
      parent.agent,
      'Synthetic service task',
      'first',
      { cli: 'opencode', model: 'saved-model', effort: 'default' },
      'accept-edits',
      undefined,
      undefined,
      new AbortController().signal,
    ),
  )
  await vi.waitFor(() =>
    expect(leases.closes[0], service.runtime.get(parent.agent.id, receipt.workerId).error).toBeDefined(),
  )
  await vi.waitFor(() => expect(leases.closes[0]).toHaveBeenCalledTimes(1))
  expect(calls).toHaveLength(1)
  expect(calls[0].request.prompt).toBe('first')
  const activeWorker = service.runtime.get(parent.agent.id, receipt.workerId)
  expect(activeWorker.status).toBe('running')
  expect(activeWorker.harnessConversation?.sessionId).toBeDefined()
  const child = ctx.agents.get(SessionId(activeWorker.harnessConversation.sessionId))!
  // Internal routes remain usable by the real AgentLoop while the ordinary
  // main-conversation catalog has no Worker model to offer for selection.
  expect(await ctx.llm.listModels(HARNESS_CLI_PROVIDER)).toEqual([])
  expect(await ctx.llm.resolveModelInfo(HARNESS_CLI_PROVIDER, `worker/${activeWorker.id}`)).toMatchObject({
    provider: HARNESS_CLI_PROVIDER,
    id: `worker/${activeWorker.id}`,
    name: 'opencode · saved-model',
    inputModalities: ['text', 'image'],
  })
  expect(child.session.header).toMatchObject({ origin: 'subagent', parentSession: parent.agent.id })
  expect(child.status).toBe('running')
  releaseFirst.resolve()
  await jobRuns[0].done
  await child.whenIdle()
  expect(service.runtime.get(parent.agent.id, receipt.workerId).status).toBe('completed')
  expect(calls).toHaveLength(1)
  expect(
    child.session
      .deriveMessages()
      .flatMap((message) =>
        message.role === 'assistant'
          ? message.content.filter((block) => block.type === 'text').map((block) => block.text)
          : [],
      ),
  ).toEqual(['reply:first'])

  await ctx.subagents.prompt(
    {
      requestId: randomUUID() as never,
      parentSessionId: parent.agent.id,
      childSessionId: child.id,
      mode: 'continuable',
      delivery: 'queue',
      content: [{ type: 'text', text: 'native continuation' }],
    },
    new AbortController().signal,
  )
  await child.whenIdle()
  expect(calls).toHaveLength(2)
  expect(calls[1].request.prompt).toBe('native continuation')
  expect(activeWorker.harnessConversation.capabilities.send).toBe(true)
  expect(child.inbox.nextTurn).toHaveLength(0)
  await service.launch(
    parent.agent,
    'Synthetic service task',
    'worker continuation',
    activeWorker.preference,
    activeWorker.mode,
    activeWorker.id,
    undefined,
    new AbortController().signal,
  )
  await jobRuns[2].done
  await child.whenIdle()
  expect(calls).toHaveLength(3)
  expect(calls[2].request).toMatchObject({
    prompt: 'worker continuation',
    conversationId: 'synthetic-native-session',
  })
  expect(leases.closes).toHaveLength(3)
  expect(leases.closes.every((close) => close.mock.calls.length === 1)).toBe(true)
  expect(
    child.session
      .deriveMessages()
      .flatMap((message) =>
        message.role === 'assistant'
          ? message.content.filter((block) => block.type === 'text').map((block) => block.text)
          : [],
      ),
  ).toEqual(['reply:first', 'reply:native continuation', 'reply:worker continuation'])
  expect(calls.every((call) => call.exited)).toBe(true)

  // Old direct/queue controls still launch only through WorkerRuntime. Their
  // native display attachment must neither disappear nor launch a duplicate.
  await service.launch(
    parent.agent,
    'Synthetic service task',
    'external direct',
    activeWorker.preference,
    activeWorker.mode,
    activeWorker.id,
    undefined,
    new AbortController().signal,
  )
  await jobRuns[3].done
  await child.whenIdle()
  expect(calls).toHaveLength(4)
  service.runtime.queueFollowup(
    parent.agent.id,
    activeWorker.id,
    'external queue',
    service.runtime.get(parent.agent.id, activeWorker.id).runId,
    randomUUID(),
    true,
  )
  await vi.waitFor(() => expect(calls).toHaveLength(5))
  await jobRuns[4].done
  await child.whenIdle()
  expect(leases.closes).toHaveLength(5)
  expect(leases.closes.every((close) => close.mock.calls.length === 1)).toBe(true)
  expect(
    child.session
      .deriveMessages()
      .flatMap((message) =>
        message.role === 'assistant'
          ? message.content.filter((block) => block.type === 'text').map((block) => block.text)
          : [],
      ),
  ).toEqual(['reply:first', 'reply:native continuation', 'reply:worker continuation', 'reply:external direct', 'reply:external queue'])
  expect(calls.every((call) => call.exited)).toBe(true)

  const unknownWrite = vi.fn(async () => 'synthetic tool output')
  ctx.tools.register(
    defineTool({
      name: 'synthetic_unknown_write',
      description: 'Synthetic unclassified third-party writer',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: unknownWrite,
    }),
  )
  const planReceipt = JSON.parse(
    await service.launch(
      parent.agent,
      'Synthetic plan',
      'plan input',
      activeWorker.preference,
      'plan',
      undefined,
      undefined,
      new AbortController().signal,
    ),
  )
  await jobRuns[5].done
  const planWorker = service.runtime.get(parent.agent.id, planReceipt.workerId)
  const planChild = ctx.agents.get(SessionId(planWorker.harnessConversation.sessionId))!
  await planChild.whenIdle()
  const planTools = await leases.options.at(-1).tools()
  expect(planTools).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'synthetic_unknown_write', execution: 'host' })]))
  // Catalog visibility inherits the real child scope; it does not execute a tool.
  const revoke = planChild.ctx.tools.restrict({ deny: ['synthetic_unknown_write'] })
  expect(await leases.options.at(-1).tools()).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'synthetic_unknown_write' })]))
  revoke()
  expect(ctx.sandboxPolicy.resolve({ session: planChild.session }).mode).toBe('read-only')
  expect(ctx.sandboxPolicy.resolve({ session: parent.agent.session }).mode).toBe('workspace-write')
  expect(unknownWrite).not.toHaveBeenCalled()

  // An invalid native log can fail Client retain.ready before any composer is
  // shown. Explicit repair therefore owns an idle Runtime preparation lease;
  // it must succeed without a fresh user prompt or native CLI process.
  const oldDisplay = service.runtime.get(parent.agent.id, activeWorker.id).harnessConversation.sessionId
  if ('drainChildren' in ctx.subagents && typeof ctx.subagents.drainChildren === 'function')
    await ctx.subagents.drainChildren(parent.agent, [SessionId(oldDisplay)])
  else await ctx.subagents.drainContinuableChildren(parent.agent, [SessionId(oldDisplay)])
  const observe = ctx.sessionQuery.observeSession.bind(ctx.sessionQuery)
  const corrupt = vi.spyOn(ctx.sessionQuery, 'observeSession').mockImplementation(async (id, options) => {
    if (id === oldDisplay)
      throw Object.assign(new Error('Synthetic corrupt display'), { code: 'SESSION_QUERY_CORRUPT_SESSION' })
    return observe(id, options)
  })
  try {
    const repaired = JSON.parse(
      await service.repairHarnessConversation(
        parent.agent.id,
        activeWorker.id,
        oldDisplay,
        new AbortController().signal,
      ),
    )
    const display = ctx.agents.get(SessionId(repaired.sessionId))!
    await display.whenIdle()
    expect(repaired.sessionId).not.toBe(oldDisplay)
    expect(calls).toHaveLength(6)
    expect(service.runtime.get(parent.agent.id, activeWorker.id).conversationId).toBe(
      'synthetic-native-session',
    )
    expect(service.runtime.snapshot(parent.agent.id, activeWorker.id).selectedBusy).toBe(false)
  } finally {
    corrupt.mockRestore()
  }

  // Stop exactly while official initial acceptance is waking the projection,
  // before startContinuable/ensure has returned to Runtime preparation. The
  // callback must never await the same Runtime.done from that admission stack.
  let stopped: Promise<Worker> | undefined
  const removeStopProbe = ctx.on(
    'agent/inbox/inserted',
    ({ agent, message }) => {
      if (
        stopped ||
        agent.session.header.parentSession !== parent.agent.id ||
        message.content[0]?.type !== 'text' ||
        !message.content[0].text.startsWith('cliworker:attach-existing-run:')
      )
        return
      const pending = [...service.runtime.storage.workers.values()].find(
        (worker: Worker) => worker.title === 'Stop during child publication',
      ) as Worker | undefined
      if (pending) stopped = service.runtime.stop(parent.agent.id, pending.id)
    },
    { global: true },
  )
  try {
    const stopReceipt = JSON.parse(
      await service.launch(
        parent.agent,
        'Stop during child publication',
        'must never spawn',
        activeWorker.preference,
        activeWorker.mode,
        undefined,
        undefined,
        new AbortController().signal,
      ),
    )
    await vi.waitFor(() => expect(stopped).toBeDefined())
    await stopped
    await jobRuns[6].done
    expect(service.runtime.get(parent.agent.id, stopReceipt.workerId).status).toBe('interrupted')
    expect(calls).toHaveLength(6)
    expect(leases.closes.every((close) => close.mock.calls.length === 1)).toBe(true)
  } finally {
    removeStopProbe()
  }
  // Once Runtime has admitted a request, a failed job binding must cancel and
  // drain it before the caller sees an error, even though no receipt was sent.
  const brokenJob = vi.spyOn(service.runtime, 'attachJob').mockImplementationOnce(() => {
    throw new Error('Synthetic job binding write failed')
  })
  try {
    await expect(service.launch(
      parent.agent,
      'Failed job binding',
      'must drain without a receipt',
      activeWorker.preference,
      activeWorker.mode,
      undefined,
      undefined,
      new AbortController().signal,
    )).rejects.toThrow('Synthetic job binding write failed')
    const admitted = [...service.runtime.storage.workers.values()].find(
      (worker: any) => worker.title === 'Failed job binding',
    ) as Worker
    expect(admitted.status).toBe('interrupted')
    expect(service.runtime.snapshot(parent.agent.id, admitted.id).selectedBusy).toBe(false)
    expect(service.nativeRunDone.has(admitted.runId)).toBe(false)
    expect(calls).toHaveLength(6)
  } finally {
    brokenJob.mockRestore()
  }
  setSandboxMode(parent.agent.session, 'read-only')
  await expect(
    service.launch(
      parent.agent,
      'Rejected write',
      'blocked',
      activeWorker.preference,
      'accept-edits',
      undefined,
      undefined,
      new AbortController().signal,
    ),
  ).rejects.toThrow('只读权限')
  expect(calls).toHaveLength(6)

  // Actual official AgentLoop provenance regression. Runtime context is not a
  // user's new CLI task, including messages claimed before downstream hooks.
  setSandboxMode(parent.agent.session, 'workspace-write')
  const live = service.runtime.get(parent.agent.id, planWorker.id)
  // Prior public maintenance may have drained inactive children. Activate using
  // one genuine public submission, never a fabricated AgentRegistry instance.
  await ctx.subagents.prompt({ requestId: randomUUID() as never, parentSessionId: parent.agent.id,
    childSessionId: SessionId(live.harnessConversation.sessionId), mode: 'continuable', delivery: 'queue',
    content: [{ type: 'text', text: 'SYNTHETIC_ACTIVATE_PROVENANCE_CHECK' }] }, new AbortController().signal)
  const display = ctx.agents.get(SessionId(live.harnessConversation.sessionId))!
  await display.whenIdle()
  const baselineCalls = calls.length
  const wdText = 'The working directory changed from "synthetic-old" to "synthetic-new".'
  const unchangedRun = live.runId, unchangedJobs = jobRuns.length
  const removeContext = ctx.on('agent/pre-step', async (payload, next) => {
    if (payload.agent.id === display.id)
      payload.messages.push(createUserMessage({ source: { kind: 'runtime-context', form: 'notice', sections: [] }, content: [{ type: 'text', text: 'SYNTHETIC_MIDDLEWARE_INSTRUCTION_MUST_NOT_BE_SENT' }] } as any))
    return next()
  }, { global: true })
  try {
    for (const kind of ['working-directory', 'runtime-context']) {
      display.send(createUserMessage({ source: { kind }, content: [{ type: 'text', text: wdText }] } as any), 'next-step', true)
      await display.whenIdle()
      await vi.waitFor(() => { expect(display.inbox.nextStep).toHaveLength(0); expect(display.status).toBe('idle') })
      expect(calls).toHaveLength(baselineCalls); expect(jobRuns).toHaveLength(unchangedJobs)
      expect(service.runtime.get(parent.agent.id, live.id).runId).toBe(unchangedRun)
    }
    // Same text is a real request when source=user; no body matching/blanket rejection.
    display.send(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: wdText }] }), 'next-step', true)
    await display.whenIdle()
    await vi.waitFor(() => expect(calls).toHaveLength(baselineCalls + 1))
    expect(calls[baselineCalls].request.prompt).toBe(wdText)
    // Mixed preclaimed context and user input retains only the genuine submission.
    display.send(createUserMessage({ source: { kind: 'working-directory' }, content: [{ type: 'text', text: wdText }] } as any), 'next-step', false)
    display.send(createUserMessage({ source: { kind: 'user', rpcId: randomUUID() }, content: [{ type: 'text', text: 'SYNTHETIC_GENUINE_MIXED_INPUT' }] } as any), 'next-step', true)
    await display.whenIdle()
    await vi.waitFor(() => expect(calls).toHaveLength(baselineCalls + 2))
    expect(calls[baselineCalls + 1].request.prompt).toBe('SYNTHETIC_GENUINE_MIXED_INPUT')
    expect(calls.slice(baselineCalls).every(call => !call.request.prompt.includes('MIDDLEWARE_INSTRUCTION'))).toBe(true)
  } finally { removeContext() }
})
