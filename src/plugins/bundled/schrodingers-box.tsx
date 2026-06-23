// Schrödinger's Box — herm tab.
// Lanes are REAL hermes sessions, branched from the active chat at
// fork-time. Both branches inherit the full message history; we submit
// the same user prompt to each (optionally with a per-lane hint) and
// let hermes run them in parallel. The tab shows the streamed
// assistant replies side-by-side; picking one activates that branch
// as the new active session. The on-disk dir is `.schrodinger/`
// (renamed from `.multiverse/`). For backward compatibility with
// forks created before the rename, the file readers fall back to
// `.multiverse/` if `.schrodinger/` is missing.

import { readFileSync, existsSync, mkdirSync } from "fs"
import { join } from "path"
import { useEffect, useRef, useState } from "react"
import { useKeyboard } from "@opentui/react"
import type { HermPlugin, HermPluginApi } from "../types"
import { resolveSchrodingerRoot, schrodingerDirFor } from "../../utils/schrodinger-root"
import { safeGroupId, writeJsonQueued } from "../../utils/schrodinger-io"
import { openModelPicker } from "../../dialogs/model-picker"

const POLL_MS = 1000
const TAB_NAME = "Schrödinger's Box"

type Phase = "configure" | "running" | "compare"
type Lane = {
  id: string
  label: string
  session_id: string          // live short id — for prompt.submit + event filter
  db_session_id?: string      // persisted DB key — for merge / history
  session_title?: string
  provider: string
  model: string
  prompt: string
  default_prompt?: string
  baseline_count?: number
  status: "ready" | "running" | "ready_message" | "error"
  text?: string
  error?: string
}
type Group = {
  group_id: string
  phase: Phase
  user_prompt: string
  project_root: string
  parent_session_id: string
  owner_session_id?: string
  owner_live_session_id?: string
  owner_process_pid?: number
  branch_a?: string
  branch_b?: string
}

function readText(path: string): string {
  try { return existsSync(path) ? readFileSync(path, "utf-8") : "" } catch { return "" }
}
function readJson<T>(path: string, fallback: T): T {
  try { return JSON.parse(readFileSync(path, "utf-8")) as T } catch { return fallback }
}
function loadActive(root: string): Group | null {
  const raw = readJson<any>(join(root, schrodingerDirFor(root), "active.json"), null)
  if (!raw) return null
  return {
    group_id: raw.group_id,
    phase: raw.phase,
    user_prompt: raw.user_prompt ?? "",
    project_root: raw.project_root ?? root,
    parent_session_id: raw.parent_session_id ?? "",
    owner_session_id: raw.owner_session_id,
    owner_live_session_id: raw.owner_live_session_id,
    owner_process_pid: raw.owner_process_pid,
    branch_a: raw.branch_a,
    branch_b: raw.branch_b,
  }
}

function AgamottoTab(props: { api: HermPluginApi; currentSessionId?: string; liveSessionId?: string }) {
  const { api, currentSessionId, liveSessionId } = props
  const t = api.theme.current
  const projectRoot = resolveSchrodingerRoot()

  // ─── ALL HOOKS — must be called in the same order every render ───
  const [active, setActive] = useState<Group | null>(null)
  const [hiddenActive, setHiddenActive] = useState<Group | null>(null)
  const [lanes, setLanes] = useState<Lane[]>([])
  const [laneText, setLaneText] = useState<Record<string, string>>({})
  const [focusIdx, setFocusIdx] = useState(0)
  const [phase, setPhase] = useState<Phase>("configure")
  const lastGroupId = useRef<string>("")
  // Track which session_ids belong to which lane, for event filtering.
  const sessionToLane = useRef<Record<string, string>>({})
  // Accumulate streaming text per lane. This is the source of truth while
  // a response is streaming; polling must never blank it or the cards flash
  // "(no response)" between deltas.
  const streamBuf = useRef<Record<string, string>>({})
  const streamDone = useRef<Record<string, boolean>>({})

  function ownsGroup(a: Group | null): boolean {
    if (!a) return false
    if (a.owner_live_session_id && liveSessionId && a.owner_live_session_id === liveSessionId) return true
    const owner = a.owner_session_id || a.parent_session_id
    if (owner && currentSessionId && owner === currentSessionId) return true
    return false
  }

  // Listen for message.delta / message.complete events from branched
  // sessions. The gateway emits these with session_id — we filter to
  // only our lanes' sessions and accumulate the text in real time.
  useEffect(() => {
    const off = api.event.on((ev) => {
      const sid = ev.session_id
      if (!sid) return
      const laneId = sessionToLane.current[sid]
      if (!laneId) return  // not one of our lanes
      if (ev.type === "message.delta") {
        const chunk = ev.payload?.text ?? ""
        if (chunk) {
          streamBuf.current[laneId] = (streamBuf.current[laneId] || "") + chunk
          setLaneText((prev) => ({ ...prev, [laneId]: streamBuf.current[laneId] }))
        }
      } else if (ev.type === "message.complete") {
        const finalText = ev.payload?.text
        if (finalText) {
          streamBuf.current[laneId] = finalText
          setLaneText((prev) => ({ ...prev, [laneId]: finalText }))
        }
        streamDone.current[laneId] = true
      }
    })
    return () => { off() }
  }, [api])

  // Polling loop: read active.json, manifest, fetch each lane's
  // session.history. The manifest's phase is the source of truth
  // (configure → running → compare). We flip running → compare when
  // both lanes have a fresh assistant message since the manifest's
  // submit timestamp.
  const submitTimestampRef = useRef<string>("")
  useEffect(() => {
    if (!projectRoot) return
    const tick = async () => {
      const a = loadActive(projectRoot)
      if (a && !ownsGroup(a)) {
        setHiddenActive(a)
        setActive(null)
        setLanes([])
        setLaneText({})
        sessionToLane.current = {}
        streamBuf.current = {}
        streamDone.current = {}
        return
      }
      setHiddenActive(null)
      setActive(a)
      if (!a) { setLanes([]); setLaneText({}); setPhase("configure"); return }
      if (!safeGroupId(a.group_id)) return
      if (a.group_id !== lastGroupId.current) {
        lastGroupId.current = a.group_id
        submitTimestampRef.current = ""
        // Clear stream buffers for the new group.
        streamBuf.current = {}
        streamDone.current = {}
        sessionToLane.current = {}
        api.kv.set("multiverse.ackOpen", a.group_id)
      }
      const manifestPath = join(projectRoot, schrodingerDirFor(projectRoot), "groups", a.group_id, "manifest.json")
      let m = readJson<any>(manifestPath, { lanes: [], phase: "configure" })
      const p: Phase = m.phase === "running" || m.phase === "compare" ? m.phase : "configure"
      setPhase(p)
      setLanes(m.lanes ?? [])

      // Update session-to-lane mapping for the event listener.
      for (const lane of (m.lanes ?? []) as Lane[]) {
        if (lane.session_id) {
          sessionToLane.current[lane.session_id] = lane.id
        }
      }

      // Only fetch session.history when at least one lane is running
      // (i.e. user has clicked Run). In configure phase, we skip the
      // network calls entirely.
      const isLivePhase = m.phase === "running" || m.phase === "compare"
      const polledTextByLane: Record<string, string> = {}
      if (isLivePhase) {
        for (const lane of (m.lanes ?? []) as Lane[]) {
          if (!lane.session_id) continue
          try {
            const hist = await api.client.request<{ messages: any[] }>(
              "session.history",
              { session_id: lane.session_id }
            )
            const allMessages = hist.messages ?? []
            // The branched session inherited the original chat's history.
            // Record the initial count at fork time so we can skip the
            // inherited messages and only show the NEW lane response.
            // On first poll during "running" phase, capture the baseline.
            if (m.phase === "running" && lane.baseline_count === undefined) {
              const snap = { ...m, lanes: (m.lanes ?? []).map((l: Lane) =>
                l.id === lane.id ? { ...l, baseline_count: allMessages.length } : { ...l }
              ) }
              m = snap
              await writeJsonQueued(manifestPath, snap)
            }
            const laneRow = (m.lanes ?? []).find((l: Lane) => l.id === lane.id)
            const baseline = laneRow?.baseline_count ?? allMessages.length
            const newMessages = allMessages.slice(baseline)
            // The lane's response is the last assistant message AFTER
            // the baseline (i.e. the one added by prompt.submit on this
            // branched session).
            const lastNewAssistant = newMessages
              .filter((msg) => msg.role === "assistant")
              .pop()
            if (lastNewAssistant) {
              const polledText = (lastNewAssistant.content ?? lastNewAssistant.text ?? "")
                .toString()
                .replace(/<[^>]+>/g, "")
              // Prefer event-driven streaming text if available (it's
              // more real-time). Only fall back to polling text.
              polledTextByLane[lane.id] = streamBuf.current[lane.id] || polledText
            }
          } catch (e) {
            // session might not exist yet, or be a different session
          }
        }
        // Preserve live event-stream text across poll ticks. The old code
        // replaced the whole laneText map with `{}` whenever session.history
        // had not yet flushed a completed assistant message, causing the UI
        // to briefly render "(no response)" and shrink both cards.
        setLaneText((prev) => {
          const next = { ...prev }
          for (const lane of (m.lanes ?? []) as Lane[]) {
            const live = streamBuf.current[lane.id]
            const polled = polledTextByLane[lane.id]
            if (live || polled) next[lane.id] = live || polled
          }
          return next
        })

        // Auto-advance to compare phase when both lanes have actual text.
        // Do NOT count streamDone alone: some completion events can arrive
        // before final text has landed in either the stream buffer or DB
        // history. Advancing on an empty completion is what lets a fast lane
        // (often PATH B) flash READY/(no response).
        if (m.phase === "running") {
          const allHave = (m.lanes ?? []).every((l: Lane) => {
            const live = streamBuf.current[l.id] || ""
            const polled = polledTextByLane[l.id] || ""
            return live.length > 0 || polled.length > 0
          })
          if (allHave && (m.lanes ?? []).length > 0) {
            const snap = { ...m, phase: "compare" as Phase }
            m = snap
            await writeJsonQueued(manifestPath, snap)
            const activePath = join(projectRoot, schrodingerDirFor(projectRoot), "active.json")
            const aj = readJson<any>(activePath, null)
            if (aj) await writeJsonQueued(activePath, { ...aj, phase: "compare" })
          }
        }
      } else {
        setLaneText({})
      }
    }
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => clearInterval(id)
  }, [projectRoot, api, currentSessionId, liveSessionId])

  // All hooks below — must be called in the same order every render.
  useKeyboard((key) => {
    if (!active) return
    if (key.ctrl && (key.name === "r" || key.name === "R")) {
      if (phase === "configure") void runLanes()
      return
    }
    if (key.name === "left" || key.name === "up") setFocusIdx((i) => (i - 1 + lanes.length) % lanes.length)
    else if (key.name === "right" || key.name === "down") setFocusIdx((i) => (i + 1) % lanes.length)
    else if (key.name === "return" || key.name === "enter") {
      if (phase !== "compare") {
        api.ui.toast({ variant: "warning", message: `Phase is ${phase}, not compare yet. Wait for both lanes to finish.` })
        return
      }
      mergeFocused()
    }
  })

  // No project root → fatal config error
  if (!projectRoot) {
    return (
      <box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1} gap={1}>
        <text fg={t.accent}>Schrödinger's Box</text>
        <text fg={t.textMuted}>Set <strong>SCHRODINGER_PROJECT_ROOT</strong> in your launcher env, then click an assistant message → "Fork into Schrödinger's Box".</text>
      </box>
    )
  }
  if (!active) {
    return (
      <box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1} gap={1}>
        <text fg={t.accent}>{TAB_NAME}</text>
        <text fg={t.textMuted}>{hiddenActive ? "No active fork in this TUI session." : "No active fork."}</text>
        {hiddenActive ? (
          <text fg={t.textMuted}>Another Hermes session owns fork {hiddenActive.group_id}; stream output is intentionally hidden here.</text>
        ) : null}
        <text fg={t.textMuted}>In Chat, click an <strong>assistant message</strong> → <strong>Fork into Schrödinger's Box</strong>.</text>
        <text fg={t.textMuted}>Project: {projectRoot}</text>
      </box>
    )
  }

  // Phase comes from manifest via the polling effect (setPhase).

  // ─── Actions ───
  function pickPath(slot: "A" | "B") {
    openModelPicker(api.ui.dialog, api.client, {
      title: `Schrödinger's Box · Path ${slot}`,
      onApply: async (provider, model) => {
        if (!active) return
        const idx = slot === "A" ? 0 : 1
        const manifestPath = join(projectRoot, schrodingerDirFor(projectRoot), "groups", active.group_id, "manifest.json")
        const m = readJson<any>(manifestPath, { lanes: [] })
        const newLanes = [...(m.lanes ?? [])]
        newLanes[idx] = { ...newLanes[idx], provider, model }
        m.lanes = newLanes
        void writeJsonQueued(manifestPath, m)
        setLanes(newLanes)
        api.ui.toast({ variant: "success", message: `Path ${slot} → ${provider}/${model}` })
      },
    })
  }

  function setLanePrompt(slot: "A" | "B", text: string) {
    if (!active) return
    const idx = slot === "A" ? 0 : 1
    const manifestPath = join(projectRoot, schrodingerDirFor(projectRoot), "groups", active.group_id, "manifest.json")
    const m = readJson<any>(manifestPath, { lanes: [] })
    const newLanes = [...(m.lanes ?? [])]
    newLanes[idx] = { ...newLanes[idx], prompt: text }
    m.lanes = newLanes
    void writeJsonQueued(manifestPath, m)
    setLanes(newLanes)
  }

  function mirrorPrompts(from: "A" | "B", to: "B" | "A") {
    const src = lanes[from === "A" ? 0 : 1]?.prompt ?? ""
    setLanePrompt(to, src)
    api.ui.toast({ variant: "info", message: `Copied PATH ${from} prompt → PATH ${to}` })
  }

  // Sync both lanes to PATH A's prompt. Useful when you type once and
  // want both lanes to run with identical prompts but different models.
  function syncBoth() {
    const a = lanes[0]?.prompt ?? ""
    setLanePrompt("B", a)
    api.ui.toast({ variant: "info", message: "Both lanes set to PATH A's prompt" })
  }

  function clearPrompts() {
    setLanePrompt("A", "")
    setLanePrompt("B", "")
    api.ui.toast({ variant: "info", message: "Both prompts cleared" })
  }

  // Run both lanes in parallel via prompt.submit to their branched
  // session_ids. Each branch has full history; hermes runs them as
  // separate turns on separate sessions.
  async function runLanes() {
    if (!active) return
    const manifestPath = join(projectRoot, schrodingerDirFor(projectRoot), "groups", active.group_id, "manifest.json")
    const m = readJson<any>(manifestPath, { lanes: [] })

    // Capture each lane's baseline BEFORE prompt.submit. The old code
    // captured baseline_count on the first polling tick after Run; a fast
    // lane could finish before that tick, so its assistant message became
    // part of the baseline and got sliced away as "old history". That is
    // the race behind intermittent READY/(no response), often on PATH B.
    for (const lane of (m.lanes ?? []) as Lane[]) {
      if (!lane.session_id) continue
      try {
        const hist = await api.client.request<{ messages: any[] }>(
          "session.history",
          { session_id: lane.session_id }
        )
        lane.baseline_count = (hist.messages ?? []).length
      } catch {
        // If history is temporarily unavailable, leave the old fallback in
        // the poller; don't block Run. This should be rare because branch
        // sessions are created before the tab opens.
      }
      streamBuf.current[lane.id] = ""
      streamDone.current[lane.id] = false
    }
    setLaneText({})

    // Update active.json + manifest phase → "running" so the tab
    // shows the streaming view.
    m.phase = "running"
    await writeJsonQueued(manifestPath, m)
    const activePath = join(projectRoot, schrodingerDirFor(projectRoot), "active.json")
    const a = readJson<any>(activePath, null)
    if (a) await writeJsonQueued(activePath, { ...a, phase: "running" })

    // Submit each lane's prompt to its branched session.
    // Uses the user's typed prompt, falling back to default_prompt
    // (the original forked message) only if the user left it blank.
    const promises = (m.lanes ?? []).map(async (lane: Lane) => {
      const promptToSend = (lane.prompt && lane.prompt.trim()) || lane.default_prompt || ""
      if (!promptToSend) {
        api.ui.toast({ variant: "error", message: `PATH ${lane.label?.slice(-1)} has no prompt` })
        return
      }
      try {
        await api.client.request("prompt.submit", {
          session_id: lane.session_id,
          text: promptToSend,
          model: lane.model || undefined,
          provider: lane.provider || undefined,
        })
        api.ui.toast({ variant: "info", message: `PATH ${lane.label?.slice(-1)} submitted to ${lane.model || "session default"}` })
      } catch (e) {
        api.ui.toast({ variant: "error", message: `PATH ${lane.label} submit failed: ${(e as Error).message}` })
      }
    })
    await Promise.all(promises)
  }

  // Merge = switch the active session to the chosen branch. Herm has
  // no real merge primitive, so "merging" here means:
  //   1. activate the chosen branch's session (becomes the new timeline)
  //   2. record the choice in the manifest so the user can see lineage
  //   3. switch the UI back to Chat
  // The other branch is preserved in state.db with the parent link,
  // so /sessions can find it. This is "collapse the wave function" —
  // pick the alive timeline, kill the unobserved one (it survives in
  // /sessions if you want to revisit).
  // Collapse the wave function: pick the alive timeline. No merge —
  // just activate the chosen branched session in the Chat tab. The
  // user continues from there. The other branch stays in /sessions.
  async function mergeFocused() {
    if (!active || phase !== "compare") return
    const focused = lanes[focusIdx]
    if (!focused?.session_id) {
      api.ui.toast({ variant: "error", message: "No session_id for this lane" })
      return
    }
    api.ui.toast({
      title: "Collapsing the wave function",
      message: `Resuming ${focused.label} (${focused.model || "default"})…`,
      variant: "success",
    })
    // Record the choice in the manifest for lineage.
    try {
      const manifestPath = join(projectRoot, schrodingerDirFor(projectRoot), "groups", active.group_id, "manifest.json")
      const m = readJson<any>(manifestPath, { lanes: [] })
      m.merged_lane = focused.id
      m.merged_at = new Date().toISOString()
      m.lanes = (m.lanes ?? []).map((l: Lane) =>
        l.id === focused.id ? { ...l, status: "merged" } : { ...l, status: "archived" }
      )
      await writeJsonQueued(manifestPath, m)
    } catch (e) {
      api.ui.toast({ variant: "error", message: `Manifest merge failed: ${(e as Error).message}` })
    }
    // Signal app.tsx to switch to the chosen session.
    try {
      const activePath = join(projectRoot, schrodingerDirFor(projectRoot), "active.json")
      const aj = readJson<any>(activePath, null)
      if (aj) {
        await writeJsonQueued(activePath, {
          ...aj,
          activate_session_id: focused.session_id,
          phase: "merged",
        })
      }
    } catch (e) {
      api.ui.toast({ variant: "error", message: `Activate failed: ${(e as Error).message}` })
      return
    }
    setTimeout(() => api.route.navigate("Chat"), 400)
  }

  function peekBranch(lane: Lane) {
    if (!lane.session_id) {
      api.ui.toast({ variant: "error", message: "No session_id for this lane" })
      return
    }
    api.ui.toast({
      title: "Branch details",
      message: `${lane.label}: ${lane.provider}/${lane.model || "default"} · /resume ${lane.session_id}`,
      variant: "info",
    })
  }

  // ─── Render ───
  // If the lanes haven't been configured yet, show the CONFIGURE view.
  if (phase === "configure") {
    return (
      <CONFIGURE_VIEW
        api={api}
        t={t}
        active={active}
        lanes={lanes}
        focusIdx={focusIdx}
        setFocusIdx={setFocusIdx}
        pickPath={pickPath}
        setLanePrompt={setLanePrompt}
        mirrorPrompts={mirrorPrompts}
        syncBoth={syncBoth}
        clearPrompts={clearPrompts}
        runLanes={runLanes}
      />
    )
  }

  return (
    <box flexDirection="row" flexGrow={1}>
      <box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1} gap={1}>
        {/* Big user prompt at the top, exactly like the mock. The
            prompt IS the story; everything below is execution. */}
        <text fg={t.accent} wrapMode="word">&gt; {active.user_prompt}</text>

        {/* Subtle single-line status. No more double narration. */}
        {phase === "running" ? (
          <text fg={t.textMuted} wrapMode="word">Hermes heard the call — {lanes.length} parallel paths spawning…</text>
        ) : phase === "compare" ? (
          <text fg={t.textMuted} wrapMode="word">Split complete — choose one to collapse into your timeline.</text>
        ) : null}

        <box flexDirection="row" flexGrow={1} height="100%" gap={1}>
          {lanes.map((lane, i) => {
            const text = laneText[lane.id] || ""
            const isFocused = i === focusIdx
            const modelName = lane.model || "(no model)"
            // Per-lane state. Three stages the user always sees:
            //   1. submitting — prompt.submit() just fired, no reply yet
            //   2. thinking    — lane is alive, no text yet
            //   3. streaming   — partial text has arrived
            //   4. ready       — both lanes done (phase === "compare")
            const isReady = phase === "compare"
            const isStreaming = phase === "running" && text.length > 0
            const isThinking = phase === "running" && text.length === 0
            const isSubmitting = phase === "running" && text.length === 0
            // The user-typed prompt for this lane (falls back to default).
            const lanePrompt = lane.prompt && lane.prompt.trim() ? lane.prompt : (lane.default_prompt || "")
            return (
              <box key={lane.id} flexGrow={1} height="100%" flexDirection="column" border
                   borderColor={isFocused ? t.accent : t.border} paddingX={1} paddingY={1} gap={1}>
                {/* Minimal header: just the path label and a status pill. */}
                <box flexDirection="row" gap={1}>
                  <text fg={isFocused ? t.accent : t.textMuted} wrapMode="word">{lane.label}</text>
                  <text fg={t.textMuted} wrapMode="word">·</text>
                  <text fg={t.textMuted} wrapMode="word">{modelName}</text>
                </box>
                {/* The prompt this lane was actually given — visible
                    above the reply so the user can verify what's running. */}
                {lanePrompt ? (
                  <box flexDirection="column" gap={0}>
                    <text fg={t.textMuted} wrapMode="word">prompt:</text>
                    <text fg={t.text} wrapMode="word">{lanePrompt}</text>
                  </box>
                ) : (
                  <text fg={t.textMuted} wrapMode="word">(no prompt set)</text>
                )}
                {/* Status pill — three animated-looking states. */}
                {isReady ? (
                  <text fg={t.accent} wrapMode="word">[ READY · {text.length} chars ]</text>
                ) : isStreaming ? (
                  <text fg={t.accent} wrapMode="word">[ streaming… {text.length} chars ]</text>
                ) : isThinking ? (
                  <text fg={t.accent} wrapMode="word">[ ⏳ thinking… ]</text>
                ) : isSubmitting ? (
                  <text fg={t.accent} wrapMode="word">[ ⚡ submitting to {modelName}… ]</text>
                ) : null}
                {/* The streamed reply — fills the card. */}
                <scrollbox
                  scrollY
                  stickyScroll
                  stickyStart="bottom"
                  flexGrow={1}
                  height="100%"
                  onMouseDown={() => setFocusIdx(i)}
                >
                  <text wrapMode="word">{text || (isReady ? "(no response)" : "")}</text>
                </scrollbox>
              </box>
            )
          })}
        </box>

        {phase === "compare" ? (
          <box flexDirection="row" gap={2}>
            <text fg={t.textMuted} wrapMode="word">←/→ or ↑/↓ focus</text>
            <text fg={t.textMuted} wrapMode="word">Enter merge</text>
            <text fg={t.textMuted} wrapMode="word">or click any card</text>
          </box>
        ) : phase === "running" ? (
          <text fg={t.textMuted} wrapMode="word">{lanes.filter((l) => laneText[l.id]?.length).length} / {lanes.length} done</text>
        ) : null}
      </box>

      {/* Right rail: actions only, minimal. */}
      <box width={32} flexDirection="column" border borderColor={t.border} paddingX={1} paddingY={1} gap={1}>
        <text fg={t.accent} wrapMode="word">{TAB_NAME}</text>
        <text wrapMode="word">Forks: {lanes.length}</text>
        {lanes.map((lane, i) => (
          <text key={lane.id} fg={i === focusIdx ? t.accent : t.text} wrapMode="word">
            {i === focusIdx ? "▶ " : "  "}{lane.label}
          </text>
        ))}

        {phase === "compare" ? (
          <box flexDirection="column" gap={1} marginTop={1}>
            <text fg={t.accent} onMouseDown={mergeFocused} wrapMode="word">[ ✓ {lanes[focusIdx]?.label} becomes real ]</text>
            {lanes.map((lane, i) => i !== focusIdx ? (
              <text key={lane.id} fg={t.textMuted} onMouseDown={() => peekBranch(lane)} wrapMode="word">[ 👁 peek {lane.label} ]</text>
            ) : null)}
          </box>
        ) : null}
      </box>
    </box>
  )
}

function CONFIGURE_VIEW(props: {
  api: HermPluginApi
  t: any
  active: Group
  lanes: Lane[]
  focusIdx: number
  setFocusIdx: (n: number) => void
  pickPath: (s: "A" | "B") => void
  setLanePrompt: (s: "A" | "B", t: string) => void
  mirrorPrompts: (f: "A" | "B", to: "B" | "A") => void
  syncBoth: () => void
  clearPrompts: () => void
  runLanes: () => void
}) {
  const { api, t, active, lanes, focusIdx, setFocusIdx, pickPath, setLanePrompt, mirrorPrompts, syncBoth, clearPrompts, runLanes } = props
  const pathA = lanes[0]
  const pathB = lanes[1]
  const bothPicked = pathA?.model && pathB?.model
  return (
    <box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1} gap={1}>
      <text fg={t.accent} wrapMode="word">Schrödinger's Box · {active.group_id} · configure</text>
      <text fg={t.textMuted} wrapMode="word">Branched from session {active.parent_session_id?.slice(0, 8) || "?"}…</text>
      <text fg={t.textMuted} wrapMode="word">Pick 2 models, then Run. The lanes share the same prompt + full chat history; pick which reply becomes your timeline.</text>

      <box flexDirection="row" gap={2}>
        <box flexGrow={1} flexDirection="column" border borderColor={t.border} paddingX={1} paddingY={1} gap={1}>
          <text fg={t.accent} wrapMode="word">PATH A</text>
          <text fg={t.textMuted} wrapMode="word">session: {pathA?.session_id?.slice(0, 8) || "?"}…</text>
          {pathA?.model ? (
            <box flexDirection="row" gap={1}>
              <text wrapMode="word">{pathA.provider}/{pathA.model}</text>
              <text fg={t.textMuted} onMouseDown={() => pickPath("A")} wrapMode="word">[change]</text>
            </box>
          ) : (
            <text fg={t.textMuted} onMouseDown={() => pickPath("A")} wrapMode="word">[ Pick model → ]</text>
          )}
          <text fg={t.textMuted} wrapMode="word">Prompt:</text>
          <input
            value={pathA?.prompt ?? ""}
            placeholder={pathA?.default_prompt ? `default: ${pathA.default_prompt.slice(0, 80)}${pathA.default_prompt.length > 80 ? "…" : ""}` : "type prompt for PATH A…"}
            onInput={(v) => setLanePrompt("A", v)}
            onSubmit={() => api.ui.toast({ variant: "info", message: "PATH A prompt saved" })}
            textColor={t.text}
            focused={focusIdx === 0}
          />
        </box>
        <box flexGrow={1} flexDirection="column" border borderColor={t.border} paddingX={1} paddingY={1} gap={1}>
          <text fg={t.accent} wrapMode="word">PATH B</text>
          <text fg={t.textMuted} wrapMode="word">session: {pathB?.session_id?.slice(0, 8) || "?"}…</text>
          {pathB?.model ? (
            <box flexDirection="row" gap={1}>
              <text wrapMode="word">{pathB.provider}/{pathB.model}</text>
              <text fg={t.textMuted} onMouseDown={() => pickPath("B")} wrapMode="word">[change]</text>
            </box>
          ) : (
            <text fg={t.textMuted} onMouseDown={() => pickPath("B")} wrapMode="word">[ Pick model → ]</text>
          )}
          <text fg={t.textMuted} wrapMode="word">Prompt:</text>
          <input
            value={pathB?.prompt ?? ""}
            placeholder={pathB?.default_prompt ? `default: ${pathB.default_prompt.slice(0, 80)}${pathB.default_prompt.length > 80 ? "…" : ""}` : "type prompt for PATH B…"}
            onInput={(v) => setLanePrompt("B", v)}
            onSubmit={() => api.ui.toast({ variant: "info", message: "PATH B prompt saved" })}
            textColor={t.text}
            focused={focusIdx === 1}
          />
        </box>
      </box>

      {/* Prompt helpers: fill both with the same text, or mirror one
          into the other. Click [both ← A] to type once in PATH A and
          copy to PATH B. Click [A→B] or [B→A] to copy an existing
          prompt to the other side. */}
      <box flexDirection="row" gap={2} flexWrap="wrap">
        <text fg={t.textMuted} wrapMode="word">prompts:</text>
        <text fg={t.textMuted} onMouseDown={() => syncBoth()} wrapMode="word">[ both ← A ]</text>
        <text fg={t.textMuted} onMouseDown={() => mirrorPrompts("A", "B")} wrapMode="word">[ A → B ]</text>
        <text fg={t.textMuted} onMouseDown={() => mirrorPrompts("B", "A")} wrapMode="word">[ B → A ]</text>
        <text fg={t.textMuted} wrapMode="word">·</text>
        <text fg={t.textMuted} onMouseDown={() => clearPrompts()} wrapMode="word">[ clear both ]</text>
      </box>

      {bothPicked ? (
        <box flexDirection="row" gap={2} marginTop={1}>
          <text fg={t.accent} onMouseDown={runLanes} wrapMode="word">[ Ctrl+R · Run both timelines in parallel → ]</text>
        </box>
      ) : (
        <text fg={t.textMuted} wrapMode="word">Pick both models to enable Run</text>
      )}
    </box>
  )
}

const plugin: HermPlugin = {
  id: "schrodinger.box",
  enabled: true,
  tui(api) {
    const root = resolveSchrodingerRoot()
    if (root) api.kv.set("schrodinger.projectRoot", root)

    api.route.register([{
      name: TAB_NAME,
      description: "Parallel paths — you pick the merge",
      render: (ctx) => <AgamottoTab api={api} currentSessionId={ctx?.sessionId} liveSessionId={ctx?.liveSessionId} />,
    }])
    api.command.register([
      { title: "Schrödinger's Box: open tab", value: "schrodinger.box.open", category: "Schrödinger", onSelect: () => api.route.navigate(TAB_NAME) },
    ])

    // Auto-navigate to the tab ONLY when a new active.json is created
    // with open_tab=true. We clear the flag after navigating.
    let lastSeenGroup = ""
    const navTick = setInterval(() => {
      const r = resolveSchrodingerRoot()
      if (!r) return
      const activePath = join(r, schrodingerDirFor(r), "active.json")
      const a = readJson<any>(activePath, null)
      if (!a) { lastSeenGroup = ""; return }
      const gid = a.group_id
      if (!gid || gid === lastSeenGroup) return
      lastSeenGroup = gid
      if (a.open_tab === true && a.owner_process_pid === process.pid) {
        a.open_tab = false
        void writeJsonQueued(activePath, { ...a, open_tab: false })
        api.route.navigate(TAB_NAME)
      }
    }, 500)
    api.lifecycle.onDispose(() => clearInterval(navTick))
  },
}

export default plugin