import { useRenderer, useTerminalDimensions } from "@opentui/react"
import { Profiler, useState, useEffect, useRef, useCallback, useMemo, useReducer, useSyncExternalStore } from "react"
import * as perf from "./utils/perf"
import { hasInterp, interpolate } from "./utils/interpolate"
import { GatewayProvider, useGateway, useGatewayRestart, type Gateway } from "./context/gateway"
import type { SessionInfo, TranscriptMessage, ImageAttachResponse } from "./context/wire"
import type { Message, Usage } from "./types/message"
import { text as msgText } from "./types/message"
import { CLOUD_MIN } from "./components/chat/ThoughtCloud"
import type { AvatarState } from "./components/avatar/states"
import { TabBar } from "./components/tabs/TabBar"
import { Sidebar, hidden as hiddenSidebar } from "./components/sidebar/Sidebar"
import { Chat } from "./tabs/Chat"
import { SessionsGroup } from "./tabs/SessionsGroup"
import { Automation } from "./tabs/Automation"
import { ConfigGroup } from "./tabs/ConfigGroup"
import { EikonGroup } from "./tabs/EikonGroup"
import { copySelection, copyText as clipCopy } from "./utils/clipboard"
import { ThemeProvider, useTheme } from "./theme"
import { DialogProvider, useDialog } from "./ui/dialog"
import { ToastProvider, useToast } from "./ui/toast"
import { CommandProvider } from "./ui/command"
import { KeysProvider } from "./keys"
import { Splash } from "./ui/Splash"
import { lastReal } from "./service/sessions-db"
import { readChangelog } from "./service/hermes-home"
import { openMessage } from "./dialogs/message"
import { openModelPicker } from "./dialogs/model-picker"
import { resolveSchrodingerRoot, schrodingerDirFor } from "./utils/schrodinger-root"
import { openTextPrompt } from "./dialogs/text-prompt"
import { parseEikonFile, type ParsedEikon } from "./components/avatar/eikon"
import { bundledEikonPath } from "./components/avatar/bundled"
import { pending as pendingPrompt, type PromptCardHandle } from "./components/chat/PromptCard"
import type { PromptWire } from "./components/chat/MessageItem"
import { resolve as resolveSlash } from "./app/slashCommands"
import { useSlashCommands } from "./app/useSlashCommands"
import { useSlash } from "./app/slash"
import { useStream } from "./app/useStream"
import { useBridge } from "./app/bridge"
import * as control from "./app/control"
import { Composer, type ComposerHandle } from "./components/chat/Composer"
import * as preferences from "./context/preferences"
import { turnReducer, initialTurn, transcriptToMessages } from "./app/turnReducer"
import { useSession } from "./app/useSession"
import { setCurrentSessionId } from "./context/sessionId"
import { SkinProvider, deriveSkin, type SkinState } from "./context/skin"
import { useAppKeys } from "./app/useAppKeys"
import { quit } from "./app/exit"
import { Stash } from "./app/stash"
import { TABS, CHAT_TAB, SESSIONS_TAB, AUTOMATION_TAB, CONFIG_TAB, EIKON_TAB, SUB_TABS } from "./app/tabs"
import { eikon as eikonSvc } from "./service/eikon"
import { activeProfileName } from "./service/hermes-profiles"
import { rehome } from "./home/rehome"
import { makeGoalHook } from "./app/goalHook"
import type { Launch } from "./app/launch"
import { PluginProvider, usePlugins } from "./plugins/runtime"
import { BackgroundProvider } from "./app/background"
import { useVoice } from "./voice/useVoice"
import { VoiceIndicator } from "./voice/Indicator"
import { sessionCapabilities } from "./app/sessionCapabilities"
import { useGitBranch } from "./utils/git"

type AppProps = { initialTheme?: string; gateway?: Gateway; launch?: Launch; keyOverrides?: Record<string, string> }

const BUSY_RE = /session busy|waiting for model response/i

export const App = (props: AppProps) => (
  <ThemeProvider initial={props.initialTheme}>
    <GatewayProvider client={props.gateway}>
      <ToastProvider>
        <KeysProvider overrides={props.keyOverrides}>
          <DialogProvider>
            <CommandProvider>
              <PluginProvider>
                <BackgroundProvider>
                  <AppInner launch={props.launch ?? { mode: "new" }} />
                </BackgroundProvider>
              </PluginProvider>
            </CommandProvider>
          </DialogProvider>
        </KeysProvider>
      </ToastProvider>
    </GatewayProvider>
  </ThemeProvider>
)

const AppInner = ({ launch: launch0 }: { launch: Launch }) => {
  const gw = useGateway()
  const gwRestart = useGatewayRestart()
  const dialog = useDialog()
  const themeCtx = useTheme()
  const toast = useToast()
  const renderer = useRenderer()
  const plugins = usePlugins()
  const session = useSession()
  const dims = useTerminalDimensions()
  const goalHook = useMemo(() => makeGoalHook(dialog, toast), [dialog, toast])

  const [turn, dispatch] = useReducer(turnReducer, initialTurn)
  const [ready, setReady] = useState(false)
  const [sid, setSid] = useState("")
  const sidRef = useRef(sid); sidRef.current = sid
  // Publish the active session id so providers above AppInner (most
  // importantly ThemeProvider) can resolve per-session state. Empty
  // string during splash and between session.close() + session.create().
  useEffect(() => { setCurrentSessionId(sid) }, [sid])
  const capabilities = sessionCapabilities({ sid, ready, streaming: turn.streaming })
  const [tab, setTab] = useState(CHAT_TAB)
  // Sub-tab per group — Chat has none, so key 0 is unused.
  // Defensive clamp lives inside each group (SessionsGroup/Automation/
  // ConfigGroup) so a shrinking SUB_TABS list doesn't render blank.
  const [subTabs, setSubTabs] = useState<Record<number, number>>(
    () => ({ [SESSIONS_TAB]: 0, [AUTOMATION_TAB]: 0, [CONFIG_TAB]: 0, [EIKON_TAB]: 0 }),
  )
  const setSub = useCallback((tabIdx: number, sub: number) =>
    setSubTabs(prev => prev[tabIdx] === sub ? prev : { ...prev, [tabIdx]: sub }), [])
  // Pre-bound per-group — inline `(i) => setSub(TAB, i)` in the JSX is a
  // fresh closure every AppInner render (= every key event, via the
  // global useKeyboard in useAppKeys), which defeats memo() on the
  // active group and reconciles its whole subtree per keystroke.
  const sessSub = useCallback((i: number) => setSub(SESSIONS_TAB, i), [setSub])
  const autoSub = useCallback((i: number) => setSub(AUTOMATION_TAB, i), [setSub])
  const cfgSub = useCallback((i: number) => setSub(CONFIG_TAB, i), [setSub])
  const eikSub = useCallback((i: number) => setSub(EIKON_TAB, i), [setSub])
  const [hideSidebar, setHideSidebar] = useState(false)
  const [usage, setUsage] = useState<Usage | undefined>(undefined)
  const [info, setInfo] = useState<SessionInfo | null>(null)
  const [title, setTitle] = useState("")
  const caption = title.trim()
  const titleRef = useRef(caption); titleRef.current = caption
  // Real SIGINT (terminal multiplexer, focus-stolen widget, kernel-delivered
  // ctrl+c that bypasses the React keyboard tree) goes through the same
  // quit() path as /quit so the resume banner always lands. Replaces the
  // bare-exit handler installed by terminal-reset.installExitResetHooks();
  // quit() ends in process.exit(0), which still fires the `exit` hook that
  // emits the mode-reset blob. Mount-once: gw/renderer identity is stable.
  useEffect(() => {
    process.removeAllListeners("SIGINT")
    process.on("SIGINT", () => quit(renderer, sidRef.current, titleRef.current, gw))
  }, [renderer, gw])
  // CONTROL=1 binds 127.0.0.1 by default; if the user overrode
  // CONTROL_BIND to a non-loopback host, the HTTP server is exposed to
  // whatever network the machine is on. Surface it once so the exposure
  // is never silent — stderr warning in start() is easy to miss behind
  // the splash.
  useEffect(() => {
    const w = control.warning()
    if (!w) return
    toast.show({
      variant: "warning",
      title: "control server exposed",
      message: w.message,
      duration: 15000,
    })
  }, [toast])
  const [focusRegion, setFocusRegion] = useState<"input" | "content">("input")
  const goToTab = useCallback((t: number) => {
    setTab(t)
    setFocusRegion(t === CHAT_TAB ? "input" : "content")
  }, [])
  // Slash-driven deep-link: jumps to a top-level tab AND sets its
  // sub-tab. goToTab preserves whatever sub-tab the user last picked;
  // goTo overrides it (what /memory or /cron should do).
  const goTo = useCallback((t: number, sub: number) => {
    setTab(t)
    setSubTabs(prev => prev[t] === sub ? prev : { ...prev, [t]: sub })
    setFocusRegion(t === CHAT_TAB ? "input" : "content")
  }, [])
  const [status, setStatus] = useState("")
  const [escHint, setEscHint] = useState(false)
  const [eikon, setEikon] = useState<ParsedEikon | undefined>(undefined)
  const [queue, setQueue] = useState<string[]>([])
  const [busy, setBusy] = useState<"queue" | "steer" | "interrupt">("queue")
  // The global useKeyboard re-renders AppInner on every key/mouse
  // event; memo() on Chat/Composer/etc is the only firewall. Callbacks
  // that land as props on those children must NOT take `turn.*` or
  // `queue` as deps — `turn.messages` is replaced every 16ms while
  // streaming, so any dep on it cascades a new callback identity into
  // the memo'd child and the firewall is decorative. Read through refs
  // instead (same shape as sidRef/cmdsRef/sendRef below).
  const turnRef = useRef(turn); turnRef.current = turn
  const queueRef = useRef(queue); queueRef.current = queue
  // Welcome-state chrome over an empty transcript. Composer stays live
  // underneath; first send dismisses. `/splash` re-summons mid-session
  // (Esc-dismissable in that case only).
  // Latched launch intent — the gateway.ready handler reads this. A
  // profile-switch overwrites it so the respawned gateway boots fresh
  // under the new HERMES_HOME instead of replaying the original argv.
  const launchRef = useRef<Launch>(launch0)
  const launch = launchRef.current
  const [splash, setSplash] = useState(launch.splash !== false)
  const [switching, setSwitching] = useState(false)
  const summoned = useRef(false)
  const [composing, setComposing] = useState(false)
  const splashLast = useMemo(
    () => launch.mode === "new" ? lastReal() : undefined,
    [launch.mode],
  )
  // Stable Splash props — inline `{…}` in JSX is a fresh reference per
  // AppInner render (= per key event) and defeats Splash's memo().
  const splashInfo = useMemo(() => info ? {
    agentVersion: info.version, behind: info.update_behind, model: info.model,
  } : undefined, [info?.version, info?.update_behind, info?.model])
  const splashLastProp = useMemo(
    () => splashLast ? { id: splashLast.id, title: splashLast.title } : undefined,
    [splashLast],
  )
  const news = useMemo(() => readChangelog()?.headline, [])
  const [attachments, setAttachments] = useState<ImageAttachResponse[]>([])
  const [cloudH, setCloudH] = useState(CLOUD_MIN)
  const [pick, setPick] = useState<Message | undefined>(undefined)
  const [skin, setSkin] = useState<SkinState>(() => deriveSkin(undefined))
  const inflight = useRef(false)
  const hold = useRef(false)
  const [pulse, setPulse] = useState(0)
  const settle = useCallback(() => {
    if (!hold.current) return
    hold.current = false
    setPulse(n => n + 1)
  }, [])
  // /undo snapshots the tail it pops (Message[]) so /redo can replay
  // the head user-turn's text. Client-only; gateway session.undo is a
  // hard delete with no unrevert. Cleared on reset/session-switch.
  const undone = useRef<Message[][]>([])
  const sessionStart = useRef(Date.now())
  const composer = useRef<ComposerHandle>(null)
  const promptRef = useRef<PromptCardHandle>(null)
  const { cmds } = useSlashCommands()
  // Live ref so send() (stable for queue-drain) reads the current catalog
  // without re-creating itself on every catalog refresh.
  const cmdsRef = useRef(cmds); cmdsRef.current = cmds

  // ── Voice ──────────────────────────────────────────────────────────
  const sys = useCallback((text: string) => dispatch({ kind: "system", text }), [])
  const voice = useVoice(gw.request.bind(gw), sys)
  // Transcript → composer: insert text and auto-send (CLI parity).
  useEffect(() => {
    voice.setOnTranscript((text: string) => {
      const c = composer.current
      if (!c) return
      c.set("")
      // Defer submit so the cleared input commits before send reads it.
      setTimeout(() => sendRef.current(text), 0)
    })
  }, [])

  // Transient error pulse — set on any reducer {kind:"error"} or
  // gateway exit; cleared when the avatar's play-once error clip
  // reaches hold (onAvatarHold below). `!ready` no longer maps to
  // error: cold boot is behind the splash, and a dead gateway already
  // emits "exit" → errorPulse via the listener below.
  const [errorPulse, setErrorPulse] = useState(false)

  const agentState: AvatarState = errorPulse
    ? "error"
    : turn.toolActive ? "working"
    : turn.streaming && turn.hasContent ? "speaking"
    : turn.streaming ? "thinking"
    : composing ? "listening"
    : "idle"

  const onAvatarHold = useCallback((s: AvatarState) => {
    if (s === "error") setErrorPulse(false)
  }, [])
  // Auto-follows the "non-text" phase of a turn: open while the model is
  // reasoning or running tools (`streaming && !hasContent`), close once
  // text is flowing (`hasContent`) or the turn ends. A manual force
  // (avatar click, cloud click, message pin) overrides auto for the rest
  // of THAT turn; the override clears on the next turn's rising edge.
  // A pending inline prompt also suppresses the cloud — the overlay
  // would occlude the card the user needs to answer.
  const prompt = useMemo(() => pendingPrompt(turn.messages), [turn.messages])
  const cloudAuto = turn.streaming && !turn.hasContent && !prompt
  const [force, setForce] = useState<boolean | undefined>(undefined)
  const cloud = !prompt && (force ?? cloudAuto)
  const prevStream = useRef(turn.streaming)
  useEffect(() => {
    if (!prevStream.current && turn.streaming) { setForce(undefined); setPick(undefined) }
    prevStream.current = turn.streaming
  }, [turn.streaming])

  const onPick = useCallback((m?: Message) => {
    // Clicking the currently-pinned message toggles the cloud closed.
    setPick(p => {
      if (m && p && m.id === p.id) { setForce(false); return undefined }
      setForce(!!m)
      return m
    })
  }, [])
  // Avatar click and cloud body click: toggle. Closing clears any pin so
  // next open shows live state.
  const onAvatar = useCallback(() => {
    const next = !cloud
    if (!next) setPick(undefined)
    setForce(next)
  }, [cloud])
  const closeCloud = useCallback(() => { setForce(false); setPick(undefined) }, [])
  const intr = useRef<() => void>(() => {})
  // Plain text submitted while streaming (Composer routes slash-shaped
  // input to onSend instead). `interrupt` prepends so the drain effect
  // fires this text first once turn.streaming flips.
  const steer = useCallback((text: string) => {
    const v = text.trim()
    if (!v) return
    gw.request<{ status?: string }>("session.steer", { text: v })
      .then(r => toast.show(r.status === "queued"
        ? { variant: "success", message: "Queued — lands on next tool result" }
        : { variant: "info", message: "No turn running; send as a normal message" }))
      .catch((e: Error) => toast.show({ variant: "error", message: e.message }))
  }, [gw, toast])

  const openSteer = useCallback(() => {
    void openTextPrompt(dialog, {
      title: "Steer active turn",
      label: "Soft nudge for the running session",
    }).then(v => { if (v) steer(v) })
  }, [dialog, steer])

  const onEnqueue = useCallback((t: string) => {
    if (busy === "steer") {
      const v = t.trim()
      if (!v) return
      gw.request<{ status?: string }>("session.steer", { text: v })
        .then(r => {
          if (r.status === "queued")
            return toast.show({ variant: "success", message: "Queued — lands on next tool result" })
          setQueue(q => [...q, t])
          toast.show({ variant: "info", message: "steer rejected — queued for next turn" })
        })
        .catch(() => setQueue(q => [...q, t]))
      return
    }
    if (busy === "interrupt") {
      hold.current = true
      setQueue(q => [t, ...q])
      intr.current()
      return
    }
    setQueue(q => [...q, t])
  }, [busy, gw, toast])
  const onAttach = useCallback((r: ImageAttachResponse) => setAttachments(a => [...a, r]), [])

  const stream = useStream({
    dispatch, session, launchRef, sidRef, sessionStart, goalHook,
    setSid, setInfo, setReady, setTitle, setBusy, setUsage, setStatus, setSkin, setErrorPulse, settle,
  })
  intr.current = stream.doInterrupt

  const reset = useCallback(() => {
    stream.interrupted.current = false
    hold.current = false
    toast.clear("credits.depleted")
    undone.current = []
    dispatch({ kind: "reset" })
    setUsage(undefined)
    setReady(false)
    setStatus("")
    setTitle("")
    setAttachments([])
  }, [toast])

  const newSession = useCallback(async () => {
    const prev = sidRef.current
    reset()
    summoned.current = true
    setSplash(true)
    // Clear the gateway's active sid before session.create lands so
    // any event emitted in the window between here and setSession(new)
    // isn't auto-attributed to the outgoing session (stale-sid race).
    // Mirrors switchProfile. session.close below passes prev
    // explicitly, so it isn't affected by the clear.
    gw.setSession("")
    setSid("")
    // Close the outgoing session unless it owns a durable background process.
    // Older gateways kill terminal(background=true) children as part of
    // session.close; preserving the live session is safer than SIGTERM'ing a
    // watcher while /new creates the next conversation.
    if (prev) void session.close(prev, { preserveBackground: true })
    try {
      const r = await session.create()
      setSid(r.id)
      if (r.info) { setInfo(r.info); setUsage(r.info.usage) }
      sessionStart.current = Date.now()
    } catch {}
  }, [reset, session, gw])

  const switchSession = useCallback(async (target: string) => {
    const prev = sidRef.current
    // Keep splash visible while the resume RPC lands so the user sees
    // the ornate frame instead of the empty-transcript welcome. summoned
    // suppresses the continue-prompt (we've already chosen a session);
    // switching drives the "Loading…" line on Splash.
    summoned.current = true
    setSplash(true)
    setSwitching(true)
    gw.setSession("")
    setSid("")
    goToTab(CHAT_TAB)
    try {
      const res = await session.resume(target)
      reset()
      setSid(res.id)
      if (res.info) {
        setInfo(res.info)
        setUsage(res.info.usage)
      }
      setReady(true)
      sessionStart.current = Date.now()
      if (res.messages.length) dispatch({ kind: "load", messages: res.messages })
      // Close only after resume succeeds — a failed resume leaves the
      // user in the outgoing session, which must stay live. Skip when
      // resuming self (prev === res.id), e.g. the boot path reusing an
      // empty stub.
      if (prev && prev !== res.id) void session.close(prev, { preserveBackground: true })
      setSplash(false)
      summoned.current = false
    } catch (err) {
      if (prev) {
        gw.setSession(prev)
        setSid(prev)
        setReady(true)
      }
      dispatch({ kind: "system", text: `Failed to resume: ${err instanceof Error ? err.message : String(err)}` })
      setSplash(false)
      summoned.current = false
    } finally {
      setSwitching(false)
    }
  }, [reset, session, goToTab, gw])

  const liveStatus = (state?: string, running = false) => {
    if (state === "waiting") return "waiting for input…"
    if (state === "starting") return "starting agent…"
    return running || state === "working" ? "running…" : "ready"
  }

  const activateSession = useCallback(async (target: string) => {
    const prev = sidRef.current
    summoned.current = true
    setSplash(true)
    setSwitching(true)
    gw.setSession("")
    setSid("")
    goToTab(CHAT_TAB)
    try {
      const res = await session.activate(target)
      reset()
      setSid(res.id)
      if (res.info) {
        setInfo(res.info)
        setUsage(res.info.usage)
      }
      sessionStart.current = res.startedAt ?? Date.now()
      dispatch({ kind: "load.live", messages: res.messages, streaming: res.running })
      setStatus(liveStatus(res.status, res.running))
      setReady(true)
      setSplash(false)
      summoned.current = false
      if (prev && prev !== res.id) toast.show({ variant: "info", message: "switched live session" })
    } catch (err) {
      if (prev) {
        gw.setSession(prev)
        setSid(prev)
        setReady(true)
      }
      dispatch({ kind: "system", text: `Failed to activate: ${err instanceof Error ? err.message : String(err)}` })
      setSplash(false)
      summoned.current = false
    } finally {
      setSwitching(false)
    }
  }, [reset, session, goToTab, toast, gw])
  // Rebind every HERMES_HOME reader, respawn the gateway subprocess
  // under the new env, and re-run the boot path. prefs.reload (inside
  // rehome) retints theme/eikon/keys via usePref; home.reset repaints
  // tabs. The session is NOT preserved — it belongs to the old
  // profile's state.db. Confirm step lives in the Agents tab.
  const switchProfile = useCallback((newHome: string, name: string) => {
    rehome(newHome)
    reset()
    gw.setSession("")
    setSid("")
    setInfo(null)
    setSkin(deriveSkin(undefined))
    // Fresh gateway boots behind the splash (same as cold launch); the
    // respawned process emits gateway.ready → session.info → onSend
    // dismisses. `summoned` suppresses the continue-prompt — the
    // outgoing profile's lastReal() is the wrong db.
    summoned.current = true
    setSplash(true)
    launchRef.current = { mode: "new", splash: true }
    toast.show({ variant: "info", message: `Switching to '${name}'…` })
    goToTab(CHAT_TAB)
    gwRestart()
  }, [reset, goToTab, gwRestart, toast, gw])

  const loadEikon = useCallback((path: string) => {
    try { setEikon(parseEikonFile(path)) }
    catch { setEikon(undefined) }
  }, [])

  // Precedence: user pref (by name) → bundled eikon matching active
  // skin → baked-in default (nous via STATE_FRAMES). Resolved through
  // eikon.baked() which checks <profile>/eikons/ then bundled/.
  const eikonName = preferences.usePref("eikon")
  // Revision bumps when service/eikon.save() rewrites a file whose
  // path hasn't changed — usePref alone would bail on an identical
  // snapshot and the sidebar wouldn't pick up the new content.
  const eikonRev = useSyncExternalStore(eikonSvc.onRevision, eikonSvc.revision)
  useEffect(() => {
    const p = (eikonName && eikonSvc.baked(eikonName)) || bundledEikonPath(skin.skin?.name)
    if (p) loadEikon(p); else setEikon(undefined)
  }, [eikonName, eikonRev, skin.skin?.name, loadEikon])

  // turnsFrom counts user turns at-or-after m — each session.undo pops
  // one user+assistant pair server-side. Reads turnRef (not turn) so
  // rewind/fork/msgMenu stay identity-stable across streaming deltas;
  // they gate on turnRef.current.streaming at call time instead.
  const turnsFrom = (m: Message) => {
    const msgs = turnRef.current.messages
    const at = msgs.findIndex(x => x.id === m.id)
    return at < 0 ? 0 : msgs.slice(at).filter(x => x.role === "user").length
  }

  const rewind = useCallback(async (m: Message) => {
    if (turnRef.current.streaming) return
    const n = turnsFrom(m)
    if (n === 0) return
    const text = m.parts.filter(p => p.type === "text").map(p => p.content).join("")
    for (let i = 0; i < n; i++) await gw.request("session.undo").catch(() => {})
    const r = await gw.request<{ messages: TranscriptMessage[] }>("session.history").catch(() => null)
    const msgs = turnRef.current.messages
    const at = msgs.findIndex(x => x.id === m.id)
    dispatch({ kind: "load", messages: r ? transcriptToMessages(r.messages ?? []) : msgs.slice(0, at) })
    composer.current?.set(text)
    setFocusRegion("input")
  }, [gw])

  // Non-destructive: session.branch clones full history into a new
  // gateway session; undo N turns *in that session* to land at m;
  // then activate the returned live session id. Original session is untouched.
  const fork = useCallback(async (m: Message) => {
    if (turnRef.current.streaming) return
    const n = turnsFrom(m)
    const text = m.parts.filter(p => p.type === "text").map(p => p.content).join("")
    const res = await gw.request<{ session_id: string; title?: string }>("session.branch", {})
      .catch((e: Error) => { toast.show({ variant: "error", message: `branch failed: ${e.message}` }); return null })
    if (!res?.session_id) return
    for (let i = 0; i < n; i++)
      await gw.request("session.undo", { session_id: res.session_id }).catch(() => {})
    await activateSession(res.session_id)
    composer.current?.set(text)
    setFocusRegion("input")
    toast.show({ variant: "success", message: `forked → ${res.title ?? res.session_id}` })
  }, [gw, toast, activateSession])

  // Listen for the Schrödinger's Box plugin's "please activate this
  // session" signal. The plugin writes the chosen session id into
  // active.json.activate_session_id; we poll that file every 800ms
  // and call activateSession, then clear the field. This is the
  // no-new-RPC merge path: the plugin never touches the gateway.
  useEffect(() => {
    const tick = setInterval(async () => {
      try {
        const root = (typeof process !== "undefined" && process.env?.SCHRODINGER_PROJECT_ROOT)
          || (typeof process !== "undefined" && process.env?.MULTIVERSE_PROJECT_ROOT)
          || (typeof process !== "undefined" && process.cwd?.())
          || ""
        if (!root) return
        const fs = await import("fs")
        const path = await import("path")
        const activePath = path.join(root, schrodingerDirFor(root), "active.json")
        if (!fs.existsSync(activePath)) return
        const aj = JSON.parse(fs.readFileSync(activePath, "utf-8") || "null")
        if (!aj || aj.activate_session_id == null) return
        const target = String(aj.activate_session_id)
        delete aj.activate_session_id
        fs.writeFileSync(activePath, JSON.stringify(aj, null, 2), "utf-8")
        if (target === sidRef.current) return
        toast.show({ variant: "info", message: `Activating session ${target.slice(0, 8)}…` })
        await activateSession(target)
        toast.show({ variant: "success", message: `Session activated` })
      } catch (e) {
        toast.show({ variant: "error", message: `Activation failed: ${(e as Error).message}` })
      }
    }, 800)
    return () => clearInterval(tick)
  }, [activateSession, toast])

  // Fork into Schrödinger's Box: branch the current session into two
  // separate sessions, both inheriting the full chat history. The tab
  // shows their diverging replies in parallel; picking one activates
  // that branch as the new active session.
  const forkSchrodinger = useCallback(async (m: Message) => {
    if (turnRef.current.streaming) return
    const promptText = m.parts.filter(p => p.type === "text").map(p => p.content).join("")
    const originalSid = sidRef.current  // captured pre-branch — the "real" timeline

    // 1) Branch the session TWICE sequentially (not parallel) so each
    //    gets a distinct title — parallel branches race on the title
    //    generator and the second one fails. Names include the groupId
    //    so re-forking after a previous run doesn't collide.
    type BranchResult = { session_id: string; db_session_id?: string; title?: string; parent?: string }
    const groupId = (crypto as { randomUUID?: () => string }).randomUUID?.().replace(/-/g, "").slice(0, 12)
      || Math.random().toString(36).slice(2, 14)
    const branchA: BranchResult | null = await gw.request<BranchResult>("session.branch", { name: `Schrödinger's Box ${groupId} · PATH A` })
      .catch((e: Error) => { toast.show({ variant: "error", message: `Branch A failed: ${e.message}` }); return null })
    const branchB: BranchResult | null = await gw.request<BranchResult>("session.branch", { name: `Schrödinger's Box ${groupId} · PATH B` })
      .catch((e: Error) => { toast.show({ variant: "error", message: `Branch B failed: ${e.message}` }); return null })
    if (!branchA?.session_id || !branchB?.session_id) return

    // 2) The user stays in the original session. The branched sessions
    //    exist as orphans. The tab will call prompt.submit to them
    //    once the user picks models.

    // 3) Write manifest + active.json so the tab can find them.
    //    The on-disk dir is `.schrodinger/`. For backward
    //    compatibility with old forks, schrodingerDirFor() falls
    //    back to `.multiverse/` if `.schrodinger/` is missing.
    const root = resolveSchrodingerRoot()
    if (!root) {
      toast.show({ variant: "error", message: "Could not find .schrodinger/ — cd to project root or set SCHRODINGER_PROJECT_ROOT" })
      return
    }

    const groupDir = `${root}/${schrodingerDirFor(root)}/groups/${groupId}`
    const activePath = `${root}/${schrodingerDirFor(root)}/active.json`
    const manifestPath = `${groupDir}/manifest.json`

    void (async () => {
      await Bun.write(manifestPath, JSON.stringify({
        id: groupId,
        // session.branch returns both the short live session_id and the
        // persisted DB parent key. Merge must target the DB key, not the
        // short live id, or state.db lookup fails.
        parent_session_id: branchA!.parent || originalSid,
        owner_session_id: branchA!.parent || info?.session_id || originalSid,
        owner_live_session_id: originalSid,
        owner_process_pid: process.pid,
        created_at: new Date().toISOString(),
        phase: "configure",
        status: "pending",
        lanes: [
          { id: "lane-0", label: "PATH A", session_id: branchA!.session_id, db_session_id: branchA!.db_session_id, session_title: branchA!.title || `Schrödinger's Box ${groupId} · PATH A`, provider: "", model: "", prompt: "", default_prompt: promptText, status: "ready" },
          { id: "lane-1", label: "PATH B", session_id: branchB!.session_id, db_session_id: branchB!.db_session_id, session_title: branchB!.title || `Schrödinger's Box ${groupId} · PATH B`, provider: "", model: "", prompt: "", default_prompt: promptText, status: "ready" },
        ],
      }, null, 2))
      await Bun.write(activePath, JSON.stringify({
        group_id: groupId,
        phase: "configure",
        user_prompt: promptText,
        project_root: root,
        parent_session_id: branchA!.parent || originalSid,
        owner_session_id: branchA!.parent || info?.session_id || originalSid,
        owner_live_session_id: originalSid,
        owner_process_pid: process.pid,
        open_tab: true,
        branch_a: branchA!.db_session_id || branchA!.session_id,
        branch_b: branchB!.db_session_id || branchB!.session_id,
      }, null, 2))
    })()

    toast.show({ title: "Schrödinger's Box", message: `Pick 2 models in the new tab · ${groupId}`, variant: "info" })
  }, [gw, toast, info])

  const msgMenu = useCallback((m?: Message) => {
    if (!m) return
    if (turnRef.current.streaming) return
    openMessage(dialog, m, { rewind, fork, forkSchrodinger, toast })
  }, [dialog, rewind, fork, forkSchrodinger, toast])
  // Gateway owns the canonical list (session["attached_images"]); chips
  // are a client-side mirror. prompt.submit drains server-side, so clear
  // here too. No image.detach RPC yet — chips are display-only.
  const attachClipboard = useCallback(() => {
    gw.request<ImageAttachResponse>("clipboard.paste")
      .then(r => r.attached
        ? setAttachments(a => [...a, r])
        : toast.show({ variant: "info", message: r.message ?? "No image in clipboard" }))
      .catch((e: Error) => toast.show({ variant: "error", message: e.message }))
  }, [gw, toast])
  // `slash` and `send` reference each other (skill/alias dispatch needs
  // to submit a turn; typed `/cmd` in send() resolves via slash). The
  // cycle is broken with a forward ref — same shape as upstream Ink's
  // slashRef/submitRef pair.
  const sendRef = useRef<(raw: string) => void>(() => {})
  const slash = useSlash({
    dispatch, session, turnRef, queueRef, sendRef, composer, summoned, undone,
    capabilities, info, sid, title: caption, skin,
    setQueue, setFocusRegion, setSplash, setAttachments, setInfo, setUsage, setTitle,
    newSession, switchSession, activateSession, rewind, goTo, attachClipboard, voiceToggle: voice.toggle,
  })
  const send = useCallback(async (raw: string) => {
    // Bare exit/quit/:q — pass through as literals so a
    // reflex `exit⏎` works without the leading slash.
    if (["exit", "quit", ":q", ":q!", ":wq"].includes(raw.trim()))
      return quit(renderer, sidRef.current, titleRef.current, gw)
    // Slash-shaped input resolves against the merged catalog: exact
    // name/alias wins, else unique prefix. This covers the "typed with
    // arg" path the popover can't — e.g. `/mod gpt-4`, `/q follow-up`.
    // Unknown `/xxx` falls through to prompt.submit verbatim (lets the
    // agent interpret paths like `/etc/hosts`).
    const m = raw.match(/^\/(\S+)(?:\s+([\s\S]*))?$/)
    if (m) {
      const [, name, arg = ""] = m
      const r = resolveSlash(cmdsRef.current, name)
      if ("hit" in r) return slash(r.hit, arg.trim())
      if ("ambiguous" in r) {
        const head = r.ambiguous.slice(0, 6).join(", ")
        return dispatch({
          kind: "system",
          text: `ambiguous: /${name} → ${head}${r.ambiguous.length > 6 ? ", …" : ""}`,
        })
      }
    }
    // {!cmd} spans resolve via shell.exec before submit so the
    // transcript shows what was actually sent. The await is short
    // (gateway-side 30s cap); status line signals the wait.
    let text = raw
    if (hasInterp(raw)) {
      setStatus("interpolating…")
      text = await interpolate(gw, raw)
      setStatus("")
    }
    stream.interrupted.current = false
    // Echo attachments into the user's transcript message as MEDIA: lines
    // so ChafaImage renders them inline. Gateway also tracks them in
    // session["attached_images"] for the agent-side enrichment — these
    // are display only, the path in the chip is what the agent sees.
    // The wire stays `text` (not `withMedia`) so the gateway's text-mode
    // image routing doesn't collide with an explicit MEDIA: duplicate
    // and so the persisted user row doesn't drag the analysis block
    // into view on resume. Parity with Ink: live preview is ours, the
    // resume view falls back to whatever upstream persisted.
    const withMedia = attachments.length
      ? [...attachments.flatMap(a => a.path ? [`MEDIA:${a.path}`] : []), text].filter(Boolean).join("\n")
      : text
    gw.request("prompt.submit", { text })
      .then(() => {
        dispatch({ kind: "user", text: withMedia })
        setAttachments([])
        undone.current = []
        setTab(CHAT_TAB)
      })
      .catch((e: Error) => {
        const msg = e instanceof Error ? e.message : String(e)
        if (BUSY_RE.test(msg)) {
          inflight.current = true
          setQueue(q => [text, ...q])
          setStatus("queued for next turn")
          toast.show({ variant: "info", message: "queued for next turn" })
          setTimeout(() => {
            inflight.current = false
            setPulse(n => n + 1)
          }, 400)
          return
        }
        inflight.current = false
        dispatch({ kind: "system", text: `submit failed: ${msg}` })
        toast.show({ variant: "error", message: msg })
      })
  }, [gw, slash, attachments, toast])
  sendRef.current = send

  // Shell mode submit — `shell.exec` is a plain subprocess (no pty,
  // 30s cap, gateway cwd) with detect_dangerous_command blocklist.
  // Output lands in the transcript as $ cmd / stdout system messages,
  // not part of the agent's conversation history.
  const onShell = useCallback((command: string) => {
    setSplash(false)
    dispatch({ kind: "system", text: `$ ${command}` })
    setStatus("running…")
    gw.request<{ stdout?: string; stderr?: string; code?: number }>(
      "shell.exec", { command })
      .then(r => {
        const out = (r.stdout ?? "").trimEnd()
        const err = (r.stderr ?? "").trimEnd()
        const body = [out, err && `stderr:\n${err}`].filter(Boolean).join("\n")
        dispatch({ kind: "system",
          text: body || `(exit ${r.code ?? 0})` })
        if ((r.code ?? 0) !== 0)
          toast.show({ variant: "warning", message: `exit ${r.code}` })
      })
      .catch((e: Error) => dispatch({ kind: "system", text: `error: ${e.message}` }))
      .finally(() => setStatus(""))
  }, [gw, toast])

  // Dismiss-on-send wrapper. Also the single gate for the splash's
  // "continue last?" prompt: empty-Enter while it's visible resumes
  // lastReal via the existing switchSession path.
  const onSend = useCallback((raw: string) => { setSplash(false); return send(raw) }, [send])
  const onEmptyEnter = useCallback(() => {
    if (!splash || summoned.current || !splashLast || composing) return false
    setSplash(false)
    void switchSession(splashLast.id)
    return true
  }, [splash, splashLast, composing, switchSession])
  // Purely client-side: prompts typed while streaming accumulate in
  // `queue`; on idle the head auto-submits. turnReducer doesn't flip
  // `streaming` until the gateway emits message.start (async), so a
  // naive effect would fire repeatedly and drain the whole queue in
  // one tick. `inflight` bridges the dispatch→message.start gap.
  useEffect(() => { if (turn.streaming) inflight.current = false }, [turn.streaming])
  useEffect(() => {
    if (!capabilities.canDrainQueue || inflight.current || hold.current || queue.length === 0) return
    const [head, ...rest] = queue
    inflight.current = true
    setQueue(rest)
    send(head)
  }, [capabilities.canDrainQueue, queue, send, pulse])

  const dequeue = useCallback((i: number) => {
    const item = queueRef.current[i]
    if (item === undefined) return
    setQueue(q => q.filter((_, j) => j !== i))
    composer.current?.set(item)
    setFocusRegion("input")
  }, [])

  // Plugin routes append after the built-in four. `plugins.routes`
  // rebuilds when a plugin registers or is (de)activated; built-in
  // indices (CHAT_TAB…CONFIG_TAB) stay stable.
  const extra = plugins.routes
  const all = useMemo(
    () => [...TABS, ...extra.map(r => ({ name: r.name, description: r.description ?? "Plugin" }))],
    [extra],
  )
  const tabMax = all.length - 1
  // Late-bind the plugin router to this shell's tab navigator so
  // `api.route.navigate(name)` can drive `goTo`. `bind` is idempotent.
  useEffect(() => {
    plugins.bind(goTo, () => all[tab]?.name)
  }, [plugins, goTo, all, tab])
  const subCount = SUB_TABS[tab]?.length ?? 0
  const cycleSub = useCallback((dir: -1 | 1) => {
    const labels = SUB_TABS[tab]
    if (!labels || labels.length === 0) return
    setSubTabs(prev => {
      const cur = prev[tab] ?? 0
      const next = (cur + dir + labels.length) % labels.length
      return next === cur ? prev : { ...prev, [tab]: next }
    })
  }, [tab])
  useAppKeys({
    tab, tabMax, chatTab: CHAT_TAB, setTab,
    subCount, cycleSub,
    focusRegion, setFocusRegion,
    streaming: turn.streaming,
    dialogOpen: dialog.open,
    composer,
    // Route keys to the pending inline prompt card before anything
    // else. Card returns true when the key was consumed; the shell
    // then stopPropagates so the composer textarea doesn't see it.
    // promptRef is null when no card is pending (Outcome rows don't
    // take the ref), so feed short-circuits.
    onPromptKey: (k) => promptRef.current?.feed(k) ?? false,
    onEscape: () => {
      if (!splash || !summoned.current) return false
      setSplash(false); summoned.current = false
      return true
    },
    onInterrupt: stream.doInterrupt,
    // queue.flush interrupts, then drain waits for session.info so
    // prompt.submit does not race the gateway's still-running turn.
    queued: queue.length,
    onFlushQueue: () => {
      hold.current = true
      stream.doInterrupt()
    },
    onQuit: () => quit(renderer, sid, caption, gw),
    onQuitArm: (label) =>
      toast.show({ variant: "info", message: `${label} again to quit` }),
    onInterruptNotice: () => {
      setEscHint(true)
      setTimeout(() => setEscHint(false), 5000)
    },
    onCopyLast: () => {
      const m = [...turnRef.current.messages].reverse()
        .find(x => x.role === "assistant" && msgText(x))
      if (m) void clipCopy(msgText(m), toast)
    },
    onCopyToast: toast.show,
    onAttachClipboard: attachClipboard,
    // Client-side drop only. Gateway's session["attached_images"] still
    // has the orphaned path until the next prompt.submit drains it, or
    // session reset clears it — the side channel is write-only from here.
    onDetachLast: () => {
      if (attachments.length === 0) return false
      setAttachments(a => a.slice(0, -1))
      return true
    },
    onNotice: (text) => dispatch({ kind: "system", text }),
    onToggleSidebar: () => setHideSidebar(v => !v),
    onSteer: openSteer,
    onStash: () => {
      const c = composer.current
      const v = c?.value().trim() ?? ""
      if (!v) {
        const e = Stash.pop()
        if (!e) return toast.show({ variant: "info", message: "stash empty" })
        c?.set(e.text); return
      }
      const n = Stash.push(v)
      c?.set("")
      toast.show({ variant: "info", message: `stashed (${n})` })
    },
    voiceRecordKey: voice.state.recordKey,
    voiceEnabled: voice.state.enabled,
    onVoiceRecord: () => voice.record(sidRef.current),
  })
  useBridge({
    tab, ready, streaming: turn.streaming, messages: turn.messages, sid, focusRegion,
    setTab, setFocusRegion, dispatch, composer,
  })

  const contentFocused = focusRegion === "content" && !turn.streaming
  // At most one pending prompt (gateway blocks on the answer). The
  // card mounts inside MessageList; key routing and composer-defocus
  // live here because the shell owns both. `prompt` is computed above
  // (before `cloud`) because a pending prompt also suppresses the
  // ThoughtCloud overlay.
  const promptAnswer = useCallback((id: string, label: string, ok: boolean) =>
    dispatch({ kind: "prompt.answered", id, label, ok }), [])
  const promptWire: PromptWire = useMemo(
    () => ({ ref: promptRef, onAnswer: promptAnswer }), [promptAnswer])
  // Snap to Chat when a prompt arrives so it isn't answered blind.
  useEffect(() => { if (prompt && tab !== CHAT_TAB) setTab(CHAT_TAB) }, [prompt?.id])

  const content = () => {
    const inner = (() => {
      switch (tab) {
        case CHAT_TAB: return <Chat messages={turn.messages} streaming={turn.streaming}
                               prompt={promptWire}
                               cloud={cloud} cloudH={cloudH} pick={pick}
                               onResize={setCloudH} onPick={msgMenu} onClose={closeCloud} onRewind={msgMenu} />
        case SESSIONS_TAB: return <SessionsGroup focused={contentFocused}
                                                 sub={subTabs[SESSIONS_TAB] ?? 0}
                                                 setSub={sessSub}
                                                 onSwitch={switchSession}
                                                 onActivateLive={activateSession}
                                                 currentId={sid}
                                                 messages={turn.messages}
                                                 sessionStart={sessionStart.current}
                                                 info={info ?? undefined}
                                                 usage={usage} />
        case AUTOMATION_TAB: return <Automation focused={contentFocused}
                                                sub={subTabs[AUTOMATION_TAB] ?? 0}
                                                setSub={autoSub}
                                                sessionId={sid} onSwitchProfile={switchProfile} />
        case CONFIG_TAB: return <ConfigGroup focused={contentFocused}
                                             sub={subTabs[CONFIG_TAB] ?? 0}
                                             setSub={cfgSub} />
        case EIKON_TAB: return <EikonGroup focused={contentFocused}
                                           sub={subTabs[EIKON_TAB] ?? 0}
                                           setSub={eikSub} />
        default: {
          const r = extra[tab - TABS.length]
          return r ? r.render({ sessionId: info?.session_id || sid, liveSessionId: sid }) : null
        }
      }
    })()
    const name = all[tab]?.name ?? "unknown"
    return <Profiler id={`tab:${name}`} onRender={perf.onRender}>{inner}</Profiler>
  }

  const theme = themeCtx.theme
  const onMouseUp = useCallback(() => copySelection(renderer, toast), [renderer, toast])
  // Composer defocuses while any prompt is pending. Approval/clarify
  // list-mode don't need input, and this guarantees the textarea's
  // `focused` prop flips false→true on answer so OpenTUI refocuses it
  // (a card's own <input focused> would otherwise leave it blurred).
  // Keys still reach the card via onPromptKey on the global bus.
  const inputFocused = focusRegion === "input" && !prompt
  const sidebarVisible = dims.width >= (tab === CHAT_TAB ? 120 : 140) && !hideSidebar
  const branch = useGitBranch(info?.cwd)
  const hidden = !sidebarVisible ? hiddenSidebar({
    info, usage, profile: activeProfileName(), title: caption, branch,
  }) : undefined

  return (
    <Profiler id="shell" onRender={perf.onRender}>
     <SkinProvider value={skin}>
      <box width="100%" height="100%" flexDirection="column"
           backgroundColor={theme.background} onMouseUp={onMouseUp}>
        <TabBar tabs={all} activeTab={tab} onTabChange={goToTab} />
        <box flexGrow={1} flexDirection="row">
          <box flexGrow={1} flexDirection="column">
            <box flexGrow={1} position="relative">
              {content()}
              {splash && tab === CHAT_TAB ? (
                <Splash
                  info={splashInfo}
                  last={summoned.current ? undefined : splashLastProp}
                  composing={composing}
                  news={news}
                  loading={switching || !info}
                />
              ) : null}
            </box>
            <box flexShrink={0} zIndex={1}>
              <VoiceIndicator voice={voice.state} keyLabel={voice.keyLabel} />
              <Composer
                ref={composer}
                focused={inputFocused} canSubmitPrompt={capabilities.canSubmitPrompt} ready={ready} streaming={turn.streaming}
                status={status}
                model={info?.model}
                hidden={hidden}
                escHint={escHint}
                queue={queue}
                attachments={attachments}
                cmds={cmds}
                onSend={onSend} onSlash={slash} onShell={onShell}
                onAttach={onAttach}
                onAttachClipboard={attachClipboard}
                onEnqueue={onEnqueue}
                onDequeue={dequeue}
                onDirty={setComposing}
                onEmptyEnter={onEmptyEnter}
              />
            </box>
          </box>
          {sidebarVisible ? (
            <Profiler id="sidebar" onRender={perf.onRender}>
              <Sidebar agentState={agentState} info={info} usage={usage} eikon={eikon} profile={activeProfileName()}
                       title={caption}
                       cloud={tab === 0 && cloud} pulse={turn.streaming}
                       onAvatar={onAvatar} onAvatarHold={onAvatarHold} />
            </Profiler>
          ) : null}
        </box>
        {plugins.has("app_bottom") ? (
          <box height={1} flexShrink={0} paddingX={1} overflow="hidden">
            <plugins.Slot name="app_bottom" mode="single_winner"
                          sid={sid} tab={tab} streaming={turn.streaming} />
          </box>
        ) : null}
      </box>
     </SkinProvider>
    </Profiler>
  )
}

