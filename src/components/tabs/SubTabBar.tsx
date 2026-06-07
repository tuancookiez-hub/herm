import { memo } from "react"
import { TabStrip } from "./TabStrip"

// Sub-tab row inside a group tab. Same visual treatment as the top
// bar; keyboard is Shift+←/→ via useAppKeys.

type Props = {
  tabs: readonly string[]
  active: number
  onChange: (i: number) => void
  hint?: string
}

export const SubTabBar = memo((props: Props) => <TabStrip {...props} />)
