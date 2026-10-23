import { mkdir, lstat, open, rename, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { dirname, isAbsolute, join, parse, resolve } from 'node:path'
import { readPrivateJSON, object, digest, OpenCodeCompatibilityError } from './opencode-v2-service.mjs'

export const OPENCODE_V2_REMOTE_UNCERTAIN = 'OpenCode v2 远端自有任务停止尚未确认，已隔离此来源；请仅执行停止核对，不要重发任务'
const fail = () => new OpenCodeCompatibilityError('OpenCode v2 自有会话记录无法安全核对')
async function directory(root, create = false) {
  if (!isAbsolute(root)) throw fail()
  const path = join(root, 'opencode-v2-owned')
  if (create) {
    const info = await lstat(root)
    if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o022) throw fail()
    await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error })
  }
  for (let cursor = path; ; cursor = dirname(cursor)) {
    const info = await lstat(cursor)
    if (!info.isDirectory() || info.isSymbolicLink()) throw fail()
    if (cursor === path && (info.mode & 0o077 || info.uid !== process.getuid?.())) throw fail()
    if (cursor === parse(cursor).root) return path
  }
}
export function ledgerPath(root, workerId) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(workerId)) throw fail()
  return join(resolve(root), 'opencode-v2-owned', `${workerId}.json`)
}
export async function readOwnedLedger(root, workerId) {
  try {
    await directory(root)
    const { data } = await readPrivateJSON(ledgerPath(root, workerId), 65536)
    if (!object(data) || data.policy !== 1 || data.workerId !== workerId || !['prepared', 'pending', 'settled', 'uncertain'].includes(data.status) || !/^ses[A-Za-z0-9_-]{1,180}$/.test(data.sessionId) || !/^[a-f0-9]{64}$/.test(data.marker) || !/^[a-f0-9]{64}$/.test(data.sourcePin) || !isAbsolute(data.project) || !isAbsolute(data.executable) || typeof data.version !== 'string' || typeof data.epoch !== 'string' || !object(data.run) || !/^msg_[A-Za-z0-9_-]{1,180}$/.test(data.run.inputId) || !/^[a-f0-9]{64}$/.test(data.run.payloadDigest) || typeof data.run.id !== 'string' || typeof data.run.keyHash !== 'string') throw fail()
    return data
  } catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
}
export async function saveOwnedLedger(root, record) {
  const parent = await directory(root, true), target = ledgerPath(root, record.workerId)
  let previous
  try { previous = await lstat(target); if (!previous.isFile() || previous.isSymbolicLink() || previous.nlink !== 1 || previous.mode & 0o077) throw fail() } catch (error) { if (error.code !== 'ENOENT') throw error }
  const parentBefore = await lstat(parent), temporary = join(parent, `write-${randomBytes(16).toString('hex')}`)
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try { await handle.writeFile(JSON.stringify(record)); await handle.sync() } finally { await handle.close() }
  const parentAfter = await lstat(parent)
  if (parentAfter.isSymbolicLink() || parentAfter.ino !== parentBefore.ino || parentAfter.dev !== parentBefore.dev) throw fail()
  if (previous) { const now = await lstat(target); if (now.ino !== previous.ino || now.dev !== previous.dev || now.mtimeMs !== previous.mtimeMs) throw fail() }
  else { try { await lstat(target); throw fail() } catch (error) { if (error.code !== 'ENOENT') throw error } }
  // Both resolved paths were constructed in the checked private owned directory.
  await rename(temporary, target)
}
function proofValue(record) { return JSON.stringify([record.workerId, record.sessionId, record.marker, record.sourcePin, record.project, record.model, record.agent, record.epoch, record.run.id, record.run.inputId, record.run.payloadDigest, record.run.terminal ?? null, record.run.watermark ?? null, record.run.baseline ?? null, record.run.admissionKnown === true, record.run.policyViolation === true, record.run.resultUnknown === true, record.invalid === true, record.status]) }
export function signSettlement(record, key) { return createHmac('sha256', key).update(proofValue(record)).digest('hex') }
export function verifySettlement(record, key) {
  if (record?.status !== 'settled' || record.run.keyHash !== digest(key) || typeof record.run.proof !== 'string' || !/^[a-f0-9]{64}$/.test(record.run.proof)) return false
  return timingSafeEqual(Buffer.from(record.run.proof, 'hex'), Buffer.from(signSettlement(record, key), 'hex'))
}
export async function unsettledOwnedLedgers(root, recoverCold = false) {
  let path
  try { path = await directory(root) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
  const result = []
  for (const name of await readdir(path)) {
    if (!name.endsWith('.json')) continue
    const record = await readOwnedLedger(root, name.slice(0, -5))
    if (record?.status === 'uncertain' || recoverCold && record?.status === 'pending') {
      if (record.status !== 'uncertain') { record.status = 'uncertain'; await saveOwnedLedger(root, record) }
      result.push(record)
    }
  }
  return result
}
