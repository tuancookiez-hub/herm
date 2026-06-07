// Gateway event stream → turn reducer. Owns delta batching, the
// client-side interrupt latch, and the Side-effect hooks mapEvent
// calls out to. Pulled from AppInner so the shell only wires setters.

import type React from "react"
import { useCallback, useRef, type RefObject } from "react"
import * as spawnHistory from "./spawnHistory"
import * as preferences from "../context/preferences"
import { useGateway, useGatewayEvent } from "../context/gateway"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { openAlert } from "../dialogs/alert"
import { formatProcessNotification, mapEvent } from "../context/events"
import { deriveSkin, type SkinState } from "../context/skin"
import { useBackground } from "./background"
import type { Action } from "./turnReducer"
import type { useSession } from "./useSession"
import type { GatewayEvent, SessionInfo } from "../context/wire"
import type { Usage } from "../types/message"
import type { Launch } from "./launch"

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
}

// Events that mutate the in-progress assistant turn. Everything else
// (system messages, session.info, toasts, completion, side channels)
// is orthogonal to the stream and passes the interrupt gate.
const STREAM_EVENTS = new Set<GatewayEvent["type"]>([
  "message.start",
  "message.delta", "reasoning.delta", "reasoning.available", "thinking.delta",
  "tool.start", "tool.progress", "tool.generating",
])

export function useStream(c: Ctx) {
  const gw = useGateway()
  const dialog = useDialog()
  const toast = useToast()
  const bg = useBackground()
  const ctx = useRef(c); ctx.current = c

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

  // Process notification batching: status.update/kind=process events
  // accumulate over a 500ms window and dispatch as one combined system
  // message. Prevents TUI lag when many background processes finish
  // in rapid succession (each one otherwise triggers a full React
  // re-render of the Chat transcript).
  const procs = useRef<{ texts: string[]; timer: ReturnType<typeof setTimeout> | null }>(
    { texts: [], timer: null },
  )

  const flush = useCallback(() => {
    const d = deltas.current
    if (d.timer) { clearTimeout(d.timer); d.timer = null }
    if (d.think) { ctx.current.dispatch({ kind: "thinking", text: d.think, final: false }); d.think = "" }
    if (d.text) { ctx.current.dispatch({ kind: "message.delta", chunk: d.text }); d.text = "" }
  }, [])

  // Flush accumulated process notifications as one combined system msg.
  const flushProcs = useCallback(() => {
    const n = procs.current
    if (n.timer) { clearTimeout(n.timer); n.timer = null }
    if (!n.texts.length) return
    const batch = n.texts.splice(0)
    const lines = batch.map(t => `  ${formatProcessNotification(t)}`)
    ctx.current.dispatch({
      kind: "system",
      text: batch.length === 1
        ? `◆ background ${lines[0].trim()}`
        : `◆ ${batch.length} background notifications\n${lines.join("\n")}`,
    })
  }, [])

  const handle = useCallback((ev: GatewayEvent) => {
    const x = ctx.current
    if (ev.type === "gateway.ready") info.current = false
    if (ev.session_id && x.sidRef.current && ev.session_id !== x.sidRef.current && !ev.type.startsWith("gateway.")) return
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
        })
      },
      onSessionInfo: (si) => {
        x.setInfo(si)
        x.setReady(true)
        if (si.session_id) x.setSid(si.session_id)
        const bad = (si.mcp_servers ?? []).filter(s => !s.connected)
        if (bad.length) x.dispatch({
          kind: "system",
          text: `MCP: ${bad.length} server(s) failed to connect — ${bad.map(s => s.name + (s.error ? ` (${s.error})` : "")).join(", ")}`,
        })
        gw.request<{ title: string; session_key?: string }>("session.title").then(r => {
          x.setTitle(r.title ?? "")
          if (r.session_key) preferences.set("lastSessionId", r.session_key)
        }).catch(() => {})
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
      },
      onBackground: (tid, text) => {
        bg.unregister(tid)
        const head = text.split("\n")[0].slice(0, 80)
        x.dispatch({ kind: "system", text: `◷ background task ${tid} complete — ${head}` })
        toast.show({
          variant: "info", title: "Background task complete", message: head,
          duration: 8000,
          action: { label: "view", run: () => openAlert(dialog, `Background task ${tid}`, text) },
        })
      },
      onBtw: (text) => {
        const head = text.split("\n")[0].slice(0, 80)
        x.dispatch({ kind: "system", text: `◈ btw — ${head}` })
        toast.show({
          variant: "info", title: "btw", message: head, duration: 8000,
          action: { label: "view", run: () => openAlert(dialog, "btw", text) },
        })
      },
      onStatus: (text) => x.setStatus(text),
      onApprovalRemembered: () => {
        void gw.request("approval.respond", { choice: "always" }).catch(() => {})
      },
      onProcessNotification: (text) => {
        const n = procs.current
        n.texts.push(text)
        if (n.timer) clearTimeout(n.timer)
        n.timer = setTimeout(flushProcs, 500)
      },
      onSkin: (s) => x.setSkin(deriveSkin(s)),
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
  }, [gw, dialog, toast, flush])

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
