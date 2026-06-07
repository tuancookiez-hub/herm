import { describe, test, expect } from "bun:test"
import { build, classifyTools, drill, cells, type Section } from "../src/service/context-segments"
import type { ToolInfo } from "../src/service/hermes-home"

const mkSection = (id: string, label: string, tokens: number, text = "x"): Section => ({
  id, label, tokens, chars: tokens * 4, text,
})

const mkTool = (name: string, d = 100, p = 200): ToolInfo => ({
  name, descriptionLength: d, paramsLength: p,
})

describe("classifyTools", () => {
  test("partitions by mcp_ prefix", () => {
    const { system, mcp } = classifyTools([
      mkTool("terminal"),
      mkTool("read_file"),
      mkTool("mcp_github_create_issue"),
      mkTool("mcp_linear_list"),
    ])
    expect(system.map(t => t.name)).toEqual(["terminal", "read_file"])
    expect(mcp.map(t => t.name)).toEqual(["mcp_github_create_issue", "mcp_linear_list"])
  })

  test("empty in, empty out", () => {
    const r = classifyTools([])
    expect(r.system).toEqual([])
    expect(r.mcp).toEqual([])
  })

  test("all MCP → system empty", () => {
    const r = classifyTools([mkTool("mcp_x_a"), mkTool("mcp_y_b")])
    expect(r.system).toEqual([])
    expect(r.mcp.length).toBe(2)
  })

  test("name starting literally with 'mcp_' but no suffix is still MCP", () => {
    // Edge case — shouldn't happen in practice but contract is prefix match
    const r = classifyTools([mkTool("mcp_")])
    expect(r.mcp.length).toBe(1)
  })

  test("'mcp' without underscore is system-builtin", () => {
    // Guard against substring matching bugs
    const r = classifyTools([mkTool("mcporter")])
    expect(r.system.length).toBe(1)
    expect(r.mcp.length).toBe(0)
  })
})

describe("build — context estimates", () => {
  const baseOpts = {
    contextLength: 200_000,
    inputTokens: 50_000,
    sections: [] as Section[],
    conversationTokens: 0,
    tools: [] as ToolInfo[],
  }

  test("produces estimated categories with explicit unknown when live usage is absent", () => {
    const sections: Section[] = [
      mkSection("soul", "SOUL.md", 500),
      mkSection("memory", "Memory Notes", 300),
      mkSection("user", "User Profile", 200),
      mkSection("skills", "Skills Catalog", 1500),
      mkSection("project", "Project Context", 400),
      mkSection("meta", "Session Metadata", 100),
      mkSection("other", "Other", 50),
    ]
    const tools: ToolInfo[] = [
      mkTool("terminal", 400, 800),    // 1200 chars → 300 tok
      mkTool("mcp_x_a", 200, 400),     // 600 chars → 150 tok
    ]
    const got = build({
      ...baseOpts,
      sections,
      tools,
      conversationTokens: 2000,
    })
    const ids = got.map(g => g.id)
    expect(ids).toEqual([
      "system_prompt", "system_tools", "mcp_tools",
      "memory", "skills", "conversation", "unknown",
    ])
  })

  test("system_prompt only contains framing (project+meta+other), not memory or skills", () => {
    const sections: Section[] = [
      mkSection("soul", "SOUL", 1000),
      mkSection("skills", "Skills Catalog", 2000),
      mkSection("project", "Project", 500),
      mkSection("meta", "Meta", 100),
    ]
    const [sysPrompt] = build({ ...baseOpts, sections })
    expect(sysPrompt.id).toBe("system_prompt")
    expect(sysPrompt.tokens).toBe(600) // project + meta, NOT soul or skills
    expect(sysPrompt.children?.map(c => c.id)).toEqual(["project", "meta"])
  })

  test("memory group aggregates soul + memory + user + mem0", () => {
    const sections: Section[] = [
      mkSection("soul", "SOUL", 100),
      mkSection("memory", "Notes", 200),
      mkSection("user", "User", 300),
      mkSection("mem0", "Mem0", 400),
    ]
    const got = build({ ...baseOpts, sections })
    const mem = got.find(g => g.id === "memory")
    expect(mem).toBeDefined()
    expect(mem!.tokens).toBe(1000)
    expect(mem!.children?.map(c => c.id).sort()).toEqual(["mem0", "memory", "soul", "user"])
  })

  test("zero live usage still renders free", () => {
    const got = build({ ...baseOpts, usedTokens: 0 }) // no sections, no tools, no conversation
    expect(got.map(g => g.id)).toEqual(["free"])
  })

  test("free = live used math, not estimated categories", () => {
    const sections: Section[] = [mkSection("project", "Project", 1000)]
    const tools: ToolInfo[] = [mkTool("x", 4000, 0)] // 4000 chars → 1000 tok
    const got = build({
      ...baseOpts,
      contextLength: 10_000,
      usedTokens: 3500,
      sections,
      tools,
      conversationTokens: 2000,
    })
    const free = got[got.length - 1]
    expect(free.id).toBe("free")
    // 10000 - live used 3500, independent of estimate sum.
    expect(free.tokens).toBe(6500)
    expect(got.find(g => g.id === "unknown")).toBeUndefined()
  })

  test("unknown records live used not explained by estimates", () => {
    const got = build({
      ...baseOpts,
      contextLength: 10_000,
      usedTokens: 5000,
      sections: [mkSection("project", "Project", 1000)],
      conversationTokens: 1000,
    })
    expect(got.find(g => g.id === "unknown")?.tokens).toBe(3000)
    expect(got.at(-1)?.tokens).toBe(5000)
  })

  test("overage records estimates exceeding live used", () => {
    const got = build({
      ...baseOpts,
      contextLength: 10_000,
      usedTokens: 1000,
      sections: [mkSection("project", "Project", 3000)],
    })
    expect(got.find(g => g.id === "overage")?.tokens).toBe(2000)
    expect(got.at(-1)?.tokens).toBe(9000)
  })

  test("system_tools and mcp_tools partition tools correctly", () => {
    const tools: ToolInfo[] = [
      mkTool("terminal", 400, 400),    // 800 chars / 4 = 200 tok
      mkTool("read_file", 200, 200),   // 400 chars / 4 = 100 tok
      mkTool("mcp_g_a", 400, 0),        // 400 chars / 4 = 100 tok
      mkTool("mcp_g_b", 400, 0),        // 400 chars / 4 = 100 tok
    ]
    const got = build({ ...baseOpts, tools })
    const sys = got.find(g => g.id === "system_tools")
    const mcp = got.find(g => g.id === "mcp_tools")
    expect(sys?.tokens).toBe(300)
    expect(mcp?.tokens).toBe(200)
  })
})

describe("drill", () => {
  test("rescales children to sum to 100% of parent", () => {
    const sections: Section[] = [
      mkSection("soul", "SOUL", 100),
      mkSection("memory", "Notes", 300),
    ]
    const [mem] = build({
      contextLength: 10_000,
      sections,
      conversationTokens: 0,
      tools: [],
    }).filter(g => g.id === "memory")
    const drilled = drill(mem)
    const sum = drilled.reduce((s, c) => s + c.percent, 0)
    expect(sum).toBeCloseTo(100, 1)
  })

  test("returns [] for groups without children", () => {
    const tools: ToolInfo[] = [mkTool("terminal", 100, 100)]
    const [sys] = build({
      contextLength: 10_000,
      sections: [],
      conversationTokens: 0,
      tools,
    }).filter(g => g.id === "system_tools")
    expect(drill(sys)).toEqual([])
  })
})

describe("cells", () => {
  test("produces 256 cells", () => {
    const sections: Section[] = [mkSection("project", "P", 1000)]
    const segs = build({
      contextLength: 10_000, sections,
      conversationTokens: 0, tools: [],
    })
    expect(cells(segs)).toHaveLength(256)
  })

  test("fallback fills under-filled total", () => {
    const cells_ = cells([{ id: "x", label: "X", tokens: 1, percent: 10 }], "free")
    // 10% = ~26 cells of "x", rest "free"
    const xs = cells_.filter(c => c.id === "x").length
    const frees = cells_.filter(c => c.id === "free").length
    expect(xs).toBeGreaterThan(20)
    expect(xs).toBeLessThan(30)
    expect(frees).toBeGreaterThan(220)
    expect(xs + frees).toBe(256)
  })
})
