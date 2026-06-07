// Three-state filter chip: off → include → exclude → off.
//
// Visual contract (matches Kanban's precedent so it reads the same
// everywhere it's reused):
//   off       text on backgroundElement — a quiet pill
//   include   background on accent fill — "show me these"
//   exclude   borderSubtle, struck-through, no fill — "hide these"
//   selected  (keyboard cursor) accent fg; fill unchanged unless
//             the state already dictates one
//
// Semantics are the caller's concern; this component only renders
// and reports clicks. `cycle` is exported for callers that want the
// canonical off→in→ex→off step without re-deriving it.

import { memo } from "react"
import { TextAttributes, type ColorInput } from "@opentui/core"
import { useTheme } from "../theme"

export type Tri = "off" | "in" | "ex"

export const cycle = (t: Tri): Tri => t === "off" ? "in" : t === "in" ? "ex" : "off"

export const FilterChip = memo((p: {
  id?: string
  label: string
  state: Tri
  /** Keyboard cursor is on this chip. */
  selected?: boolean
  /** Leading gap in cells (default 1). Use 3 between groups. */
  gap?: number
  /** Include/selected color. Defaults to theme accent. */
  color?: ColorInput
  /** Off-state text color. Defaults to theme text. */
  textColor?: ColorInput
  onMouseDown?: () => void
}) => {
  const theme = useTheme().theme
  const color = p.color ?? theme.accent
  const text = p.textColor ?? theme.text
  const bg = p.state === "in" ? color
    : p.state === "ex" ? undefined
    : theme.backgroundElement
  const fg = p.state === "in" ? theme.background
    : p.state === "ex" ? (p.selected ? color : theme.borderSubtle)
    : p.selected ? color : text
  return (
    <box id={p.id} height={1} flexShrink={0} marginLeft={p.gap ?? 1}
         paddingLeft={1} paddingRight={1}
         backgroundColor={bg} onMouseDown={p.onMouseDown}>
      <text fg={fg}
        attributes={p.state === "ex" ? TextAttributes.STRIKETHROUGH : TextAttributes.NONE}>
        {p.label}
      </text>
    </box>
  )
})
