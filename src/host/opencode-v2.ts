import { ProcessCleanupUnconfirmedError } from './process.ts'
import { OpenCodeCompatibilityError } from './opencode-v2-service.mjs'
export { OpenCodeCompatibilityError, openCodeV2ModelRef, readOpenCodeV2Metadata } from './opencode-v2-service.mjs'
export type { OpenCodeV2Options, OpenCodeV2Snapshot, OpenCodeVersion } from './opencode-v2-service.mjs'
import type { OpenCodeVersion } from './opencode-v2-service.mjs'
export const OPENCODE_V2_EXECUTION_UNAVAILABLE = 'OpenCode v2 必须使用已确认的自有会话只读通路；不能派遣旧协议或续接 v1 历史任务'
export type OpenCodeMetadataCapture = (argv: string[], env?: Record<string, string>) => Promise<string>
export function parseOpenCodeVersion(raw: string): OpenCodeVersion {
  // OpenCode 2.0.31 effect/cli emits `opencode v<version>` in a plain pipe.
  // Keep legacy canonical forms, but never allow a prefix to span lines.
  const match = /^(?:opencode(?: version)?[ \t]+|opencode v)?((\d+)\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)$/.exec(raw.trim())
  if (!match || !['1', '2'].includes(match[2]!)) {
    // Return only fixed shape diagnostics. A wrong launcher can print secrets;
    // never include stdout/stderr excerpts, even when they resemble a version.
    const text = raw.trim()
    const lines = text ? text.split(/\r\n|\r|\n/).length : 0
    const ansi = /\x1b/.test(text)
    const format = match ? 'unsupported-major' : !text ? 'empty' : ansi ? 'ansi' :
      lines > 1 ? 'multiple-lines' : /[\x00-\x1f\x7f]/.test(text) ? 'control-characters' :
      /^v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(text) ? 'v-prefix' :
      /^opencode(?: version)?\s+/i.test(text) && !/^opencode(?: version)?\s+/.test(text) ? 'noncanonical-prefix' :
      /^(?:opencode(?: version)?\s+)?\d+\.\d+\.\d+-[A-Za-z0-9.-]+\+[A-Za-z0-9.-]+$/.test(text) ? 'prerelease-and-build' : 'unrecognized'
    throw new OpenCodeCompatibilityError(`OpenCode 原生版本暂不支持或无法确认；versionDiagnostic: format=${format}, chars=${raw.length}, lines=${lines}, ansi=${ansi}; 不会回退旧认证协议`)
  }
  return { major: Number(match[2]) as 1 | 2, version: match[1]! }
}
export async function readOpenCodeVersion(executable: string, capture: OpenCodeMetadataCapture, signal?: AbortSignal) {
  signal?.throwIfAborted()
  try { const result = parseOpenCodeVersion(await capture([executable, '--version'])); signal?.throwIfAborted(); return result }
  catch (error) {
    if (error instanceof ProcessCleanupUnconfirmedError || error instanceof OpenCodeCompatibilityError) throw error
    signal?.throwIfAborted()
    throw new OpenCodeCompatibilityError('OpenCode 原生版本查询失败；不会读取旧账号文件或准备任务')
  }
}
export function assertOpenCodeV1(version: OpenCodeVersion): void { if (version.major !== 1) throw new OpenCodeCompatibilityError(OPENCODE_V2_EXECUTION_UNAVAILABLE) }
export const openCodeV2Actions = [{ id: 'manage' as const, label: '原生账号终端', description: '打开 OpenCode 原生界面管理账号与后台服务；插件不注入登录或退出命令。' }]
