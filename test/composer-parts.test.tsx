// Composer ↔ PartsBuffer integration. The unit tests in parts.test.tsx
// cover the buffer in isolation; these drive it through the <Composer>
// surface the app actually mounts — submit emits parts[], a single
// backspace past a chip boundary eats it whole, and history restore
// rebuilds chips rather than dropping them to plain text.

import { describe, expect, test } from "bun:test"
import { act, createRef } from "react"
import type { RefObject } from "react"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { mountNode, until, MockGateway, type Harness } from "./harness"
import { Composer, type ComposerHandle } from "../src/components/chat/Composer"
import { LOCAL_COMMANDS } from "../src/app/slashCommands"
import type { Part, FilePart } from "../src/app/parts"

type Sent = { text: string; parts: readonly Part[] | undefined }

// Gateway that resolves any `@file:<query>` word to a single item whose
// text equals the query — so popAccept() accepts a "complete" chip
// (not a prefix that ends in `:` or `/`) and drives the insertPart path.
function fileGateway(): MockGateway {
  return new MockGateway({
    "complete.path": p => {
      const w = String(p.word)
      if (w.startsWith("@file:") && !w.endsWith(":") && !w.endsWith("/")) {
        return { items: [{ text: w, display: w, meta: "file" }] }
      }
      return { items: [] }
    },
  })
}

async function setup(gw = new MockGateway()) {
  const ref = createRef<ComposerHandle>()
  const sent: Sent[] = []
  const t: Harness = await mountNode(
    <box flexDirection="column" flexGrow={1} width="100%" height="100%">
      <box flexGrow={1} />
      <Composer
        ref={ref}
        canSubmitPrompt={true}
        focused={true}
        ready={true}
        streaming={false}
        cmds={LOCAL_COMMANDS}
        onSend={(text, parts) => sent.push({ text, parts })}
        onSlash={() => {}}
      />
    </box>,
    { gw, width: 120, height: 30 },
  )
  await until(t, () => t.frame().includes("Ready"))
  return { t, ref, sent }
}

// Type an @file ref and accept the popover — lands a chip via the real
// atAccept() path (the one the user hits with Tab/Enter on the popover).
async function chip(t: Harness, ref: RefObject<ComposerHandle | null>, word: string) {
  await act(async () => { await t.keys.typeText(word) })
  await until(t, () => ref.current?.popOpen() === true)
  act(() => ref.current?.popAccept())
  await t.settle()
}

describe("composer parts — submit", () => {
  test("chip + text → onSend gets text with chip inlined and parts[] carrying the FilePart", async () => {
    const { t, ref, sent } = await setup(fileGateway())
    await chip(t, ref, "@file:src/a.ts")
    // atAccept appends a trailing space after the chip
    expect(ref.current?.value()).toBe("@file:src/a.ts ")
    await act(async () => { await t.keys.typeText("and hello") })
    await t.settle()
    expect(ref.current?.value()).toBe("@file:src/a.ts and hello")

    act(() => t.keys.pressEnter())
    await t.settle()
    expect(sent).toHaveLength(1)
    expect(sent[0]!.text).toBe("@file:src/a.ts and hello")
    expect(sent[0]!.parts).toHaveLength(1)
    const p = sent[0]!.parts![0] as FilePart
    expect(p.type).toBe("file")
    expect(p.filename).toBe("@file:src/a.ts")
    expect(p.source?.text.value).toBe("@file:src/a.ts")
    t.destroy()
  })

  test("plain text → parts[] is empty", async () => {
    const { t, sent } = await setup()
    await act(async () => { await t.keys.typeText("no chips here") })
    act(() => t.keys.pressEnter())
    await t.settle()
    expect(sent).toEqual([{ text: "no chips here", parts: [] }])
    t.destroy()
  })

  test("two chips back-to-back → parts[] carries both FileParts on submit", async () => {
    const { t, ref, sent } = await setup(fileGateway())
    await chip(t, ref, "@file:src/a.ts")
    await chip(t, ref, "@file:src/b.ts")
    expect(ref.current?.value()).toBe("@file:src/a.ts @file:src/b.ts ")

    act(() => t.keys.pressEnter())
    await t.settle()
    expect(sent).toHaveLength(1)
    expect(sent[0]!.text).toBe("@file:src/a.ts @file:src/b.ts")
    expect(sent[0]!.parts).toHaveLength(2)
    const parts = sent[0]!.parts as readonly FilePart[]
    expect(parts[0]!.type).toBe("file")
    expect(parts[0]!.filename).toBe("@file:src/a.ts")
    expect(parts[1]!.type).toBe("file")
    expect(parts[1]!.filename).toBe("@file:src/b.ts")
    t.destroy()
  })
})
describe("composer parts — atomic backspace", () => {
  test("single backspace past a chip removes it whole (and drops its part on submit)", async () => {
    const { t, ref, sent } = await setup(fileGateway())
    await chip(t, ref, "@file:src/a.ts")
    expect(ref.current?.value()).toBe("@file:src/a.ts ")

    // First ⌫ eats the trailing space; the second lands on the chip
    // boundary and deletes the whole virtual run in one keystroke.
    act(() => t.keys.pressBackspace())
    await t.settle()
    expect(ref.current?.value()).toBe("@file:src/a.ts")
    act(() => t.keys.pressBackspace())
    await t.settle()
    expect(ref.current?.value()).toBe("")

    // Submit a new plain message so the previous chip doesn't ride on parts[]
    await act(async () => { await t.keys.typeText("after") })
    act(() => t.keys.pressEnter())
    await t.settle()
    expect(sent).toEqual([{ text: "after", parts: [] }])
    t.destroy()
  })
})

describe("composer parts — history restore", () => {
  test("↑ into a history entry with parts rebuilds chips, submit re-emits the FilePart", async () => {
    // Seed history with an entry that carries a FilePart. The composer's
    // restore() dispatches to fromSnapshot when parts.length > 0 — that's
    // the chip-rebuild path we need to exercise.
    const dir = process.env.HERM_CONFIG_DIR!
    mkdirSync(dir, { recursive: true })
    const part: FilePart = {
      type: "file",
      mime: "text/uri-list",
      filename: "@file:src/x.ts",
      source: { type: "file", path: "@file:src/x.ts", text: { start: 0, end: 14, value: "@file:src/x.ts" } },
    }
    const entry = { input: "@file:src/x.ts tail", parts: [part] }
    writeFileSync(join(dir, "history"), JSON.stringify(entry) + "\n", "utf-8")

    const { t, ref, sent } = await setup()
    // mountNode doesn't wire useAppKeys, so drive history via the
    // imperative handle the shell normally binds to ArrowUp.
    act(() => { ref.current?.historyUp() })
    await t.settle()
    expect(ref.current?.value()).toBe("@file:src/x.ts tail")

    act(() => t.keys.pressEnter())
    await t.settle()
    expect(sent).toHaveLength(1)
    expect(sent[0]!.text).toBe("@file:src/x.ts tail")
    expect(sent[0]!.parts).toHaveLength(1)
    expect((sent[0]!.parts![0] as FilePart).filename).toBe("@file:src/x.ts")

    rmSync(join(dir, "history"), { force: true })
    t.destroy()
  })
})
