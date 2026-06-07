import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { dirname, join } from "path"
import { parseEikon, listEikons } from "../src/components/avatar/eikon"
import { bundledEikonPath } from "../src/components/avatar/bundled"

const FIXTURE = [
  JSON.stringify({ eikon: 1, name: "tiny", width: 4, height: 2, author: "t", states: ["idle", "error"] }),
  JSON.stringify({ state: "idle", fps: 8, frame_count: 2 }),
  JSON.stringify({ f: 0, data: " o \n/|\\" }),
  JSON.stringify({ f: 1, data: " O \n/|\\" }),
  JSON.stringify({ state: "error", frame_count: 2 }),
  JSON.stringify({ f: 0, data: " x \n/|\\", duration_ms: 100 }),
  JSON.stringify({ f: 1, data: " X \n/|\\", duration_ms: 50 }),
].join("\n")

const LAUNCH_FIXTURE = [
  JSON.stringify({
    type: "header",
    eikon: 1,
    id: "test/tiny-launch",
    version: "1.0.0",
    title: "tiny launch",
    author: { name: "t" },
    size: { cols: 3, rows: 2 },
    defaultSignal: "state.idle",
    signals: {
      "state.idle": { clip: "idle" },
      "state.error": { clip: "error", fallback: "state.idle" },
    },
  }),
  JSON.stringify({ type: "clip", name: "idle", fps: 8, frameCount: 2, loopFrom: 0 }),
  JSON.stringify({ type: "frame", clip: "idle", index: 0, rows: [" o ", "/|\\"] }),
  JSON.stringify({ type: "frame", clip: "idle", index: 1, rows: [" O ", "/|\\"] }),
  JSON.stringify({ type: "clip", name: "error", fps: 4, frameCount: 1, loopFrom: 1 }),
  JSON.stringify({ type: "frame", clip: "error", index: 0, rows: [" x ", "/|\\"] }),
].join("\n")

describe("parseEikon", () => {
  test("parses header + states + frames", () => {
    const e = parseEikon(FIXTURE)
    expect(e.meta.name).toBe("tiny")
    expect(e.meta.version).toBe(1)
    expect(e.meta.width).toBe(4)
    expect(e.meta.states).toEqual(["idle", "error"])
    expect(e.states.size).toBe(2)
    const idle = e.states.get("idle")!
    expect(idle.fps).toBe(8)
    expect(idle.frames).toHaveLength(2)
    expect(idle.frames[0]).toEqual([" o ", "/|\\"])
  })

  test("derives fps from median duration_ms when fps absent", () => {
    const e = parseEikon(FIXTURE)
    const err = e.states.get("error")!
    // median of [100, 50] = 75 → 1000/75 ≈ 13
    expect(err.fps).toBe(13)
  })

  test("falls back to 12 fps when no fps and no durations", () => {
    const txt = [
      JSON.stringify({ eikon: 1, name: "x", width: 1, height: 1 }),
      JSON.stringify({ state: "idle", frame_count: 1 }),
      JSON.stringify({ f: 0, data: "." }),
    ].join("\n")
    expect(parseEikon(txt).states.get("idle")!.fps).toBe(12)
  })

  test("throws with line number on malformed JSON", () => {
    const bad = FIXTURE.split("\n")
    bad[2] = "{not json"
    expect(() => parseEikon(bad.join("\n"))).toThrow(/line 3/)
  })

  test("tolerates unknown version and unknown fields", () => {
    const txt = [
      JSON.stringify({ eikon: 99, name: "x", width: 1, height: 1, mystery: true }),
      JSON.stringify({ state: "idle", fps: 4, frame_count: 1, extra: [1, 2] }),
      JSON.stringify({ f: 0, data: ".", weird: {} }),
    ].join("\n")
    const e = parseEikon(txt)
    expect(e.meta.version).toBe(99)
    expect(e.states.get("idle")!.frames).toHaveLength(1)
  })

  test("loop_from: absent → 0, explicit clamped to [0,count], loop:false → count", () => {
    const mk = (decl: object) => [
      JSON.stringify({ eikon: 1, name: "x", width: 1, height: 1 }),
      JSON.stringify({ state: "s", fps: 4, frame_count: 3, ...decl }),
      JSON.stringify({ f: 0, data: "." }),
      JSON.stringify({ f: 1, data: "." }),
      JSON.stringify({ f: 2, data: "." }),
    ].join("\n")
    expect(parseEikon(mk({})).states.get("s")!.loopFrom).toBe(0)
    expect(parseEikon(mk({ loop_from: 2 })).states.get("s")!.loopFrom).toBe(2)
    expect(parseEikon(mk({ loop_from: 3 })).states.get("s")!.loopFrom).toBe(3)   // hold
    expect(parseEikon(mk({ loop_from: 99 })).states.get("s")!.loopFrom).toBe(3)  // clamp
    expect(parseEikon(mk({ loop_from: -5 })).states.get("s")!.loopFrom).toBe(0)  // clamp
    expect(parseEikon(mk({ loop: false })).states.get("s")!.loopFrom).toBe(3)    // alias
    expect(parseEikon(mk({ loop: true })).states.get("s")!.loopFrom).toBe(0)
    // loop:false wins over loop_from (deprecated alias, but unambiguous intent)
    expect(parseEikon(mk({ loop: false, loop_from: 1 })).states.get("s")!.loopFrom).toBe(3)
  })

  test("parses launch-format streams", () => {
    const e = parseEikon(LAUNCH_FIXTURE)
    expect(e.meta.name).toBe("tiny launch")
    expect(e.meta.version).toBe(1)
    expect(e.meta.width).toBe(3)
    expect(e.meta.height).toBe(2)
    expect(e.states.has("idle")).toBe(true)
    expect(e.states.get("idle")!.frames[0]).toEqual([" o ", "/|\\"])
    expect(e.states.get("error")!.loopFrom).toBe(1)
  })
})

describe("listEikons", () => {
  test("scans dirs, parses header only, skips missing dirs", () => {
    const dir = mkdtempSync(join(tmpdir(), "eikon-"))
    writeFileSync(join(dir, "a.eikon"), FIXTURE)
    writeFileSync(join(dir, "skip.txt"), "nope")
    const found = listEikons([dir, "/does/not/exist"])
    expect(found).toHaveLength(1)
    expect(found[0].meta.name).toBe("tiny")
    expect(found[0].meta.states).toEqual(["idle", "error"])
    expect(found[0].path).toContain("a.eikon")
  })

  test("prefers package manifest entrypoint over sibling non-entrypoint streams", () => {
    const dir = mkdtempSync(join(tmpdir(), "eikon-"))
    writeFileSync(join(dir, "standalone.eikon"), FIXTURE)
    const pkg = join(dir, "pkg")
    mkdirSync(pkg)
    writeFileSync(join(pkg, "manifest.json"), JSON.stringify({
      kind: "eikon.package",
      schemaVersion: "1.0",
      id: "test/pkg",
      name: "pkg",
      compatibility: { eikon: ">=1 <2" },
      entrypoints: { default: "streams/pkg.eikon" },
      files: [{ path: "streams/pkg.eikon", role: "runtime", mediaType: "application/vnd.eikon.stream+jsonl" }],
    }))
    mkdirSync(join(pkg, "streams"))
    writeFileSync(join(pkg, "streams", "pkg.eikon"), LAUNCH_FIXTURE)
    writeFileSync(join(pkg, "pkg.eikon"), FIXTURE)
    writeFileSync(join(pkg, "extra.eikon"), LAUNCH_FIXTURE)

    const found = listEikons([dir])
    const paths = found.map(e => e.path)
    expect(paths.some(p => p.endsWith("standalone.eikon"))).toBe(true)
    expect(paths.some(p => p.endsWith("streams/pkg.eikon"))).toBe(true)
    expect(paths.some(p => p.endsWith("pkg/pkg.eikon"))).toBe(false)
    expect(paths.some(p => p.endsWith("extra.eikon"))).toBe(false)
  })

  test("bundled eikons ship as package runtime streams and list once", () => {
    const p = bundledEikonPath("default")!
    expect(p).toEndWith("default.eikon")
    expect(existsSync(join(dirname(p), "manifest.json"))).toBe(true)
    const e = parseEikon(readFileSync(p, "utf8"))
    expect(e.meta.width).toBe(48)
    expect(e.states.has("idle")).toBe(true)
    const found = listEikons([join(import.meta.dir, "../assets/eikons")])
    expect(found.filter(e => e.meta.name.toLowerCase() === "nous")).toHaveLength(1)
    expect(found.every(e => e.path.endsWith(".eikon"))).toBe(true)
  })
})
