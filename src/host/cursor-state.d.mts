import type { ModelChoice } from '../shared/types.ts'
export function cursorState(state: unknown): { model: string; mode: 'agent' | 'plan' | 'ask'; models: ModelChoice[] }
