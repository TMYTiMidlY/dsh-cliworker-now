import type { ModelChoice } from '../shared/types.ts'
import type { AccountIdentity } from './account-identity.ts'
export interface OpenCodeVersion { major: 1 | 2; version: string }
export interface OpenCodeV2Options { home?: string; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; fetch?: typeof globalThis.fetch; maxBytes?: number; timeoutMs?: number; includeAgent?: boolean }
export class OpenCodeCompatibilityError extends Error { readonly code: string; constructor(message?: string) }
export const DENY_ALL: readonly { action: string; resource: string; effect: string }[]
export function object(v: unknown): v is Record<string, any>
export function text(v: unknown): v is string
export function digest(v: unknown): string
export function readPrivateJSON(path: string, limit?: number, signal?: AbortSignal): Promise<{ data: any; fingerprint: string }>
export function openCodeV2ModelRef(id: string): { providerID: string; id: string; variant?: string }
export interface OpenCodeV2Snapshot {
  identity: AccountIdentity
  candidates: ModelChoice[]
  agent?: { id: string; mode: string; hidden: boolean; permissions: unknown[]; fingerprint: string }
  pins: Record<string, string>
  bindingMaterial: { sourceIds: string[]; entries: { provider: string; principal: unknown; route: unknown }[] }
}
export interface OpenCodeV2Service {
  directory: string; epoch: string; pid: number; version: string; registryPath: string
  json(route: string, method?: string, body?: unknown, signal?: AbortSignal, budget?: { used: number; maximum: number }): Promise<any>
  request(route: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<Response>
  verify(signal?: AbortSignal): Promise<void>
  credentialsEnvironment(): string
  close(): void
}
export function openOpenCodeV2Service(executable: string, version: OpenCodeVersion, project: string, signal: AbortSignal, options?: OpenCodeV2Options): Promise<OpenCodeV2Service>
export function serviceMetadata(service: OpenCodeV2Service, signal: AbortSignal, options?: OpenCodeV2Options): Promise<OpenCodeV2Snapshot>
export function readOpenCodeV2Metadata(executable: string, version: OpenCodeVersion, project: string, signal: AbortSignal, options?: OpenCodeV2Options): Promise<OpenCodeV2Snapshot>
