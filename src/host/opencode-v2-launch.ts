import { mkdir } from 'node:fs/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import { prepareNativeWorker } from './native-worker.ts'
import { ProcessCleanupUnconfirmedError, type RuntimeConfig } from './process.ts'
import { openOpenCodeV2Service, serviceMetadata, openCodeV2ModelRef, digest, OpenCodeCompatibilityError, type OpenCodeVersion } from './opencode-v2-service.mjs'
import { readOwnedLedger, saveOwnedLedger, verifySettlement, unsettledOwnedLedgers, OPENCODE_V2_REMOTE_UNCERTAIN } from './opencode-v2-ledger.mjs'
import { reconcileOpenCodeV2Owned } from './native-opencode-v2.mjs'
import type { Preference, TaskMode } from '../shared/types.ts'

export class OpenCodeRemoteUncertainError extends ProcessCleanupUnconfirmedError {
  constructor() { super(); this.name = 'OpenCodeRemoteUncertainError'; this.message = OPENCODE_V2_REMOTE_UNCERTAIN }
}
export async function assertOpenCodeV2RemoteReady(root: string) {
  if ((await unsettledOwnedLedgers(root)).length) throw new OpenCodeRemoteUncertainError()
}
export async function recoverOpenCodeV2Remote(root: string) { return unsettledOwnedLedgers(root, true) }
export async function reconcileOpenCodeV2Remote(root: string, workerId: string) {
  const key = randomBytes(32).toString('hex')
  const result = await reconcileOpenCodeV2Owned(root, workerId, key)
  if (!verifySettlement(result, key)) throw new OpenCodeRemoteUncertainError()
  return result
}
export async function prepareOpenCodeV2Worker(input: {
  executable: string; version: OpenCodeVersion; project: string; preference: Preference; mode: TaskMode; prompt: string
  root: string; workerId: string; runId: string; stateDirectory: string; conversationId?: string
}, config: RuntimeConfig, signal: AbortSignal) {
  if (input.mode !== 'plan' || config.attachments?.length || config.harnessTools) throw new OpenCodeCompatibilityError('OpenCode v2 只开放显式只读纯文本；编辑、附件和工具尚未支持')
  await assertOpenCodeV2RemoteReady(input.root)
  const service = await openOpenCodeV2Service(input.executable, input.version, input.project, signal, { maxBytes: config.maxRunBytes })
  try {
    const metadata = await serviceMetadata(service, signal, { includeAgent: true, maxBytes: config.maxRunBytes })
    const sourcePin = metadata.pins[input.preference.model], agent = metadata.agent?.id
    if (!sourcePin || !agent || input.preference.effort !== 'default') throw new OpenCodeCompatibilityError('OpenCode v2 当前模型、来源或agent不可用')
    const previous = await readOwnedLedger(input.root, input.workerId)
    if (previous && (previous.status !== 'settled' || previous.invalid || !previous.owned || previous.sessionId !== input.conversationId || previous.project !== input.project || previous.sourcePin !== sourcePin || previous.agent !== agent)) throw new OpenCodeCompatibilityError('OpenCode v2 自有会话或来源已经改变，请新建任务')
    if (!previous && input.conversationId) throw new OpenCodeCompatibilityError('OpenCode v2 不接续无自有记录的原生会话或v1历史')
    const key = randomBytes(32).toString('hex')
    const record = { policy: 1, workerId: input.workerId, project: input.project, executable: input.executable, version: input.version.version,
      sessionId: previous?.sessionId ?? `ses_${randomUUID().replaceAll('-', '')}`, marker: previous?.marker ?? randomBytes(32).toString('hex'),
      owned: previous?.owned ?? false, model: openCodeV2ModelRef(input.preference.model), agent, sourcePin, epoch: service.epoch,
      lastSeq: previous?.lastSeq, status: 'prepared', run: { id: input.runId, inputId: `msg_${randomUUID().replaceAll('-', '')}`, payloadDigest: digest({ text: input.prompt, delivery: 'steer', resume: true }), keyHash: digest(key) } }
    await saveOwnedLedger(input.root, record)
    await mkdir(input.stateDirectory, { recursive: true, mode: 0o700 })
    const launch = await prepareNativeWorker({ argv: [input.executable], env: {
      CLIWORKER_OPENCODE_V2_SERVICE: service.credentialsEnvironment(), CLIWORKER_OPENCODE_V2_PROOF_KEY: key,
    } }, { cli: 'opencode', transport: 'opencode-http-v2', project: input.project, preference: input.preference, mode: 'plan', prompt: input.prompt,
      conversationId: input.conversationId, stateDirectory: input.stateDirectory,
      opencodeV2: { root: input.root, workerId: input.workerId, runId: input.runId, sessionId: record.sessionId, epoch: service.epoch } }, config)
    let activated = false, checked = false
    return { ...launch,
      async activate() {
        await service.verify(signal)
        const fresh = await serviceMetadata(service, signal, { includeAgent: true, maxBytes: config.maxRunBytes })
        if (fresh.pins[input.preference.model] !== sourcePin) throw new OpenCodeCompatibilityError('OpenCode v2 实际启动来源已改变')
        record.status = 'pending'; await saveOwnedLedger(input.root, record); activated = true
      },
      async confirmRemoteSettlement() {
        if (!activated) return
        let current: any
        try {
          current = await readOwnedLedger(input.root, input.workerId)
          if (!current || current.run.id !== record.run.id || current.epoch !== record.epoch || !verifySettlement(current, key)) throw new OpenCodeRemoteUncertainError()
          checked = true
        } catch {
          // Persist THIS exact pending run even if the bridge died, a previous
          // proof was replayed, or its ledger was replaced before reporting.
          if (current?.run?.id === record.run.id && current.marker === record.marker && current.epoch === record.epoch && current.sessionId === record.sessionId) {
            record.owned = current.owned === true
            Object.assign(record, { invalid: current.invalid === true })
            Object.assign(record.run, { baseline: current.run.baseline, admissionKnown: current.run.admissionKnown === true, policyViolation: current.run.policyViolation === true })
          }
          record.status = 'uncertain'
          await saveOwnedLedger(input.root, record).catch(() => {})
          throw new OpenCodeRemoteUncertainError()
        } finally { service.close() }
      },
      async cleanup() {
        try {
          if (activated && !checked) throw new OpenCodeRemoteUncertainError()
          await launch.cleanup?.()
        } finally { service.close() }
      },
    }
  } catch (error) { service.close(); throw error }
}
