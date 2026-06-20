import { memo } from "react"
import { useTheme } from "../../theme"
import type { SessionInfo } from "../../context/wire"
import type { Usage } from "../../types/message"
import { formatTokens } from "../../utils/tokens"

const FILL = "█"
const EMPTY = "░"
const CHAR_TO_TOKEN = 0.25
const TOOL_TOKENS = 125

/** Parse the real system prompt into sections by marker strings.
 *  Each section is [start_marker, end_marker) — the text between them
 *  is measured for token estimation. Returns chars per section. */
const parse = (prompt: string) => {
  const idx = (m: string) => prompt.indexOf(m)
  const slice = (a: number, b: number) => Math.max(0, b - a)

  // Identity: "# Hermes Agent Persona" → start of skills or tool-use
  const idStart = idx("# Hermes Agent Persona")
  const idEnd = idx("<available_skills>")
  const identity = slice(idStart < 0 ? 0 : idStart, idEnd < 0 ? prompt.length : idEnd)

  // Skills: <available_skills> → </available_skills>
  const skStart = idx("<available_skills>")
  const skEnd = idx("</available_skills>")
  const skills = slice(skStart < 0 ? 0 : skStart, skEnd < 0 ? (skStart < 0 ? 0 : prompt.length) : skEnd)

  // Memory: "MEMORY (your personal notes)" → "USER PROFILE" or next §
  const memStart = idx("MEMORY (your personal notes)")
  const memEnd = idx("USER PROFILE")
  const memory = slice(memStart < 0 ? 0 : memStart, memEnd < 0 ? (memStart < 0 ? 0 : prompt.length) : memEnd)

  // Guidance: "# Finishing the job" through "# Nous Subscription" + "# Tool-use enforcement"
  // These are scattered, so measure by known markers
  const guideMarkers = ["# Finishing the job", "# Nous Subscription", "# Tool-use enforcement", "## Skills (mandatory)"]
  let guidance = 0
  for (const m of guideMarkers) {
    const s = idx(m)
    if (s < 0) continue
    // Find next # heading at column 0
    const after = prompt.slice(s + m.length)
    const nextHeading = after.search(/\n#[^#]/)
    const end = nextHeading < 0 ? prompt.length : s + m.length + nextHeading
    guidance += slice(s, end)
  }

  // Context: everything else (AGENTS.md, project files, environment)
  const known = identity + skills + memory + guidance
  const total = prompt.length
  const context = Math.max(0, total - known)

  return {
    identity: Math.round(identity * CHAR_TO_TOKEN),
    skills: Math.round(skills * CHAR_TO_TOKEN),
    memory: Math.round(memory * CHAR_TO_TOKEN),
    guidance: Math.round(guidance * CHAR_TO_TOKEN),
    context: Math.round(context * CHAR_TO_TOKEN),
  }
}

const estimate = (info?: SessionInfo | null) => {
  if (!info) return { identity: 0, context: 0, skills: 0, memory: 0, tools: 0, guidance: 0, total: 0 }

  const prompt = info.system_prompt ?? ""
  const promptTokens = Math.round(prompt.length * CHAR_TO_TOKEN)
  const parts = parse(prompt)

  const tc = Object.values(info.tools ?? {}).reduce((n, v) => n + v.length, 0)
  const tools = tc * TOOL_TOKENS
  const total = promptTokens + tools

  return { ...parts, tools, total }
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
