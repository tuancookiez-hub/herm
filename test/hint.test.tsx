import { describe, test, expect } from "bun:test"
import { mountNode } from "./harness"
import { HintBar } from "../src/ui/hint"

// HintBar stays one row below tab panes. Pairs render as `[key] verb`
// joined by two spaces; raw text passes through unchanged.

describe("HintBar", () => {
  test("raw text renders verbatim in a single row", async () => {
    const t = await mountNode(<HintBar raw="↑↓ nav  Enter open" />, { width: 60, height: 3 })
    const f = t.frame()
    expect(f).toContain("↑↓ nav  Enter open")
    // Single-row footer — no second content line.
    const nonEmpty = f.split("\n").filter(l => l.trim()).length
    expect(nonEmpty).toBe(1)
    t.destroy()
  })

  test("pairs format as [key] verb joined by 2 spaces", async () => {
    const t = await mountNode(
      <HintBar pairs={[["↑↓", "select"], ["Enter", "open"], ["n", "new"]]} />,
      { width: 60, height: 3 },
    )
    expect(t.frame()).toContain("[↑↓] select  [Enter] open  [n] new")
    t.destroy()
  })

  test("pairs take precedence over raw when both supplied", async () => {
    const t = await mountNode(
      <HintBar pairs={[["Esc", "cancel"]]} raw="ignored" />,
      { width: 40, height: 3 },
    )
    const f = t.frame()
    expect(f).toContain("[Esc] cancel")
    expect(f).not.toContain("ignored")
    t.destroy()
  })

  test("suffix appends after pairs with ' · ' separator", async () => {
    const t = await mountNode(
      <HintBar pairs={[["↑↓", "select"], ["Space", "activate"]]}
               suffix="● 3 unsaved" />,
      { width: 80, height: 3 },
    )
    expect(t.frame()).toContain("[↑↓] select  [Space] activate  ·  ● 3 unsaved")
    t.destroy()
  })

  test("suffix without pairs is ignored (use raw for pure-status lines)", async () => {
    const t = await mountNode(<HintBar suffix="lonely" />, { width: 40, height: 3 })
    expect(t.frame()).not.toContain("lonely")
    t.destroy()
  })

  test("oversized content clips to one row, does not wrap", async () => {
    const long = "↑↓ nav  Enter open  n new  d delete  / search  r refresh  Tab pane"
    const t = await mountNode(<HintBar raw={long} />, { width: 30, height: 3 })
    const f = t.frame()
    // At w=30 the tail words won't fit — the line is clipped, not
    // reflowed onto a second row.
    const nonEmpty = f.split("\n").filter(l => l.trim()).length
    expect(nonEmpty).toBe(1)
    t.destroy()
  })
})
