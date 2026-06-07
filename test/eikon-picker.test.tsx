import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { mountNode, until } from "./harness"
import { EikonPickerDialog } from "../src/dialogs/eikon-picker"

const FIXTURE = [
  JSON.stringify({ eikon: 1, name: "tiny-guy", width: 10, height: 3, author: "tester", states: ["idle"] }),
  JSON.stringify({ state: "idle", fps: 4, frame_count: 2 }),
  JSON.stringify({ f: 0, data: "  [o_o]   \n  /| |\\   \n  == ==   " }),
  JSON.stringify({ f: 1, data: "  [O_O]   \n  /| |\\   \n  == ==   " }),
].join("\n")

describe("EikonPickerDialog", () => {
  test("lists fixture and renders live preview", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eikon-pick-"))
    writeFileSync(join(dir, "tiny.eikon"), FIXTURE)

    let picked = ""
    const t = await mountNode(
      <EikonPickerDialog dirs={[dir, "/nope"]} onSelect={p => { picked = p }} />,
      { width: 120, height: 40 },
    )
    await until(t, () => t.frame().includes("tiny-guy"))

    const f = t.frame()
    // list row: name, author, state count; fixed eikon dimensions are omitted.
    expect(f).toContain("tiny-guy")
    expect(f).toContain("tester")
    expect(f).toContain("1 states")
    expect(f).not.toContain("10×3")
    // preview: frame content rendered via AnimatedAvatar
    expect(f).toMatch(/\[o_o\]|\[O_O\]/)
    expect(picked).toBe("")
    t.destroy()
  })
})
