// Gateway event stream → turn reducer. Owns delta batching, the
// client-side interrupt latch, and the Side-effect hooks mapEvent
// calls out to. Pulled from AppInner so the shell only wires setters.

import type React from "react"
import { useCallback, useEffect, useRef, type RefObject } from "react"
import * as spawnHistory from "./spawnHistory"
import * as preferences from "../context/preferences"
import { useGateway, useGatewayEvent } from "../context/gateway"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { openAlert } from "../dialogs/alert"
import { mapEvent } from "../context/events"
import { deriveSkin, type SkinState } from "../context/skin"
import { useBackground } from "./background"
import type { Action } from "./turnReducer"
import type { useSession } from "./useSession"
import type { GatewayEvent, SessionInfo } from "../context/wire"
import type { Usage } from "../types/message"
import type { Launch } from "./launch"
import { syncProcessCwd } from "../utils/cwd"

type Ctx = {
  dispatch: React.Dispatch<Action>
  session: ReturnType<typeof useSession>
  launchRef: RefObject<Launch>
  sidRef: RefObject<string>
  sessionStart: RefObject<number>
  goalHook: { check: (sid: string) => void }

  setSid: (id: string) => void
  setInfo: (i: SessionInfo) => void
  setReady: (r: boolean) => void
  setTitle: (t: string) => void
  setBusy: (m: "queue" | "steer" | "interrupt") => void
  setUsage: (u: Usage | undefined) => void
  setStatus: (s: string) => void
  setSkin: (s: SkinState) => void
  setErrorPulse: (v: boolean) => void
  settle: () => void
}

// Events that mutate the in-progress assistant turn. Everything else
// (system messages, session.info, toasts, completion, side channels)
// is orthogonal to the stream and passes the interrupt gate.
const STREAM_EVENTS = new Set<GatewayEvent["type"]>([
  "message.start",
  "message.delta", "reasoning.delta", "reasoning.available", "thinking.delta",
  "tool.start", "tool.progress", "tool.generating",
])
const TITLE_DELAYS = [1200, 5000, 15000, 30000] as const

export function useStream(c: Ctx) {
  const gw = useGateway()
  const dialog = useDialog()
  const toast = useToast()
  const bg = useBackground()
  const ctx = useRef(c); ctx.current = c
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    if (deltas.current.timer) clearTimeout(deltas.current.timer)
  }, [])

  // Client-side interrupt latch: flipped on Esc×2 before the gateway
  // has confirmed the stop. Stream-mutation events still in the stdio
  // pipe (already written by the agent thread before it saw the
  // interrupt flag) are dropped until the NEXT user send — not
  // message.complete — because run_agent's worker thread can keep
  // emitting after the monitor thread's InterruptedError has already
  // ended the turn.
  const interrupted = useRef(false)
  const info = useRef(false)

  // Delta batching: streamed text/reasoning chunks accumulate in a
  // ref and flush at most once per 16ms. Every delta otherwise
  // triggers an O(messages) array spread + O(content) string concat +
  // full markdown re-parse of the streaming block. Any non-delta
  // action flushes synchronously first so part ordering is preserved.
  const deltas = useRef({ text: "", think: "", timer: null as ReturnType<typeof setTimeout> | null })

  const flush = useCallback(() => {
    const d = deltas.current
    if (d.timer) { clearTimeout(d.timer); d.timer = null }
    if (d.think) { ctx.current.dispatch({ kind: "thinking", text: d.think, final: false }); d.think = "" }
    if (d.text) { ctx.current.dispatch({ kind: "message.delta", chunk: d.text }); d.text = "" }
  }, [])

  const sync = useCallback((ms = 0) => {
    const run = () => gw.request<{ title?: string; session_key?: string }>("session.title")
      .then(r => {
        ctx.current.setTitle(r.title ?? "")
        if (r.session_key) preferences.set("lastSessionId", r.session_key)
      })
      .catch(() => {})
    if (ms <= 0) return run()
    const id = setTimeout(() => {
      timers.current = timers.current.filter(t => t !== id)
      run()
    }, ms)
    timers.current.push(id)
  }, [gw])

  const handle = useCallback((ev: GatewayEvent) => {
    const x = ctx.current
    if (ev.type === "gateway.ready") info.current = false
    if (ev.type === "background.complete" && ev.session_id && x.sidRef.current
        && ev.session_id !== x.sidRef.current) {
      bg.unregister(ev.payload.task_id)
      return
    }
    const shared = ev.type === "background.complete" && !ev.session_id
    if (ev.session_id && x.sidRef.current && ev.session_id !== x.sidRef.current && !ev.type.startsWith("gateway.") && !shared) return
    // The agent's stream-retry loop (run_agent._call) classifies the
    // force-closed httpx socket from an interrupt as a transient drop
    // and emits "Reconnecting…" lifecycle status before the top-of-loop
    // interrupt guard catches it. Drain those (and any ghost stream
    // events from the clear_interrupt race) until the next user send.
    if (interrupted.current) {
          if (STREAM_EVENTS.has(ev.type)) return
          if (ev.type === "status.update" && ev.payload?.kind === "lifecycle") return
        }
        const action = mapEvent(ev, {
      onReady: () => {
        x.session.boot(x.launchRef.current).then((r) => {
          x.setSid(r.id)
          if (r.info) { x.setInfo(r.info); x.setUsage(r.info.usage) }
          x.sessionStart.current = Date.now()
          if (r.messages.length) x.dispatch({ kind: "load", messages: r.messages })
          if (r.note) toast.show({ variant: "info", message: r.note })
        }).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          process.stderr.write(`herm: session boot failed: ${msg}\n`)
          toast.show({ variant: "error", message: `session boot failed: ${msg}` })
          x.dispatch({ kind: "system", text: `session boot failed: ${msg}` })
        })
      },
      onSessionInfo: (si) => {
        syncProcessCwd(si.cwd)
        x.setInfo(si)
        x.setReady(true)
        // Don't overwrite sid with si.session_id — that's the DB key,
        // not the live short id that prompt.submit / session.history
        // need. The live id is already correct from session.create /
        // session.activate.
        x.settle()
        const bad = (si.mcp_servers ?? []).filter(s => !s.connected)
        if (bad.length) x.dispatch({
          kind: "system",
          text: `MCP: ${bad.length} server(s) failed to connect — ${bad.map(s => s.name + (s.error ? ` (${s.error})` : "")).join(", ")}`,
        })
        sync()
        gw.request<{ value?: string }>("config.get", { key: "busy" }).then(r => {
          const m = r.value
          if (m === "queue" || m === "steer" || m === "interrupt") x.setBusy(m)
        }).catch(() => {})
      },
      onUsage: (u) => x.setUsage(u),
      onTurnComplete: () => {
        x.setStatus("")
        spawnHistory.flush(gw, x.sidRef.current)
        x.goalHook.check(x.sidRef.current)
        TITLE_DELAYS.forEach(sync)
      },
      onBackground: (tid, text) => {
        const title = bg.label(tid)
        bg.unregister(tid)
        x.dispatch({ kind: "background", id: tid, title, text })
      },
      onBtw: (text) => {
        x.dispatch({ kind: "system", text: `◈ btw\n\n${text}` })
        const preview = text.split("\n")[0].slice(0, 160)
        toast.show({
          variant: "info", title: "btw", message: preview, duration: 8000,
          action: { label: "view", run: () => openAlert(dialog, "btw", text) },
        })
      },
      onStatus: (text) => x.setStatus(text),
      onApprovalRemembered: () => {
        void gw.request("approval.respond", { choice: "always" }).catch(() => {})
      },
      onSkin: (s) => x.setSkin(deriveSkin(s)),
      notices: toast,
    })
    if (!action) return
    if (ev.type === "session.info") {
      if (info.current) return
      info.current = true
    }
    const d = deltas.current
    if (action.kind === "message.delta") {
      if (d.think) flush()
      d.text += action.chunk
      d.timer ??= setTimeout(flush, 16)
      return
    }
    if (action.kind === "thinking" && !action.final) {
      if (d.text) flush()
      d.think += action.text
      d.timer ??= setTimeout(flush, 16)
      return
    }
    flush()
    if (action.kind === "error") x.setErrorPulse(true)
    x.dispatch(action)
  }, [gw, dialog, toast, flush, bg])

  useGatewayEvent(handle)

  const doInterrupt = useCallback(() => {
    interrupted.current = true
    // Drop any 16ms-batched deltas that haven't hit the reducer yet —
    // flushing them would append post-interrupt text.
    const d = deltas.current
    if (d.timer) { clearTimeout(d.timer); d.timer = null }
    d.text = ""; d.think = ""
    ctx.current.session.interrupt()
  }, [])

  return { interrupted, doInterrupt }
}