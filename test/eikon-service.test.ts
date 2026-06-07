import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { eikon } from "../src/service/eikon"
import { knobs } from "../src/utils/eikon-knobs"
import { native, caps, type Rasterizer } from "../src/utils/eikon-render"
import { parseEikon } from "../src/components/avatar/eikon"
import * as prefs from "../src/context/preferences"

const HH = process.env.HERMES_HOME!
if (!HH || HH.includes("/.hermes")) throw new Error("sandbox not applied")

describe("service/eikon: layout", () => {
  test("ensure creates folder form", () => {
    const p = eikon.ensure("foo")
    expect(p.dir).toBe(join(HH, "eikons", "foo"))
    expect(existsSync(p.source)).toBe(true)
  })

  test("adopt + findSource: base → idle → first; per-state wins", () => {
    writeFileSync(join(HH, "ext.png"), "png")
    const f = eikon.adopt("foo", join(HH, "ext.png"))
    expect(f).toBe("base.png")
    expect(eikon.findSource("foo")).toBe(join(HH, "eikons", "foo", "source", "base.png"))
    writeFileSync(join(HH, "eikons", "foo", "source", "error.jpg"), "j")
    expect(eikon.findSource("foo", "error")).toMatch(/error\.jpg$/)
    expect(eikon.findSource("foo", "idle")).toMatch(/base\.png$/)
  })

  test("studio.json round-trip", () => {
    const s = knobs.fresh("foo", native)
    eikon.writeStudio("foo", knobs.toStudio(s))
    const r = eikon.readStudio("foo")!
    expect(r.rasterizer).toBe("native")
    expect(r.glyph).toBe("◆")
  })

  test("list returns folder-form only; legacy header source_url is a fallback", () => {
    writeFileSync(eikon.file("foo"), JSON.stringify({ eikon: 1, name: "foo", source_url: "http://x/foo/" }) + "\n")
    eikon.ensure("bar"); writeFileSync(eikon.file("bar"), '{"eikon":1,"name":"bar"}\n')
    writeFileSync(join(HH, "eikons", "flat.eikon"), "{}")
    const xs = eikon.list()
    const names = xs.map(x => x.name)
    expect(names).toContain("foo"); expect(names).toContain("bar")
    expect(names).not.toContain("flat")
    expect(xs.find(x => x.name === "foo")!.hasSource).toBe(true)
    expect(xs.find(x => x.name === "foo")!.sourceUrl).toBe("http://x/foo/")
  })
})

describe("service/eikon: registry", () => {
  test("built-ins present; register/unregister; pick prefers available", () => {
    expect(eikon.rasterizers().map(r => r.name)).toEqual(["chafa", "native"])
    const fake: Rasterizer = {
      name: "fake", knobs: {},
      available: () => true, render: async () => ({ frames: [[""]] }),
    }
    let pinged = 0
    const off = eikon.onRegistry(() => pinged++)
    const un = eikon.register(fake)
    expect(eikon.rasterizer("fake")).toBe(fake)
    expect(pinged).toBe(1)
    // pick: unavailable prefer → first available. fake is always
    // available, so this holds regardless of chafa/ffmpeg on the host.
    expect(eikon.pick("nope").available()).toBe(true)
    expect(eikon.pick("fake")).toBe(fake)
    un()
    expect(eikon.rasterizer("fake")).toBeUndefined()
    off()
    // With only built-ins, pick() at least falls back to native.
    expect(["chafa", "native"]).toContain(eikon.pick("nope").name)
  })
})

describe("service/eikon: save", () => {
  const run = caps.ffmpeg ? test : test.skip
  run("save writes launch stream, preserves legacy source_url as manifest origin, and bumps revision", async () => {
    const before = eikon.revision()
    eikon.ensure("pack")
    // Valid 16×16 gray PNG via ffmpeg so native can decode it.
    const png = join(HH, "eikons", "pack", "source", "base.png")
    spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi",
      "-i", "color=gray:s=16x16", "-frames:v", "1", "-y", png])
    writeFileSync(eikon.file("pack"), JSON.stringify({ eikon: 1, name: "pack", source_url: "http://x/pack/" }) + "\n")
    const s = knobs.fresh("pack", native, eikon.readStudio("pack"))
    s.sources = { base: "base.png" }
    const out = await eikon.save(s)
    expect(out).toBe(eikon.file("pack"))
    expect(prefs.get("eikon")).toBe("pack")
    expect(eikon.revision()).toBe(before + 1)
    const doc = parseEikon(readFileSync(out, "utf8"))
    expect(doc.meta.width).toBe(48)
    expect(doc.states.size).toBe(6)
    expect(eikon.header(out)!.source_url).toBeUndefined()
    const man = JSON.parse(readFileSync(join(eikon.dir("pack"), "manifest.json"), "utf8"))
    expect(man.origin.source).toBe("http://x/pack/")
    expect(eikon.list().find(x => x.name === "pack")!.sourceUrl).toBe("http://x/pack/")
  })

  test("save with no source writes glyph placeholder frames", async () => {
    eikon.ensure("empty"); writeFileSync(eikon.file("empty"), '{"eikon":1,"name":"empty"}\n')
    const s = knobs.fresh("empty", native)
    const out = await eikon.save(s)
    const doc = parseEikon(readFileSync(out, "utf8"))
    expect(doc.states.get("idle")!.frames[0]!.join("")).toContain("◆")
  })
})

describe("service/eikon: fetchSource", () => {
  const png = new Uint8Array([137, 80, 78, 71])
  const body = (name: string) => {
    if (name === "manifest.json") return Response.json({
      name: "remix", source: "source.png",
      license: "MIT", provenance: "made by Kaio",
      states: { idle: { file: "states/idle.mp4" }, error: { file: "states/error.mp4" } },
    })
    if (name === "source.png") return new Response(png)
    if (name.endsWith(".mp4")) return new Response(new Uint8Array(1024))
    return new Response("404", { status: 404 })
  }
  test("eikon-repo manifest: role-mapped, studio.json sources written, peek caches", async () => {
    const srv = Bun.serve({ port: 0, fetch: r => body(new URL(r.url).pathname.split("/").pop()!) })
    const url = `http://localhost:${srv.port}/x/`
    const peek = await eikon.peekSource(url)
    expect(peek!.n).toBe(3)
    expect(peek!.bytes).toBeGreaterThan(0)
    const out = await eikon.fetchSource(url, { name: "remix" })
    expect(out.n).toBe(3)
    expect(out.sources.base).toBe("base.png")
    expect(out.sources.idle).toBe("idle.mp4")
    expect(existsSync(join(eikon.sourceDir("remix"), "idle.mp4"))).toBe(true)
    // studio.json + manifest.json (with origin) both written.
    expect(eikon.readStudio("remix")!.sources.error).toBe("error.mp4")
    writeFileSync(eikon.file("remix"), '{"eikon":1,"name":"remix"}\n')
    const man = JSON.parse(readFileSync(join(eikon.dir("remix"), "manifest.json"), "utf8"))
    expect(man.origin.source).toBe(url)
    expect(eikon.list().find(x => x.name === "remix")!.manifest!.origin).toEqual(man.origin)
    expect(man.license).toBeUndefined()
    expect(man.provenance).toBeUndefined()
    // peekSource memoized — second call same Promise.
    expect(eikon.peekSource(url)).toBe(eikon.peekSource(url))
    srv.stop()
  })

  test("fetchSource can install without source media", async () => {
    const srv = Bun.serve({ port: 0, fetch: r => body(new URL(r.url).pathname.split("/").pop()!) })
    const url = `http://localhost:${srv.port}/nosource/`
    const out = await eikon.fetchSource(url, { name: "nosource", media: false })
    expect(out.name).toBe("nosource")
    expect(out.n).toBe(3)
    expect(out.bytes).toBe(0)
    expect(out.sources).toEqual({})
    expect(eikon.readStudio("nosource")!.sources).toEqual({})
    expect(existsSync(join(eikon.sourceDir("nosource"), "idle.mp4"))).toBe(false)
    srv.stop()
  })

  test("legacy {files:[]} manifest: role from basename", async () => {
    const srv = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url)
        if (u.pathname.endsWith("manifest.json"))
          return Response.json({ name: "legacy", files: ["base.png", "thinking.png"] })
        return new Response(png)
      },
    })
    const url = `http://localhost:${srv.port}/y/`
    const out = await eikon.fetchSource(url)
    expect(out.name).toBe("legacy")
    expect(out.sources).toEqual({ base: "base.png", thinking: "thinking.png" })
    srv.stop()
  })
})

afterAll(() => { void HH })
