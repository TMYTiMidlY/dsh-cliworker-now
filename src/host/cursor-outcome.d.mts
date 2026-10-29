import type { EventInput } from './protocol.ts'
export function cursorSourceDiagnostic(value: unknown): boolean
export interface CursorOutcomeTracker {
  start(sessionId: string): void
  /** Caller must use the ACP active/same-session, post-eventId-dedupe rail. */
  accept(update: Record<string, any>, sessionId: string): void
  /** Only a locally chosen active/current-session rejection, never raw CLI text. */
  permissionDenied(toolCallId: string, sessionId: string): void
  projectTool(event: EventInput, update: Record<string, any>, sessionId: string): EventInput
  /** Publish only after all prompt notifications have drained. */
  finalEvents(): EventInput[]
  finalize(input: { status: string; failure?: unknown }): { status: 'ERROR' | 'UNCERTAIN'; error: string } | undefined
}
export function createCursorOutcomeTracker(): CursorOutcomeTracker
