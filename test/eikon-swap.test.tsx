import { test, expect } from "bun:test"
import { act } from "react"
import { writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { mountNode, until, type Harness } from "./harness"
import { EikonGroup } from "../src/tabs/EikonGroup"
import { eikon } from "../src/service/eikon"
import { caps } from "../src/utils/eikon-render"
import * as prefs from "../src/context/preferences"

const HH = process.env.HERMES_HOME!
const run = caps.chafa && caps.ffmpeg ? test : test.skip

function seed(name: string, r: string) {
  const p = eikon.ensure(name)
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi",
    "-i", "color=gray:s=32x32", "-frames:v", "1", "-y", join(p.source, "base.png")])
  writeFileSync(eikon.file(name), JSON.stringify({ eikon: 1, name }) + "\n")
  eikon.writeStudio(name, { rasterizer: r, spatial: { zoom: 1, ox: 0.5, oy: 0.5 }, tone: { contrast: 1, invert: true, flip: "none" }, fps: 16, base: {}, per: {}, glyph: "◆", sources: { base: "base.png" } })
}

/** DialogSelect filterable=false; registry order [chafa, native]. */
async function pickIdx(t: Harness, idx: number) {
  act(() => t.keys.pressKey("HOME")); await t.settle()  // sel → row 0 (eikon)
  act(() => t.keys.pressArrow("down")); await t.settle()  // → row 1 (rasterizer)
  act(() => t.keys.pressEnter())
  await until(t, () => t.frame().includes("Rasterizer"))
  act(() => t.keys.pressKey("HOME")); await t.settle()
  for (let i = 0; i < idx; i++) { act(() => t.keys.pressArrow("down")); await t.settle() }
  act(() => t.keys.pressEnter()); await t.settle()
}

const rowOf = (t: Harness, name: string) =>
  t.frame().split("\n").find(l => l.includes("││") && l.split("││")[1]!.includes(name))!

/** A row is selected when its RHS starts with the caret (`▸ `). HEAD
 *  rows carry `▸` in their *value* text (`▸ defaults`), so checking
 *  anywhere-in-line false-matches. */
const selected = (t: Harness, name: string) =>
  /^ ▸ /.test(rowOf(t, name)?.split("││")[1] ?? "")

async function navTo(t: Harness, name: string) {
  act(() => t.keys.pressKey("HOME")); await t.settle()
  for (let i = 0; i < 20; i++) {
    if (selected(t, name)) return
    act(() => t.keys.pressArrow("down")); await t.settle()
  }
  throw new Error(`never reached row '${name}'\n${t.frame()}`)
}

run("chafa↔native: chafa-only rows appear/disappear immediately on swap", async () => {
  seed("swap", "native")
  prefs.set("eikon", "swap")
  prefs.set("eikonRasterizer", "native")
  await using t = await mountNode(<EikonGroup focused sub={1} setSub={() => {}} />, { width: 180, height: 60 })
  await until(t, () => t.frame().includes("native ▸"))
  // fill/dither are chafa-only; flip/contrast are now studio-owned
  // HEAD rows so they're always present.
  expect(t.frame()).toContain("flip")
  expect(t.frame()).toContain("contrast")
  expect(t.frame()).not.toContain("dither")

  await pickIdx(t, 0)
  await until(t, () => t.frame().includes("chafa ▸"))
  expect(t.frame()).toContain("dither")
  expect(t.frame()).toContain("fill")

  await pickIdx(t, 1)
  await until(t, () => t.frame().includes("native ▸"))
  expect(t.frame()).not.toContain("dither")

  await pickIdx(t, 0)
  await until(t, () => t.frame().includes("chafa ▸"))
  expect(t.frame()).toContain("dither")
})

run("Esc in a prompt dialog does NOT fall through to discard()", async () => {
  seed("esc", "native")
  prefs.set("eikon", "esc")
  await using t = await mountNode(<EikonGroup focused sub={1} setSub={() => {}} />, { width: 180, height: 60 })
  await until(t, () => t.frame().includes("rasterizer"))

  // Make dirty first so discard() would actually fire if Esc leaked.
  await navTo(t, "symbols")
  act(() => t.keys.pressArrow("right")); await t.settle()
  await until(t, () => t.frame().includes("● unsaved"))

  // Open 'source' menu → Esc closes it, no discard confirm.
  await navTo(t, "source")
  act(() => t.keys.pressEnter())
  await until(t, () => t.frame().includes("Source for '"))
  act(() => t.keys.pressEscape()); await t.settle(); await t.settle()
  expect(t.frame()).not.toContain("Source for '")
  expect(t.frame()).not.toContain("Discard unsaved")
  expect(t.frame()).toContain("● unsaved")  // dirty retained

  // Same for rasterizer DialogSelect.
  await navTo(t, "rasterizer")
  act(() => t.keys.pressEnter())
  await until(t, () => t.frame().includes("Rasterizer"))
  act(() => t.keys.pressEscape()); await t.settle(); await t.settle()
  expect(t.frame()).not.toContain("Discard unsaved")
})

run("knob rows: Space and Enter both act per nav.md; click = activate", async () => {
  seed("kact", "native")
  prefs.set("eikon", "kact")
  await using t = await mountNode(<EikonGroup focused sub={1} setSub={() => {}} />, { width: 180, height: 60 })
  await until(t, () => t.frame().includes("invert"))

  // toggle: Space flips, Enter also flips (only one semantic).
  await navTo(t, "invert")
  const was = rowOf(t, "invert").includes("● on")
  act(() => t.keys.pressKey(" ")); await t.settle()
  expect(rowOf(t, "invert").includes("● on")).toBe(!was)
  act(() => t.keys.pressEnter()); await t.settle()
  expect(rowOf(t, "invert").includes("● on")).toBe(was)

  // cycle: Space cycles forward; Enter also cycles (wraps back).
  await navTo(t, "symbols")
  expect(rowOf(t, "symbols")).toContain("braille")
  act(() => t.keys.pressKey(" ")); await t.settle()
  expect(rowOf(t, "symbols")).toContain("block")
  act(() => t.keys.pressEnter()); await t.settle()
  expect(rowOf(t, "symbols")).toContain("braille")

  // select (rasterizer): Space opens dialog.
  await navTo(t, "rasterizer")
  act(() => t.keys.pressKey(" ")); await t.settle()
  await until(t, () => t.frame().includes("Rasterizer"))
  act(() => t.keys.pressEscape()); await t.settle()

  // action/reset: Space is inert (high-commitment); Enter opens confirm.
  await navTo(t, "reset")
  act(() => t.keys.pressKey(" ")); await t.settle(); await t.settle()
  expect(t.frame()).not.toContain("Reset settings?")
  act(() => t.keys.pressEnter())
  await until(t, () => t.frame().includes("Reset settings?"))
  act(() => t.keys.pressKey("n")); await t.settle()

  // slider: Space/Enter inert (no value change).
  await navTo(t, "contrast")
  const c0 = rowOf(t, "contrast")
  act(() => t.keys.pressKey(" ")); await t.settle()
  act(() => t.keys.pressEnter()); await t.settle()
  expect(rowOf(t, "contrast")).toBe(c0)
})

void HH
