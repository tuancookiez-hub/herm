import { memo, useState } from "react"
import { useTheme } from "../../theme"
import { useProviderQuota, type QuotaWindow, type QuotaState, formatReset } from "../../service/providers"

// MiniMax Token Plan quota widget for the right sidebar. Two stacked
// windows (5h Session, Weekly) with their own progress bars and reset
// timers. Collapsed by default to keep the pillar quiet when the user
// is mid-turn; expands on click.
//
// Always visible — a missing/invalid credential renders as a yellow
// "configure" hint rather than disappearing silently. Hiding the
// widget when a provider isn't configured leaves the user with no
// signal that the slot exists; the configurable-hint makes the next
// step obvious.

const FILL = "█"
const EMPTY = "░"
const WIDTH = 44 // INNER of the sidebar pillar (WIDTH=48 - 4)

const ramp = (pct: number): "muted" | "primary" | "warning" | "error" => {
  if (pct >= 90) return "error"
  if (pct >= 75) return "warning"
  if (pct >= 50) return "primary"
  return "muted"
}

const formatPct = (pct: number): string => {
  const p = Math.max(0, Math.min(100, pct))
  return p < 10 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`
}

const renderBar = (pct: number): string => {
  const ratio = Math.max(0, Math.min(1, pct / 100))
  const cells = Math.max(8, WIDTH - 2)
  const filled = Math.round(ratio * cells)
  return FILL.repeat(filled) + EMPTY.repeat(cells - filled)
}

const truncate = (s: string, max: number): string =>
  s.length <= max ? s : s.slice(0, max - 1) + "…"

const WindowRow = memo((props: { w: QuotaWindow }) => {
  const theme = useTheme().theme
  const w = props.w
  const pct = w.used_percent ?? 0
  const reset = formatReset(w.reset_at)
  const colorKey = ramp(pct)
  const color = (() => {
    switch (colorKey) {
      case "error":   return theme.error
      case "warning": return theme.warning
      case "primary": return theme.primary
      default:        return theme.textMuted
    }
  })()
  const label = w.label ?? "Window"
  const pctText = formatPct(pct)
  return (
    <box flexDirection="column" marginBottom={1}>
      <box height={1}>
        <text>
          <span fg={theme.textMuted}>{`  ${label.padEnd(10)}`}</span>
          <span fg={theme.text}>{pctText}</span>
          {reset ? <span fg={theme.textMuted}>{`  · ${reset}`}</span> : null}
        </text>
      </box>
      <box height={1}>
        <text><span fg={color}>{`  [${renderBar(pct)}]`}</span></text>
      </box>
    </box>
  )
})

const StatusLine = memo((props: {
  windows: QuotaWindow[]
  state: "loading" | "no_key" | "error" | "empty" | "available"
  message?: string
  open: boolean
  onToggle: () => void
}) => {
  const theme = useTheme().theme
  const arrow = props.open ? "▾ " : "▸ "
  if (props.state === "loading") {
    return (
      <box height={1}>
        <text>
          <span fg={theme.textMuted}>{arrow}</span>
          <span fg={theme.text}><strong>{"MiniMax"}</strong></span>
          <span fg={theme.textMuted}>{"  loading…"}</span>
        </text>
      </box>
    )
  }
  if (props.state === "no_key") {
    return (
      <box height={1} onMouseDown={props.onToggle}>
        <text>
          <span fg={theme.text}>{arrow}</span>
          <span fg={theme.text}><strong>{"MiniMax"}</strong></span>
          <span fg={theme.warning}>{"  not configured"}</span>
        </text>
      </box>
    )
  }
  if (props.state === "error") {
    return (
      <box height={1} onMouseDown={props.onToggle}>
        <text>
          <span fg={theme.text}>{arrow}</span>
          <span fg={theme.text}><strong>{"MiniMax"}</strong></span>
          <span fg={theme.error}>{`  ${truncate(props.message ?? "error", 28)}`}</span>
        </text>
      </box>
    )
  }
  if (props.state === "empty") {
    return (
      <box height={1} onMouseDown={props.onToggle}>
        <text>
          <span fg={theme.text}>{arrow}</span>
          <span fg={theme.text}><strong>{"MiniMax"}</strong></span>
          <span fg={theme.textMuted}>{"  no quota data"}</span>
        </text>
      </box>
    )
  }
  const highest = props.windows.reduce((m: number, w: QuotaWindow) => Math.max(m, w.used_percent ?? 0), 0)
  const hintColor = highest >= 90 ? theme.error
    : highest >= 75 ? theme.warning
    : highest >= 50 ? theme.primary
    : theme.textMuted
  return (
    <box height={1} onMouseDown={props.onToggle}>
      <text>
        <span fg={theme.text}>{arrow}</span>
        <span fg={theme.text}><strong>{"MiniMax"}</strong></span>
        <span fg={theme.textMuted}>{`  ${formatPct(highest)}`}</span>
        <span fg={hintColor}>{`  ${props.windows.length} windows`}</span>
      </text>
    </box>
  )
})

const HintLine = memo((props: { text: string }) => {
  const theme = useTheme().theme
  return (
    <box height={1}>
      <text>
        <span fg={theme.warning}>{`  ${truncate(props.text, WIDTH - 2)}`}</span>
      </text>
    </box>
  )
})

const deriveStatus = (state: QuotaState): "loading" | "no_key" | "error" | "empty" | "available" => {
  if (state.state === "loading") return "loading"
  if (state.state === "no_key") return "no_key"
  if (state.state === "error") return "error"
  if (state.snapshot.windows.length === 0) return "empty"
  return "available"
}

export const MiniMaxQuota = memo((props: { defaultOpen?: boolean }) => {
  const state = useProviderQuota("minimax")
  const [open, setOpen] = useState(!!props.defaultOpen)

  const status = deriveStatus(state)
  const windows = state.state === "available" ? state.snapshot.windows : []
  const message = state.state === "error" ? state.message : undefined
  const hint = state.state === "available" && state.snapshot.unavailable_reason
    ? state.snapshot.unavailable_reason
    : null

  return (
    <box flexDirection="column" marginTop={1} marginBottom={open ? 1 : 0}>
      <StatusLine
        state={status}
        windows={windows}
        message={message}
        open={open}
        onToggle={() => setOpen(o => !o)}
      />
      {open ? (
        <box flexDirection="column">
          {status === "available" ? windows.map((w: QuotaWindow) => <WindowRow key={w.label} w={w} />) : null}
          {status === "no_key" ? <HintLine text="Run `hermes auth add minimax-oauth` or set MINIMAX_API_KEY." /> : null}
          {status === "empty" ? <HintLine text={hint ?? "MiniMax returned no usage windows."} /> : null}
          {status === "error" && message ? <HintLine text={message} /> : null}
        </box>
      ) : null}
    </box>
  )
})
