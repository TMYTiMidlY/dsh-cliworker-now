import { types } from 'node:util'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { ProcessCleanupUnconfirmedError, isProcessCleanupUnconfirmedError } from './process.ts'
import { MetadataCaptureError, type MetadataPhase, type MetadataReason, type MetadataHint } from './metadata-diagnostics.ts'
import { isMiniMaxIdentityCancellation } from './minimax-identity.ts'

const opaque = () => new Error('CLI_OPERATION_FAILED：操作未完成，错误详情不可安全公开；请核对对应回执，不要自动重发')
/** Inspect data descriptors only. Never evaluate an unknown accessor or cause. */
function data(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

/** Final presentation only: internal abort reasons and cleanup flow stay untouched. */
export function publicOperationError(value: unknown, signal?: AbortSignal): Error {
  const cancelled = signal?.aborted && value === signal.reason
  try {
    // Constructor-owned cleanup identity also covers the genuine MiniMax and
    // OpenCode subclasses. Unknown/proxied prototypes are never traversed.
    if (isProcessCleanupUnconfirmedError(value)) {
      const safe = new ProcessCleanupUnconfirmedError(), message = data(value, 'message')
      if (typeof message === 'string') safe.message = message.slice(0, 4096)
      return safe
    }
    // MiniMax intentionally projects caller reasons to a fresh private DOMException.
    // Recognize only its module-owned witness, never a generic AbortError lookalike.
    if (isMiniMaxIdentityCancellation(value))
      return new Error('CLI_OPERATION_CANCELLED：操作已取消；执行或投递情况请核对已有回执，不要自动重发')
    // util's native brand check rejects Error proxies without traversing their traps.
    if (types.isNativeError(value)) {
      const error = value as Error, prototype = Object.getPrototypeOf(error)
      if (prototype === MetadataCaptureError.prototype) {
        const phase = data(error, 'phase'), reason = data(error, 'reason'), exitCode = data(error, 'exitCode')
        if (typeof phase === 'string' && ['resolve', 'spawn', 'read', 'exit', 'timeout'].includes(phase) && typeof reason === 'string')
          return new MetadataCaptureError(phase as MetadataPhase, reason as MetadataReason, exitCode, data(error, 'hint') as MetadataHint | undefined)
        return opaque()
      }
      // Unknown delivery outranks a simultaneous cancellation. Do not echo a cause.
      if (data(error, 'code') === 'STEER_UNKNOWN')
        return Object.assign(new Error('CLI 投递状态未确认；请先核对本轮回执，不要自动重发'), { code: 'STEER_UNKNOWN' })
      if (cancelled)
        return new Error('CLI_OPERATION_CANCELLED：操作已取消；执行或投递情况请核对已有回执，不要自动重发')
      const message = data(error, 'message')
      // Copy ordinary domain diagnostics, not overridden name/toString/cause/stack.
      return typeof message === 'string' && message.length ? new Error(message.slice(0, 4096)) : opaque()
    }
  } catch {
    // A hostile prototype/descriptor is not evidence about auth, quota or delivery.
  }
  return cancelled
    ? new Error('CLI_OPERATION_CANCELLED：操作已取消；执行或投递情况请核对已有回执，不要自动重发')
    : opaque()
}

/** Preserve every SDK tool declaration; normalize only a rejected public call. */
export function withPublicToolErrors(tool: ToolDefinition, disposed?: AbortSignal): ToolDefinition {
  return {
    ...tool,
    async execute(args, exec) {
      try { return await tool.execute(args, exec) }
      catch (error) {
        throw publicOperationError(error, disposed ? AbortSignal.any([exec.signal, disposed]) : exec.signal)
      }
    },
  }
}
