export const OPENCODE_V2_REMOTE_UNCERTAIN: string
export function ledgerPath(root: string, workerId: string): string
export function readOwnedLedger(root: string, workerId: string): Promise<any | undefined>
export function saveOwnedLedger(root: string, record: any): Promise<void>
export function signSettlement(record: any, key: string): string
export function verifySettlement(record: any, key: string): boolean
export function unsettledOwnedLedgers(root: string, recoverCold?: boolean): Promise<any[]>
