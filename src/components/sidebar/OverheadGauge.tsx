import { memo } from "react"
import { useTheme } from "../../theme"
import type { SessionInfo } from "../../context/wire"
import type { Usage } from "../../types/message"
import { formatTokens } from "../../utils/tokens"

const FILL = "█"
const EMPTY = "░"
const CHAR_TO_TOKEN = 0.25
const TOOL_TOKENS = 125

const KNOWN = {
  agent_guidance: 2000,
  tool_guidance: 1200,
  model_guidance: 500,
  env_profile: 800,
  timestamp: 200,
} as const

const estimate = (info?: SessionInfo | null) => {
  if (!info) return { identity: 0, context: 0, skills: 0, memory: 0, tools: 0, guidance: 0, total: 0 }

  const prompt = info.system_prompt ?? ""
  const promptTokens = Math.round(prompt.length * CHAR_TO_TOKEN)

  const identity = Math.round((866 + KNOWN.agent_guidance) * CHAR_TO_TOKEN)
  const guidance = Math.round((KNOWN.tool_guidance + KNOWN.model_guidance + KNOWN.env_profile) * CHAR_TO_TOKEN)
  const sc = Object.values(info.skills ?? {}).reduce((n, v) => n + v.length, 0)
  const skills = sc * 20
  const memory = 500
  const tc = Object.values(info.tools ?? {}).reduce((n, v) => n + v.length, 0)
  const tools = tc * TOOL_TOKENS

  const knownPrompt = identity + skills + memory + guidance
  const context = Math.max(0, promptTokens - knownPrompt)

  const total = promptTokens + tools

  return { identity, context, skills, memory, tools, guidance, total }
}

export const OverheadGauge = memo((props: {
  info?: SessionInfo | null
  usage?: Usage
  width: number
}) => {
  const theme = useTheme().theme
  const { identity, context, skills, memory, tools, guidance, total } = estimate(props.info)
  if (total <= 0) return null

  const cells = Math.max(8, props.width - 2)
  const scale = (t: number) => Math.round((t / total) * cells)
  const segs = [
    { label: "Identity", tok: identity, color: theme.primary, w: scale(identity) },
    { label: "Context", tok: context, color: theme.success, w: scale(context) },
    { label: "Skills", tok: skills, color: theme.warning, w: scale(skills) },
    { label: "Memory", tok: memory, color: theme.error, w: scale(memory) },
    { label: "Tools", tok: tools, color: theme.secondary, w: scale(tools) },
    { label: "Guidance", tok: guidance, color: theme.textMuted, w: scale(guidance) },
  ].filter(s => s.w > 0)

  const usedW = segs.reduce((n, s) => n + s.w, 0)
  const emptyW = Math.max(0, cells - usedW)

  const max = props.usage?.context_max ?? props.info?.usage?.context_max ?? props.info?.context_max
  const pct = max ? ((total / max) * 100) : 0
  const pctS = pct < 10 ? pct.toFixed(1) : String(Math.round(pct))

  return (
    <box flexDirection="column" marginTop={1}>
      <box height={1}>
        <text>
          <span fg={theme.textMuted}> </span>
          <span fg={theme.text}>Overhead</span>
          <span fg={theme.textMuted}>{` ${formatTokens(total)} (${pctS}%)`}</span>
        </text>
      </box>
      <box height={1}>
        <text>
          <span fg={theme.textMuted}>[</span>
          {segs.map((s, i) => <span key={i} fg={s.color}>{FILL.repeat(s.w)}</span>)}
          <span fg={theme.textMuted}>{EMPTY.repeat(emptyW)}]</span>
        </text>
      </box>
      {[0, 3].map(row => (
        <box key={row} height={1}>
          <text>
            {segs.slice(row, row + 3).map((s, j) => (
              <span key={j}>
                {j > 0 ? <span fg={theme.textMuted}>  </span> : null}
                <span fg={s.color}>■</span>
                <span fg={theme.textMuted}>{` ${s.label} ${formatTokens(s.tok)}`}</span>
              </span>
            ))}
          </text>
        </box>
      ))}
    </box>
  )
})
