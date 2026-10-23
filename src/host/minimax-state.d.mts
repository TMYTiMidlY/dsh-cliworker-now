import type { ModelChoice, Preference } from '../shared/types.ts'
export const MINIMAX_EFFORTS: string[]
export function validMiniMaxModel(value: unknown): boolean
export function minimaxState(state: unknown): { model: string; models: ModelChoice[]; permission: string; mode: string; effort?: string; efforts: string[] }
export function configureMiniMax(peer: any, sessionId: string, state: any, preference: Preference): Promise<any>
