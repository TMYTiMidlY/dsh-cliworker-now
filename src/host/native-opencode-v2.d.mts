export function runNativeOpenCodeV2(config: any, io: any): Promise<void>
export function reconcileOpenCodeV2Owned(root: string, workerId: string, key: string): Promise<any>
export function consumeOpenCodeV2SSE(response: Response, signal: AbortSignal, limits: {used: number; maximum: number; line: number}, onFrame: (value: any) => any): Promise<void>
