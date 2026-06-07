/**
 * context-segments.ts — Parse the Hermes system prompt into sections,
 * group them into a two-level hierarchy, and generate grids.
 *
 * Level 0 (top):  System Prompt | System Tools | MCP Tools | Memory |
 *                 Skills | Conversation | Free
 * Level 1 (drill): Children of a group, e.g. Memory → SOUL | Notes |
 *                 User Profile | Mem0 | Providers
 *
 * The grid always fills 256 cells. At top level, percentages are relative
 * to the full context length. At drill level, relative to the parent group.
 */

import type { Source, ToolInfo } from "./hermes-home"
import { makeSource } from "./hermes-home"
import { count as tok } from "../utils/tokens"

/** A parsed section of the system prompt */
export type Section = {
  readonly id: string
  readonly label: string
  readonly chars: number
  readonly tokens: number
  readonly text: string
  readonly source?: Source
}

/** A segment in the grid — leaf or group */
export type Segment = {
  readonly id: string
  readonly label: string
  readonly tokens: number
  readonly percent: number
  readonly children?: ReadonlyArray<Segment>
  readonly section?: Section
}

/** Grid cell */
type Cell = { readonly id: string }

const GRID = 256
// Chars-per-token fallback for ToolInfo (description/param lengths are
// char counts; the text itself is not retained in the snapshot — so we
// can't run the real tokenizer until upstream ToolInfo carries text).
const CPT = 4

/** Parsed-section IDs that belong to the Memory top-level category */
const MEMORY_IDS = new Set(["soul", "memory", "user", "mem0"])

/** Parsed-section IDs that are residual system-prompt framing */
const SYSTEM_PROMPT_IDS = new Set(["project", "meta", "other"])

/** Parse raw system prompt text into sections by structural delimiters */
export function parse(text: string): Section[] {
  if (!text) return []

  const sections: Section[] = []
  const used = new Array(text.length).fill(false)

  const mark = (start: number, end: number, id: string, label: string, source?: Source) => {
    const slice = text.slice(start, end)
    if (slice.trim().length === 0) return
    for (let i = start; i < end; i++) used[i] = true
    sections.push({ id, label, chars: slice.length, tokens: tok(slice), text: slice, source })
  }

  // SOUL.md — start to first ══════
  const bar1 = text.indexOf("══════")
  if (bar1 > 0) mark(0, bar1, "soul", "SOUL.md", makeSource("SOUL.md"))

  // MEMORY block
  const memH = text.indexOf("MEMORY (your personal notes)")
  if (memH >= 0) {
    const s = text.lastIndexOf("══════", memH)
    const after = text.indexOf("\n", text.indexOf("══════", memH + 1))
    const next = text.indexOf("══════", after > 0 ? after : memH + 40)
    const e = next > 0 ? text.lastIndexOf("\n", next) + 1 : text.length
    if (s >= 0) mark(s, e, "memory", "Memory Notes", makeSource("memories/MEMORY.md", "MEMORY.md"))
  }

  // USER PROFILE block
  const userH = text.indexOf("USER PROFILE (who the user is)")
  if (userH >= 0) {
    const s = text.lastIndexOf("══════", userH)
    const after = text.indexOf("\n", text.indexOf("══════", userH + 1))
    const rest = text.slice(after > 0 ? after : userH + 40)
    const next = rest.search(/\n#\s/)
    const e = next >= 0 ? (after > 0 ? after : userH + 40) + next + 1 : text.length
    if (s >= 0) mark(s, e, "user", "User Profile", makeSource("memories/USER.md", "USER.md"))
  }

  // Mem0 Memory
  const m0 = text.indexOf("# Mem0 Memory")
  if (m0 >= 0) {
    const rest = text.slice(m0 + 1)
    const next = rest.search(/\n##?\s/)
    mark(m0, next >= 0 ? m0 + 1 + next + 1 : text.length, "mem0", "Mem0 Memory")
  }

  // Skills catalog
  const skH = text.indexOf("## Skills (mandatory)")
  const skE = text.indexOf("</available_skills>")
  if (skH >= 0 && skE >= 0) {
    let end = text.indexOf("\n", skE)
    while (end < text.length && end >= 0) {
      const nl = text.indexOf("\n", end + 1)
      if (nl < 0) { end = text.length; break }
      const line = text.slice(end + 1, nl).trim()
      if (line.startsWith("#")) break
      if (line === "") {
        const peek = text.slice(nl + 1, text.indexOf("\n", nl + 1)).trim()
        if (peek.startsWith("#")) { end = nl; break }
      }
      end = nl
    }
    mark(skH, end + 1, "skills", "Skills Catalog", makeSource("skills", "skills/"))
  }

  // Project Context
  const proj = text.indexOf("# Project Context")
  if (proj >= 0) {
    const conv = text.indexOf("Conversation started:")
    mark(proj, conv > proj ? conv : text.length, "project", "Project Context", makeSource("AGENTS.md"))
  }

  // Session metadata
  const conv = text.indexOf("Conversation started:")
  if (conv >= 0) mark(conv, text.length, "meta", "Session Metadata")

  // Unmarked regions → "other"
  let start = -1
  for (let i = 0; i <= text.length; i++) {
    if (i < text.length && !used[i]) {
      if (start < 0) start = i
    } else if (start >= 0) {
      const slice = text.slice(start, i)
      if (slice.trim().length > 0) {
        sections.push({ id: "other", label: "Other", chars: slice.length, tokens: tok(slice), text: slice })
      }
      start = -1
    }
  }

  return sections.sort((a, b) => text.indexOf(a.text) - text.indexOf(b.text))
}

/** Classify tools by origin. MCP tools always have `mcp_` prefix — this is
 *  a guaranteed convention (mcp_tool.py:2394 collision guard). */
export function classifyTools(
  tools: ReadonlyArray<ToolInfo>,
): { system: ToolInfo[]; mcp: ToolInfo[] } {
  const system: ToolInfo[] = []
  const mcp: ToolInfo[] = []
  for (const t of tools) {
    if (t.name.startsWith("mcp_")) mcp.push(t)
    else system.push(t)
  }
  return { system, mcp }
}

/** Token estimate for a tool's schema entry. chars/4 fallback — ToolInfo
 *  only carries lengths, not text. */
export function toolTokens(tool: ToolInfo): number {
  return Math.ceil((tool.descriptionLength + tool.paramsLength) / CPT)
}

type Opts = {
  contextLength: number
  usedTokens?: number
  sections: ReadonlyArray<Section>
  conversationTokens: number
  tools: ReadonlyArray<ToolInfo>
  /** Optional — total tokens consumed by installed skills (name+description
   *  per skill). When absent, falls back to the "skills" section from parse()
   *  (which reflects what's actually injected into the system prompt). */
  skillsTokens?: number
}

/**
 * Build the two-level segment hierarchy.
 * Returns top-level groups. Groups with children can be drilled into.
 *
 * Top-level categories (in display order):
 *   system_prompt | system_tools | mcp_tools | memory | skills | conversation | free
 */
export function build(opts: Opts): Segment[] {
  const pct = (t: number) => opts.contextLength > 0 ? (t / opts.contextLength) * 100 : 0
  const result: Segment[] = []

  const byId = new Map<string, Section>()
  for (const s of opts.sections) byId.set(s.id, s)
  const promptChildren: Segment[] = opts.sections
    .filter(sec => SYSTEM_PROMPT_IDS.has(sec.id) && sec.tokens > 0)
    .map(sec => ({
      id: sec.id,
      label: sec.label,
      tokens: sec.tokens,
      percent: pct(sec.tokens),
      section: sec,
    }))
  const promptTok = promptChildren.reduce((s, c) => s + c.tokens, 0)
  if (promptTok > 0) {
    result.push({
      id: "system_prompt",
      label: "System Prompt",
      tokens: promptTok,
      percent: pct(promptTok),
      children: promptChildren,
    })
  }
  const { system: sysTools, mcp: mcpTools } = classifyTools(opts.tools)
  const sysToolsTok = sysTools.reduce((s, t) => s + toolTokens(t), 0)
  if (sysToolsTok > 0) {
    result.push({
      id: "system_tools",
      label: "System Tools",
      tokens: sysToolsTok,
      percent: pct(sysToolsTok),
    })
  }
  const mcpToolsTok = mcpTools.reduce((s, t) => s + toolTokens(t), 0)
  if (mcpToolsTok > 0) {
    result.push({
      id: "mcp_tools",
      label: "MCP Tools",
      tokens: mcpToolsTok,
      percent: pct(mcpToolsTok),
    })
  }
  const memChildren: Segment[] = opts.sections
    .filter(sec => MEMORY_IDS.has(sec.id) && sec.tokens > 0)
    .map(sec => ({
      id: sec.id,
      label: sec.label,
      tokens: sec.tokens,
      percent: pct(sec.tokens),
      section: sec,
    }))
  const memTok = memChildren.reduce((s, c) => s + c.tokens, 0)
  if (memTok > 0) {
    result.push({
      id: "memory",
      label: "Memory",
      tokens: memTok,
      percent: pct(memTok),
      children: memChildren,
    })
  }
  const skillsSec = byId.get("skills")
  const skillsTok = skillsSec?.tokens ?? opts.skillsTokens ?? 0
  if (skillsTok > 0) {
    result.push({
      id: "skills",
      label: "Skills",
      tokens: skillsTok,
      percent: pct(skillsTok),
      section: skillsSec,
    })
  }
  if (opts.conversationTokens > 0) {
    const ct = opts.conversationTokens
    result.push({ id: "conversation", label: "~Conversation", tokens: ct, percent: pct(ct) })
  }
  const taken = result.reduce((s, g) => s + g.tokens, 0)
  const used = opts.usedTokens
  if (typeof used !== "number") {
    const unknown = Math.max(0, opts.contextLength - taken)
    if (unknown > 0) result.push({ id: "unknown", label: "Unknown (live unavailable)", tokens: unknown, percent: pct(unknown) })
    return result
  }
  const unknown = Math.max(0, used - taken)
  if (unknown > 0) result.push({ id: "unknown", label: "Unknown / Provider Overhead", tokens: unknown, percent: pct(unknown) })
  const overage = Math.max(0, taken - used)
  if (overage > 0) result.push({ id: "overage", label: "Estimate Overage", tokens: overage, percent: pct(overage) })
  const free = Math.max(0, opts.contextLength - used)
  result.push({ id: "free", label: "Free", tokens: free, percent: pct(free) })
  return result
}

/**
 * Get drilled-in segments for a group, with percentages rescaled
 * to fill the grid relative to the group's total.
 */
export function drill(group: Segment): Segment[] {
  if (!group.children || group.children.length === 0) return []
  const total = group.tokens
  return group.children.map(c => ({
    ...c,
    percent: total > 0 ? (c.tokens / total) * 100 : 0,
  }))
}

/** Generate 256 cells from segments, proportional to percent */
export function cells(segments: ReadonlyArray<Segment>, fallback = "free"): Cell[] {
  const filled = segments.flatMap(seg =>
    Array.from({ length: Math.round((seg.percent / 100) * GRID) }, () => ({ id: seg.id }))
  )
  const pad = Array.from({ length: Math.max(0, GRID - filled.length) }, () => ({ id: fallback }))
  return [...filled, ...pad].slice(0, GRID)
}
