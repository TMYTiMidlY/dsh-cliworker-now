import { homedir } from 'node:os'
import { join } from 'node:path'

/** Current AGY file store. Never fall back to an unrelated/stale jetski login. */
export function agyAccountPath(home = homedir()): string {
  return join(home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token')
}
