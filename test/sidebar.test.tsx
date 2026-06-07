import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mountNode, until, MockGateway } from "./harness"
import { Sidebar } from "../src/components/sidebar/Sidebar"
import { parseEikon } from "../src/components/avatar/eikon"

const PREVIEW = parseEikon([
  JSON.stringify({ eikon: 1, name: "preview", width: 48, height: 24 }),
  JSON.stringify({ state: "idle", fps: 1, frame_count: 1, loop_from: 1 }),
  JSON.stringify({ f: 0, data: "SIDEBAR-PREVIEW-IDLE" }),
].join("\n") + "\n")

const INFO = {
  model: "test-model-v9",
  cwd: "/home/t",
  tools: { file: ["read", "write"], web: ["search"] },
  skills: { dev: ["a"] },
  mcp_servers: [
    { name: "linear", connected: true, transport: "stdio", tools: 5 },
    { name: "broken", connected: false, transport: "stdio", tools: 0 },
  ],
}

describe("Sidebar", () => {
  test("Title primary, Agent row gone, no Identity wrapper, no Tools row", async () => {
    const gw = new MockGateway({ "plugins.list": () => ({ plugins: [] }) })
    const t = await mountNode(
      <Sidebar agentState="idle" info={INFO} title="my session" />,
      { gw, width: 160, height: 48 },
    )
    await until(t, () => t.frame().includes("Title"))

    const f = t.frame()

    // Title always-on, first identity row
    expect(f).toMatch(/Title\s+my session/)
    expect(f.indexOf("Title")).toBeLessThan(f.indexOf("Profile"))

    // Agent row removed; Profile carries lineage
    expect(f).not.toMatch(/Agent\s+Hermes/)
    expect(f).toContain("Profile")

    // Identity rows render flat (no ▾/▸ Identity wrapper)
    expect(f).not.toContain("Identity")
    expect(f).toContain("test-model-v9")

    expect(f).not.toMatch(/^\s*Tools\s/m)
    expect(f).not.toMatch(/^\s*Skills\s/m)
    expect(f).not.toContain("▸ Stats")
    expect(f).not.toContain("▸ Memory")
    expect(f).not.toContain("▸ Recent")
    expect(f).not.toContain("Est. cost")
    expect(f).toContain("▸ MCP")
    t.destroy()
  })

  test("Title row shows placeholder when unset (no layout shift)", async () => {
    const gw = new MockGateway({ "plugins.list": () => ({ plugins: [] }) })
    const t = await mountNode(
      <Sidebar agentState="idle" info={INFO} />,
      { gw, width: 160, height: 48 },
    )
    await until(t, () => t.frame().includes("Profile"))
    expect(t.frame()).toMatch(/Title\s+—/)
    t.destroy()
  })

  test("MCP section toggles on header click", async () => {
    const gw = new MockGateway({ "plugins.list": () => ({ plugins: [] }) })
    const t = await mountNode(
      <Sidebar agentState="idle" info={INFO} />,
      { gw, width: 160, height: 48 },
    )
    await until(t, () => t.frame().includes("▸ MCP"))

    const find = (needle: string) => {
      const lines = t.frame().split("\n")
      const y = lines.findIndex(l => l.includes(needle))
      return { x: lines[y].indexOf(needle), y }
    }

    let p = find("▸ MCP")
    await act(async () => { await t.mouse.pressDown(p.x, p.y) })
    await until(t, () => t.frame().includes("▾ MCP"))
    expect(t.frame()).toContain("● linear")
    expect(t.frame()).toContain("○ broken")

    p = find("▾ MCP")
    await act(async () => { await t.mouse.pressDown(p.x, p.y) })
    await until(t, () => t.frame().includes("▸ MCP"))
    expect(t.frame()).not.toContain("● linear")
    t.destroy()
  })

  test("context gauge renders used/max + bar + percent when usage present", async () => {
    const gw = new MockGateway({ "plugins.list": () => ({ plugins: [] }) })
    const info = {
      ...INFO,
      usage: { input: 0, output: 0, total: 0, context_used: 258_000, context_max: 1_000_000 },
    }
    const t = await mountNode(
      <Sidebar agentState="idle" info={info} />,
      { gw, width: 160, height: 48 },
    )
    await until(t, () => t.frame().includes("258K"))
    const f = t.frame()
    expect(f).toContain("258K / 1M")
    expect(f).toContain("█")
    expect(f).toContain("░")
    expect(f).toContain("26%")
    t.destroy()
  })

  test("context gauge hidden when usage absent", async () => {
    const gw = new MockGateway({ "plugins.list": () => ({ plugins: [] }) })
    const t = await mountNode(
      <Sidebar agentState="idle" info={INFO} />,
      { gw, width: 160, height: 48 },
    )
    await until(t, () => t.frame().includes("Profile"))
    const f = t.frame()
    // No gauge chrome: no bracketed block bar
    expect(f).not.toMatch(/\[█+░*\]/)
    expect(f).not.toMatch(/\[░+\]/)
    t.destroy()
  })

  test("preview override replaces avatar and suppresses chat cloud", async () => {
    const gw = new MockGateway({ "plugins.list": () => ({ plugins: [] }) })
    const t = await mountNode(
      <Sidebar agentState="thinking" info={INFO} cloud pulse preview={{ key: "market", eikon: PREVIEW, state: "idle", subtitle: "Test" }} />,
      { gw, width: 160, height: 48 },
    )
    await until(t, () => t.frame().includes("SIDEBAR-PREVIEW-IDLE"))
    const f = t.frame()
    expect(f).toMatch(/Eikon\s+preview/)
    expect(f).toMatch(/Author\s+Test/)
    expect(f).not.toContain("Profile")
    expect(f).not.toContain("╭")
    t.destroy()
  })
})
