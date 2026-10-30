// Local bounded admission/postcondition sample for an already authorized private
// MiniMax profile. Not HMAC authority, credential proof or a continuous watcher.
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { parseDocument } from 'yaml'
const failure = () => new Error('MiniMax 私有账号原签名保护设置已失效，未准入后续操作')
const same = info => [info.dev, info.ino, info.uid, info.gid, info.mode].join(':')
const stamp = info => [same(info), info.nlink, info.size, info.mtimeNs, info.ctimeNs].join(':')
const object = value => !!value && typeof value === 'object' && !Array.isArray(value)
const keys = (value, expected) => object(value) && Object.keys(value).length === expected.length && Object.keys(value).every(key => expected.includes(key))
const consent = value => keys(value, ['enabled']) && typeof value.enabled === 'boolean'
const ownedKeys = ['logLevel', 'permissionMode', 'dataContribution', 'memory', 'skipWindowsHardSafetyChecks', 'skipParentDeathGuard']
// Vendor-owned keys mcode 0.6.12 may re-add when it normalizes a root's config
// on ACP startup; anything else remains an unknown protection field.
const vendorKeys = ['provider', 'defaultModel', 'defaultModelVariant', 'defaultModelThinking', 'defaultModelContextWindow', 'defaultProvider', 'minimaxModelSource']
function protectedBytes(bytes, expected) {
  const document = parseDocument(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), { logLevel: 'silent' })
  if (document.errors.length || document.warnings.length) throw failure()
  const value = document.toJS({ maxAliasCount: 0 })
  if (!object(value) || !ownedKeys.every(key => Object.hasOwn(value, key)) || !Object.keys(value).every(key => ownedKeys.includes(key) || vendorKeys.includes(key)) ||
      value.logLevel !== 'info' || value.permissionMode !== 'default' || !consent(value.dataContribution) || !consent(value.memory) ||
      value.skipWindowsHardSafetyChecks !== false || value.skipParentDeathGuard !== false) throw failure()
  const canonical = { logLevel: value.logLevel, permissionMode: value.permissionMode,
    dataContribution: { enabled: value.dataContribution.enabled }, memory: { enabled: value.memory.enabled },
    skipWindowsHardSafetyChecks: false, skipParentDeathGuard: false }
  if (createHash('sha256').update(JSON.stringify(canonical)).digest('hex') !== expected) throw failure()
}
export function assertMiniMaxProfileProtection(expected, env) {
  const nodes = []; let file, bytes
  try {
    if (process.platform !== 'linux' || process.arch !== 'x64' || typeof process.getuid !== 'function' ||
        !keys(expected, ['root', 'region', 'configDigest', 'version']) || typeof expected.root !== 'string' || expected.root.length > 4096 ||
        expected.root.includes('\0') || !isAbsolute(expected.root) || resolve(expected.root) !== expected.root ||
        !['cn', 'en'].includes(expected.region) || !/^[0-9a-f]{64}$/.test(expected.configDigest) || expected.version !== '0.6.12' ||
        process.env.MAVIS_BUILTIN_AGENTS_V2_DIR) throw failure()
    if (env !== undefined && (env.MINIMAX_DATA_DIR !== expected.root || env.MAVIS_DATA_DIR !== expected.root ||
        env.MAVIS_REGION !== expected.region || env.MAVIS_BUILD_ENV !== 'prod')) throw failure()
    const uid = BigInt(process.getuid()), parts = expected.root.split('/').filter(Boolean)
    if (parts.length < 1 || parts.length > 48) throw failure()
    let absolute = '/', parent
    for (const part of ['', ...parts]) {
      const path = parent === undefined ? '/' : `/proc/self/fd/${parent}/${part}`
      const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW), info = fstatSync(fd, { bigint: true })
      if (part) absolute = absolute === '/' ? '/' + part : absolute + '/' + part
      nodes.push({ fd, absolute, info }); parent = fd
      const leaf = absolute === expected.root
      if (!info.isDirectory() || (info.uid !== uid && (leaf || info.uid !== 0n)) || (info.mode & 0o022n) || leaf && (info.mode & 0o777n) !== 0o700n) throw failure()
    }
    const root = nodes.at(-1), path = `/proc/self/fd/${root.fd}/config.yaml`
    const absent = () => { for (const name of ['permission.json', 'plugin-hook-permissions']) {
      try { lstatSync(`/proc/self/fd/${root.fd}/${name}`); throw failure() }
      catch (error) { if (error?.code !== 'ENOENT') throw failure() }
    } }
    const safe = info => { if (!info.isFile() || info.uid !== uid || info.nlink !== 1n || (info.mode & 0o777n) !== 0o600n || info.size < 1n || info.size > 65536n) throw failure() }
    absent(); const before = lstatSync(path, { bigint: true }); safe(before)
    file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    if (stamp(before) !== stamp(fstatSync(file, { bigint: true }))) throw failure()
    bytes = Buffer.alloc(Number(before.size) + 1); let length = 0
    while (length < bytes.length) { const n = readSync(file, bytes, length, bytes.length - length, null); if (!n) break; length += n }
    if (length !== Number(before.size) || stamp(before) !== stamp(fstatSync(file, { bigint: true })) || stamp(before) !== stamp(lstatSync(path, { bigint: true }))) throw failure()
    protectedBytes(bytes.subarray(0, length), expected.configDigest)
    if (stamp(before) !== stamp(fstatSync(file, { bigint: true })) || stamp(before) !== stamp(lstatSync(path, { bigint: true }))) throw failure()
    absent()
    for (const node of nodes) if (same(node.info) !== same(fstatSync(node.fd, { bigint: true })) || same(node.info) !== same(lstatSync(node.absolute, { bigint: true }))) throw failure()
  } catch { throw failure() }
  finally { bytes?.fill(0); if (file !== undefined) closeSync(file); for (const node of nodes.reverse()) closeSync(node.fd) }
}
