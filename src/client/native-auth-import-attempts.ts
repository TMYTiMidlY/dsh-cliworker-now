// Dialog-scoped uncertain receipts must survive close/reopen, but never enter
// localStorage, project preferences, logs or generated build artifacts.
// Input contains only an authorized directory/region/label, not file contents.
const pending = new WeakMap<object, Map<string, Map<string, string>>>()
function entries(api: object, session: string) {
  let sessions = pending.get(api); if (!sessions) { sessions = new Map(); pending.set(api, sessions) }
  let values = sessions.get(session)
  if (!values) { if (sessions.size >= 64) throw new Error('请先核对未确认的导入结果'); values = new Map(); sessions.set(session, values) }
  return values
}
export function importAttemptId(api: object, session: string, input: string): string {
  const values = entries(api, session), existing = values.get(input)
  if (existing) return existing
  if (values.size >= 8) throw new Error('请先核对未确认的导入结果')
  const id = crypto.randomUUID(); values.set(input, id); return id
}
export function confirmImportAttempt(api: object, session: string, input: string, id: string) {
  const sessions = pending.get(api), values = sessions?.get(session)
  if (values?.get(input) === id) values.delete(input)
  if (values?.size === 0) sessions!.delete(session)
}
export function hasUnconfirmedImport(api: object, session: string): boolean { return !!pending.get(api)?.get(session)?.size }
