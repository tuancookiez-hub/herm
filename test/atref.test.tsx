import { describe, expect, test } from "bun:test"
import { act, createRef } from "react"
import { rmSync } from "fs"
import { join } from "path"
import { KEYWORDS, match } from "../src/app/useAtRefPopover"
import { frecency } from "../src/app/frecency"
import { configDir } from "../src/utils/paths"
import { mountNode, until, MockGateway, type Harness } from "./harness"
import { Composer, type ComposerHandle } from "../src/components/chat/Composer"

describe("atref keywords", () => {
  test("bare @ shows all fixed keywords", () => {
    const texts = match("@").map(k => k.text)
    expect(texts).toEqual([
      "@diff", "@staged", "@git:1", "@git:3", "@git:5", "@url:", "@folder:",
    ])
    // presets for @git:<n>
    expect(KEYWORDS.filter(k => k.text.startsWith("@git:"))).toHaveLength(3)
  })

  test("typed prefix narrows case-insensitively", () => {
    expect(match("@di").map(k => k.text)).toEqual(["@diff"])
    expect(match("@DI").map(k => k.text)).toEqual(["@diff"])
    expect(match("@g").map(k => k.text)).toEqual(["@git:1", "@git:3", "@git:5"])
    expect(match("@s").map(k => k.text)).toEqual(["@staged"])
    expect(match("@x")).toEqual([])
  })

  test("@folder: / @url: drop out once the prefix is complete → path/URL takes over", () => {
    // exact match is excluded so accepting `@folder:` hands off to
    // gateway path completion instead of re-offering itself
    expect(match("@folder:")).toEqual([])
    expect(match("@folder:src/")).toEqual([])
    expect(match("@url:")).toEqual([])
    // but partial prefix still offers the keyword
    expect(match("@fold").map(k => k.text)).toEqual(["@folder:"])
  })
})

describe("atref frecency ranking", () => {
  test("complete.path results sort by frecency; accept() bumps", async () => {
    rmSync(join(configDir(), "frecency.jsonl"), { force: true })
    frecency._reset()
    frecency.bump("@file:src/b.ts")  // b above a
    const ref = createRef<ComposerHandle>()
    const gw = new MockGateway({
      "complete.path": () => ({ items: [
        { text: "@file:src/a.ts", display: "a.ts", meta: "src/" },
        { text: "@file:src/b.ts", display: "b.ts", meta: "src/" },
        { text: "@file:src/c.ts", display: "c.ts", meta: "src/" },
      ]}),
    })
    gw.start()
    const t: Harness = await mountNode(
      <box flexDirection="column" flexGrow={1} width="100%" height="100%">
        <box flexGrow={1} />
        <Composer ref={ref} focused canSubmitPrompt={true} ready streaming={false} cmds={[]}
          onSend={() => {}} onSlash={() => {}} />
      </box>,
      { gw, width: 120, height: 30 },
    )
    await until(t, () => t.frame().includes("Ready"))
    await act(async () => { await t.keys.typeText("look at @src/") })
    // 120ms debounce + render
    await until(t, () => t.frame().includes("b.ts"), 3000)
    const f = t.frame().split("\n")
    const row = (s: string) => f.findIndex(l => l.includes(s))
    // b (bumped) renders above a and c (server order preserved among ties)
    expect(row("b.ts")).toBeLessThan(row("a.ts"))
    expect(row("a.ts")).toBeLessThan(row("c.ts"))
    // Accept cursor item (b.ts) via handle → bumps it again
    const before = frecency.score("@file:src/b.ts")
    act(() => ref.current?.popAccept())
    await until(t, () => ref.current?.value().includes("@file:src/b.ts") === true)
    expect(frecency.score("@file:src/b.ts")).toBeGreaterThan(before)
    t.destroy()
  })
})
