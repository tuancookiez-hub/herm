import { memo, useEffect, type ReactNode } from "react"
import { Agents } from "./Agents"
import { Cron } from "./Cron"
import { Kanban } from "./Kanban"
import { SubTabBar } from "../components/tabs/SubTabBar"
import { SUB_TABS, AUTOMATION_TAB } from "../app/tabs"

type Props = {
  focused?: boolean
  sub: number
  setSub: (i: number) => void
  // Agents
  sessionId: string
  onSwitchProfile: (newHome: string, name: string) => void
}

// Consolidates Agents (profiles + running subagents), Cron, and Kanban.
// Each sub-tab owns its own keybindings via useKeyboard({focused}); the
// group only forwards `focused` to whichever is active.
export const Automation = memo((props: Props) => {
  const labels = SUB_TABS[AUTOMATION_TAB]
  useEffect(() => {
    if (props.sub >= labels.length) props.setSub(0)
  }, [props.sub, labels.length])
  const hint = "shift+←/→ sub"
  return (
    <box flexDirection="column" flexGrow={1} minWidth={0}>
      <SubTabBar tabs={labels} active={props.sub} onChange={props.setSub} hint={hint} />
      <box flexGrow={1} minWidth={0} flexDirection="column">
        <Pane visible={props.sub === 0}>
          <Kanban focused={!!props.focused && props.sub === 0} />
        </Pane>
        <Pane visible={props.sub === 1}>
          <Agents focused={!!props.focused && props.sub === 1}
                  sessionId={props.sessionId} onSwitchProfile={props.onSwitchProfile} />
        </Pane>
        <Pane visible={props.sub === 2}>
          <Cron focused={!!props.focused && props.sub === 2} />
        </Pane>
      </box>
    </box>
  )
})

const Pane = ({ visible, children }: { visible: boolean; children: ReactNode }) =>
  visible ? <box flexGrow={1} minWidth={0} minHeight={0} flexDirection="column">{children}</box> : null
