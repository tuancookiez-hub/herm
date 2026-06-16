/**
 * Current-session-id bridge — lets the ThemeProvider (which lives above
 * AppInner in the provider tree) know what session is active so the
 * active theme can resolve to the per-session override.
 *
 * AppInner calls `setCurrentSessionId(sid)` whenever `sid` state
 * changes. Consumers (currently just ThemeProvider) call
 * `useCurrentSessionId()` to subscribe.
 *
 * Empty string = no active session (e.g. boot, splash, between
 * session.close() and session.create()). Consumers should treat
 * empty as "fall back to global" — not as a real session id.
 */

import { useSyncExternalStore } from "react"

let currentSid = ""
const listeners = new Set<() => void>()

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

function getSnapshot(): string {
  return currentSid
}

export function useCurrentSessionId(): string {
  return useSyncExternalStore(subscribe, getSnapshot)
}

export function setCurrentSessionId(sid: string): void {
  if (currentSid === sid) return
  currentSid = sid
  for (const l of listeners) l()
}
