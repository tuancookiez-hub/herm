import { memo } from "react"
import { useTheme } from "../../theme"
import type { SessionInfo } from "../../context/wire"
import type { Usage } from "../../types/message"
import { formatTokens } from "../../utils/tokens"

const FILL = "█"
const EMPTY = "░"
const CHAR_TO_TOKEN = 0.25
const TOOL_TOKENS = 125

/**
 * Parse the real system prompt into sections by marker strings.
 *
 * Verified against actual herm system prompts (June 2026). Structure:
 *
 *   [identity]                  # Hermes Agent Persona … first guidance heading
 *   [guidance]                  # Finishing the job … <available_skills>
 *   [skills]                    <available_skills> … </available_skills>
 *   [skill guidance]            </available_skills> … end of prompt
 *
 * The OLD version (commits <b69c686>) treated Identity as 0→<available_skills>
 * and Guidance as the headings inside that range, double-counting 4-6K tokens
 * and showing Context=0 always. This version uses non-overlapping ranges:
 * Identity ends at the FIRST guidance heading, not at <available_skills>.
 *
 * Memory is NOT in the system prompt at all — it's pulled at query time by
 * the agent runtime from ~/.hermes/memories/*.md. So Memory is always 0 in
 * the prompt-length breakdown. We surface it as a real number only when the
 * prompt actually contains a memory section (older gateway variants).
 */
const parse = (prompt: string) => {
  const idx = (m: string) => prompt.indexOf(m)

  // Identity: "# Hermes Agent Persona" → first guidance heading
  const idStart = idx("# Hermes Agent Persona")
  const guidanceStart = idx("# Finishing the job")
  const skillsStart = idx("<available_skills>")
  const skillsEnd = idx("</available_skills>")

  const identity = idStart < 0 ? 0
    : Math.max(0, (guidanceStart < 0 ? (skillsStart < 0 ? prompt.length : skillsStart) : guidanceStart) - idStart)

  // Guidance: "# Finishing the job" → <available_skills>
  const guidance = guidanceStart < 0 ? 0
    : Math.max(0, (skillsStart < 0 ? prompt.length : skillsStart) - guidanceStart)

  // Skills: <available_skills> … </available_skills>
  const skills = skillsStart < 0 || skillsEnd < 0 ? 0
    : Math.max(0, skillsEnd - skillsStart)

  // Skill guidance: </available_skills> … end
  const skillGuidance = skillsEnd < 0 ? 0
    : Math.max(0, prompt.length - skillsEnd)

  // Memory: look for explicit markers in this prompt (rare — memory is
  // usually loaded at query time, not baked into the system prompt).
  const memStart = idx("MEMORY (your personal notes)")
  const memEnd = idx("USER PROFILE")
  const memory = memStart < 0 || memEnd < 0 ? 0
    : Math.max(0, memEnd - memStart)

  // Known sum for sanity check
  const known = identity + guidance + skills + skillGuidance + memory

  return {
    identity: Math.round(identity * CHAR_TO_TOKEN),
    guidance: Math.round(guidance * CHAR_TO_TOKEN),
    skills: Math.round(skills * CHAR_TO_TOKEN),
    skillGuidance: Math.round(skillGuidance * CHAR_TO_TOKEN),
    memory: Math.round(memory * CHAR_TO_TOKEN),
    promptTotal: Math.round(prompt.length * CHAR_TO_TOKEN),
    known: Math.round(known * CHAR_TO_TOKEN),
  }
}

const estimate = (info?: SessionInfo | null) => {
  if (!info) return { identity: 0, context: 0, skills: 0, memory: 0, tools: 0, guidance: 0, total: 0 }

  const prompt = info.system_prompt ?? ""
  const promptTokens = Math.round(prompt.length * CHAR_TO_TOKEN)
  const parts = parse(prompt)

  const tc = Object.values(info.tools ?? {}).reduce((n, v) => n + v.length, 0)
  const tools = tc * TOOL_TOKENS

  // Surface the un-accounted residual (should be ~0 with correct parsing;
  // if non-zero, the prompt has content our markers didn't catch).
  const context = Math.max(0, promptTokens - parts.known)

  return {
    identity: parts.identity,
    guidance: parts.guidance + parts.skillGuidance,
    skills: parts.skills,
    memory: parts.memory,
    tools,
    context,
    total: promptTokens + tools,
  }
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
    { label: "Guidance", tok: guidance, color: theme.textMuted, w: scale(guidance) },
    { label: "Skills", tok: skills, color: theme.warning, w: scale(skills) },
    { label: "Memory", tok: memory, color: theme.error, w: scale(memory) },
    { label: "Tools", tok: tools, color: theme.secondary, w: scale(tools) },
    { label: "Context", tok: context, color: theme.success, w: scale(context) },
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