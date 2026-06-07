import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mount, until, MockGateway } from "./harness"

const pk = (name: string, raw = name) => ({
  name,
  ctrl: false,
  meta: false,
  shift: false,
  option: false,
  super: false,
  sequence: raw,
  raw,
  number: false,
  eventType: "press" as const,
  source: "raw" as const,
})

describe("degraded mouse burst filter", () => {
  test("swallows pure SGR mouse leak blobs before composer submit", async () => {
    const gw = new MockGateway()
    await using t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    act(() => t.renderer.keyInput.processParsedKey(pk("<35;120;7M")))
    act(() => t.keys.pressEnter())
    await t.settle()

    expect(gw.last("prompt.submit")).toBeUndefined()
    expect(t.frame()).not.toContain("<35;120;7M")
  })

  test("swallows stalled-loop residue chunks", async () => {
    const gw = new MockGateway()
    await using t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    act(() => t.renderer.keyInput.processParsedKey(pk("35;120;7M")))
    act(() => t.renderer.keyInput.processParsedKey(pk("120;7m")))
    act(() => t.keys.pressEnter())
    await t.settle()

    expect(gw.last("prompt.submit")).toBeUndefined()
    expect(t.frame()).not.toContain("35;120;7M")
    expect(t.frame()).not.toContain("120;7m")
  })

  test("preserves normal prose containing M and m", async () => {
    const gw = new MockGateway()
    await using t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("Mmm MMM mmm yummy") })
    act(() => t.keys.pressEnter())
    await until(t, () => gw.last("prompt.submit") !== undefined)

    expect(gw.last("prompt.submit")?.params.text).toBe("Mmm MMM mmm yummy")
  })
})
