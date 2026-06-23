// Reset sticky terminal modes. Ported from hermes-agent
// ui-tui/src/lib/terminalModes.ts (v0.12.0, commits d05497f81 +
// cad7944b9).
//
// Why this exists: @opentui/core only resets ?1049 (alt-screen) on
// shutdown. If a prior TUI crashed with any of the modes below still
// enabled — mouse reporting, focus events, bracketed paste, kitty
// keyboard protocol — the terminal tab poisons the next process.
// Symptoms: raw `[<35;12;8M` cursor-motion escapes dumped into the
// composer, phantom focus events, paste wrapped in [200~...[201~,
// kitty CSI-u sequences interpreted as literal input.
//
// We emit this on startup (self-heal a poisoned tab from a prior
// crashed process) and on every exit path (so our own crash doesn't
// poison the next shell prompt).

import { appendFileSync, writeSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const TERMINAL_MODE_RESET =
  "\x1b[0'z" +     // DEC locator reporting
  "\x1b[0'{" +     // selectable locator events
  "\x1b[?2029l" +  // passive mouse
  "\x1b[?1016l" +  // SGR-pixels mouse
  "\x1b[?1015l" +  // urxvt decimal mouse
  "\x1b[?1006l" +  // SGR mouse
  "\x1b[?1005l" +  // UTF-8 extended mouse
  "\x1b[?1003l" +  // any-motion mouse
  "\x1b[?1002l" +  // button-motion mouse
  "\x1b[?1001l" +  // highlight mouse
  "\x1b[?1000l" +  // click mouse
  "\x1b[?9l" +     // X10 mouse
  "\x1b[?1004l" +  // focus events
  "\x1b[?2004l" +  // bracketed paste
  "\x1b[?1049l" +  // alternate screen
  "\x1b[<u" +      // kitty keyboard (pop stack)
  "\x1b[>4;0m" +   // modifyOtherKeys → level 0
  "\x1b[0m" +      // SGR attributes
  "\x1b[?25h"      // cursor visible

type ResettableStream = Pick<NodeJS.WriteStream, "isTTY" | "write"> & {
  fd?: number
}

/**
 * Synchronously emit the reset blob to `stream`.
 *
 * Returns true if the write succeeded. Skips non-TTY streams (piped
 * stdout, test mocks) — ANSI reset on a plain pipe would corrupt
 * downstream consumers.
 *
 * Prefers `fs.writeSync(fd, …)` over `stream.write(…)` because async
 * writes don't flush when `process.exit()` terminates the loop.
 * `stream.write` is the fallback for mocked streams where `fd` isn't
 * a real kernel descriptor.
 */
export function resetTerminalModes(stream: ResettableStream = process.stdout): boolean {
  if (!stream.isTTY) return false

  const fd = typeof stream.fd === "number"
    ? stream.fd
    : stream === process.stdout ? 1 : undefined

  if (fd !== undefined) {
    try {
      writeSync(fd, TERMINAL_MODE_RESET)
      return true
    } catch {
      // Fall through to stream.write for mocked or unusual TTY streams.
    }
  }

  try {
    stream.write(TERMINAL_MODE_RESET)
    return true
  } catch {
    return false
  }
}

/**
 * Wire exit-path hooks so the reset blob fires on every shutdown
 * route: clean exit, signals (SIGINT/SIGTERM/SIGHUP), and uncaught
 * throws. Idempotent — calling more than once is a no-op.
 *
 * On signals we let the process continue to exit naturally after the
 * reset; we don't `process.exit(code)` ourselves because that would
 * race with OpenTUI's own signal handler (which has its own
 * alt-screen cleanup). The reset is synchronous stdout writeSync, so
 * it always lands before the process reaps.
 */
let wired = false

/** Benign when OpenTUI's console capture owns stderr/stdout pipes (Windows). */
export function isPipeNoise(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "EPIPE")
    return true
  const s = err instanceof Error ? err.message : String(err)
  return /EPIPE|broken pipe/i.test(s)
}

export function safeStderrWrite(chunk: string): void {
  try {
    process.stderr.write(chunk)
  } catch (e) {
    if (!isPipeNoise(e)) throw e
  }
}

/** Drop EPIPE from hijacked console methods (OpenTUI overlay). */
export function installConsolePipeNoiseFilter(): void {
  const wrap = (level: "log" | "info" | "warn" | "error" | "debug") => {
    const orig = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      if (args.some(a => isPipeNoise(a))) return
      const text = args.map(a => (typeof a === "string" ? a : "")).join(" ")
      if (/EPIPE|broken pipe/i.test(text)) return
      orig(...args)
    }
  }
  wrap("error")
  wrap("warn")
}

/** Swallow EPIPE on stdio streams after the renderer hijacks them. */
export function installStderrPipeGuard(): void {
  const on = (err: Error) => { if (isPipeNoise(err)) return }
  process.stderr.on("error", on)
  process.stdout.on("error", on)
}

function crashLog(label: string, err: unknown) {
  if (isPipeNoise(err)) return
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err)
  const line = `${new Date().toISOString()} ${label}\n${msg}\n`
  try {
    const home = process.env.HERMES_HOME || join(homedir(), ".hermes")
    appendFileSync(join(home, "herm-crash.log"), line)
  } catch { /* best-effort */ }
  safeStderrWrite(`herm: ${label}\n${msg}\n`)
}

export function installExitResetHooks(): void {
  if (wired) return
  wired = true

  // Normal exit — fires on process.exit() and on main() falling off.
  // `exit` handler must be synchronous (node discards async work).
  process.on("exit", () => { resetTerminalModes() })

  // Do not register SIGINT/SIGTERM here — AppInner wires SIGINT → quit()
  // after mount, and OpenTUI registers its own exitSignals on the renderer.
  // Duplicate SIGINT handlers caused immediate process.exit(130) races.
}

/** Log fatal async errors without tearing down the TUI (boot catches RPC). */
export function logAsyncFatal(label: string, err: unknown): void {
  crashLog(label, err)
}
