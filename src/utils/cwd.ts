import { useEffect, useState } from "react"

/**
 * Adaptive CWD polling intervals.
 *
 * The sidebar CWD is the live `process.cwd()` of the herm process.
 * Polling is necessary because there's no portable Node API for CWD
 * change notifications — fs.watch can't watch for "CWD changed"
 * directly (no filesystem event fires when chdir happens).
 *
 * Strategy: poll fast at the start of a session when the user is most
 * likely to be moving between directories (project bootstrap), then
 * back off once the session has settled. "Start of session" is anchored
 * to the `resetKey` argument — pass the session id and the window
 * restarts whenever a new session opens.
 *
 * Initial window: poll every INITIAL_INTERVAL_MS for INITIAL_DURATION_MS
 * (5s × 10min = up to 120 polls during bootstrap).
 * Steady state: poll every STEADY_INTERVAL_MS (one poll every 10min
 * catches any drift; the gateway-driven syncProcessCwd path also
 * wakes the hook immediately via notifyCwdChanged, so users almost
 * never wait the full interval for changes they explicitly triggered).
 *
 * Cost: a single Win32 GetCurrentDirectoryW call is ~50-100µs, so
 * even 5s polling is ~0.002% CPU on Windows. Negligible.
 *
 * Tune these three constants if the bootstrap/settle tradeoff changes.
 */
const INITIAL_INTERVAL_MS = 5000       // fast poll during bootstrap
const STEADY_INTERVAL_MS = 600000      // 10min once settled
const INITIAL_DURATION_MS = 600000     // 10min of fast polling

/** Module-level channel so syncProcessCwd can wake the hook immediately. */
const cwdChangedListeners = new Set<() => void>()

/** Hook subscribers call this to force an immediate CWD re-read. */
export const notifyCwdChanged = (): void => {
  for (const fn of cwdChangedListeners) fn()
}

/**
 * Live-tracked current working directory of the herm process.
 *
 * Returns `process.cwd()` and re-renders whenever it changes, regardless
 * of what triggered the change:
 * - Gateway emits `session.info` with new cwd (slash /cwd, resume, profile switch)
 * - A tool call uses `process.chdir()`
 * - Any future code path that mutates the process CWD
 *
 * `resetKey` (typically the session id) restarts the bootstrap fast-poll
 * window when it changes. Pass undefined for app-lifetime polling.
 */
export const useProcessCwd = (resetKey?: string): string => {
  const [cwd, setCwd] = useState(() => process.cwd())

  useEffect(() => {
    const tick = () => {
      const current = process.cwd()
      setCwd(prev => prev === current ? prev : current)
    }
    // Bootstrap: fast interval that hands off to slow after INITIAL_DURATION.
    let id = setInterval(tick, INITIAL_INTERVAL_MS)
    const handoff = setTimeout(() => {
      clearInterval(id)
      id = setInterval(tick, STEADY_INTERVAL_MS)
    }, INITIAL_DURATION_MS)
    // External wake-up via notifyCwdChanged — fires whenever syncProcessCwd
    // or any other code mutates the process CWD. Bypasses the poll cadence.
    cwdChangedListeners.add(tick)
    return () => {
      clearInterval(id)
      clearTimeout(handoff)
      cwdChangedListeners.delete(tick)
    }
  }, [resetKey])

  return cwd
}

/**
 * Sync the herm process's working directory to the given absolute path.
 * No-op if path is empty, invalid, or already matches `process.cwd()`.
 * Call this from `session.info` handlers and the `/cwd` slash command
 * to make the OS state match the gateway's view — then notifyCwdChanged
 * wakes the polling hook on its next tick so the sidebar updates
 * immediately (no waiting up to 10min for the steady-state poll).
 *
 * Failures are swallowed (path may not exist, may lack permissions).
 * The gateway already validates paths before emitting; this is just
 * the local mirror.
 */
export const syncProcessCwd = (target: string | null | undefined): boolean => {
  if (!target) return false
  try {
    const current = process.cwd()
    if (target === current) return false
    process.chdir(target)
    notifyCwdChanged()
    return true
  } catch {
    return false
  }
}