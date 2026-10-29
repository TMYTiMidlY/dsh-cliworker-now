import { SubagentError } from '@deepseek-ai/dsh-subagent'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

/** Optional public Host events: no runtime dependency on the settings/loader plugins.
 * The handler consumes no payload, including any foreign identity. */
declare module '@deepseek-ai/cordis' {
  interface Events {
    'settings/document-updated'(ns: string, revision: number): void
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void
  }
}

/** Local SDK evidence only. delivery-unavailable by itself is deliberately insufficient. */
export function isHostChildCapacityError(error: unknown): boolean {
  if (error instanceof SubagentError) return error.code === 'ACTIVATION_LIMIT_REACHED'
  return error instanceof RemoteError && error.code === 'subagent/delivery-unavailable' &&
    error.cause instanceof SubagentError && error.cause.code === 'ACTIVATION_LIMIT_REACHED'
}
/** Only the conversation bridge may create this after its rollback completed and no child exists. */
export class HostChildCapacityDeferred extends Error {
  constructor(readonly authority: object, readonly candidateChildId?: string) {
    super('等待 DSH 宿主子会话容量；尚未启动 CLI，不代表厂商限流')
    this.name = 'HostChildCapacityDeferred'
  }
}
/** No interval, no unbounded rapid preparation. Events retain a minimum failed-attempt cooldown. */
export const HOST_ADMISSION_MIN_RETRY_MS = 2_000
export const hostAdmissionBackoff = (attempt: number): number =>
  Math.min(30_000, HOST_ADMISSION_MIN_RETRY_MS * 2 ** Math.min(Math.max(0, attempt - 1), 4))
