import type { AuthProfilePin } from '../shared/auth-profiles.ts'
import { profileSelection } from './native-auth-profile-scope.ts'
import { MiniMaxNativeAuthProfiles } from './native-auth-minimax-service.ts'
import { parseAuthImportRequest, parseAuthManageRequest, parseAuthRequestJson } from './native-auth-profile-requests.ts'
import { NativeAuthError, nativeAuthFailureCode } from './native-auth-files.ts'
import { readCliAccountBinding } from './cli-account-binding.ts'
import { SettingsCatalogCache } from './settings-catalog-cache.ts'
import { workerRunResult } from './worker-result.ts'
import { resolveModel } from '../shared/models.ts'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as validate } from 'zod'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { SettingsCacheMetadata } from '../shared/settings-cache.ts'
import { createHarnessConversationBridge } from './harness-conversation.ts'
import { workerGoalCommand } from './harness-conversation-commands.ts'
import { HarnessConversationStore } from './harness-conversation-store.ts'
import {
  projectExternalTurnUsage,
  recoverHarnessTurnRuns,
  type HarnessTurnObservation,
} from './harness-turn-usage.ts'
import { projectExternalTurnAnswer } from './harness-turn-answer.ts'
import { projectRequestState } from './native-request-state.ts'
import type { HarnessConversationApi, HarnessConversationRecord } from './harness-conversation-types.ts'
import {
  classifyHarnessTool,
  adoptNativeHarnessLease,
  createNativeHarnessTools,
  type NativeHarnessSkill,
} from './native-harness-tools.ts'
import { nativeHarnessToolCapability, nativeHarnessExecutionReady } from './native-harness-injection.mjs'
import { installHarnessModelGuard, withinCliTool } from './harness-model-guard.ts'
import { resolveHarnessAttachments } from './harness-attachments.ts'
import type { NativeAttachment } from './native-attachments.mjs'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { publicOperationError, withPublicToolErrors } from './public-operation-error.ts'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-subprocess'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-plan-mode'
import {
  CLI_IDS,
  CLI_LABELS,
  cliOf,
  workerName,
  isUserInterrupted,
  EFFORTS,
  type Effort,
  type CliId,
  type Preference,
  type FollowupExpectation,
  type TaskMode,
  type RoleSnapshot,
  type Worker,
} from '../shared/types.ts'
import { agentNameSchema, roleSnapshot } from './roles.ts'
import {
  DEFAULT_CONFIG,
  projectDirectory,
  isProcessCleanupUnconfirmedError,
  ProcessCleanupUnconfirmedError,
  type ProcessBackend,
  type RuntimeConfig,
} from './process.ts'
import { nativeProcessBackend } from './native-process.ts'
import { validatePreference, configuredCliExecutable, resolveCliExecutable, type Catalog } from './adapters.ts'
import { CliExecutablePathStore } from './cli-executable-paths.ts'
import type { CliExecutablePathStatus } from '../shared/cli-settings.ts'
import { RUNNING_MESSAGE_MODES } from '../shared/running-message.ts'
import { workerPermissionOptions, type WorkerPermissionState } from '../shared/worker-permissions.ts'
import { WindowsCliInstallationError, WindowsCliNotFoundError } from './windows-cli-installation.ts'
import { ACCOUNT_CHANGED, authorizedCatalog, authorizeSelection } from './authorized-catalog.ts'
import { agyConfigForPreference } from './agy-account.ts'
import { WorkerStorage, type DispatchSetup } from './storage.ts'
import { WorkerRuntime, type Submission } from './runtime.ts'
import { AccountManager } from './accounts.ts'
import {
  CLI_DELEGATION_GUIDANCE,
  CLI_NAME_GUIDANCE,
  registerCliRouting,
  requireCliName,
  resolveCliName,
  isGenericQoderName,
  resolveAvailableCliName,
} from './routing.ts'

export type {
  Preference,
  Worker,
  WorkerSnapshot,
  ModelChoice,
  TimelineItem,
  TaskMode,
  Effort,
  WorkerStatus,
  RolePreset,
  RoleSnapshot,
} from '../shared/types.ts'
import { MAX_CONCURRENCY } from '../shared/scheduling.ts'

/** Deployment settings; all values are resolved by the plugin schema. */
export interface Config {
  /** Antigravity isolated HOME selector (default lxy for this deployment). */
  agyAccount?: 'default' | 'lxy'
  /** CLI binary or absolute path (default agy). */
  executable?: string
  /** Codex CLI executable. */
  codexExecutable?: string
  /** Claude Code executable. */
  claudeExecutable?: string
  /** Kimi Code executable. */
  kimiExecutable?: string
  /** Official Xiaomi MiMo Code executable. */
  mimoExecutable?: string
  zcodeExecutable?: string
  grokExecutable?: string
  ompExecutable?: string
  piExecutable?: string
  hermesExecutable?: string
  hermesHome?: string
  opencodeExecutable?: string
  qoderExecutable?: string
  qodercnExecutable?: string
  cursorExecutable?: string
  minimaxExecutable?: string
  minimaxHome?: string
  zcodeAuthDirectory?: string
  zcodeBuiltinConfig?: string
  /** @deprecated Accepted for old deployments only; never read or forwarded. */
  zaiCredentialRef?: string
  /** Optional private state directory; defaults to DSH_HOME/cliworker-now. */
  stateDirectory?: string
  /** Initial global run slots, 1–12 (default 8); explicit private UI/tool choice wins. */
  maxConcurrent?: number
  /** Maximum turn duration in milliseconds (default 1800000). */
  timeoutMs?: number
  /** Process termination grace in milliseconds (default 5000). */
  graceMs?: number
  /** Maximum NDJSON line bytes (default 1048576). */
  maxLineBytes?: number
  /** Maximum output bytes per run (default 16777216). */
  maxRunBytes?: number
  /** Maximum logical timeline rows in one live view (default 1000). */
  maxTimelineItems?: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** CLI worker lifecycle and browser API. */ cliworker: CliWorkerService
  }
}
declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    cliworker: 'cliworker'
  }
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** CLI worker operation could not proceed; unknown delivery must not be resent. */ 'cliworker/unavailable': {
      reason: string
      deliveryUnknown?: boolean
    }
  }
}

const preferenceSchema = validate.object({
  authProfile: validate.object({ id: validate.string().regex(/^ap_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/), materialRevision: validate.string().regex(/^m_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/) }).strict().optional(),
  cli: validate.enum(CLI_IDS).optional(),
  model: validate.string().min(1),
  effort: validate.enum(EFFORTS),
  agyAccount: validate.enum(['default', 'lxy']).optional(),
})
const messageSubmissionSchema = validate
  .object({
    id: validate.uuid(),
    clientId: validate.uuid(),
    sequence: validate.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    prompt: validate
      .string()
      .min(1)
      .max(100_000)
      .refine((text) => !!text.trim()),
    mode: validate.enum(RUNNING_MESSAGE_MODES),
    intent: validate.enum(['direct', 'running']),
    expectedRunId: validate.string().min(1).max(128),
  })
  .strict()
const failure = (error: unknown, signal?: AbortSignal) => {
  const safe = publicOperationError(error, signal), reason = String(safe)
  return new RemoteError('cliworker/unavailable', reason, {
    reason,
    ...(Object.getOwnPropertyDescriptor(safe, 'code')?.value === 'STEER_UNKNOWN'
      ? { deliveryUnknown: true } : {}),
  })
}

/** Cancel a question/wait independently; late answers cannot commit a selection. */
function waitForInput<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener('abort', aborted)
      reject(signal.reason ?? new Error('选择已取消'))
    }
    signal.addEventListener('abort', aborted, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
  })
}

/** Host owner of CLI conversations, model tools and Remote streams. */
export class CliWorkerService extends TypertRemoteService {
  static inject = [
    'agents',
    'tools',
    'systemPrompt',
    'jobs',
    'subprocess',
    'sandboxPolicy',
    'typert',
  ]
  static Config: z<Config> = z.object({
    agyAccount: z.union([z.const('default'), z.const('lxy')]).default('lxy'),
     executable: z.string().min(1).default(DEFAULT_CONFIG.executable),
    codexExecutable: z.string().min(1).default('codex'),
    claudeExecutable: z.string().min(1).default('claude'),
    kimiExecutable: z.string().min(1).default('kimi'),
    mimoExecutable: z.string().min(1).default('mimo'),
    zcodeExecutable: z.string(),
    grokExecutable: z.string(),
    ompExecutable: z.string(),
    piExecutable: z.string(),
    hermesExecutable: z.string(),
    hermesHome: z.string(),
    opencodeExecutable: z.string(),
    qoderExecutable: z.string().min(1).default('qoder'),
    qodercnExecutable: z.string().min(1).default('qodercn'),
    cursorExecutable: z.string(),
    minimaxExecutable: z.string(),
    minimaxHome: z.string(),
    zcodeAuthDirectory: z.string(),
    zcodeBuiltinConfig: z.string(),
    zaiCredentialRef: z.string(),
    stateDirectory: z.string(),
    maxConcurrent: z.natural().min(1).max(MAX_CONCURRENCY).default(DEFAULT_CONFIG.maxConcurrent),
    timeoutMs: z.natural().min(1000).max(86400000).default(DEFAULT_CONFIG.timeoutMs),
    graceMs: z.natural().min(100).max(30000).default(DEFAULT_CONFIG.graceMs),
    maxLineBytes: z.natural().min(1024).default(DEFAULT_CONFIG.maxLineBytes),
    maxRunBytes: z.natural().min(1024).default(DEFAULT_CONFIG.maxRunBytes),
    maxTimelineItems: z.natural().min(10).default(DEFAULT_CONFIG.maxTimelineItems),
  })
  private runtime: WorkerRuntime
  private accounts: AccountManager
  private accountParents = new Map<string, () => Promise<void>>()
  private options: RuntimeConfig
  private backend: ProcessBackend
  private pending = new Map<string, number>()
  private dispatchWaits = new Map<string, Promise<void>>()
  private messageSubmissions = new Map<string, { request: string; done: Promise<string> }>()
  private selectionBindings = new WeakMap<Preference, string>()
  private selectionProjects = new WeakMap<Preference, string>()
  private displayedBindings = new Map<string, string>()
  private profileTaskProofs?: Map<string, string>
  private settingsCatalogs?: SettingsCatalogCache
  private settingsInstance?: string
  private settingsSourceRevisions?: Map<CliId, number>
  private disposed = new AbortController()
  private harnessConversation?: HarnessConversationApi
  private harnessConversationStore?: HarnessConversationStore
  private nativeRunDone = new Map<string, Promise<Worker>>()
  private repairingDisplays = new Set<string>()
  private nativeProfiles?: MiniMaxNativeAuthProfiles

  /** @param ctx - Harness services. @param config - Validated deployment options. */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'cliworker', { namespace: 'cliworker' })
    this.options = {
      ...DEFAULT_CONFIG,
      ...config,
    }
    const stateDirectory =
      config.stateDirectory ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'cliworker-now')
    this.options.cliExecutablePaths = new CliExecutablePathStore(stateDirectory)
    this.backend = nativeProcessBackend(ctx.subprocess)
    this.accounts = new AccountManager(this.backend, this.options, undefined, (cli, error) =>
      this.runtime.blockCatalogOnCleanup(cli, error),
    )
    const workerStorage = new WorkerStorage(stateDirectory)
    const profiles = new MiniMaxNativeAuthProfiles(workerStorage.directory, this.backend, this.options)
    this.nativeProfiles = profiles
    this.runtime = new WorkerRuntime(workerStorage, this.backend, this.options, profiles)
    this.ctx.effect(() => () => profiles.dispose())
    this.ctx.inject(['sessionController', 'subagents', 'llm'], (scope) => {
      const records = new HarnessConversationStore(this.runtime.storage.directory)
      this.harnessConversationStore = records
      const bridge = createHarnessConversationBridge(scope, {
        bindings: () => records.list(),
        bind: async (record) => {
          const worker = this.runtime.get(record.parentSessionId, record.workerId)
          // Public capability metadata is derived by the bridge, never used as authority.
          const publicBinding = worker.harnessConversation
          if (publicBinding && publicBinding.sessionId !== record.sessionId)
            throw new Error('Worker 原生会话身份不匹配')
          records.save(record)
          this.runtime.changed()
        },
        unbind: async (record) => {
          records.remove(record)
          const worker = this.runtime.get(record.parentSessionId, record.workerId)
          if (worker.harnessConversation?.sessionId === record.sessionId) {
            delete worker.harnessConversation
            this.runtime.storage.save(worker)
            this.runtime.changed()
          }
        },
        replaceBinding: async (previous, next) => {
          const worker = this.runtime.get(previous.parentSessionId, previous.workerId)
          if (worker.harnessConversation?.sessionId !== previous.sessionId)
            throw new Error('Worker 原生会话替换的当前身份不匹配')
          records.replace(previous, next)
          // The private CAS is authoritative. Publish only after its atomic commit.
          const previousBinding = worker.harnessConversation
          worker.harnessConversation = {
            ...previousBinding,
            sessionId: next.sessionId,
          }
          try {
            this.runtime.storage.save(worker)
          } catch (error) {
            worker.harnessConversation = previousBinding
            const rollback = {
              ...previous,
              retiredSessionIds: [...(previous.retiredSessionIds ?? []), next.sessionId],
            }
            try {
              records.replace(next, rollback)
            } catch (cleanup) {
              throw new AggregateError([error, cleanup], '原生会话绑定替换及回滚未完成')
            }
            throw error
          }
          this.runtime.changed()
        },
        restoreUnpublished: async (candidate, previous) => {
          const worker = this.runtime.get(candidate.parentSessionId, candidate.workerId)
          if (this.ctx.agents.get(candidate.sessionId as Agent['id']) || worker.harnessConversation?.sessionId !== candidate.sessionId)
            throw new Error('未发布子会话回滚身份无法确认')
          records.restoreUnpublished(candidate, previous)
          const binding = worker.harnessConversation
          worker.harnessConversation = { ...binding, sessionId: previous.sessionId }
          try { this.runtime.storage.save(worker) }
          catch (error) { worker.harnessConversation = binding; throw error }
          this.runtime.changed()
        },
        getWorker: (parent, id) => this.runtime.get(parent, id),
        busy: (record) => {
          const snapshot = this.runtime.snapshot(record.parentSessionId, record.workerId)
          return (
            !!snapshot.selectedBusy &&
            !(this.repairingDisplays.has(record.workerId) && snapshot.selectedBusyReason === 'preparing')
          )
        },
        events: (record, runId, afterSeq) =>
          this.runtime.storage
            .history(record.workerId)
            .filter((event) => event.runId === runId && event.seq > afterSeq),
        subscribe: (listener) => this.runtime.subscribe(listener),
        receipt: (record, prompt, requestId) =>
          !!this.runtime.directMessageReceipt(record.parentSessionId, record.workerId, prompt, requestId),
        admitted: (record, batchId) => this.runtime.storage.history(record.workerId)
          .some((event) => event.kind === 'user' && event.queuedFollowupId === batchId),
        steering: (record) => this.runtime.nativeSteeringState(record.parentSessionId, record.workerId),
        steer: async (record, prompt, runId, requestId, signal) => {
          await this.steerMessage(record.parentSessionId, record.workerId, prompt, runId, requestId, signal)
        },
        fork: async (record, signal) => {
          const result = JSON.parse(await this.forkWorker(record.parentSessionId, record.workerId, '', signal)) as { childSessionId: string }
          return `已创建 CLI 会话分支：${result.childSessionId}`
        },
        goal: async (record, input, signal) => {
          const worker = this.runtime.get(record.parentSessionId, record.workerId)
          if (worker.harnessConversation?.sessionId !== record.sessionId)
            throw new Error('CLI 子会话绑定已改变，未修改目标')
          signal.throwIfAborted()
          return workerGoalCommand(worker, input, {
            set: async (objective, revision) => JSON.parse(await this.setWorkerGoal(record.parentSessionId, record.workerId, objective, revision, signal)),
            status: (status, revision) => this.setWorkerGoalStatus(record.parentSessionId, record.workerId, status, revision, signal),
            clear: (revision) => this.clearWorkerGoal(record.parentSessionId, record.workerId, revision, signal),
          })
        },
        permission: async (record, mode, signal) => {
          const worker = this.runtime.get(record.parentSessionId, record.workerId)
          if (worker.harnessConversation?.sessionId !== record.sessionId)
            throw new Error('CLI 子会话绑定已改变，未修改权限')
          if (mode !== undefined) {
            const saved = JSON.parse(await this.configureWorkerPermission(record.parentSessionId, record.workerId, mode, signal)) as Worker
            return `当前 CLI 权限：${workerPermissionOptions(saved).find((option) => option.value === saved.mode)?.name ?? saved.mode}`
          }
          const state = JSON.parse(await this.permissionForWorker(record.parentSessionId, record.workerId, signal)) as WorkerPermissionState
          return `当前 CLI 权限：${state.currentValue}。可用模式：${state.options.map((option) => `${option.value}（${option.name}）`).join('、')}${state.reason ? `。${state.reason}` : ''}`
        },
        run: async (record, prompt, requestId, signal, messages = []) => {
          const parent = await this.parent(record.parentSessionId)
          signal.throwIfAborted()
          const worker = this.runtime.get(parent.id, record.workerId)
          if (worker.harnessConversation?.sessionId !== record.sessionId)
            throw new Error('CLI 子会话绑定已改变，未启动任务')
          const previous = this.runtime.directMessageReceipt(parent.id, worker.id, prompt, requestId)
          if (previous?.runId)
            return { runId: previous.runId, done: this.waitHarnessRun(record, previous.runId) }
          const child = this.ctx.agents.get(record.sessionId as Agent['id'])
          if (!child) throw new Error('CLI 子会话已失效，未读取附件')
          const attachments = resolveHarnessAttachments(child.ctx, messages)
          // The native Agent has claimed this message. Reuse the same launch
          // checks and process lifetime, without a second conversation queue.
          const receipt = JSON.parse(
            await this.launch(
              parent,
              worker.title,
              prompt,
              worker.preference,
              worker.mode,
              worker.id,
              undefined,
              signal,
              undefined,
              undefined,
              undefined,
              requestId,
              attachments,
            ),
          ) as { runId: string }
          return { runId: receipt.runId, done: this.waitHarnessRun(record, receipt.runId) }
        },
        wait: (record, runId) => this.waitHarnessRun(record, runId),
        stop: async (record, runId) => {
          const current = this.runtime.get(record.parentSessionId, record.workerId)
          // A late projection from the previous run cannot cancel a new turn.
          if (current.runId === runId) await this.runtime.stop(record.parentSessionId, record.workerId)
        },
      })
      this.harnessConversation = bridge
      const removeModelGuard = installHarnessModelGuard(scope)
      // Install before the first reserve attempt. These are hints only: the SDK
      // owns capacity, and unpublished rollback is covered by Runtime backoff.
      scope.on('subagent/end', () => this.runtime.wakeHostAdmission())
      scope.on('settings/document-updated', () => this.runtime.wakeHostAdmission())
      scope.on('loader/volatile-update', () => this.runtime.wakeHostAdmission())
      const removePreparation = this.runtime.setHarnessPreparation(async (worker, signal, input) => {
        const parent = await this.parent(worker.parentSessionId)
        if (input.hostAuthority && input.hostAuthority !== parent) throw new Error('等待期间父会话已替换，未重新准入')
        this.assertExecution(parent)
        if (this.project(parent) !== worker.project) throw new Error('等待期间项目已变更，未重新准入')
        const binding = await bridge.ensure(parent, worker, {
          nativeSubmissionId: input.submissionId,
          admissionChildId: input.hostChildId,
          initialRunId: worker.runId,
          projectRun: true,
          signal,
        })
        // Runtime owns this exact mutable Worker for the duration of the run.
        worker.harnessConversation = binding
        this.runtime.storage.save(worker)
        this.runtime.changed()
        const cli = cliOf(worker.preference)
        const child = this.ctx.agents.get(binding.sessionId as Agent['id'])
        if (!child) throw new Error('原生子 Agent 尚未就绪，未启动 CLI 工具桥')
        setSandboxMode(
          child.session,
          worker.mode === 'plan'
            ? 'read-only'
            : parent.ctx.get('sandboxPolicy')!.resolve({ session: parent.session }).mode,
        )
        child.ctx.get('planMode')?.set(child, worker.mode === 'plan')
        if (worker.transport === 'opencode-http-v2') {
          worker.harnessConversation = { ...binding, capabilities: { ...binding.capabilities, model: false, steer: false },
            reasons: { ...binding.reasons, tools: 'OpenCode v2 当前只开放全工具拒绝的纯文本会话', skills: 'OpenCode v2 当前不注入工具或技能', model: '此自有会话固定模型，修改请新建任务', steer: 'OpenCode v2 尚未开放实时引导' } }
          this.runtime.storage.save(worker); this.runtime.changed()
          return undefined
        }
        const support = nativeHarnessToolCapability(cli)
        if (!support.transport) {
          worker.harnessConversation = {
            ...binding,
            reasons: {
              ...binding.reasons,
              tools: support.reason,
              skills: support.reason,
            },
          }
          this.runtime.storage.save(worker)
          this.runtime.changed()
          return undefined
        }
        // Public scoped presentation affects only this internal child. Tool policy
        // and inherited restrictions still run inside tools.execute.
        const resetPresentation = child.ctx.tools.presentAs('native')
        let lease: Awaited<ReturnType<typeof createNativeHarnessTools>>
        try {
          // The real child scope owns its tool/MCP catalog. Refresh for every
          // bridge operation so an old grant cannot outlive a policy change.
          const tools = () => {
            const schemas = child.ctx.tools.schemas(child)
            return schemas.map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.parameters,
              execution: classifyHarnessTool(tool.name, schemas),
            }))
          }
          const skills = child.ctx.get('skills') as
            | {
                list(options: { cwd: string; scope: Agent; signal: AbortSignal }): Promise<
                  Array<{
                    name: string
                    description: string
                    invocation: { modelInvocable: boolean }
                  }>
                >
                get(
                  name: string,
                  options: { cwd: string; scope: Agent; signal: AbortSignal },
                ): Promise<
                  | (NativeHarnessSkill & {
                      invocation: { modelInvocable: boolean }
                    })
                  | undefined
                >
              }
            | undefined
          const skillOptions = (control: AbortSignal) => ({
            cwd: worker.project,
            scope: child,
            signal: control,
          })
          lease = await createNativeHarnessTools({
            binding: {
              parentSessionId: parent.id,
              harnessSessionId: binding.sessionId,
              workerId: worker.id,
              runId: worker.runId,
              cli,
            },
            tools,
            signal,
            executionReady: nativeHarnessExecutionReady(cli),
            authorize: async (identity) => {
              signal.throwIfAborted()
              const current = this.runtime.get(parent.id, worker.id)
              if (
                current.runId !== identity.runId ||
                current.harnessConversation?.sessionId !== identity.harnessSessionId ||
                this.ctx.agents.get(binding.sessionId as Agent['id']) !== child ||
                !['queued', 'running'].includes(current.status)
              )
                throw new Error('工具桥运行身份已失效')
              this.assertExecution(parent)
              if (this.project(parent) !== worker.project) throw new Error('工具桥项目已变更')
              this.runtime.assertCliEnabled(cli)
            },
            execute: async (call) =>
              withinCliTool(worker.runId, async () =>
                child.ctx.tools.execute({
                  callId: ToolCallId(`cliworker:${call.callId}`),
                  name: call.name,
                  arguments: call.arguments,
                  agent: child,
                  signal: call.signal,
                }),
              ),
            ...(skills
              ? {
                  skills: {
                    list: async (control: AbortSignal) =>
                      (await skills.list(skillOptions(control)))
                        .filter((skill) => skill.invocation.modelInvocable)
                        .map(({ name, description }) => ({
                          name,
                          description,
                        })),
                    get: async (name: string, control: AbortSignal) => {
                      const skill = await skills.get(name, skillOptions(control))
                      return skill?.invocation.modelInvocable ? skill : undefined
                    },
                  },
                }
              : {}),
          })
        } catch (error) {
          resetPresentation()
          throw error
        }
        const owned = lease
        return adoptNativeHarnessLease(owned, resetPresentation, () => {
          if (worker.harnessConversation) {
            worker.harnessConversation = {
              ...worker.harnessConversation,
              capabilities: {
                ...worker.harnessConversation.capabilities,
                tools: owned.capabilities.ready && owned.capabilities.toolCount > 0,
                skills: owned.capabilities.ready && owned.capabilities.skills,
              },
              reasons: {
                ...worker.harnessConversation.reasons,
                tools: owned.capabilities.ready
                  ? '共享当前子 Agent 获准的 DSH 工具与 MCP；每次执行仍走宿主权限和审批链，未接通的模型辅助与递归派遣不可用'
                  : owned.capabilities.reason,
                skills: owned.capabilities.ready
                  ? '当前子 Agent 没有可供模型读取的 DSH 技能'
                  : owned.capabilities.reason,
              },
            }
            this.runtime.storage.save(worker)
          }
          this.runtime.changed()
        })
      })
      scope.effect(() => async () => {
        removePreparation()
        if (this.harnessConversation === bridge) this.harnessConversation = undefined
        if (this.harnessConversationStore === records) this.harnessConversationStore = undefined
        try {
          await bridge.dispose()
        } finally {
          removeModelGuard()
        }
      })
    })
    this.runtime.setFollowupLauncher(async (worker, item, admission, signal) => {
      const agent = await this.parent(worker.parentSessionId)
      const control = AbortSignal.any([signal, this.disposed.signal])
      control.throwIfAborted()
      await this.launch(
        agent,
        worker.title,
        item.prompt,
        worker.preference,
        worker.mode,
        worker.id,
        undefined,
        control,
        undefined,
        admission,
      )
    })
    this.runtime.setQueuedExecutionGuard((worker) => {
      const agent = this.ctx.agents.get(worker.parentSessionId as Agent['id'])
      if (!agent) throw new Error('父会话已关闭，请重新打开后继续发送')
      this.assertExecution(agent)
      if (this.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
      this.runtime.assertCliEnabled(cliOf(worker.preference))
      if (this.accounts.isBusy(cliOf(worker.preference))) throw new Error('请先关闭账号终端')
    })
    ctx.effect(
      () => () => {
        this.disposed.abort()
        return Promise.all([
          this.runtime.close(),
          this.accounts.close(),
          ...[...this.accountParents.values()].map((dispose) => dispose()),
        ])
      },
      'cliworker:lifetime',
    )
    this.registerTools()
    registerCliRouting(ctx)
    ctx.effect(
      () =>
        ctx.systemPrompt.section({
          name: 'cliworker:delegation',
          order: 80,
          text: CLI_DELEGATION_GUIDANCE,
        }),
      'cliworker:guidance',
    )
  }
  private async parent(id: string): Promise<Agent> {
    // Use the same composition-owned resolution policy as native Remote Agent parameters.
    await this.ctx.typert.lookups.get('agent')?.resolve(id)
    const agent = this.ctx.agents.get(id as Agent['id'])
    if (!agent) throw new Error('请先在主对话发送一条消息以激活会话，然后重试')
    return agent
  }
  private project(agent: Agent): string {
    if (!agent.session.header.cwd) throw new Error('此主对话没有工作目录，请先选择项目')
    return projectDirectory(agent.session.header.cwd)
  }
  private assertExecution(agent: Agent): void {
    if (agent.session.header.origin === 'subagent') throw new Error('MVP 只支持主对话下的直接 CLI 子 Agent')
    // agy's terminal sandbox cannot implement Harness's whole-process read-only
    // policy (its native state is writable). Refuse rather than silently weaken it.
    if (agent.ctx.get('planMode')?.get(agent).active)
      throw new Error('请先退出 Harness 规划模式，再运行外部 CLI；本插件不会绕过规划边界')
    if (agent.ctx.get('sandboxPolicy')!.resolve({ session: agent.session }).mode === 'read-only')
      throw new Error('Harness 当前为只读权限；外部 CLI 需要可写运行状态，请先明确切换项目权限')
  }
  private profileResources(): MiniMaxNativeAuthProfiles {
    if (!this.nativeProfiles) {
      const profiles = new MiniMaxNativeAuthProfiles(this.runtime.storage.directory, this.backend, this.options)
      this.nativeProfiles = profiles
      this.ctx.effect(() => () => profiles.dispose())
    }
    return this.nativeProfiles
  }
  private profileSignal(agent: Agent, signal: AbortSignal, write: boolean): AbortSignal {
    if (agent.session.header.origin === 'subagent') throw new Error('原生账号档案只允许所属主对话管理或查看')
    const active = AbortSignal.any([signal, this.disposed.signal]); active.throwIfAborted()
    if (write) this.assertExecution(agent)
    return active
  }
  private profileError(error: unknown, signal?: AbortSignal): Error {
    const code = nativeAuthFailureCode(error)
    if (code === 'CLEANUP_UNCONFIRMED') this.runtime.blockCatalogOnCleanup('minimax', new ProcessCleanupUnconfirmedError())
    return code ? new NativeAuthError(code) : publicOperationError(error, signal)
  }
  private profilesForAgent(agent: Agent, signal: AbortSignal): string {
    try {
      this.profileSignal(agent, signal, false)
      return JSON.stringify({ controlApiVersion: 1, profiles: this.profileResources().list(), validation: 'registered-not-live-checked',
        importScope: 'minimax-account-only', quota: 'unavailable' })
    } catch (error) { throw this.profileError(error, signal) }
  }
  private async importProfileForAgent(agent: Agent, input: unknown, signal: AbortSignal): Promise<string> {
    try {
      const active = this.profileSignal(agent, signal, true), request = parseAuthImportRequest(input)
      this.runtime.assertCliEnabled('minimax'); this.runtime.assertAccountIdle('minimax')
      if (this.accounts.isBusy('minimax')) throw new NativeAuthError('BUSY')
      const { cli: _cli, ...parameters } = request
      const profile = await this.profileResources().import({ ...parameters, signal: active },
        operationSignal => resolveCliExecutable('minimax', this.backend, this.options, operationSignal))
      // A committed receipt remains the result even if cancellation arrives
      // after publication; do not relabel an applied import as uncommitted.
      return JSON.stringify({ controlApiVersion: 1, profile, importScope: 'account-only',
        notice: '仅导入登录及支持的必要连接、隐私和权限设置；不迁业务智能体或历史。本地独立不保证远端refresh family独立，失败导入也可能影响远端续期；无额度或余额证明。' })
    } catch (error) { throw this.profileError(error, signal) }
  }
  private manageProfileForAgent(agent: Agent, input: unknown, signal: AbortSignal): string {
    try {
      this.profileSignal(agent, signal, true)
      const { cli: _cli, ...request } = parseAuthManageRequest(input)
      return JSON.stringify({ controlApiVersion: 1, profile: this.profileResources().manage(request) })
    } catch (error) { throw this.profileError(error, signal) }
  }
  private selectedProfile(cli: CliId, selection?: string, agyAccount?: 'default' | 'lxy'): Readonly<AuthProfilePin> | null | undefined {
    if (selection === undefined) return undefined
    if (cli !== 'minimax' || agyAccount !== undefined) throw new NativeAuthError('UNSUPPORTED')
    return selection === 'native' ? null : this.profileResources().select(selection)
  }
  private async queryProfileCatalog(profile: AuthProfilePin, cli: CliId, backend: ProcessBackend, config: RuntimeConfig, project: string, signal: AbortSignal, expected?: string) {
    profileSelection({ cli, model: 'scope', effort: 'default', authProfile: profile })
    try {
      const executable = await resolveCliExecutable(cli, backend, config, signal)
      return await this.profileResources().run(profile, executable,
        operation => authorizedCatalog(cli, backend, operation.config, project, operation.signal, expected), signal)
    } catch (error) { throw this.profileError(error, signal) }
  }
  private async queryCatalog(...args: Parameters<typeof authorizedCatalog>) {
    try {
      return await authorizedCatalog(...args)
    } catch (error) {
      if (isProcessCleanupUnconfirmedError(error)) this.runtime.blockCatalogOnCleanup(args[0], error)
      throw error
    }
  }
  private async querySelection(...args: Parameters<typeof authorizeSelection>) {
    try {
      const [preference, backend, config, project, signal, expected] = args, profile = profileSelection(preference)
      if (profile) {
        const executable = await resolveCliExecutable('minimax', backend, config, signal)
        return await this.profileResources().run(profile, executable,
          operation => authorizeSelection(preference, backend, operation.config, project, operation.signal, expected), signal)
      }
      return await authorizeSelection(...args)
    } catch (error) {
      if (isProcessCleanupUnconfirmedError(error))
        this.runtime.blockCatalogOnCleanup(cliOf(args[0]), error)
      if (nativeAuthFailureCode(error)) throw this.profileError(error, args[4])
      throw error
    }
  }
  /** Read installation paths without saving discovery or opening a native account/model process. */
  private async resolveDispatchName(name: string, signal: AbortSignal) {
    return resolveAvailableCliName(name, async (cli) => {
      signal.throwIfAborted()
      const saved = this.options.cliExecutablePaths?.read(cli)
      const config = {
        ...this.options,
        cliExecutablePaths: undefined,
        ...(saved?.mode === 'manual' ? { [`${cli}Executable`]: saved.path } : {}),
      }
      try {
        await resolveCliExecutable(cli, this.backend, config, signal)
        signal.throwIfAborted()
        return true
      } catch (error) {
        if (isProcessCleanupUnconfirmedError(error)) {
          this.runtime.blockCatalogOnCleanup(cli, error)
          throw error
        }
        signal.throwIfAborted()
        // A missing manually configured entry is a broken selection, not absence.
        if (!saved || saved.mode !== 'manual') {
          if (
            !configuredCliExecutable(cli, config) &&
            (error instanceof WindowsCliNotFoundError ||
              error instanceof SubprocessExecutableNotFoundError ||
              ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException)?.code ?? ''))
          )
            return false
        }
        throw error
      }
    })
  }
  private async chooseQoderVariant(agent: Agent, callerSignal: AbortSignal, name: string) {
    const signal = AbortSignal.any([callerSignal, this.disposed.signal])
    signal.throwIfAborted()
    const project = this.project(agent)
    const key = JSON.stringify([agent.id, project, 'qoder-variant'])
    const waits = (this.dispatchWaits ??= new Map())
    const previous = waits.get(key) ?? Promise.resolve()
    let release!: () => void
    const owned = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => owned)
    waits.set(key, tail)
    void tail.then(() => {
      if (waits.get(key) === tail) waits.delete(key)
    })
    this.pending.set(agent.id, (this.pending.get(agent.id) ?? 0) + 1)
    this.runtime.changed()
    try {
      await waitForInput(previous, signal)
      this.assertExecution(agent)
      const resolution = await this.resolveDispatchName(name, signal)
      signal.throwIfAborted()
      let cli: 'qoder' | 'qodercn'
      if (resolution.status === 'resolved' && (resolution.cli === 'qoder' || resolution.cli === 'qodercn'))
        cli = resolution.cli
      else if (resolution.status === 'ambiguous')
        throw new Error('CLI_AMBIGUOUS：同时安装 Qoder 和 Qoder CN，请显式传 cli=qoder国际版 或 cli=qodercn；未创建 Worker，不会询问用户')
      else throw new Error('未找到 Qoder 或 Qoder CN 安装，请先安装或配置 CLI 路径；任务尚未启动')
      signal.throwIfAborted()
      this.assertExecution(agent)
      if (this.project(agent) !== project) throw new Error('项目已变更，请重新选择')
      this.runtime.assertCliEnabled(cli)
      return cli
    } finally {
      release()
      const pending = (this.pending.get(agent.id) ?? 1) - 1
      if (pending) this.pending.set(agent.id, pending)
      else this.pending.delete(agent.id)
      this.runtime.changed()
    }
  }
  /** One lock for native first selection and explicit changes to this parent's confirmed setup. */
  private async withDispatchSetup<T>(agent: Agent, callerSignal: AbortSignal, cli: CliId, apply: (project: string, signal: AbortSignal) => Promise<T>): Promise<T> {
    const signal = AbortSignal.any([callerSignal, this.disposed.signal])
    signal.throwIfAborted()
    this.runtime.assertCliEnabled(cli)
    const project = this.project(agent)
    const key = JSON.stringify([agent.id, project, cli])
    const waits = (this.dispatchWaits ??= new Map())
    const previous = waits.get(key) ?? Promise.resolve()
    let release!: () => void
    const owned = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => owned)
    waits.set(key, tail)
    void tail.then(() => {
      if (waits.get(key) === tail) waits.delete(key)
    })
    this.pending.set(agent.id, (this.pending.get(agent.id) ?? 0) + 1)
    this.runtime.changed()
    try {
      await waitForInput(previous, signal)
      signal.throwIfAborted()
      this.assertExecution(agent)
      this.runtime.assertCliEnabled(cli)
      return await apply(project, signal)
    } finally {
      release()
      const pending = (this.pending.get(agent.id) ?? 1) - 1
      if (pending) this.pending.set(agent.id, pending)
      else this.pending.delete(agent.id)
      this.runtime.changed()
    }
  }
  private async controlCli(name: string, signal: AbortSignal): Promise<CliId> {
    if (!isGenericQoderName(name)) return requireCliName(name)
    const result = await this.resolveDispatchName(name, signal)
    if (result.status !== 'resolved') throw new Error('请明确使用 Qoder 或 Qoder CN，模型查询不会代答版本选择')
    return result.cli
  }
  private async conversationCatalog(agent: Agent, cli: CliId, signal: AbortSignal, agyAccount?: 'default' | 'lxy', authProfile?: string): Promise<Catalog> {
    const control = AbortSignal.any([signal, this.disposed.signal])
    control.throwIfAborted()
    if (agent.session.header.origin === 'subagent') throw new Error('需要所属主对话 Agent')
    if (agyAccount !== undefined && cli !== 'antigravity') throw new Error('agy_account 仅适用于 Antigravity')
    const project = this.project(agent)
    this.runtime.assertCliEnabled(cli)
    if (this.accounts.isBusy(cli)) throw new Error('请先关闭账号终端')
    const selected = this.selectedProfile(cli, authProfile, agyAccount)
    const setup = this.runtime.storage.conversationSetup(agent.id, project, cli, selected)
    const profile = selected === undefined ? setup?.preference.authProfile : selected ?? undefined
    const explicitAccount = agyAccount !== undefined || authProfile !== undefined
    const config = explicitAccount ? { ...this.options, agyAccount }
      : setup ? agyConfigForPreference(this.options, setup.preference) : this.options
    const cache = explicitAccount || profile ? undefined : (this.settingsCatalogs ??= new SettingsCatalogCache(this.runtime.storage.directory))
    const revision = cache?.revision(cli) ?? 0
    // Explicit discovery is not a rebind. Native lookup still checks identity before/after discovery.
    const result = profile
      ? await this.queryProfileCatalog(profile, cli, this.backend, config, project, control, explicitAccount ? undefined : setup?.binding)
      : await this.queryCatalog(cli, this.backend, config, project, control, explicitAccount ? undefined : setup?.binding)
    control.throwIfAborted()
    if (this.project(agent) !== project) throw new Error('项目已变更，请重试')
    this.runtime.assertCliEnabled(cli)
    if (!explicitAccount && setup && result.binding !== setup.binding) throw new Error(ACCOUNT_CHANGED)
    if (result.catalog.executionUnavailable) throw new Error(result.catalog.executionUnavailable)
    if (!result.catalog.models.length) throw new Error(result.catalog.notice || '当前账号没有可用模型')
    cache?.remember(project, result, revision)
    return result.catalog
  }
  private async configureConversation(agent: Agent, cli: CliId, model: string, effort: string | undefined, signal: AbortSignal, agyAccount?: 'default' | 'lxy', authProfile?: string) {
    this.assertExecution(agent)
    return this.withDispatchSetup(agent, signal, cli, async (project, control) => {
      const selected = this.selectedProfile(cli, authProfile, agyAccount)
      const current = this.runtime.storage.conversationSetup(agent.id, project, cli, selected)
      if (!current) throw new Error('FIRST_SELECTION_REQUIRED：本父会话没有完整派遣设定；请通过 cliworker_start 的 model、effort、可选 role 参数建立设定，不会弹出选型问题；未创建 Worker')
      const original = JSON.stringify(current)
      const accountOverride = cli === 'antigravity' && agyAccount !== undefined
      const catalogResult = accountOverride
        ? await this.queryCatalog(cli, this.backend, { ...this.options, agyAccount }, project, control)
        : { catalog: await this.conversationCatalog(agent, cli, control, undefined, authProfile) }
      const catalog = catalogResult.catalog
      const retainedAccount = accountOverride ? agyAccount : current.preference.agyAccount
      const selection = preferenceSchema.parse({ cli, model, effort: effort ?? 'default', ...(current.preference.authProfile ? { authProfile: current.preference.authProfile } : {}), ...(cli === 'antigravity' && retainedAccount !== undefined ? { agyAccount: retainedAccount } : {}) })
      validatePreference(selection, catalog)
      const preference = resolveModel(selection, catalog.models)
      if (!catalog.models.some(choice => choice.id === model) && preference.model !== model)
        throw new Error('精确模型标识与思考强度不匹配，未修改配置')
      const selectedBinding = 'binding' in catalogResult ? catalogResult.binding : current.binding
      const checked = await this.querySelection(preference, this.backend, agyConfigForPreference(this.options, preference), project, control, selectedBinding)
      control.throwIfAborted()
      this.assertExecution(agent)
      this.runtime.assertCliEnabled(cli)
      if (this.project(agent) !== project) throw new Error('项目已变更，请重试')
      if (this.accounts.isBusy(cli)) throw new Error('请先关闭账号终端')
      if (checked.binding !== selectedBinding) throw new Error(ACCOUNT_CHANGED)
      if (checked.preference.model !== preference.model) throw new Error('模型与思考强度不匹配')
      if (JSON.stringify(this.runtime.storage.conversationSetup(agent.id, project, cli, selected)) !== original)
        throw new Error('本会话确认设定已变化，未覆盖新设定')
      this.runtime.storage.setConversationSetup(agent.id, project, { ...current, preference, binding: checked.binding })
      return { controlApiVersion: 1, cli, scope: 'current-parent-project-cli', configuredModel: preference.model,
        configuredEffort: preference.effort, role: current.role?.name ?? null, appliesTo: 'new-workers-only', executed: false }
    })
  }
  /** Agent-controlled setup: validate explicit parameters or reuse a complete setup, never ask. */
  private async chooseDispatch(agent: Agent, callerSignal: AbortSignal, cli: CliId, mode?: TaskMode, expectedModel?: string, agyAccount?: 'default' | 'lxy', directModel?: string, directEffort?: Effort, directRole?: string, authProfile?: string): Promise<DispatchSetup> {
    return this.withDispatchSetup(agent, callerSignal, cli, async (project, signal) => {
      const selected = this.selectedProfile(cli, authProfile, agyAccount)
      const current = this.runtime.storage.conversationSetup(agent.id, project, cli, selected)
      const original = JSON.stringify(current)
      const saved = current ?? this.runtime.storage.dispatchSetup(project, cli, selected ?? undefined)
      const profile = selected === undefined ? saved?.preference.authProfile : selected ?? undefined
      const accountOverride = cli === 'antigravity' && agyAccount !== undefined || authProfile !== undefined
      if (!directModel && !saved)
        throw new Error('MODEL_REQUIRED：请先调用 cliworker_models({cli})，再用 model、effort 和可选 role 调用 cliworker_start；未创建 Worker，不会弹出选型问题')
      if (!directModel && !directEffort && expectedModel !== undefined && saved?.preference.model !== expectedModel)
        throw new Error('预期模型与本会话已确认选型不匹配；请先显式配置或提供 model，未创建 Worker')
      const rolePreset = directRole !== undefined && directRole !== 'none'
        ? this.runtime.storage.rolePresets().find(preset => preset.id === directRole) : undefined
      if (directRole !== undefined && directRole !== 'none' && !rolePreset)
        throw new Error('ROLE_NOT_FOUND：请调用 cliworker_roles 查询精确角色 ID，或传 role=none；未创建 Worker')
      const snapshot = rolePreset ? roleSnapshot(rolePreset) : null
      const selectedAccount = accountOverride ? agyAccount : saved?.preference.agyAccount
      const scopedConfig = cli === 'antigravity' && selectedAccount !== undefined
        ? { ...this.options, agyAccount: selectedAccount } : this.options
      this.settingsCatalogs ??= new SettingsCatalogCache(this.runtime.storage.directory)
      const catalogRevision = this.settingsCatalogs.revision(cli)
      const { catalog, binding } = profile
        ? await this.queryProfileCatalog(profile, cli, this.backend, scopedConfig, project, signal, !directModel && !accountOverride ? saved?.binding : undefined)
        : await this.queryCatalog(cli, this.backend, scopedConfig, project, signal, !directModel && !accountOverride ? saved?.binding : undefined)
      signal.throwIfAborted()
      this.runtime.assertCliEnabled(cli)
      if (catalog.executionUnavailable) throw new Error(catalog.executionUnavailable)
      if (catalog.allowedModes && (!mode || !catalog.allowedModes.includes(mode)))
        throw new Error('OpenCode v2 当前仅支持显式只读纯文本，请使用 read_only；编辑和工具尚未开放')
      if (!profile) this.settingsCatalogs.remember(project, { catalog, binding }, catalogRevision)
      if (!directModel && !accountOverride && saved?.binding !== binding) throw new Error(ACCOUNT_CHANGED)
      if (!directModel && directEffort === undefined) validatePreference(saved!.preference, catalog)
      const model = directModel ?? saved!.preference.model
      const choice = catalog.models.find(item => item.id === model || Object.values(item.variants ?? {}).includes(model))
      if (!choice?.efforts?.length) throw new Error('MODEL_UNAVAILABLE：精确模型不在当前原生目录；请用 cliworker_models 查询后补参，未创建 Worker')
      const reusableEffort = saved?.binding === binding && model === saved.preference.model && choice.efforts.includes(saved.preference.effort)
        ? saved.preference.effort : undefined
      const effort = directEffort ?? reusableEffort ?? (choice.efforts.includes('default') ? 'default' : choice.efforts.length === 1 ? choice.efforts[0] : undefined)
      if (effort === undefined) throw new Error('EFFORT_REQUIRED：该模型支持多个强度且没有 default，请按 cliworker_models 的 efforts 显式提供 effort；未创建 Worker')
      const preference = resolveModel(preferenceSchema.parse({ cli, model, effort, ...(profile ? { authProfile: profile } : {}),
        ...(cli === 'antigravity' && selectedAccount !== undefined ? { agyAccount: selectedAccount } : {}) }), catalog.models)
      if (directModel && !catalog.models.some(item => item.id === directModel) && preference.model !== directModel)
        throw new Error(directEffort === undefined ? 'EFFORT_REQUIRED：精确模型变体需要匹配的 effort，请查询目录；未创建 Worker' : '精确模型标识与思考强度不匹配；未创建 Worker')
      if (!directModel && !directEffort && preference.model !== saved!.preference.model)
        throw new Error('已确认模型与当前目录的思考强度不匹配；请显式提供 model 和 effort，未创建 Worker')
      if (expectedModel !== undefined && preference.model !== expectedModel)
        throw new Error('预期模型与本次精确选型不匹配；未创建 Worker')
      const role = directRole !== undefined ? snapshot : saved?.binding === binding ? structuredClone(saved.role) : null
      const checked = await this.querySelection(preference, this.backend, scopedConfig, project, signal, binding)
      if (checked.binding !== binding) throw new Error(ACCOUNT_CHANGED)
      if (checked.preference.model !== preference.model) throw new Error('模型与思考强度已变更；未创建 Worker')
      signal.throwIfAborted()
      this.assertExecution(agent)
      this.runtime.assertCliEnabled(cli)
      if (this.project(agent) !== project) throw new Error('项目已变更，请重新调用')
      if (this.accounts?.isBusy(cli)) throw new Error('请先关闭账号终端')
      if (JSON.stringify(this.runtime.storage.conversationSetup(agent.id, project, cli, selected)) !== original)
        throw new Error('本会话设定已变化；未覆盖新设定')
      const setup: DispatchSetup = { preference, role, binding }
      if (directModel !== undefined || directEffort !== undefined || directRole !== undefined || accountOverride)
        this.runtime.storage.setDispatchSetup(project, setup)
      this.runtime.storage.setConversationSetup(agent.id, project, setup)
      ;(this.selectionBindings ??= new WeakMap()).set(preference, binding)
      ;(this.selectionProjects ??= new WeakMap()).set(preference, project)
      return setup
    })
  }
  private async launch(
    agent: Agent,
    title: string,
    prompt: string,
    preference: Preference,
    mode: TaskMode,
    workerId?: string,
    identity?: { agentName?: string; role?: RoleSnapshot },
    signal: AbortSignal = this.disposed.signal,
    restartSourceId?: string,
    queuedAdmission?: { id: string; expectedRunId: string; priority?: boolean },
    preparationId?: string,
    submissionId?: string,
    attachments?: readonly NativeAttachment[],
    expectation?: FollowupExpectation,
  ): Promise<string> {
    if (workerId && !preparationId)
      return this.runtime.prepareFollowup(
        agent.id,
        workerId,
        signal,
        (control, id) =>
          this.launch(
            agent,
            title,
            prompt,
            preference,
            mode,
            workerId,
            identity,
            control,
            restartSourceId,
            queuedAdmission,
            id,
            submissionId,
            attachments,
            expectation,
          ),
        queuedAdmission?.priority ? queuedAdmission.id : undefined,
      )
    this.assertExecution(agent)
    if (workerId && expectation) this.runtime.assertFollowupExpectation(agent.id, workerId, expectation)
    if (!workerId && expectation?.expectedModel !== undefined && expectation.expectedModel !== preference.model) throw new Error('预期模型与新任务明确选型不匹配；未创建 Worker')
    this.runtime.assertCliEnabled(cliOf(preference))
    if (this.accounts.isBusy(cliOf(preference)))
      throw new Error('此 CLI 正在管理账号，请先关闭账号终端再启动任务')
    const project = this.project(agent)
    const selectedProject = this.selectionProjects?.get(preference)
    if (!workerId && selectedProject && selectedProject !== project) throw new Error('项目已变更，请重新选择')
    const expected = workerId
      ? this.runtime.storage.accountBinding(workerId)
      : this.selectionBindings?.get(preference)
    if (workerId && !expected) {
      const worker = this.runtime.get(agent.id, workerId)
      if (worker.conversationId || !isUserInterrupted(worker)) throw new Error(this.runtime.missingAccountBindingNotice(workerId))
    }
    const { binding, preference: authorizedPreference } = await this.querySelection(
      preference,
      this.backend,
      this.options,
      project,
      signal,
      expected,
    )
    if (authorizedPreference.model !== preference.model) throw new Error('模型与思考强度不匹配，请重新选择')
    signal.throwIfAborted()
    this.assertExecution(agent)
    this.runtime.assertCliEnabled(cliOf(preference))
    if (this.accounts.isBusy(cliOf(preference))) throw new Error('请先关闭账号终端')
    if (this.project(agent) !== project) throw new Error('项目已变更，请重新选择')
    if (restartSourceId) this.runtime.assertLegacyRestart(agent.id, restartSourceId)
    if (workerId && expectation) this.runtime.assertFollowupExpectation(agent.id, workerId, expectation)
    if (!workerId && expectation?.expectedModel !== undefined && expectation.expectedModel !== authorizedPreference.model) throw new Error('预期模型与本轮授权选型不匹配；未创建 Worker')
    let submission: Submission | undefined
    const id = agent.ctx.get('jobs')!.start({
      kind: 'cliworker',
      owner: agent.id,
      label: `${CLI_LABELS[cliOf(preference)]} · ${title} · ${workerId ? '续聊' : '新任务'}：${prompt.replace(/\s+/g, ' ').slice(0, 100)}`,
      outputLimitBytes: 12000,
      run: () => {
        const submitted = this.runtime.submit(
          agent.id,
          project,
          title,
          prompt,
          preference,
          mode,
          workerId,
          identity,
          binding,
          queuedAdmission,
          preparationId,
          submissionId,
          attachments,
          expectation,
        )
        submission = submitted
        return {
          cancel: submitted.cancel,
          done: submitted.done.then((worker) => ({
            status:
              worker.status === 'completed'
                ? ('completed' as const)
                : worker.status === 'interrupted'
                  ? ('killed' as const)
                  : ('failed' as const),
            detail: worker.error,
            result: JSON.stringify({
              cli: cliOf(worker.preference),
              workerId: worker.id,
              agentName: workerName(worker),
              runId: worker.runId,
              task: prompt.slice(0, 300),
              status: worker.status,
              response: worker.lastResult,
              error: worker.error,
              guidance:
                worker.status === 'uncertain'
                  ? '结果待核实；请先核查本轮输出和实际产物，不要自动重试。'
                  : undefined,
            }),
          })),
        }
      },
    })
    if (!submission) throw new Error('Harness did not publish the worker job')
    this.nativeRunDone.set(submission.worker.runId, submission.done)
    const runId = submission.worker.runId
    void submission.done.then(
      () => {
        this.nativeRunDone.delete(runId)
      },
      () => {
        this.nativeRunDone.delete(runId)
      },
    )
    try {
      this.runtime.attachJob(submission.worker, id)
    } catch (error) {
      // Admission already happened. Do not leave a process running without a
      // receipt when the job binding cannot be persisted.
      const admitted = submission
      const outcomes = await Promise.allSettled([
        Promise.resolve().then(() => admitted.cancel()),
        admitted.done,
      ])
      const failures = outcomes.filter((item): item is PromiseRejectedResult => item.status === 'rejected')
      if (failures.length)
        throw new AggregateError([error, ...failures.map((item) => item.reason)], '任务登记失败；取消或清理报告异常')
      throw error
    }
    return JSON.stringify({
      cli: cliOf(submission.worker.preference),
      workerId: submission.worker.id,
      agentName: workerName(submission.worker),
      runId: submission.worker.runId,
      jobId: id,
      status: submission.worker.status,
      model: submission.worker.preference.model,
      effort: submission.worker.preference.effort,
    })
  }
  private waitHarnessRun(record: HarnessConversationRecord, runId: string): Promise<Worker> {
    const running = this.nativeRunDone.get(runId)
    if (running) return running.then((worker) => structuredClone(worker))
    const worker = this.runtime.get(record.parentSessionId, record.workerId)
    if (worker.runId !== runId) return Promise.reject(new Error('原生会话目标轮次已变化，未重放任务'))
    if (['queued', 'running', 'stopping'].includes(worker.status))
      return Promise.reject(new Error('无法接管缺少完成凭据的运行，请等待现有任务结束'))
    return Promise.resolve(structuredClone(worker))
  }
  /** @param parentSessionId - Owning Harness parent. @param workerId - Existing Worker identity. @param signal - View lifetime. @returns Real native child binding; opening never submits the user task again. */
  @Remote('ensureHarnessConversation')
  async ensureHarnessConversation(
    parentSessionId: string,
    workerId: string,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      const parent = await this.parent(parentSessionId)
      const worker = this.runtime.get(parent.id, workerId)
      if (this.project(parent) !== worker.project) throw new Error('项目已变更，请在原项目打开会话')
      if (!this.harnessConversation) throw new Error('当前 Harness 原生会话服务未就绪')
      const ensured = await this.harnessConversation.ensure(parent, worker, {
        initialRunId: worker.runId,
        signal,
      })
      const current = this.runtime.get(parent.id, workerId)
      const previous = current.harnessConversation
      const binding =
        previous?.sessionId === ensured.sessionId
          ? {
              ...ensured,
              capabilities: {
                ...ensured.capabilities,
                tools: previous.capabilities.tools,
                skills: previous.capabilities.skills,
              },
              reasons: {
                ...ensured.reasons,
                tools: previous.reasons?.tools,
                skills: previous.reasons?.skills,
              },
            }
          : ensured
      current.harnessConversation = binding
      this.runtime.storage.save(current)
      this.runtime.changed()
      return JSON.stringify(binding)
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Exact owning parent. @param workerId - Existing Worker. @param expectedSessionId - Failed display binding shown by this Client. @param signal - Explicit repair lifetime. @returns Replacement display binding; never submits a CLI prompt. */
  @Remote('repairHarnessConversation')
  async repairHarnessConversation(
    parentSessionId: string,
    workerId: string,
    expectedSessionId: string,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      const parent = await this.parent(parentSessionId)
      const worker = this.runtime.get(parent.id, workerId)
      if (this.project(parent) !== worker.project) throw new Error('项目已变更，请在原项目修复显示会话')
      if (!this.harnessConversation) throw new Error('当前 Harness 原生会话服务未就绪')
      if (this.runtime.snapshot(parent.id, workerId).selectedBusy)
        throw new Error('当前任务仍在执行、提交或清理，请结束后再修复显示会话')
      return await this.runtime.prepareFollowup(
        parent.id,
        workerId,
        AbortSignal.any([signal, this.disposed.signal]),
        async (control) => {
          this.repairingDisplays.add(workerId)
          try {
            const binding = await this.harnessConversation!.repairDisplay(
              parent,
              worker,
              expectedSessionId,
              control,
            )
            const current = this.runtime.get(parent.id, workerId)
            current.harnessConversation = binding
            this.runtime.storage.save(current)
            this.runtime.changed()
            return JSON.stringify(binding)
          } finally {
            this.repairingDisplays.delete(workerId)
          }
        },
      )
    } catch (error) {
      throw failure(error)
    }
  }
  private concurrencyForAgent(agent: Agent, signal: AbortSignal, limit?: number): string {
    AbortSignal.any([signal, this.disposed.signal]).throwIfAborted()
    if (agent.session.header.origin === 'subagent') throw new Error('全局并发设置仅供主会话使用')
    if (limit !== undefined) { this.assertExecution(agent); this.runtime.setConcurrencyLimit(limit) }
    const state = this.runtime.concurrencySnapshot(agent.id)
    let reason = state.error
    try { this.assertExecution(agent) } catch (error) { reason ??= String(publicOperationError(error, signal)) }
    return JSON.stringify({ ...state, concurrencyApiVersion: 1, writable: !reason, reason,
      notice: '插件全局运行预算，影响所有 CLI 和父会话；不是厂商配额。占位含准备及清理，降低不停止在途任务。' })
  }
  /** @param parentSessionId - Owning main conversation. @param signal - Cancellation. */
  @Remote('readConcurrency')
  async readConcurrency(parentSessionId: string, signal: AbortSignal): Promise<string> {
    return this.concurrencyForAgent(await this.parent(parentSessionId), signal)
  }
  /** @param parentSessionId - Owning main conversation. @param limit - Explicit global limit 1–12. @param signal - Cancellation. */
  @Remote('configureConcurrency')
  async configureConcurrency(parentSessionId: string, limit: number, signal: AbortSignal): Promise<string> {
    return this.concurrencyForAgent(await this.parent(parentSessionId), signal, limit)
  }
  private registerTools(): void {
    const register = (tool: ToolDefinition) => this.ctx.tools.register(withPublicToolErrors(tool, this.disposed.signal))
    const output = {
      schema: { type: 'string' as const },
      render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
    }
    this.ctx.effect(
      () =>
        register(
          defineTool({
            name: 'cliworker_resolve',
            description: `只读解析明确调用中的 CLI 名称、别名或轻微拼写误差，不启动任务、不读取账号、不保存选型。${CLI_NAME_GUIDANCE}。未知、歧义或多个目标返回简短候选错误，不启动、不额外发问题卡。`,
            parameters: {
              name: {
                type: 'string',
                required: true,
                description: '用户要求调用的 CLI 名称；不是任务内容或模型名称。',
              },
            },
            output,
            isConcurrencySafe: () => true,
            execute: async (args, exec) =>
              JSON.stringify(
                isGenericQoderName(args.name)
                  ? await this.resolveDispatchName(
                      args.name,
                      AbortSignal.any([exec.signal, this.disposed.signal]),
                    )
                  : resolveCliName(args.name),
              ),
          }),
        ),
      'cliworker:resolve',
    )
    this.ctx.effect(
      () =>
        register(
          defineTool({
            name: 'cliworker_start',
            description: `用户明确要求调用外部 CLI 时使用。由 Agent 在调用参数中指定 model、effort、role，不向用户弹选型问题卡。先用 cliworker_models({cli}) 查精确模型/强度；角色用 cliworker_roles 查询。省略选型时复用本父会话或同项目同CLI有效完整设定；无设定且缺model返回MODEL_REQUIRED，不猜模型。首次显式model且省略role表示不使用预设，role=none显式无角色。${CLI_NAME_GUIDANCE}。Qoder双安装歧义须改传cli=qoder国际版或qodercn；不会询问版本。保留账号、权限和并发门禁。返回后台job、workerId、runId和agentName；已有智能体续聊用cliworker_followup。`,
            parameters: {
              cli: {
                type: 'string',
                required: true,
                description: `本次用户明确指定的 CLI 规范 ID 或别名：${CLI_NAME_GUIDANCE}。每次调用必填，Antigravity 也不可省略；不得照搬历史调用中省略 cli 的写法。较长名称仅接受唯一轻微误差；短名须精确，不猜模型。`,
              },
              title: { type: 'string', required: true },
              prompt: { type: 'string', required: true },
              agy_account: { type: 'string', description: 'Antigravity only: default or lxy (agy-lxy). Selects the child HOME without changing the parent or other CLI.' },
              auth_profile: { type: 'string', description: 'MiniMax-only imported profile ID for this new Worker; native explicitly selects the original native source. Omit to reuse only a valid current complete setup/default. Cannot combine agy_account; existing Workers keep their fixed source/version.' },
              model: { type: 'string', description: 'Exact model ID from cliworker_models. Required when no valid complete setup exists; never guessed and no user question is opened.' },
              effort: { type: 'string', description: 'Actual supported effort. Omit to reuse the same model’s valid saved effort, or its advertised default/only effort; ambiguous choices return EFFORT_REQUIRED.' },
              role: { type: 'string', description: 'Exact preset ID from cliworker_roles, or none. Omit to reuse a valid setup’s role; a first explicit model with no setup uses no preset. Existing Workers are not changed.' },
              expected_model: { type: 'string', description: '仅准入前置条件：精确匹配本次参数/有效设定解析后的configuredModel，不代选模型；不匹配零Worker/零prompt/零设定写入。' },
              agent_name: {
                type: 'string',
                description:
                  'Optional user-requested unique worker name within this parent conversation. Otherwise assigned from the CLI short name and an ordinal. Use followup by worker_name to reuse an existing named worker.',
              },
              read_only: {
                type: 'boolean',
                description:
                  'Use native read-only/plan mode; unsupported by Kimi print mode. Omit or false for coding.',
              },
            },
            output,
            timeoutMs: 1800000,
            isConcurrencySafe: () => true,
            execute: async (args, exec) => {
              if (!exec.agent) throw new Error('A parent Agent is required')
              this.assertExecution(exec.agent)
              let cli = requireCliName(args.cli)
              if (isGenericQoderName(args.cli))
                cli = await this.chooseQoderVariant(exec.agent, exec.signal, args.cli)
              const agentName =
                args.agent_name === undefined ? undefined : agentNameSchema.parse(args.agent_name)
              const expectedModel = args.expected_model === undefined ? undefined : validate.string().min(1).max(16384).parse(args.expected_model)
              const agyAccount = args.agy_account === undefined ? undefined : validate.enum(['default', 'lxy']).parse(args.agy_account)
              const directModel = args.model === undefined ? undefined : validate.string().min(1).max(16384).parse(args.model)
              const directEffort = args.effort === undefined ? undefined : validate.enum(EFFORTS).parse(args.effort) as Effort
              const directRole = args.role === undefined ? undefined : validate.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/).parse(args.role)
              if (agyAccount !== undefined && cli !== 'antigravity') throw new Error('agy_account 仅适用于 Antigravity')
              if (cli === 'kimi' && args.read_only) throw new Error('Kimi 非交互模式不支持只读派遣')
              const dispatchSignal = AbortSignal.any([exec.signal, this.disposed.signal])
              const setup = expectedModel === undefined && agyAccount === undefined && directModel === undefined && directEffort === undefined && directRole === undefined && args.auth_profile === undefined
                ? await this.chooseDispatch(exec.agent, dispatchSignal, cli, args.read_only ? 'plan' : 'accept-edits')
                : agyAccount === undefined && directModel === undefined && directEffort === undefined && directRole === undefined && args.auth_profile === undefined
                  ? await this.chooseDispatch(exec.agent, dispatchSignal, cli, args.read_only ? 'plan' : 'accept-edits', expectedModel)
                  : await this.chooseDispatch(exec.agent, dispatchSignal, cli, args.read_only ? 'plan' : 'accept-edits', expectedModel, agyAccount, directModel, directEffort, directRole, args.auth_profile === undefined ? undefined : validate.string().min(1).max(100).parse(args.auth_profile))
              exec.signal.throwIfAborted()
              if (expectedModel !== undefined) {
                if (setup.preference.model !== expectedModel) throw new Error('预期模型与本会话已确认选型不匹配；请先显式配置，未创建 Worker')
                return this.launch(exec.agent, args.title, args.prompt, setup.preference, args.read_only ? 'plan' : 'accept-edits', undefined,
                  { agentName, role: setup.role ?? undefined }, AbortSignal.any([exec.signal, this.disposed.signal]),
                  undefined, undefined, undefined, undefined, undefined, { expectedModel })
              }
              return this.launch(
                exec.agent,
                args.title,
                args.prompt,
                setup.preference,
                args.read_only ? 'plan' : 'accept-edits',
                undefined,
                { agentName, role: setup.role ?? undefined },
                AbortSignal.any([exec.signal, this.disposed.signal]),
              )
            },
          }),
        ),
      'cliworker:start',
    )
    this.ctx.effect(
      () =>
        register(
          defineTool({
            name: 'cliworker_status',
            description:
              'Read the parent conversation’s CLI workers or one worker’s latest result. Background completion is announced automatically.',
            parameters: { worker_id: { type: 'string' }, worker_name: { type: 'string' } },
            output,
            isConcurrencySafe: () => true,
            execute: async (args, exec) => {
              if (!exec.agent) throw new Error('A parent Agent is required')
              if (args.worker_id || args.worker_name) {
                const worker = this.runtime.resolveWorker(exec.agent.id, args.worker_id, args.worker_name)
                return JSON.stringify({ ...worker, agentName: workerName(worker), scheduling: this.runtime.scheduling(worker), concurrency: this.runtime.concurrencySnapshot(exec.agent.id) })
              }
              return JSON.stringify(
                this.runtime.snapshot(exec.agent.id).workers.map((worker) => ({
                  ...worker,
                  agentName: workerName(worker),
                })),
              )
            },
          }),
        ),
      'cliworker:status',
    )
    this.ctx.effect(() => register(defineTool({
      name: 'cliworker_auth_profiles',
      description: '只读列出本机已登记的原生账号档案安全描述，当前仅MiniMax；不读取登录材料、不启动Native、不核实时授权/余额。只限主对话；登记available不等于当前账号可用，既有Worker来源不变。',
      parameters: {}, output, isConcurrencySafe: () => true,
      execute: async (_args, exec) => {
        if (!exec.agent) throw new Error('A parent Agent is required')
        return this.profilesForAgent(exec.agent, exec.signal)
      },
    })), 'cliworker:auth-profiles')
    this.ctx.effect(() => register(defineTool({
      name: 'cliworker_auth_import',
      description: '从用户明确授权的同CLI绝对目录导入原生账号。当前仅MiniMax标准prod cn/en、account-only：登录与支持的必要隐私/权限，不迁业务agents/提示/工作目录/历史/MCP/hooks，不改原账号。须可写非plan主对话。可能运行原生准备/续期，副本可能同远端refresh family；失败也可能影响远端续期，不自动重试。request_id用于精确重放；不接受token/key/任意执行器。只返回安全登记回执，不会切旧Worker或证明额外额度。',
      parameters: { cli: { type: 'string', required: true, description: '当前仅minimax；mcode/mmx是同CLI别名。' }, source_root: { type: 'string', required: true, description: '用户已授权的本机同CLI绝对目录；不是shell别名或凭据文本。' }, region: { type: 'string', required: true, description: '明确cn或en；不猜区域或回退其它账号。' }, label: { type: 'string', required: true }, request_id: { type: 'string', required: true }, profile_id: { type: 'string' }, expected_record_revision: { type: 'number' } },
      output, isConcurrencySafe: () => false,
      execute: async (args, exec) => {
        if (!exec.agent) throw new Error('A parent Agent is required')
        return this.importProfileForAgent(exec.agent, { cli: args.cli, sourceRoot: args.source_root, region: args.region, label: args.label, requestId: args.request_id,
          ...(args.profile_id !== undefined ? { id: args.profile_id } : {}), ...(args.expected_record_revision !== undefined ? { expectedRecordRevision: args.expected_record_revision } : {}) }, exec.signal)
      },
    })), 'cliworker:auth-import')
    this.ctx.effect(() => register(defineTool({
      name: 'cliworker_auth_manage',
      description: '按profile_id及expected_record_revision做CAS改名/启用/停用；当前仅MiniMax，须可写非plan主对话。忙碌拒绝，不删除材料、会话或历史，不换已有Worker来源；停用阻止后续准入而不妨碍owned停止。request_id只回原精确回执，不把重放当重新验权。',
      parameters: { cli: { type: 'string', required: true }, profile_id: { type: 'string', required: true }, expected_record_revision: { type: 'number', required: true }, request_id: { type: 'string', required: true }, label: { type: 'string' }, enabled: { type: 'boolean' } },
      output, isConcurrencySafe: () => false,
      execute: async (args, exec) => {
        if (!exec.agent) throw new Error('A parent Agent is required')
        return this.manageProfileForAgent(exec.agent, { cli: args.cli, id: args.profile_id, expectedRecordRevision: args.expected_record_revision, requestId: args.request_id,
          ...(args.label !== undefined ? { label: args.label } : {}), ...(args.enabled !== undefined ? { enabled: args.enabled } : {}) }, exec.signal)
      },
    })), 'cliworker:auth-manage')
    this.ctx.effect(() => register(defineTool({
      name: 'cliworker_concurrency',
      description: '正式在线管理插件全局并发预算，影响所有 CLI 和父会话，不代表 AGY 或其他厂商配额。省略 limit 只读安全统计（globalActive/globalQueued/limit及本父会话计数），不泄露其他任务。明确传1–12整数先私有持久化再立即调度；默认8。提高释放eligible队列，降低不杀不取消在途任务；同会话/同目录写串行及全部原门禁保持。DSH宿主active-child政策独立，插件12不保证同root可派12；宿主容量满时原Task/run留队，不重复新建或自动改Hostpolicy。写须主会话可写且不在plan，子Agent拒绝；无需重载/重启，不自动修改账号/模型/权限。',
      parameters: { limit: { type: 'number', description: '可选：明确修改全局限制的1–12整数；省略只读。' } }, output,
      isConcurrencySafe: () => false,
      execute: async (args, exec) => {
        if (!exec.agent) throw new Error('A parent Agent is required')
        return this.concurrencyForAgent(exec.agent, exec.signal, args.limit)
      },
    })), 'cliworker:concurrency')
    this.ctx.effect(() => register(defineTool({
      name: 'cliworker_roles',
      description: '只读列出可用于cliworker_start(role)的角色预设精确ID、名称和摘要；不返回提示词正文、不启动任务、不保存设定、不向用户提问。role=none表示不使用预设。',
      parameters: {}, output,
      isConcurrencySafe: () => true,
      execute: async (_args, exec) => {
        if (!exec.agent || exec.agent.session.header.origin === 'subagent') throw new Error('需要所属主对话 Agent')
        AbortSignal.any([exec.signal, this.disposed.signal]).throwIfAborted()
        return JSON.stringify({ controlApiVersion: 1, noRole: 'none', roles: this.runtime.storage.rolePresets().map(({ id, name, summary }) => ({ id, name, summary })) })
      },
    })), 'cliworker:roles')
    this.ctx.effect(() => register(defineTool({
      name: 'cliworker_models',
      description: '只读查询本父会话已有 Worker 或显式cli账号范围的精确模型ID/label/efforts/variants；两种选择器互斥。AGY可在cli查询时显式传agy_account=default或lxy，查询该账号而不沿用失效旧绑定；不重绑定、不建立确认、不启动任务/改偏好。省略账号仍保留原绑定校验，Worker查询不允许账号覆盖。已有Worker换模用configure；新Worker用start或configure_conversation显式选型。目录不是远端权益保证；不从提示词猜模型。',
      parameters: { worker_id: { type: 'string' }, worker_name: { type: 'string' }, cli: { type: 'string', description: '明确 CLI 查询目录；与 worker_id/worker_name 互斥，不建立首次设定。' }, auth_profile: { type: 'string', description: '仅MiniMax显式CLI查询：导入profile ID或native原生默认；不能与Worker selector/agy_account合用，不建立或修改设定。' }, agy_account: { type: 'string', description: '仅用于显式 Antigravity cli 查询：default 或 lxy。只读发现该账号目录，不改已保存设定；不能与 Worker 选择器混用。' } }, output,
      isConcurrencySafe: () => true,
      execute: async (args, exec) => {
        if (!exec.agent || exec.agent.session.header.origin === 'subagent') throw new Error('需要所属主对话 Agent')
        const agyAccount = args.agy_account === undefined ? undefined : validate.enum(['default', 'lxy']).parse(args.agy_account)
        if (agyAccount !== undefined && (args.cli === undefined || args.worker_id !== undefined || args.worker_name !== undefined))
          throw new Error('agy_account 仅用于显式 cli 目录查询，不能与 Worker 选择器同时使用')
        const authProfile = args.auth_profile === undefined ? undefined : validate.string().min(1).max(100).parse(args.auth_profile)
        if (authProfile !== undefined && (args.cli === undefined || args.worker_id !== undefined || args.worker_name !== undefined || agyAccount !== undefined))
          throw new NativeAuthError('INVALID_INPUT')
        if (args.cli !== undefined) {
          if (args.worker_id || args.worker_name) throw new Error('cli 与 Worker 选择器不能同时使用')
          const cli = await this.controlCli(args.cli, exec.signal)
          if (agyAccount !== undefined && cli !== 'antigravity') throw new Error('agy_account 仅适用于 Antigravity')
          const catalog = await this.conversationCatalog(exec.agent, cli, exec.signal, agyAccount, authProfile)
          const setup = this.runtime.storage.conversationSetup(exec.agent.id, this.project(exec.agent), cli)
          const explicitAccount = agyAccount !== undefined || authProfile !== undefined
          return JSON.stringify({ controlApiVersion: 1, cli, scope: explicitAccount ? 'explicit-account-read-only' : 'current-parent-project-cli',
            ...(explicitAccount ? { agyAccount } : {}), firstSelectionConfirmed: !explicitAccount && !!setup,
            configuredModel: explicitAccount ? null : setup?.preference.model ?? null,
            configuredEffort: explicitAccount ? null : setup?.preference.effort ?? null, models: catalog.models, notice: catalog.notice })
        }
        const worker = this.runtime.resolveWorker(exec.agent.id, args.worker_id, args.worker_name)
        const catalog = await this.workerCatalog(exec.agent, worker.id, exec.signal, true)
        const current = this.runtime.get(exec.agent.id, worker.id)
        return JSON.stringify({ controlApiVersion: 1, workerId: current.id, agentName: workerName(current), cli: cliOf(current.preference), runId: current.runId,
          configuredModel: current.preference.model, configuredEffort: current.preference.effort,
          modelControl: current.transport === 'opencode-http-v2' ? 'fixed-new-task' : current.harnessConversation?.capabilities.model === false ? 'unavailable' : 'idle-only',
          models: catalog.models, notice: catalog.notice })
      },
    })), 'cliworker:models')
    this.ctx.effect(() => register(defineTool({
      name: 'cliworker_configure_conversation',
      description: '仅重配当前父会话/project/CLI已有完整设定的模型/强度，保留原角色，不改项目默认、其他父会话或已有Worker。先用cliworker_models的cli查询精确目录；本工具不执行模型。缺设定报FIRST_SELECTION_REQUIRED，此时直接用start的model、effort、可选role参数建立设定；不会向用户提问。成功后普通start首个prompt即新模型，不要先派旧模型空任务再配置。',
      parameters: { cli: { type: 'string', required: true }, model: { type: 'string', required: true }, effort: { type: 'string' }, auth_profile: { type: 'string', description: 'MiniMax profile ID or native; only reconfigure an existing complete setup in that source/version domain, never an existing Worker.' }, agy_account: { type: 'string', description: 'Antigravity only: default or lxy; switches the account route for future new Workers in this parent.' } }, output,
      isConcurrencySafe: () => false,
      execute: async (args, exec) => {
        if (!exec.agent) throw new Error('A parent Agent is required')
        this.assertExecution(exec.agent)
        const cli = await this.controlCli(args.cli, exec.signal)
        const agyAccount = args.agy_account === undefined ? undefined : validate.enum(['default', 'lxy']).parse(args.agy_account)
        if (agyAccount !== undefined && cli !== 'antigravity') throw new Error('agy_account 仅适用于 Antigravity')
        return JSON.stringify(await this.configureConversation(exec.agent, cli, args.model, args.effort, exec.signal, agyAccount,
          args.auth_profile === undefined ? undefined : validate.string().min(1).max(100).parse(args.auth_profile)))
      },
    })), 'cliworker:configure-conversation')
    this.ctx.effect(() => register(defineTool({
      name: 'cliworker_configure',
      description: '显式配置本父会话已完成首次原生选型的空闲 Worker，仅接受 cliworker_models 返回的精确模型 ID 和有效 effort；不执行模型、不改角色/权限/会话或项目默认。缺省 effort 只表示 default，不能代替目录要求。忙碌/待发消息/清理未确认/固定模型拒绝，不自动 stop、clone 或 retry。回执只是后续配置，不是已用该模型完成。',
      parameters: { worker_id: { type: 'string' }, worker_name: { type: 'string' }, model: { type: 'string', required: true }, effort: { type: 'string' } }, output,
      isConcurrencySafe: () => false,
      execute: async (args, exec) => {
        if (!exec.agent) throw new Error('A parent Agent is required')
        this.assertExecution(exec.agent)
        const worker = this.runtime.resolveWorker(exec.agent.id, args.worker_id, args.worker_name)
        const updated = await this.configureSelectedWorker(exec.agent, worker.id,
          preferenceSchema.parse({ cli: cliOf(worker.preference), model: args.model, effort: args.effort ?? 'default' }), exec.signal, true)
        return JSON.stringify({ controlApiVersion: 1, workerId: updated.id, agentName: workerName(updated), cli: cliOf(updated.preference), previousRunId: updated.runId,
          configuredModel: updated.preference.model, configuredEffort: updated.preference.effort, conversationId: updated.conversationId,
          appliesTo: 'next-run', executed: false })
      },
    })), 'cliworker:configure')
    this.ctx.effect(() => register(defineTool({
      name: 'cliworker_result',
      description: '只读读取本父会话 Worker 的指定 runId 公开正文及独立状态；省略 runId 读取当前轮，未知轮不回退 lastResult。长正文用 nextCursor 稳定分页（追加不会混页），保留 failed/interrupted/uncertain 部分正文。configuredModel 与 observedModel 分开，缺证据为 unknown；不得把配置/正文自称当原生模型证明，不自动重试。',
      parameters: { worker_id: { type: 'string' }, worker_name: { type: 'string' }, run_id: { type: 'string' }, cursor: { type: 'string' }, limit: { type: 'number', description: '每页1–8192个UTF-16字符，默认4096；游标后续页保持原预算。' } }, output,
      isConcurrencySafe: () => true,
      execute: async (args, exec) => {
        if (!exec.agent || exec.agent.session.header.origin === 'subagent') throw new Error('需要所属主对话 Agent')
        AbortSignal.any([exec.signal, this.disposed.signal]).throwIfAborted()
        const worker = this.runtime.resolveWorker(exec.agent.id, args.worker_id, args.worker_name)
        return JSON.stringify(workerRunResult(this.runtime.storage, worker, { runId: args.run_id, cursor: args.cursor, limit: args.limit }))
      },
    })), 'cliworker:result')
    this.ctx.effect(
      () =>
        register(
          defineTool({
            name: 'cliworker_followup',
            description:
              'Continue a specific idle CLI worker by worker_id or exact agentName. Retains role, current configured model/effort and CLI conversation; never starts another worker. To change models, use cliworker_models then cliworker_configure first. Optional expected_model/expected_run_id are exact admission preconditions, NOT configuration; mismatch rejects before a new run/prompt. Use cliworker_result with the returned runId for this task, not old latest output.',
            parameters: {
              worker_id: { type: 'string' },
              worker_name: { type: 'string' },
              prompt: { type: 'string', required: true },
              expected_model: { type: 'string', description: '精确匹配配置回执的 configuredModel；不匹配不派遣，不暗中配置。' },
              expected_run_id: { type: 'string', description: '预期的前序 runId；过期拒绝，不应用到新轮。' },
            },
            output,
            isConcurrencySafe: () => true,
            execute: async (args, exec) => {
              if (!exec.agent) throw new Error('A parent Agent is required')
              const worker = this.runtime.resolveWorker(exec.agent.id, args.worker_id, args.worker_name)
              if (args.expected_model === undefined && args.expected_run_id === undefined)
                return this.followup(exec.agent.id, worker.id, args.prompt, exec.signal)
              const expectation = validate.object({ expectedModel: validate.string().min(1).max(16384).optional(), expectedRunId: validate.uuid().optional() }).parse({ expectedModel: args.expected_model, expectedRunId: args.expected_run_id })
              return this.followupSelected(exec.agent, worker.id, args.prompt, exec.signal, expectation)
            },
          }),
        ),
      'cliworker:followup',
    )
    this.ctx.effect(
      () =>
        register(
          defineTool({
            name: 'cliworker_stop',
            description: 'Stop a CLI worker and await cleanup of its managed processes.',
            parameters: { worker_id: { type: 'string' }, worker_name: { type: 'string' } },
            output,
            isConcurrencySafe: () => true,
            execute: async (args, exec) => {
              if (!exec.agent) throw new Error('A parent Agent is required')
              const worker = this.runtime.resolveWorker(exec.agent.id, args.worker_id, args.worker_name)
              return JSON.stringify(await this.runtime.stop(exec.agent.id, worker.id))
            },
          }),
        ),
      'cliworker:stop',
    )
  }
  /** @param parentSessionId - Owning Harness session. @param workerId - Selected worker or empty string. @param signal - Stream lifetime. @returns JSON snapshots, initially and after changes. */
  @Remote({ mode: 'stream' })
  async *watch(parentSessionId: string, workerId: string, signal: AbortSignal): AsyncIterable<string> {
    let wake: (() => void) | undefined
    let dirty = true
    let observedSessionId: string | undefined
    const notify = () => {
      dirty = true
      wake?.()
    }
    const unsubscribe = this.runtime.subscribe(notify)
    const unsubscribeSession = this.ctx.on('session/event', (session, event) => {
      if (session.id === observedSessionId && event.type === 'turn/end') notify()
    }, { global: true })
    const lifetime = AbortSignal.any([signal, this.disposed.signal])
    lifetime.addEventListener('abort', notify)
    try {
      while (!lifetime.aborted) {
        if (!dirty)
          await new Promise<void>((resolve) => {
            wake = resolve
          })
        wake = undefined
        if (lifetime.aborted) return
        dirty = false
        const snapshot = this.runtime.snapshot(parentSessionId, workerId || undefined)
        const selected = snapshot.selected
        const binding = selected?.harnessConversation
        observedSessionId = binding?.parentSessionId === parentSessionId ? binding.sessionId : undefined
        let record = binding && this.harnessConversationStore?.list().find((entry) =>
          entry.sessionId === binding.sessionId && entry.workerId === selected.id && entry.parentSessionId === parentSessionId)
        const events = selected ? this.runtime.storage.history(selected.id) : []
        const needsRecovery = record?.nativeInputs?.some((input) => input.accepted && events.some((event) =>
          event.kind === 'user' && event.queuedFollowupId === input.batchId && event.admittedRunId === event.runId &&
          !record?.turnRuns?.some((entry) => entry.runId === event.runId)))
        let externalTurnAnswer: import('../shared/native-turn-answer.ts').ExternalTurnAnswer | undefined
        if (record && selected && (record.turnRuns?.length || (!snapshot.selectedBusy && needsRecovery))) {
          const query = this.ctx?.get('sessionQuery') as
            | {
                observeSession(
                  id: SessionId,
                  options: { signal: AbortSignal; projectionMode: 'none' },
                ): Promise<Disposable & HarnessTurnObservation>
              }
            | undefined
          if (query) {
            try {
              const observation = await query.observeSession(SessionId(record.sessionId), {
                signal: lifetime,
                projectionMode: 'none',
              })
              try {
                if (!snapshot.selectedBusy && needsRecovery) record = recoverHarnessTurnRuns(record, selected, events, observation)
                externalTurnAnswer = projectExternalTurnAnswer(record, selected, events, observation)
              } finally { observation[Symbol.dispose]() }
            } catch {
              if (lifetime.aborted) return
              // Read failures are not permission to guess or rewrite an old turn.
            }
            if (this.runtime.snapshot(parentSessionId, workerId || undefined).revision !== snapshot.revision) {
              dirty = true
              continue
            }
          }
        }
        yield JSON.stringify({
          ...snapshot,
          ...(selected && binding?.parentSessionId === parentSessionId
            ? {
                externalRequestState: projectRequestState(selected, events),
                externalTurnAnswer,
                externalTurnUsage: projectExternalTurnUsage(
                  record,
                  selected,
                  !!snapshot.selectedBusy,
                  events,
                  (runId) => this.runtime.runUsage(parentSessionId, selected.id, runId),
                  (runId) => this.runtime.runCredits(parentSessionId, selected.id, runId),
                ),
              }
            : {}),
          configuring: this.pending.has(parentSessionId),
        })
      }
    } finally {
      unsubscribe()
      unsubscribeSession()
      lifetime.removeEventListener('abort', notify)
    }
  }
  /** @param parentSessionId - Owning parent session. @param workerId - Worker identity. @param anchor - Stable logical row ID, excluded from the result. @param direction - before or after. @returns JSON historical page, at most 200 rows. */
  @Remote('history')
  async history(
    parentSessionId: string,
    workerId: string,
    anchor: string,
    direction: string,
  ): Promise<string> {
    try {
      return JSON.stringify(this.runtime.history(parentSessionId, workerId, anchor, direction))
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning Harness session. @param signal - Query lifetime. @returns Profile-wide CLI enablement JSON. */
  @Remote('cliSettings')
  async cliSettings(parentSessionId: string, signal: AbortSignal): Promise<string> {
    try {
      const parent = await this.parent(parentSessionId)
      signal.throwIfAborted()
      const settings = this.runtime.storage.cliSettings()
      let project: string
      try {
        project = this.project(parent)
      } catch {
        return JSON.stringify(settings)
      }
      // Reusing the same project's display list in another parent still pins
      // configure() to the original verified account; no CLI query is needed.
      for (const cli of CLI_IDS) {
        const binding = this.settingsCatalogs?.displayBinding(project, cli)
        const key = JSON.stringify([parentSessionId, cli])
        if (binding) (this.displayedBindings ??= new Map()).set(key, binding)
      }
      return JSON.stringify({ ...settings, settingsCache: this.settingsDisplayMetadata(project) })
    } catch (error) {
      throw failure(error)
    }
  }
  private settingsDisplayMetadata(project: string): SettingsCacheMetadata {
    this.settingsInstance ??= randomUUID()
    return {
      policy: 1,
      host: this.settingsInstance,
      project: createHash('sha256').update(project).digest('hex'),
      revisions: Object.fromEntries(
        CLI_IDS.map((cli) => [
          cli,
          `${this.settingsSourceRevisions?.get(cli) ?? 0}:${this.options.cliExecutablePaths?.revision(cli) ?? 0}`,
        ]),
      ) as Record<CliId, string>,
      catalogReady: Object.fromEntries(
        CLI_IDS.map((cli) => [cli, !!this.settingsCatalogs?.displayBinding(project, cli)]),
      ) as Record<CliId, boolean>,
      preferences: Object.fromEntries(
        CLI_IDS.flatMap((cli) => {
          const preference = this.runtime.storage.preference(project, cli)
          return preference ? [[cli, preference]] : []
        }),
      ),
    }
  }
  private invalidateSettingsDisplay(cli: CliId) {
    this.settingsCatalogs?.invalidate(cli)
    const revisions = (this.settingsSourceRevisions ??= new Map())
    revisions.set(cli, (revisions.get(cli) ?? 0) + 1)
  }
  /** @param parentSessionId - Active parent. @param cli - Explicit CLI. @param signal - Read lifetime. @returns Project/CLI running-message preference and native capability. */
  @Remote('runningMessageSettings')
  async runningMessageSettings(parentSessionId: string, cli: string, signal: AbortSignal): Promise<string> {
    try {
      const agent = await this.parent(parentSessionId)
      signal.throwIfAborted()
      return JSON.stringify(
        this.runtime.storage.runningMessageSettings(this.project(agent), validate.enum(CLI_IDS).parse(cli)),
      )
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Active parent. @param cli - Explicit CLI. @param mode - Running submission preference. @param signal - Save lifetime. @returns Saved preference; never starts a CLI. */
  @Remote('saveRunningMessageMode')
  async saveRunningMessageMode(
    parentSessionId: string,
    cli: string,
    mode: string,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      const agent = await this.parent(parentSessionId)
      signal.throwIfAborted()
      const result = this.runtime.storage.setRunningMessageMode(
        this.project(agent),
        validate.enum(CLI_IDS).parse(cli),
        validate.enum(RUNNING_MESSAGE_MODES).parse(mode),
      )
      this.runtime.changed()
      return JSON.stringify(result)
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Active parent. @param signal - Query lifetime. @returns JSON role preset library. */
  @Remote('rolePresets')
  async rolePresets(parentSessionId: string, signal: AbortSignal): Promise<string> {
    try {
      await this.parent(parentSessionId)
      signal.throwIfAborted()
      return JSON.stringify(this.runtime.storage.rolePresets())
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Active parent. @param requestJSON - Preset fields, optional existing id. @param signal - Mutation lifetime. @returns Saved preset JSON. */
  @Remote('saveRolePreset')
  async saveRolePreset(parentSessionId: string, requestJSON: string, signal: AbortSignal): Promise<string> {
    try {
      await this.parent(parentSessionId)
      signal.throwIfAborted()
      const preset = this.runtime.storage.saveRolePreset(JSON.parse(requestJSON))
      this.runtime.changed()
      return JSON.stringify(preset)
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Active parent. @param presetId - Preset to delete. @param signal - Mutation lifetime. @returns Completion. */
  @Remote('deleteRolePreset')
  async deleteRolePreset(parentSessionId: string, presetId: string, signal: AbortSignal): Promise<void> {
    try {
      await this.parent(parentSessionId)
      signal.throwIfAborted()
      this.runtime.storage.deleteRolePreset(presetId)
      this.runtime.changed()
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Worker identity. @param name - Unique readable name. @param signal - Mutation lifetime. @returns Completion. */
  @Remote('renameWorker')
  async renameWorker(
    parentSessionId: string,
    workerId: string,
    name: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      await this.parent(parentSessionId)
      signal.throwIfAborted()
      this.runtime.renameWorker(parentSessionId, workerId, name)
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Worker identity. @param title - Single-line chat title, at most 160 characters. @param signal - Mutation lifetime. @returns Completion. */
  @Remote('renameWorkerTitle')
  async renameWorkerTitle(
    parentSessionId: string,
    workerId: string,
    title: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      await this.parent(parentSessionId)
      signal.throwIfAborted()
      this.runtime.renameWorkerTitle(parentSessionId, workerId, title)
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Worker identity. @param objective - Persistent objective. @param expectedRevision - Current goal revision, or zero when absent. @param signal - Mutation lifetime. @returns WorkerGoal JSON. */
  @Remote('setWorkerGoal')
  async setWorkerGoal(parentSessionId: string, workerId: string, objective: string, expectedRevision: number, signal: AbortSignal): Promise<string> {
    try {
      await this.parent(parentSessionId)
      signal.throwIfAborted()
      return JSON.stringify(this.runtime.setWorkerGoal(parentSessionId, workerId, objective, expectedRevision))
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Worker identity. @param status - Active or paused. @param expectedRevision - Current goal revision. @param signal - Mutation lifetime. @returns WorkerGoal JSON. */
  @Remote('setWorkerGoalStatus')
  async setWorkerGoalStatus(parentSessionId: string, workerId: string, status: 'active' | 'paused', expectedRevision: number, signal: AbortSignal): Promise<string> {
    try {
      await this.parent(parentSessionId)
      signal.throwIfAborted()
      return JSON.stringify(this.runtime.setWorkerGoalStatus(parentSessionId, workerId, status, expectedRevision))
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Worker identity. @param expectedRevision - Current goal revision. @param signal - Mutation lifetime. @returns Completion. */
  @Remote('clearWorkerGoal')
  async clearWorkerGoal(parentSessionId: string, workerId: string, expectedRevision: number, signal: AbortSignal): Promise<void> {
    try {
      await this.parent(parentSessionId)
      signal.throwIfAborted()
      this.runtime.clearWorkerGoal(parentSessionId, workerId, expectedRevision)
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Idle Worker to hide. @param signal - Mutation lifetime. @returns Completion without deleting native data. */
  @Remote('deleteWorker')
  async deleteWorker(parentSessionId: string, workerId: string, signal: AbortSignal): Promise<void> {
    try {
      await this.parent(parentSessionId)
      signal.throwIfAborted()
      this.runtime.deleteWorker(parentSessionId, workerId)
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Deleted Worker identity. @param signal - Mutation lifetime. @returns Completion with the original ID and history. */
  @Remote('restoreWorker')
  async restoreWorker(parentSessionId: string, workerId: string, signal: AbortSignal): Promise<void> {
    try {
      await this.parent(parentSessionId)
      signal.throwIfAborted()
      this.runtime.restoreWorker(parentSessionId, workerId)
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Idle source Worker. @param atMessageId - Completed assistant message, or empty for latest. @param signal - Fork lifetime. @returns Worker and child session identities as JSON. */
  @Remote('forkWorker')
  async forkWorker(parentSessionId: string, workerId: string, atMessageId: string, signal: AbortSignal): Promise<string> {
    try {
      const parent = await this.parent(parentSessionId)
      signal.throwIfAborted()
      if (!this.harnessConversation) throw new Error('Harness CLI 会话桥未就绪')
      return JSON.stringify(await this.runtime.forkWorker(parent, workerId, atMessageId, this.harnessConversation, signal))
    } catch (error) { throw failure(error) }
  }
  /** @param parentSessionId - Owning session. @param cli - Selected CLI. @param enabled - Allow new CLI operations. @param signal - Mutation admission lifetime. @returns Updated profile-wide CLI enablement JSON. */
  @Remote('setCliEnabled')
  async setCliEnabled(
    parentSessionId: string,
    cli: string,
    enabled: boolean,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      await this.parent(parentSessionId)
      signal.throwIfAborted()
      const id = validate.enum(CLI_IDS).parse(cli)
      const next = validate.boolean().parse(enabled)
      // The check, persistence, and account startup reservation are synchronous;
      // a pending managed terminal cannot be disabled during its async startup.
      if (!next && this.accounts.isBusy(id))
        throw new Error('此 CLI 正在管理账号，请先关闭账号终端再关闭 CLI')
      signal.throwIfAborted()
      const settings = this.runtime.setCliEnabled(id, next)
      this.invalidateSettingsDisplay(id)
      return JSON.stringify(settings)
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning main session. @param signal - Read lifetime. @returns Safe registered profile descriptions, not live auth/quota. */
  @Remote('authProfiles')
  async authProfiles(parentSessionId: string, signal: AbortSignal): Promise<string> {
    try { return this.profilesForAgent(await this.parent(parentSessionId), signal) }
    catch (error) { throw failure(error, signal) }
  }
  /** @param parentSessionId - Owning writable main session. @param request - Closed account-only import request JSON, never credentials. @param signal - Full import lifetime. @returns Committed safe receipt JSON. */
  @Remote('authImport')
  async authImport(parentSessionId: string, request: string, signal: AbortSignal): Promise<string> {
    try { return await this.importProfileForAgent(await this.parent(parentSessionId), parseAuthRequestJson(request), signal) }
    catch (error) { throw failure(error, signal) }
  }
  /** @param parentSessionId - Owning writable main session. @param request - Closed CAS management JSON. @param signal - Request lifetime. @returns Safe management receipt JSON. */
  @Remote('authManage')
  async authManage(parentSessionId: string, request: string, signal: AbortSignal): Promise<string> {
    try { return this.manageProfileForAgent(await this.parent(parentSessionId), parseAuthRequestJson(request), signal) }
    catch (error) { throw failure(error, signal) }
  }
  private assertTaskSourceOwner(agent: Agent): void {
    if (this.ctx.agents.get(agent.id) !== agent) throw new Error('所属主会话已关闭或重建，请重新打开设置')
  }
  private taskSourceKey(parent: string, project: string, pin?: AuthProfilePin): string {
    return JSON.stringify([parent, project, 'minimax', pin?.id ?? 'native', pin?.materialRevision ?? null])
  }
  /** @param parentSessionId - Owning main session. @param signal - Metadata lifetime. @returns Safe registry/current selection and write capability, not live authentication. */
  @Remote('authTaskSettings')
  async authTaskSettings(parentSessionId: string, signal: AbortSignal): Promise<string> {
    try {
      const agent = await this.parent(parentSessionId); this.assertTaskSourceOwner(agent); this.profileSignal(agent, signal, false)
      let writable = true; try { this.assertExecution(agent) } catch { writable = false }
      const current = this.runtime.storage.conversationSetup(agent.id, this.project(agent), 'minimax')
      return JSON.stringify({ controlApiVersion: 1, profiles: this.profileResources().list(), current: current?.preference ?? null,
        writable, importSupported: process.platform === 'linux' && process.arch === 'x64', validation: 'registered-not-live-checked' })
    } catch (error) { throw failure(this.profileError(error, signal), signal) }
  }
  /** @param parentSessionId - Owning main session. @param source - Explicit MiniMax profile ID or native. @param signal - Read lifetime. @returns Fresh source-specific catalog and exact material pin, with no saved selection. */
  @Remote('authTaskCatalog')
  async authTaskCatalog(parentSessionId: string, source: string, signal: AbortSignal): Promise<string> {
    try {
      const agent = await this.parent(parentSessionId); this.assertTaskSourceOwner(agent)
      const control = this.profileSignal(agent, signal, false)
      const selected = this.selectedProfile('minimax', validate.string().min(1).max(100).parse(source)), pin = selected ?? undefined
      const project = this.project(agent); this.runtime.assertCliEnabled('minimax')
      if (this.accounts.isBusy('minimax')) throw new NativeAuthError('BUSY')
      const result = pin ? await this.queryProfileCatalog(pin, 'minimax', this.backend, this.options, project, control)
        : await this.queryCatalog('minimax', this.backend, this.options, project, control)
      control.throwIfAborted(); this.assertTaskSourceOwner(agent); this.runtime.assertCliEnabled('minimax')
      if (project !== this.project(agent)) throw new Error('项目已变更，请重新读取')
      const key = this.taskSourceKey(agent.id, project, pin), proofs = this.profileTaskProofs ??= new Map()
      if (!proofs.has(key) && proofs.size >= 64) proofs.delete(proofs.keys().next().value!)
      proofs.set(key, result.binding)
      const saved = this.runtime.storage.conversationSetup(agent.id, project, 'minimax', pin ?? null) ?? this.runtime.storage.dispatchSetup(project, 'minimax', pin)
      return JSON.stringify({ controlApiVersion: 1, source, ...(pin ? { pin } : {}), catalog: result.catalog,
        preference: saved?.binding === result.binding ? saved.preference : null })
    } catch (error) { throw failure(this.profileError(error, signal), signal) }
  }
  /** @param parentSessionId - Owning writable main session. @param request - Closed complete source/model/effort JSON. @param signal - Save lifetime. @returns Parent-only future-task selection, never a Worker execution or project default write. */
  @Remote('authTaskApply')
  async authTaskApply(parentSessionId: string, request: string, signal: AbortSignal): Promise<string> {
    try {
      const agent = await this.parent(parentSessionId); this.assertTaskSourceOwner(agent)
      const control = this.profileSignal(agent, signal, true)
      const input = validate.object({ source: validate.string().min(1).max(100), preference: preferenceSchema.strict() }).strict().parse(parseAuthRequestJson(request))
      const pin = profileSelection(input.preference)
      if (cliOf(input.preference) !== 'minimax' || input.preference.agyAccount !== undefined || (input.source === 'native' ? !!pin : pin?.id !== input.source)) throw new NativeAuthError('INVALID_INPUT')
      return await this.withDispatchSetup(agent, control, 'minimax', async (project, active) => {
        this.assertTaskSourceOwner(agent)
        if (project !== this.project(agent)) throw new Error('项目已变更，请重新打开设置')
        const key = this.taskSourceKey(agent.id, project, pin), expected = this.profileTaskProofs?.get(key)
        if (!expected) throw new Error('请先读取所选账号的模型目录，再应用完整组合')
        if (this.accounts.isBusy('minimax')) throw new NativeAuthError('BUSY')
        const before = JSON.stringify(this.runtime.storage.conversationSetup(agent.id, project, 'minimax'))
        const checked = await this.querySelection(input.preference, this.backend, this.options, project, active, expected)
        active.throwIfAborted(); this.assertTaskSourceOwner(agent); this.assertExecution(agent); this.runtime.assertCliEnabled('minimax')
        if (this.accounts.isBusy('minimax')) throw new NativeAuthError('BUSY')
        if (project !== this.project(agent) || this.profileTaskProofs?.get(key) !== expected) throw new Error('账号目录来源已变化，请重新读取')
        if (JSON.stringify(this.runtime.storage.conversationSetup(agent.id, project, 'minimax')) !== before) throw new Error('当前新任务设定已变化，请重试')
        const previous = this.runtime.storage.conversationSetup(agent.id, project, 'minimax', pin ?? null)
        const role = previous?.binding === checked.binding ? previous.role : null
        this.runtime.storage.setConversationSetup(agent.id, project, { preference: checked.preference, binding: checked.binding, role })
        return JSON.stringify({ controlApiVersion: 1, source: input.source, preference: checked.preference, executed: false })
      })
    } catch (error) { throw failure(this.profileError(error, signal), signal) }
  }
  /** @param parentSessionId - Owning session. @param cli - Selected CLI. @param signal - Query lifetime. @returns Safe account status JSON. */
  @Remote('accountStatus')
  async accountStatus(parentSessionId: string, cli: string, signal: AbortSignal): Promise<string> {
    let queriedCli: CliId | undefined
    try {
      const id = validate.enum(CLI_IDS).parse(cli)
      queriedCli = id
      const project = this.project(await this.parent(parentSessionId))
      signal.throwIfAborted()
      this.runtime.assertCliEnabled(id)
      const status = await this.accounts.status(id, project, signal)
      signal.throwIfAborted()
      this.runtime.assertCliEnabled(id)
      return JSON.stringify(status)
    } catch (error) {
      if (queriedCli && isProcessCleanupUnconfirmedError(error))
        this.runtime.blockCatalogOnCleanup(queriedCli, error)
      throw failure(error, signal)
    }
  }

  private executablePathSnapshot(cli: CliId): CliExecutablePathStatus {
    const saved = this.options.cliExecutablePaths?.read(cli)
    const configured = configuredCliExecutable(cli, this.options)
    const manual = saved?.mode === 'manual'
    return {
      cli,
      path: manual ? saved.path : (configured ?? saved?.path ?? ''),
      source: manual ? 'manual' : configured ? 'configured' : saved ? 'auto' : 'none',
      available: false,
    }
  }
  private async probeExecutablePath(cli: CliId, signal: AbortSignal): Promise<CliExecutablePathStatus> {
    try {
      const path = await resolveCliExecutable(cli, this.backend, this.options, signal)
      signal.throwIfAborted()
      const current = this.executablePathSnapshot(cli)
      return { ...current, path: current.source === 'manual' ? current.path : path, available: true }
    } catch (error) {
      if (isProcessCleanupUnconfirmedError(error)) {
        this.runtime.blockCatalogOnCleanup(cli, error)
        throw error
      }
      signal.throwIfAborted()
      return {
        ...this.executablePathSnapshot(cli),
        error:
          error instanceof WindowsCliInstallationError
            ? error.message
            : 'CLI 路径不可用，请确认填写的是 CLI 文件的完整路径，再刷新重试',
      }
    }
  }
  /** @param parentSessionId - Owning session. @param cli - Selected CLI. @param signal - Query lifetime. @returns Machine-local executable path and availability JSON. */
  @Remote('cliExecutablePath')
  async cliExecutablePath(parentSessionId: string, cli: string, signal: AbortSignal): Promise<string> {
    try {
      await this.parent(parentSessionId)
      const id = validate.enum(CLI_IDS).parse(cli)
      const control = AbortSignal.any([signal, this.disposed.signal])
      control.throwIfAborted()
      // While a CLI is in use, expose its saved selection without probing or
      // replacing an installation under an active task/account terminal.
      try {
        this.runtime.assertAccountIdle(id)
        if (this.accounts.isBusy(id)) throw new Error('请先关闭此 CLI 的账号终端再刷新路径')
      } catch (error) {
        return JSON.stringify({ ...this.executablePathSnapshot(id), error: String(error) })
      }
      return JSON.stringify(await this.probeExecutablePath(id, control))
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning session. @param cli - Selected CLI. @param path - Full file path for manual selection. @param action - manual, refresh or auto. @param signal - Mutation/query lifetime. @returns Saved machine-local path and fresh availability JSON. */
  @Remote('refreshCliExecutablePath')
  async refreshCliExecutablePath(
    parentSessionId: string,
    cli: string,
    path: string,
    action: string,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      await this.parent(parentSessionId)
      const id = validate.enum(CLI_IDS).parse(cli)
      const operation = validate.enum(['manual', 'refresh', 'auto']).parse(action)
      const control = AbortSignal.any([signal, this.disposed.signal])
      control.throwIfAborted()
      this.runtime.assertAccountIdle(id)
      if (this.accounts.isBusy(id)) throw new Error('请先关闭此 CLI 的账号终端再修改路径')
      const store = this.options.cliExecutablePaths
      if (!store) throw new Error('CLI 路径存储尚未就绪')
      if (operation === 'manual') store.setManual(id, path)
      else if (operation === 'auto') store.reset(id)
      this.displayedBindings?.clear()
      this.invalidateSettingsDisplay(id)
      this.runtime.changed()
      return JSON.stringify(await this.probeExecutablePath(id, control))
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning session. @param cli - Selected CLI. @param action - Explicit human action. @param signal - Startup lifetime. @returns Managed account terminal identity and instruction JSON. */
  @Remote('accountStart')
  async accountStart(
    parentSessionId: string,
    cli: string,
    action: string,
    signal: AbortSignal,
  ): Promise<string> {
    return this.startAccount(parentSessionId, cli, action, signal)
  }

  /** @param source - One current CLI-native source, never a filesystem path. */
  @Remote('accountStartForSource')
  async accountStartForSource(
    parentSessionId: string,
    cli: string,
    action: string,
    source: string,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      const selected = validate.enum(['native', 'plugin']).parse(source)
      return this.startAccount(parentSessionId, cli, action, signal, selected)
    } catch (error) {
      throw failure(error)
    }
  }

  /** @param provider - Explicit ZCode native login provider, never a URL or logout source. */
  @Remote('accountStartForProvider')
  async accountStartForProvider(
    parentSessionId: string,
    cli: string,
    action: string,
    provider: string,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      const selected = validate.enum(['bigmodel', 'zai']).parse(provider)
      if (cli !== 'zcode' || action !== 'login') throw new Error('不支持的 ZCode 授权来源')
      return this.startAccount(parentSessionId, cli, action, signal, undefined, selected)
    } catch (error) {
      throw failure(error)
    }
  }

  private async startAccount(
    parentSessionId: string,
    cli: string,
    action: string,
    signal: AbortSignal,
    source?: 'native' | 'plugin',
    provider?: 'bigmodel' | 'zai',
  ): Promise<string> {
    try {
      const id = validate.enum(CLI_IDS).parse(cli)
      const operation = validate.enum(['login', 'logout', 'manage']).parse(action)
      const parent = await this.parent(parentSessionId)
      this.assertExecution(parent)
      this.runtime.assertCliEnabled(id)
      this.runtime.assertAccountIdle(id)
      if (!this.accountParents.has(parent.id)) {
        const dispose = parent.ctx.effect(
          () => () => {
            this.accountParents.delete(parent.id)
            return this.accounts.closeParent(parent.id)
          },
          'cliworker:account-parent',
        )
        this.accountParents.set(parent.id, dispose)
      }
      this.invalidateSettingsDisplay(id)
      return JSON.stringify(
        await this.accounts.start(parent.id, id, operation, this.project(parent), signal, source, provider),
      )
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning session. @param accountId - Account terminal identity. @param signal - Stream lifetime. @returns Ephemeral terminal frame JSON. */
  @Remote({ mode: 'stream' })
  async *accountWatch(
    parentSessionId: string,
    accountId: string,
    signal: AbortSignal,
  ): AsyncIterable<string> {
    try {
      await this.parent(parentSessionId)
      for await (const frame of this.accounts.watch(parentSessionId, accountId, signal))
        yield JSON.stringify(frame)
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning session. @param accountId - Account terminal identity. @param data - Human keyboard input. @returns Input accepted. */
  @Remote('accountWrite')
  async accountWrite(parentSessionId: string, accountId: string, data: string): Promise<boolean> {
    try {
      this.assertExecution(await this.parent(parentSessionId))
      await this.accounts.write(parentSessionId, accountId, data)
      return true
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning session. @param accountId - Account terminal identity. @param cols - Visible columns. @param rows - Visible rows. @returns Resize accepted. */
  @Remote('accountResize')
  async accountResize(
    parentSessionId: string,
    accountId: string,
    cols: number,
    rows: number,
  ): Promise<boolean> {
    try {
      await this.parent(parentSessionId)
      await this.accounts.resize(parentSessionId, accountId, cols, rows)
      return true
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning session. @param accountId - Account terminal identity. @returns Process cleanup completed. */
  @Remote('accountStop')
  async accountStop(parentSessionId: string, accountId: string): Promise<boolean> {
    try {
      await this.accounts.stop(parentSessionId, accountId)
      return true
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Parent session identity. @param signal - Caller lifetime. @returns JSON model catalog and project preference. */
  @Remote('catalog')
  async catalog(parentSessionId: string, signal: AbortSignal): Promise<string> {
    return this.catalogForCli(parentSessionId, 'antigravity', signal)
  }
  /** @param parentSessionId - Parent session identity. @param cli - Selected CLI. @param signal - Caller lifetime. @returns CLI catalog and saved project preference. */
  @Remote('catalogForCli')
  async catalogForCli(parentSessionId: string, cli: string, signal: AbortSignal): Promise<string> {
    return this.settingsCatalog(parentSessionId, cli, signal, false)
  }
  /** @param parentSessionId - Owning parent. @param workerId - Worker whose original account scopes the saved choices. @param signal - Caller lifetime. @returns Saved model choices; only a missing valid directory requires discovery. */
  @Remote('catalogForWorker')
  async catalogForWorker(parentSessionId: string, workerId: string, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.workerCatalog(await this.parent(parentSessionId), workerId, signal))
  }
  /** Same account-scoped core as the UI; Agent queries require a fresh verified directory. */
  private async workerCatalog(agent: Agent, workerId: string, signal: AbortSignal, refresh = false): Promise<Catalog> {
    let queriedCli: CliId | undefined
    try {
      const control = AbortSignal.any([signal, this.disposed.signal])
      control.throwIfAborted()
      if (agent.session.header.origin === 'subagent') throw new Error('只能查询当前主对话所属 Worker')
      const worker = this.runtime.get(agent.id, workerId)
      const cli = cliOf(worker.preference)
      const scopedConfig = agyConfigForPreference(this.options, worker.preference)
      queriedCli = cli
      const expected = this.runtime.storage.accountBinding(workerId)
      if (!expected) throw new Error(this.runtime.missingAccountBindingNotice(workerId))
      this.runtime.assertCliEnabled(cli)
      const profile = profileSelection(worker.preference)
      if (profile) {
        if (this.accounts.isBusy(cli)) throw new Error('请先关闭账号终端')
        const result = await this.queryProfileCatalog(profile, cli, this.backend, this.options, worker.project, control, expected)
        control.throwIfAborted(); this.runtime.get(agent.id, workerId); this.runtime.assertCliEnabled(cli)
        return result.catalog
      }
      this.settingsCatalogs ??= new SettingsCatalogCache(this.runtime.storage.directory)
      let catalog = refresh ? undefined : this.settingsCatalogs.display(worker.project, cli, expected)
      if (!catalog) {
        if (refresh && this.accounts.isBusy(cli)) throw new Error('请先关闭账号终端')
        const result = await this.settingsCatalogs.get({
          cli,
          project: worker.project,
          signal: control,
          refresh,
          selfVerifiedDiscovery: cli === 'qoder' || cli === 'qodercn',
          binding: async () => {
            const current = await readCliAccountBinding(
              cli,
              this.backend,
              scopedConfig,
              worker.project,
              control,
            )
            if (current !== expected) throw new Error(ACCOUNT_CHANGED)
            return current
          },
          discover: () =>
            this.queryCatalog(cli, this.backend, scopedConfig, worker.project, control, expected),
        })
        catalog = result.catalog
      }
      control.throwIfAborted()
      this.runtime.get(agent.id, workerId)
      this.runtime.assertCliEnabled(cli)
      if (refresh && !catalog.models.length) throw new Error(catalog.notice || '当前账号没有可用模型')
      return catalog
    } catch (error) {
      if (queriedCli && isProcessCleanupUnconfirmedError(error))
        this.runtime.blockCatalogOnCleanup(queriedCli, error)
      throw failure(error, signal)
    }
  }
  /** @param parentSessionId - Parent session identity. @param cli - Selected CLI. @param signal - Caller lifetime. @returns Fresh model catalog and saved project preference. */
  @Remote('refreshCatalogForCli')
  async refreshCatalogForCli(parentSessionId: string, cli: string, signal: AbortSignal): Promise<string> {
    return this.settingsCatalog(parentSessionId, cli, signal, true)
  }
  private async settingsCatalog(
    parentSessionId: string,
    cli: string,
    signal: AbortSignal,
    refresh: boolean,
  ): Promise<string> {
    let queriedCli: CliId | undefined
    try {
      const id = validate.enum(CLI_IDS).parse(cli)
      queriedCli = id
      const project = this.project(await this.parent(parentSessionId))
      const control = AbortSignal.any([signal, this.disposed.signal])
      this.runtime.assertCliEnabled(id)
      this.settingsCatalogs ??= new SettingsCatalogCache(this.runtime.storage.directory)
      const { catalog, binding } = await this.settingsCatalogs.get({
        cli: id,
        project,
        signal: control,
        refresh,
        selfVerifiedDiscovery: id === 'qoder' || id === 'qodercn',
        binding: () => readCliAccountBinding(id, this.backend, this.options, project, control),
        discover: () => this.queryCatalog(id, this.backend, this.options, project, control),
      })
      control.throwIfAborted()
      ;(this.displayedBindings ??= new Map()).set(JSON.stringify([parentSessionId, id]), binding)
      this.runtime.assertCliEnabled(id)
      return JSON.stringify({ ...catalog, preference: this.runtime.storage.preference(project, id) })
    } catch (error) {
      if (queriedCli && isProcessCleanupUnconfirmedError(error))
        this.runtime.blockCatalogOnCleanup(queriedCli, error)
      throw failure(error, signal)
    }
  }
  /** @param parentSessionId - Parent session identity. @param selection - JSON model and effort. @param signal - Caller lifetime. @returns Saved JSON preference. */
  @Remote('configure')
  async configure(parentSessionId: string, selection: string, signal: AbortSignal): Promise<string> {
    try {
      const agent = await this.parent(parentSessionId)
      let preference: Preference = preferenceSchema.parse(JSON.parse(selection))
      if (profileSelection(preference)) throw new Error('此入口仅保存原生默认设置；导入档案须使用独立完整选型')
      const project = this.project(agent)
      this.runtime.assertCliEnabled(cliOf(preference))
      const { catalog } = await this.querySelection(
        preference,
        this.backend,
        this.options,
        project,
        signal,
        this.displayedBindings?.get(JSON.stringify([parentSessionId, cliOf(preference)])),
      )
      validatePreference(preference, catalog)
      preference = resolveModel(preference, catalog.models)
      signal.throwIfAborted()
      this.runtime.assertCliEnabled(cliOf(preference))
      this.runtime.storage.setPreference(project, preference)
      this.runtime.changed()
      return JSON.stringify(preference)
    } catch (error) {
      throw failure(error, signal)
    }
  }
  /** @param parentSessionId - Owning session. @param workerId - Idle worker. @param selection - JSON preference from saved choices. @param signal - Caller lifetime. @returns Saved preference; execution performs live authorization. */
  @Remote('configureWorker')
  async configureWorker(
    parentSessionId: string,
    workerId: string,
    selection: string,
    signal: AbortSignal,
  ): Promise<string> {
    return JSON.stringify(await this.configureSelectedWorker(await this.parent(parentSessionId), workerId, preferenceSchema.parse(JSON.parse(selection)), signal))
  }
  /** One settings/Agent commit path; Agent calls additionally refresh live account-scoped choices. */
  private async configureSelectedWorker(agent: Agent, workerId: string, selection: Preference, signal: AbortSignal, verifySource = false): Promise<Worker> {
    try {
      const control = AbortSignal.any([signal, this.disposed.signal])
      control.throwIfAborted()
      this.assertExecution(agent)
      const worker = this.runtime.get(agent.id, workerId)
      const declared = profileSelection(selection), fixed = profileSelection(worker.preference)
      if (declared && JSON.stringify(declared) !== JSON.stringify(fixed)) throw new Error('已有会话不能切换账号档案或材料版本')
      const preference = preferenceSchema.parse({ ...selection, ...(fixed ? { authProfile: fixed } : {}) })
      if (cliOf(preference) !== cliOf(worker.preference)) throw new Error('已有会话不能切换 CLI')
      const expected = this.runtime.storage.accountBinding(workerId)
      if (!expected) throw new Error(this.runtime.missingAccountBindingNotice(workerId))
      this.runtime.assertWorkerModelConfigurable(agent.id, workerId, preference)
      this.assertNativeWorkerSettingsIdle(worker)
      if (this.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
      if (this.accounts.isBusy(cliOf(preference))) throw new Error('请先关闭账号终端')
      this.settingsCatalogs ??= new SettingsCatalogCache(this.runtime.storage.directory)
      const cached = this.settingsCatalogs.display(worker.project, cliOf(preference), expected)
      if (!cached && !verifySource && !fixed) throw new Error('模型目录已失效，请重试读取或在设置中刷新')
      const original = { expectedRunId: worker.runId, expectedModel: worker.preference.model }
      return await this.runtime.prepareFollowup(agent.id, workerId, control, async (prepared, preparationId) => {
        const catalog = verifySource || fixed ? await this.workerCatalog(agent, workerId, prepared, true) : cached!
        validatePreference(preference, catalog)
        const resolved = resolveModel(preference, catalog.models)
        if (verifySource && !catalog.models.some(model => model.id === preference.model) && resolved.model !== preference.model)
          throw new Error('精确模型标识与思考强度不匹配，未修改配置')
        prepared.throwIfAborted()
        this.assertExecution(agent)
        const current = this.runtime.assertFollowupExpectation(agent.id, workerId, original)
        this.runtime.assertWorkerModelConfigurable(agent.id, workerId, resolved, preparationId)
        this.assertNativeWorkerSettingsIdle(current)
        if (this.project(agent) !== current.project) throw new Error('项目已变更，请在原项目继续')
        if (this.accounts.isBusy(cliOf(preference))) throw new Error('请先关闭账号终端')
        return this.runtime.configureWorker(agent.id, workerId, resolved, preparationId)
      })
    } catch (error) { throw failure(error) }
  }
  private assertNativeWorkerSettingsIdle(worker: Worker): void {
    const id = worker.harnessConversation?.sessionId
    if (!id) return
    const child = this.ctx.agents.get(id as Agent['id'])
    if (child && (child.status !== 'idle' || child.inbox.nextTurn.length || child.inbox.nextStep.length))
      throw new Error('请等待原生对话结束，并发送或移除原生待发消息后再修改设置')
  }
  /** Update a cold child's real Session without activating an Agent or delivering input. */
  private async configureColdWorkerPermission(
    parent: Agent,
    worker: Worker,
    selected: TaskMode,
    signal: AbortSignal,
  ): Promise<Worker> {
    const sessionId = SessionId(worker.harnessConversation!.sessionId)
    return this.runtime.prepareFollowup(
      parent.id,
      worker.id,
      AbortSignal.any([signal, this.disposed.signal]),
      async (control, preparationId) => {
        const persistence = this.ctx.get('sessionPersistence')
        const sessions = this.ctx.get('sessions')
        const query = this.ctx.get('sessionQuery')
        const projections = this.ctx.get('sessionProjections')
        if (!persistence || !sessions || !query || !projections)
          throw new Error('原生历史会话服务尚未就绪，未修改权限')
        const validateCurrent = () => {
          control.throwIfAborted()
          if (this.ctx.agents.get(parent.id) !== parent)
            throw new Error('所属主对话已关闭，未修改权限')
          this.assertExecution(parent)
          const current = this.runtime.get(parent.id, worker.id)
          const record = this.harnessConversation?.lookup(sessionId)
          if (
            this.project(parent) !== current.project ||
            current.project !== worker.project ||
            current.harnessConversation?.sessionId !== sessionId ||
            current.harnessConversation.parentSessionId !== parent.id ||
            record?.sessionId !== sessionId ||
            record.workerId !== worker.id ||
            record.parentSessionId !== parent.id
          )
            throw new Error('CLI 子会话所属主对话不匹配，未修改权限')
          this.assertNativeWorkerSettingsIdle(current)
        }
        validateCurrent()
        // The public writer is the exclusive cold-session mutation lease. It
        // also prevents a concurrent native resume from using an older mode.
        const writer = await persistence.open(sessionId, 'write', { signal: control })
        let detach: (() => void) | undefined
        try {
          validateCurrent()
          const read = await writer.read(0, undefined, { signal: control })
          validateCurrent()
          if (
            writer.header.origin !== 'subagent' ||
            writer.header.parentSession !== parent.id ||
            writer.header.cwd !== worker.project ||
            this.ctx.agents.get(sessionId)
          )
            throw new Error('CLI 子会话所属主对话不匹配，未修改权限')
          const session = sessions.prepare(sessionId, {
            seed: read.events,
            meta: structuredClone(writer.header),
            inheritedEventCount: writer.inheritedEventCount,
            eventState: read.eventState,
          })
          const inbox = projections.stateOf(session, 'inbox')
          const turn = projections.stateOf(session, 'turnBoundary')
          const plan = projections.stateOf(session, 'plan')
          if (!inbox || !turn || !plan)
            throw new Error('原生历史会话投影尚未就绪，未修改权限')
          if (plan.running !== null)
            throw new Error('原生规划命令尚未完成，未修改权限')
          if (inbox['next-turn'].length || inbox['next-step'].length || turn.openTurnStartSeq !== null)
            throw new Error('请等待原生对话结束，并发送或移除原生待发消息后再修改设置')
          detach = sessions.enter(session)
          // Native restore may append a lifecycle marker before publication.
          // Read that suffix through the public query rather than private logs.
          const observation = await query.observeSession(sessionId, {
            signal: control,
            projectionMode: 'none',
          })
          try {
            const suffix = observation.events.slice(read.events.length)
            if (suffix.length) await writer.append(suffix, { signal: control })
          } finally { observation[Symbol.dispose]() }
          validateCurrent()
          sessions.announce(session)
          validateCurrent()
          const saved = this.runtime.configureWorkerPermission(parent.id, worker.id, selected, preparationId)
          const sandbox = selected === 'plan' ? 'read-only' :
            parent.ctx.get('sandboxPolicy')!.resolve({ session: parent.session }).mode
          if (parent.ctx.get('sandboxPolicy')!.resolve({ session }).mode !== sandbox)
            setSandboxMode(session, sandbox)
          // This is the native persisted collaboration event. There is no
          // Agent to queue a pending intent or inject a synthetic user message.
          if (plan.active !== (selected === 'plan') || plan.wanted !== null)
            session.append('plan/mode', { active: selected === 'plan' })
          if (!(await sessions.flush(session)))
            throw new Error('原生会话权限持久化服务不可用，请重新读取当前状态')
          return saved
        } finally {
          // Finish the writer even on cancellation/failure before releasing the
          // Session and the outer Worker preparation lease.
          try { await writer.close() } finally { detach?.() }
        }
      },
    )
  }
  /** @param parentSessionId - Owning parent. @param workerId - Exact Worker. @param signal - Read lifetime. @returns Native permission control data; no task or permission change. */
  @Remote('permissionForWorker')
  async permissionForWorker(parentSessionId: string, workerId: string, signal: AbortSignal): Promise<string> {
    try {
      const parent = await this.parent(parentSessionId)
      signal.throwIfAborted()
      const worker = this.runtime.get(parent.id, workerId)
      if (this.project(parent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
      let reason: string | undefined
      try {
        this.assertExecution(parent)
        this.assertNativeWorkerSettingsIdle(worker)
        const snapshot = this.runtime.snapshot(parent.id, worker.id)
        if (snapshot.selectedBusy) throw new Error('请等待本轮结束后再修改权限')
        if (snapshot.queuedFollowups?.length)
          throw new Error('请先发送或取消待发送消息（包含已暂停消息），再修改权限')
      } catch (error) { reason = publicOperationError(error, signal).message }
      const state: WorkerPermissionState = {
        currentValue: worker.mode, options: workerPermissionOptions(worker), writable: !reason, ...(reason ? { reason } : {}),
      }
      return JSON.stringify(state)
    } catch (error) { throw failure(error) }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Exact idle Worker. @param mode - An advertised native CLI mode. @param signal - Save lifetime. @returns Saved Worker; no task is launched. */
  @Remote('configureWorkerPermission')
  async configureWorkerPermission(parentSessionId: string, workerId: string, mode: string, signal: AbortSignal): Promise<string> {
    try {
      const parent = await this.parent(parentSessionId)
      signal.throwIfAborted()
      this.assertExecution(parent)
      const worker = this.runtime.get(parent.id, workerId)
      if (this.project(parent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
      const selected = validate.enum(['plan', 'accept-edits']).parse(mode)
      if (!workerPermissionOptions(worker).some((option) => option.value === selected))
        throw new Error('当前 CLI 通路不支持此权限模式')
      this.assertNativeWorkerSettingsIdle(worker)
      const binding = worker.harnessConversation
      const child = binding && this.ctx.agents.get(binding.sessionId as Agent['id'])
      if (
        binding &&
        (binding.parentSessionId !== parent.id ||
          binding.sessionId === parent.id ||
          (child &&
            (child.session.header.origin !== 'subagent' ||
              child.session.header.parentSession !== parent.id ||
              !this.ctx.agents.isOwnedBy(child.id, parent))))
      )
        throw new Error('CLI 子会话所属主对话不匹配，未修改权限')
      if (binding && !child)
        return JSON.stringify(await this.configureColdWorkerPermission(parent, worker, selected, signal))
      const saved = this.runtime.configureWorkerPermission(parent.id, worker.id, selected)
      if (child) {
        // Keep the real session projection and tool policy aligned with the
        // saved CLI mode while idle; the next run rechecks the same parent policy.
        const sandbox =
          selected === 'plan'
            ? 'read-only'
            : parent.ctx.get('sandboxPolicy')!.resolve({ session: parent.session }).mode
        if (child.ctx.get('sandboxPolicy')!.resolve({ session: child.session }).mode !== sandbox)
          setSandboxMode(child.session, sandbox)
        child.ctx.get('planMode')?.set(child, selected === 'plan')
      }
      return JSON.stringify(saved)
    } catch (error) { throw failure(error) }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Conversation identity. @param requestJSON - Immutable click identity, text, mode and destination. @param signal - Admission lifetime. @returns Exact message acceptance receipt, not native completion. */
  @Remote('submitMessage')
  async submitMessage(
    parentSessionId: string,
    workerId: string,
    requestJSON: string,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      const request = messageSubmissionSchema.parse(JSON.parse(requestJSON))
      const key = `${parentSessionId}:${workerId}:${request.id}`
      const canonical = JSON.stringify(request)
      const submissions = (this.messageSubmissions ??= new Map())
      const prior = submissions.get(key)
      if (prior) {
        if (prior.request === canonical) return await prior.done
        const original = messageSubmissionSchema.parse(JSON.parse(prior.request))
        const promotion =
          original.mode === 'queue' &&
          original.intent === 'running' &&
          request.mode === 'interrupt' &&
          request.intent === 'running' &&
          request.prompt === original.prompt &&
          request.clientId === original.clientId &&
          request.sequence > original.sequence
        if (!promotion) throw new Error('重复提交标识对应的消息不同')
      }
      // Occupancy and the Stop boundary must exist before parent lookup or model preparation awaits.
      const reservation = this.runtime.reserveSubmission(parentSessionId, workerId, request.id)
      const control = AbortSignal.any([signal, this.disposed.signal, reservation.signal])
      const done = (async () => {
        const agent = await this.parent(parentSessionId)
        control.throwIfAborted()
        reservation.assertCurrent()
        this.assertExecution(agent)
        const worker = this.runtime.get(agent.id, workerId)
        if (this.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
        if (this.accounts.isBusy(cliOf(worker.preference))) throw new Error('请先关闭账号终端')
        if (request.intent === 'direct') {
          const receipt = this.runtime.directMessageReceipt(agent.id, workerId, request.prompt, request.id)
          if (receipt) return JSON.stringify({ ...receipt, revision: this.runtime.revision })
          return await this.launch(
            agent,
            worker.title,
            request.prompt,
            worker.preference,
            worker.mode,
            workerId,
            undefined,
            control,
            undefined,
            undefined,
            undefined,
            request.id,
          )
        }
        if (request.mode === 'interrupt')
          return JSON.stringify(
            this.runtime.interruptMessage(
              agent.id,
              workerId,
              request.prompt,
              request.id,
              request.clientId,
              request.sequence,
              control,
            ),
          )
        const receipt = await this.runtime.sendRunningMessage(
          agent.id,
          workerId,
          request.prompt,
          request.expectedRunId,
          request.id,
          control,
          request.mode,
        )
        return JSON.stringify({ ...(receipt ?? { accepted: true }), revision: this.runtime.revision })
      })()
      const operation = { request: canonical, done }
      submissions.set(key, operation)
      try {
        return await done
      } finally {
        if (submissions.get(key) === operation) submissions.delete(key)
        reservation.release()
      }
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Worker to continue after this turn. @param prompt - Unsent message. @param expectedRunId - Run observed by the caller. @param requestId - Stable UUID for retries of this message. @param signal - Admission lifetime. @returns Accepted outbox item JSON. */
  @Remote('queueFollowup')
  async queueFollowup(
    parentSessionId: string,
    workerId: string,
    prompt: string,
    expectedRunId: string,
    requestId: string,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      const agent = await this.parent(parentSessionId)
      signal.throwIfAborted()
      this.assertExecution(agent)
      const worker = this.runtime.get(agent.id, workerId)
      if (this.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
      return JSON.stringify(this.runtime.queueFollowup(agent.id, workerId, prompt, expectedRunId, requestId))
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Current native Worker. @param prompt - Current-run input. @param expectedRunId - Exact target run. @param requestId - Stable steering identity. @param signal - Receipt lifetime. @returns Native acceptance; never creates or schedules a later turn. */
  @Remote('steerMessage')
  async steerMessage(
    parentSessionId: string,
    workerId: string,
    prompt: string,
    expectedRunId: string,
    requestId: string,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      validate.uuid().parse(requestId)
      validate
        .string()
        .min(1)
        .max(100_000)
        .refine((text) => !!text.trim())
        .parse(prompt)
      const observed = this.runtime.get(parentSessionId, workerId)
      if (observed.runId !== expectedRunId) throw new Error('本轮状态已变化，请核对当前运行后发送引导')
      const control = AbortSignal.any([signal, this.disposed.signal])
      const agent = await this.parent(parentSessionId)
      control.throwIfAborted()
      this.assertExecution(agent)
      const worker = this.runtime.get(agent.id, workerId)
      if (this.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
      if (this.accounts.isBusy(cliOf(worker.preference))) throw new Error('请先关闭账号终端')
      await this.runtime.steerMessage(agent.id, workerId, prompt, expectedRunId, requestId, control)
      return JSON.stringify({
        accepted: true,
        requestId,
        runId: expectedRunId,
        revision: this.runtime.revision,
      })
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Active Worker. @param prompt - New message. @param expectedRunId - Observed run. @param requestId - Stable submission UUID. @param signal - Admission lifetime. @returns Accepted submission using the saved mode. */
  @Remote('sendRunningMessage')
  async sendRunningMessage(
    parentSessionId: string,
    workerId: string,
    prompt: string,
    expectedRunId: string,
    requestId: string,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      const agent = await this.parent(parentSessionId)
      signal.throwIfAborted()
      this.assertExecution(agent)
      const worker = this.runtime.get(agent.id, workerId)
      if (this.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
      if (this.accounts.isBusy(cliOf(worker.preference))) throw new Error('请先关闭账号终端')
      const receipt = await this.runtime.sendRunningMessage(
        agent.id,
        workerId,
        prompt,
        expectedRunId,
        requestId,
        signal,
      )
      return JSON.stringify(receipt ?? { accepted: true })
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Current Worker. @param prompt - Message text. @param requestId - Stable message UUID, including a local queue item. @param clientId - Panel source UUID. @param sequence - Increasing click order for this source. @param signal - Admission transport lifetime. @returns JSON durable acceptance receipt; execution proceeds independently of this RPC. */
  @Remote('interruptMessage')
  async interruptMessage(
    parentSessionId: string,
    workerId: string,
    prompt: string,
    requestId: string,
    clientId: string,
    sequence: number,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      const agent = await this.parent(parentSessionId)
      signal.throwIfAborted()
      this.assertExecution(agent)
      const worker = this.runtime.get(agent.id, workerId)
      if (this.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
      if (this.accounts.isBusy(cliOf(worker.preference))) throw new Error('请先关闭账号终端')
      return JSON.stringify(
        this.runtime.interruptMessage(agent.id, workerId, prompt, requestId, clientId, sequence, signal),
      )
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Worker with pending messages. @param queuedId - Explicit priority message. @param expectedRunId - Observed run. @param signal - Admission lifetime. @returns JSON priority request receipt with queuedId and snapshot revision; not confirmation of native delivery. */
  @Remote('interruptQueuedFollowup')
  async interruptQueuedFollowup(
    parentSessionId: string,
    workerId: string,
    queuedId: string,
    expectedRunId: string,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      const agent = await this.parent(parentSessionId)
      signal.throwIfAborted()
      this.assertExecution(agent)
      const worker = this.runtime.get(agent.id, workerId)
      if (this.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
      if (this.accounts.isBusy(cliOf(worker.preference))) throw new Error('请先关闭账号终端')
      await this.runtime.interruptQueuedFollowup(agent.id, workerId, queuedId, expectedRunId, signal)
      return JSON.stringify({ queuedId, revision: this.runtime.revision })
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Owning Worker. @param queuedId - Unsent item identity. @param signal - Mutation lifetime. @returns Completion; already admitted messages cannot be cancelled here. */
  @Remote('cancelQueuedFollowup')
  async cancelQueuedFollowup(
    parentSessionId: string,
    workerId: string,
    queuedId: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const agent = await this.parent(parentSessionId)
      signal.throwIfAborted()
      this.runtime.cancelQueuedFollowup(agent.id, workerId, queuedId)
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Idle Worker with paused messages. @param expectedRunId - Current run identity. @param signal - Mutation lifetime. @returns Explicit queue reactivation; each turn rechecks native authorization. */
  @Remote('retryQueuedFollowups')
  async retryQueuedFollowups(
    parentSessionId: string,
    workerId: string,
    expectedRunId: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const agent = await this.parent(parentSessionId)
      signal.throwIfAborted()
      this.assertExecution(agent)
      const worker = this.runtime.get(agent.id, workerId)
      if (this.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目继续')
      this.runtime.retryQueuedFollowups(agent.id, workerId, expectedRunId)
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Parent session identity. @param workerId - Worker to continue. @param prompt - New task. @param signal - Admission lifetime. @returns Published background receipt. */
  @Remote('followup')
  async followup(
    parentSessionId: string,
    workerId: string,
    prompt: string,
    signal: AbortSignal,
  ): Promise<string> {
    return this.followupSelected(await this.parent(parentSessionId), workerId, prompt, signal)
  }
  private async followupSelected(agent: Agent, workerId: string, prompt: string, signal: AbortSignal, expectation?: FollowupExpectation): Promise<string> {
    try {
      signal.throwIfAborted()
      this.assertExecution(agent)
      const worker = this.runtime.assertFollowupExpectation(agent.id, workerId, expectation)
      this.runtime.assertCliEnabled(cliOf(worker.preference))
      return await this.launch(agent, worker.title, prompt, worker.preference, worker.mode, workerId,
        undefined, signal, undefined, undefined, undefined, undefined, undefined, expectation)
    } catch (error) {
      // Preparation/Stop still relies on the cleanup classification, not just a
      // Remote error string. Preserve the existing asynchronous launch contract.
      if (isProcessCleanupUnconfirmedError(error)) throw error
      throw failure(error, signal)
    }
  }
  /** @param parentSessionId - Owning parent. @param workerId - Idle legacy history without an account binding. @param prompt - Explicit new-dialog task. @param signal - Admission lifetime. @returns JSON background receipt for a fresh Worker. */
  @Remote('restartWorker')
  async restartWorker(
    parentSessionId: string,
    workerId: string,
    prompt: string,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      const agent = await this.parent(parentSessionId)
      signal.throwIfAborted()
      this.assertExecution(agent)
      const worker = this.runtime.assertLegacyRestart(agent.id, workerId)
      if (this.project(agent) !== worker.project) throw new Error('项目已变更，请在原项目新建对话')
      return await this.launch(
        agent,
        worker.title,
        prompt,
        { ...worker.preference },
        worker.mode,
        undefined,
        { role: worker.role ? structuredClone(worker.role) : undefined },
        signal,
        workerId,
      )
    } catch (error) {
      throw failure(error)
    }
  }
  /** @param parentSessionId - Owning Harness session. @param workerId - Worker to stop. @returns Final worker state after cleanup. */
  @Remote('stop')
  async stop(parentSessionId: string, workerId: string): Promise<string> {
    try {
      return JSON.stringify(await this.runtime.stop(parentSessionId, workerId))
    } catch (error) {
      throw failure(error)
    }
  }
}

export default CliWorkerService
