// Host-private orchestrator. Source authorization and Native verifier are
// trusted Host responsibilities; this is not a model-facing arbitrary-files API.
import { createHash } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import {
  AuthDirectory, cancelled, fail, fdPath, isNativeAuthCleanupUnconfirmedError, nativeAuthFailureCode,
} from './native-auth-files.ts'
import { isProcessCleanupUnconfirmedError } from './process.ts'
import { withNativeAuthSnapshot } from './native-auth-snapshot.ts'
import { miniMaxProfileIdentity, miniMaxAccountProfileIdentity, type NativeAuthStore, type NativeAuthContext, type NativeAuthDescriptor, type NativeAuthIdentity, type NativeAuthImport } from './native-auth-store.ts'
import { projectMiniMaxAccountSettings } from './native-auth-minimax-settings.ts'
import type { NativeAuthKernelBackend } from './native-auth-kernel.ts'
import { requestMiniMaxIdentity, type MiniMaxIdentityOptions } from './minimax-identity.ts'
import { assertMiniMaxRoute } from './minimax-accounts.ts'
import type { MiniMaxAuthRefreshGroups } from './native-auth-minimax-refresh.ts'
import { inspectMiniMaxNativeAuth, projectMiniMaxNativeAuth } from './native-auth-minimax.ts'

const inputSchema = z.object({
  sourceRoot: z.string().min(1).max(4096).refine(value => !value.includes('\0') && isAbsolute(value) && resolve(value) === value),
  region: z.enum(['cn', 'en']), label: z.string().min(1).max(100), requestId: z.string().min(1).max(128),
  id: z.string().optional(), expectedRecordRevision: z.number().int().min(1).optional(),
  scope: z.literal('account-only').optional(),
}).strict()
const protection = ['permission.json', 'agents', 'plugin-hook-permissions'] as const
const cleanupUnknown = (error: unknown) => isNativeAuthCleanupUnconfirmedError(error) || isProcessCleanupUnconfirmedError(error)
function safeFailure(error: unknown, signal?: AbortSignal): never {
  if (cleanupUnknown(error)) fail('CLEANUP_UNCONFIRMED')
  const code = nativeAuthFailureCode(error)
  if (code) fail(code)
  cancelled(signal)
  return fail('VALIDATION_FAILED')
}
/** Preflight only. Actual required absence and file identity/coherence are
 * guarded again throughout the source callback; these checks authorize none. */
function configPresent(sourceRoot: string, protectedPaths: readonly string[]): boolean {
  const root = AuthDirectory.open(sourceRoot, true)
  try {
    for (const name of protectedPaths) {
      try { lstatSync(fdPath(root.fd, name)); fail('UNSUPPORTED') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    try {
      const stat = lstatSync(fdPath(root.fd, 'config.yaml'))
      if (!stat.isFile() || stat.isSymbolicLink()) fail('UNSUPPORTED')
      root.verify(false); return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      root.verify(false); return false
    }
  } finally { root.close() }
}
export interface MiniMaxNativeImportRequest {
  sourceRoot: string; region: 'cn' | 'en'; label: string; requestId: string
  id?: string; expectedRecordRevision?: number; signal?: AbortSignal
  /** Explicit Host-authorized account import; excludes business definitions. */
  scope?: 'account-only'
}
export interface MiniMaxNativeImporterDependencies {
  store: NativeAuthStore
  groups: MiniMaxAuthRefreshGroups
  /** Must await owned Native cleanup and validate coherent target material,
   * original protection policy and a fresh proved principal before returning.
   * An injected callback or successful models response is not that proof. */
  verifyTarget: (context: NativeAuthContext, signal: AbortSignal) => Promise<NativeAuthIdentity>
  identity?: MiniMaxIdentityOptions
  snapshotBackend?: NativeAuthKernelBackend
}
export class MiniMaxNativeProfileImporter {
  readonly #dependencies: MiniMaxNativeImporterDependencies
  constructor(dependencies: MiniMaxNativeImporterDependencies) { this.#dependencies = dependencies }
  async import(input: MiniMaxNativeImportRequest): Promise<NativeAuthDescriptor> {
    const { signal, ...parameters } = input
    const parsed = inputSchema.safeParse(parameters)
    if (!parsed.success) fail('INVALID_INPUT')
    const selected = parsed.data, { store, groups } = this.#dependencies
    const sourceKey = createHash('sha256').update(JSON.stringify(selected.scope === 'account-only'
      ? ['minimax-native-account-import', 1, 'prod', selected.region, selected.sourceRoot]
      : ['minimax-native-file-import', 1, 'prod', selected.region, selected.sourceRoot],
    )).digest('hex')
    const request: NativeAuthImport = {
      cli: 'minimax', label: selected.label, requestId: selected.requestId, sourceKey,
      ...(selected.id !== undefined ? { id: selected.id } : {}),
      ...(selected.expectedRecordRevision !== undefined ? { expectedRecordRevision: selected.expectedRecordRevision } : {}),
      signal,
    }
    let work: Promise<NativeAuthDescriptor> | undefined
    try {
      cancelled(signal)
      const prior = store.lookupImport(request)
      if (prior) return prior
      if (request.id) {
        const descriptor = store.list().find(row => row.id === request.id)
        if (!descriptor) fail('NOT_FOUND')
        if (descriptor.cli !== 'minimax' || descriptor.recordRevision !== request.expectedRecordRevision) fail('CONFLICT')
      }
      assertMiniMaxRoute()
      // Human-authorized account-only imports do not inspect/dereference a
      // business agent tree. Global permission/plugin protection remains part
      // of the guarded contract and is not silently discarded.
      const protectedPaths = selected.scope === 'account-only' ? protection.filter(path => path !== 'agents') : protection
      const hasConfig = configPresent(selected.sourceRoot, protectedPaths), prefix = `auth/prod/${selected.region}/mcode-public`
      return await withNativeAuthSnapshot({
        root: selected.sourceRoot, signal,
        files: [
          { path: `${prefix}/auth.json`, maxBytes: 65536 }, { path: `${prefix}/auth-state.json`, maxBytes: 65536 },
          ...(hasConfig ? [{ path: 'config.yaml', maxBytes: 65536 }] : []),
        ],
        metadata: [...protectedPaths, ...(!hasConfig ? ['config.yaml'] : [])].map(path => ({ kind: 'absent' as const, path })),
      }, (files, guard) => {
        // SEAL detaches source observation; it must not detach the caller's
        // cancellation from the later registry transaction.
        const operationSignal = signal ? AbortSignal.any([signal, guard.signal]) : guard.signal
        // The kernel race may return before this promise. Retain and join ALL
        // inner work before returning or releasing ownership on source failure.
        work = (async () => {
          const settings = selected.scope === 'account-only'
            ? projectMiniMaxAccountSettings(files.get('config.yaml'), selected.region) : undefined
          // Validate the auth pair independently of the explicitly projected
          // account settings. The RAW source config remains held by the guard.
          const authFiles = settings ? new Map(files) : files
          if (settings) (authFiles as Map<string, Buffer>).delete('config.yaml')
          try {
            const sample = inspectMiniMaxNativeAuth({ sourceRoot: selected.sourceRoot, region: selected.region, files: authFiles })
            const principal = await requestMiniMaxIdentity(selected.region, sample.accessToken, operationSignal, this.#dependencies.identity)
            const identity = settings
              ? miniMaxAccountProfileIdentity(principal, selected.region, settings.digest)
              : miniMaxProfileIdentity(principal, selected.region, sample.configPolicy)
            if (!('identityPolicy' in identity)) fail('STORE_UNAVAILABLE')
            return await groups.run(identity.identityPolicy.refreshGroup, async () => {
              let targetCleanupUnconfirmed = false
              try {
                return await store.import({ ...request, signal: operationSignal }, async context => {
                  const projection = projectMiniMaxNativeAuth({
                    sourceRoot: selected.sourceRoot, targetRoot: context.nativeRoot, region: selected.region, files: authFiles,
                  })
                  return { identity, files: settings
                    ? [...projection.files, { path: 'config.yaml', bytes: settings.bytes }] : projection.files }
                }, async context => {
                  let verified: NativeAuthIdentity
                  try { verified = await this.#dependencies.verifyTarget(context, operationSignal) }
                  catch (error) {
                    // Observe the original constructor-owned witness HERE. A
                    // later store-finally failure must not erase it and release
                    // the group while its Native range remains unconfirmed.
                    targetCleanupUnconfirmed = cleanupUnknown(error)
                    throw error
                  }
                  await guard.seal()
                  cancelled(operationSignal)
                  return verified
                })
              } catch (error) {
                if (targetCleanupUnconfirmed) fail('CLEANUP_UNCONFIRMED')
                throw error
              }
            }, operationSignal)
          } finally { settings?.bytes.fill(0) }
        })()
        return work
      }, { timeoutMs: 30000, ...this.#dependencies.snapshotBackend })
    } catch (error) {
      if (work) {
        try { await work } catch (inner) { if (cleanupUnknown(inner)) return safeFailure(inner) }
      }
      return safeFailure(error, signal)
    }
  }
}
