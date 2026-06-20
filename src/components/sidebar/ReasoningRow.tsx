import { memo } from "react"
import { useHome } from "../../home"
import { useTheme } from "../../theme"

const PAD_L = 12
const WIDTH = 48
const INNER = WIDTH - 4
const trunc = (s: string, max: number) => s.length <= max ? s : s.slice(0, max - 1) + "…"

export const ReasoningRow = memo(() => {
  const theme = useTheme().theme
  const config = useHome("config")
  const raw = config?.agent?.reasoning_effort
  const effort = typeof raw === "string" ? raw.trim() : ""
  const set = effort !== ""
  const value = set ? effort : "default"

  return (
    <box height={1}>
      <text>
        <span fg={theme.textMuted}>{`  ${"Reasoning".padEnd(PAD_L)}`}</span>
        <span fg={set ? theme.text : theme.textMuted}>{trunc(value, INNER - PAD_L - 2)}</span>
      </text>
    </box>
  )
})
