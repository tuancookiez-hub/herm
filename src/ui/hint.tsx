import { memo } from "react"
import { useTheme } from "../theme"

// Tab-footer hint line. One muted row below panes and above the
// composer; clips instead of wraps.
//
// Input shapes:
//   - `pairs`: structured [key, verb] list, rendered as `[key] verb`
//     separated by 2 spaces. The canonical shape.
//   - `suffix`: optional trailing status fragment appended after pairs
//     with a `  ·  ` separator — for live indicators like "● 3 unsaved"
//     or "● active" that sit alongside key hints but aren't bindings
//     themselves.
//   - `raw`: free-form passthrough. Used where the hint is pure status
//     text (breadcrumb, managed-by label) with no key bindings.

type Pair = readonly [string, string]

export const HintBar = memo((props: { pairs?: readonly Pair[]; suffix?: string; raw?: string }) => {
  const theme = useTheme().theme
  const text = props.pairs
    ? props.pairs.map(p => `[${p[0]}] ${p[1]}`).join("  ")
      + (props.suffix ? `  ·  ${props.suffix}` : "")
    : props.raw ?? ""
  return (
    <box height={1} flexShrink={0} paddingX={1} overflow="hidden">
      <text fg={theme.textMuted} wrapMode="none">{text}</text>
    </box>
  )
})
