export type MetadataPhase = 'resolve' | 'spawn' | 'read' | 'exit' | 'timeout'
const phases = new Set<MetadataPhase>(['resolve', 'spawn', 'read', 'exit', 'timeout'])
const systemReasons = ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ENOEXEC', 'EIO', 'ENOMEM', 'EMFILE', 'ENFILE', 'EPIPE', 'ECONNRESET', 'ETIMEDOUT', 'ERR_STREAM_PREMATURE_CLOSE', 'ABORT_ERR'] as const
export type MetadataReason = typeof systemReasons[number] | 'unknown' | 'exit' | 'signal' | 'deadline' | 'output-limit'
const reasons = new Set<string>([...systemReasons, 'unknown', 'exit', 'signal', 'deadline', 'output-limit'])
export const metadataExitCode = (value: unknown): number | null => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4294967295 ? value : null
export function metadataSystemReason(error: unknown): MetadataReason {
  try {
    const code = error !== null && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
    return typeof code === 'string' && (systemReasons as readonly string[]).includes(code) ? code as MetadataReason : 'unknown'
  } catch { return 'unknown' }
}
const nativeHints = ['native-argument', 'native-auth-text', 'native-network-text', 'native-permission-text', 'native-file-text', 'native-terminal-text', 'native-runtime-text', 'native-settings-text', 'native-update-text', 'native-sandbox-text', 'native-output-empty', 'native-unclassified-text'] as const
export type MetadataHint = typeof nativeHints[number]
/** Fixed categories only. Native text is untrusted and cannot establish login,
 * identity, quota, route or permission. Never return captures or original text. */
export function metadataNativeHint(text: string): MetadataHint | undefined {
  if (/unknown (?:command|flag)|unrecognized (?:command|option|argument)|flag provided but not defined/i.test(text)) return 'native-argument'
  if (/authentication (?:required|failed)|not logged in|login required|invalid_grant|unauthorized/i.test(text)) return 'native-auth-text'
  if (/proxyconnect|connection refused|network (?:is )?unreachable|dial tcp|x509:|certificate (?:signed|verify)|TLS handshake/i.test(text)) return 'native-network-text'
  if (/permission denied|operation not permitted/i.test(text)) return 'native-permission-text'
  if (/no such file or directory|cannot find module|cannot find package/i.test(text)) return 'native-file-text'
  if (/not a terminal|requires? (?:a )?(?:TTY|terminal)|terminal is required/i.test(text)) return 'native-terminal-text'
  if (/panic:|runtime error:|fatal error:/i.test(text)) return 'native-runtime-text'
  if (/settings|configuration|config file/i.test(text)) return 'native-settings-text'
  if (/auto.?updat|updater|update required/i.test(text)) return 'native-update-text'
  if (/sandbox|namespace|bubblewrap/i.test(text)) return 'native-sandbox-text'
  // These wider fixed categories still describe text only, never the actual
  // cause or validity of an account. No matched text/captures leave this scope.
  if (/usage:|invalid argument|unexpected argument/i.test(text)) return 'native-argument'
  if (/\bauth\b|oauth|credential|\btoken\b|\blogin\b|sign.?in/i.test(text)) return 'native-auth-text'
  if (/proxy|\bhttp\b|https:|\bDNS\b|\bTLS\b|\bEOF\b|socket|connect|fetch|timed? ?out|transport/i.test(text)) return 'native-network-text'
  if (/updat/i.test(text)) return 'native-update-text'
  if (/ERR_MODULE|SyntaxError|TypeError|ReferenceError|signal:|segmentation/i.test(text)) return 'native-runtime-text'
  return text.trim() ? 'native-unclassified-text' : 'native-output-empty'
}
/** Safe opt-in diagnostic. Never retains original error/cause or process inputs/output. */
export class MetadataCaptureError extends Error {
  readonly code = 'CLI_METADATA_CAPTURE_FAILED'
  readonly phase: MetadataPhase
  readonly reason: MetadataReason
  readonly exitCode: number | null
  readonly hint?: MetadataHint
  constructor(phase: MetadataPhase, reason: MetadataReason = 'unknown', exitCode: unknown = null, hint?: MetadataHint) {
    if (!phases.has(phase)) throw new Error('Invalid metadata diagnostic phase')
    const safeReason = reasons.has(reason) ? reason : 'unknown', safeExit = metadataExitCode(exitCode)
    const safeHint = nativeHints.includes(hint as MetadataHint) ? hint : undefined
    super(`CLI metadata failed (phase=${phase}, reason=${safeReason}, exitCode=${safeExit ?? 'unknown'}${safeHint ? `, hint=${safeHint}` : ''})`)
    this.name = 'MetadataCaptureError'; this.phase = phase; this.reason = safeReason; this.exitCode = safeExit
    if (safeHint) this.hint = safeHint
  }
}
export const metadataSignalReason = (signal: unknown): MetadataReason => typeof signal === 'string' && ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP', 'SIGABRT', 'SIGSEGV', 'SIGBUS', 'SIGPIPE', 'SIGQUIT'].includes(signal) ? 'signal' : 'unknown'
