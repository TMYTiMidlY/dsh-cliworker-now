import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { constants, existsSync, lstatSync, openSync, fstatSync, readSync, closeSync, type Stats } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { foldEvents, cliOf, workerName, type Worker, type WorkerStatus } from '../shared/types.ts'
import { atomicJSON, type WorkerStorage } from './storage.ts'

const terminal = new Set(['completed', 'failed', 'interrupted', 'uncertain'])
const pendingSchema = z.enum(['queued', 'running', 'stopping', 'unknown'])
const cursorSchema = z.tuple([z.literal(1), z.uuid(), z.uuid(), z.number().int().safe().nonnegative(), z.number().int().safe().nonnegative(), z.number().int().min(1).max(8192), pendingSchema, z.string().regex(/^[a-f0-9]{64}$/)])
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const badCursor = () => new Error('结果游标无效、快照已变化或不属于此 Worker/run')
const stamp = (stat: Stats) => [stat.dev, stat.ino, stat.size, stat.mode, stat.uid, stat.nlink, stat.mtimeMs, stat.ctimeMs].join(':')

/** Host-private persisted signing key: paging survives job disposal and Host restart. */
function cursorKey(storage: WorkerStorage): Buffer {
  const path = join(storage.directory, 'result-cursor-key.json')
  if (!existsSync(path)) atomicJSON(path, { policy: 1, key: randomBytes(32).toString('hex') })
  const before = lstatSync(path)
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 256 ||
    process.platform !== 'win32' && ((before.mode & 0o077) !== 0 || before.uid !== process.getuid?.())) throw badCursor()
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  const bytes = Buffer.alloc(257)
  try {
    const opened = fstatSync(fd)
    const size = readSync(fd, bytes, 0, bytes.length, null)
    if (stamp(before) !== stamp(opened) || stamp(opened) !== stamp(fstatSync(fd)) || stamp(before) !== stamp(lstatSync(path)) || size !== before.size) throw badCursor()
    const data = z.object({ policy: z.literal(1), key: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(JSON.parse(bytes.subarray(0, size).toString('utf8')))
    bytes.fill(0)
    return Buffer.from(data.key, 'hex')
  } finally { bytes.fill(0); closeSync(fd) }
}
export interface WorkerResultRequest { runId?: string; cursor?: string; limit?: number }
/** Public persisted events only: never consult raw-wire, credentials or another run's lastResult. */
export function workerRunResult(storage: WorkerStorage, worker: Worker, request: WorkerResultRequest = {}) {
  if (request.runId !== undefined) z.uuid().parse(request.runId)
  if (request.limit !== undefined) z.number().int().min(1).max(8192).parse(request.limit)
  let cursor: z.infer<typeof cursorSchema> | undefined
  let key: Buffer | undefined
  const signature = (value: string) => createHmac('sha256', key ??= cursorKey(storage)).update(value).digest('hex')
  try {
    if (request.cursor !== undefined) {
      if (request.cursor.length > 2048 || !/^[\w-]+\.[a-f0-9]{64}$/.test(request.cursor)) throw badCursor()
      const [encoded, sig] = request.cursor.split('.') as [string, string]
      const raw = Buffer.from(encoded, 'base64url').toString('utf8')
      if (Buffer.from(raw).toString('base64url') !== encoded || !timingSafeEqual(Buffer.from(signature(raw)), Buffer.from(sig))) throw badCursor()
      cursor = cursorSchema.parse(JSON.parse(raw))
      if (cursor[1] !== worker.id || request.runId !== undefined && request.runId !== cursor[2] || request.limit !== undefined && request.limit !== cursor[5]) throw badCursor()
    }
    const runId = cursor?.[2] ?? request.runId ?? worker.runId
    const history = storage.history(worker.id)
    if (!history.some(event => event.runId === runId && event.kind !== 'submission')) throw new Error('指定 runId 不存在或没有保存的公开运行证据')
    const watermark = cursor?.[3] ?? history.at(-1)?.seq ?? 0
    if (watermark > (history.at(-1)?.seq ?? 0) || watermark !== 0 && !history.some(event => event.seq === watermark)) throw badCursor()
    const events = history.filter(event => event.seq <= watermark && event.runId === runId && event.kind !== 'submission')
    if (!events.length) throw badCursor()
    const configurations = events.flatMap(event => event.runConfiguration ? [event.runConfiguration] : [])
    const configured = configurations.length === 1 ? configurations[0] : undefined
    const ends = events.filter(event => event.kind === 'status' && terminal.has(event.state ?? event.text))
    const pending = cursor?.[6] ?? (worker.runId === runId && ['queued', 'running', 'stopping'].includes(worker.status) ? worker.status as 'queued' | 'running' | 'stopping' : 'unknown')
    const end = ends.length === 1 ? ends[0] : undefined
    const status = (end?.runOutcome?.status ?? end?.state ?? (end ? end.text : pending)) as WorkerStatus | 'unknown'
    const rawError = end?.runOutcome?.error ?? (end && ['failed', 'uncertain'].includes(status) && !terminal.has(end.text) ? end.text : undefined)
    const observations = [...new Set(events.flatMap(event => typeof event.observedModel === 'string' && event.observedModel ? [event.observedModel] : []))]
    const observedModel = observations.length === 1 && observations[0]!.length <= 16384 ? observations[0] : undefined
    const evidence = observations.length > 1 ? 'conflicting' : observedModel ? 'native' : 'unknown'
    const hasPublicText = events.some(event => event.kind === 'assistant' && event.text.length > 0)
    const successful = (event: (typeof events)[number]) => event.kind === 'result' && ['SUCCESS', 'COMPLETED'].includes((event.state ?? '').toUpperCase())
    const scopedResult = events.some(event => successful(event) && event.resultScope === 'run')
    const unknownResult = !hasPublicText && !scopedResult && events.some(event => event.kind === 'result' && event.text.length > 0)
    // Failed/unscoped aggregate text may contain earlier answers. Only public
    // stream segments or an explicitly successful run-scoped receipt can fill it.
    const publicEvents = events.filter(event => event.kind !== 'result' || successful(event) && event.resultScope === 'run')
    const body = foldEvents(publicEvents, undefined, configured?.preference.cli ?? cliOf(worker.preference)).filter(row => row.kind === 'assistant').map(row => row.text).join('\n\n')
    const targetModelVerified = !!configured && !!observedModel && evidence === 'native' && configured.preference.model === observedModel
    const metadata = { status, configuredModel: configured?.preference.model ?? null, configuredEffort: configured?.preference.effort ?? null,
      configuredMode: configured?.mode ?? null, observedModel: observedModel ?? null, modelEvidence: evidence,
      modelMatchesConfigured: configured && observedModel ? configured.preference.model === observedModel : null, targetModelVerified,
      notice: targetModelVerified ? null : evidence === 'conflicting' || configured && observedModel ? '原生模型冲突或不匹配，不得计为目标模型完成' : '本轮缺少完整配置/原生模型证据，不能用当前偏好或正文自称补证',
      bodyEvidence: hasPublicText ? 'public-assistant' : scopedResult ? 'successful-run-result' : unknownResult ? 'unknown-result-scope' : 'no-public-body',
      cleanup: end?.runOutcome?.cleanup ?? 'unknown', error: rawError?.slice(0, 4096) ?? null, errorTruncated: !!rawError && rawError.length > 4096,
      partial: status !== 'completed' || unknownResult, completeness: unknownResult ? 'unknown' : status === 'completed' ? 'complete' : terminal.has(status) ? 'partial' : 'snapshot' }
    const digest = hash(JSON.stringify([metadata, body]))
    if (cursor && cursor[7] !== digest) throw badCursor()
    const offset = cursor?.[4] ?? 0, limit = cursor?.[5] ?? request.limit ?? 4096
    if (offset > body.length) throw badCursor()
    let next = Math.min(offset + limit, body.length)
    // Do not split a UTF-16 surrogate pair across pages.
    if (next > offset && next < body.length && /[\uD800-\uDBFF]/.test(body[next - 1]!) && /[\uDC00-\uDFFF]/.test(body[next]!)) next = next - 1 > offset ? next - 1 : next + 1
    const payload = JSON.stringify([1, worker.id, runId, watermark, next, limit, pending, digest])
    return { controlApiVersion: 1, workerId: worker.id, agentName: workerName(worker), runId, ...metadata, configurationEvidence: configured ? 'run-admission' : 'unknown',
      body: body.slice(offset, next), offset, totalCharacters: body.length, snapshot: { eventWatermark: watermark, digest },
      hasMore: next < body.length, nextCursor: next < body.length ? `${Buffer.from(payload).toString('base64url')}.${signature(payload)}` : null }
  } finally { key?.fill(0) }
}
