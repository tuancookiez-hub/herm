import { afterEach, expect, test } from "bun:test"
import { act } from "react"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { mountNode, until, type Harness } from "./harness"
import { EikonGallery } from "../src/tabs/EikonGallery"
import { EikonStudio } from "../src/tabs/EikonStudio"
import { eikon } from "../src/service/eikon"
import * as prefs from "../src/context/preferences"
import { submit as eikonSubmit, type SubmitBackend, type SubmitRequest } from "eikon"
import { caps, type Rasterizer } from "../src/utils/eikon-render"

const HH = process.env.HERMES_HOME!
if (!HH || HH.includes("/.hermes")) throw new Error("sandbox not applied")

const PX = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,0,0,0,0,58,126,155,85,0,0,0,10,73,68,65,84,120,156,99,104,0,0,0,130,0,129,119,205,114,182,0,0,0,0,73,69,78,68,174,66,96,130])

const stubFrame = Array.from({ length: 24 }, (_, i) =>
  (i === 0 ? "E2E-PREVIEW" : i === 1 ? "NOUS-DUPLICATE" : "").padEnd(48))

const stub: Rasterizer = {
  name: "e2e-stub",
  knobs: {},
  available: () => true,
  render: async () => ({ frames: [stubFrame] }),
}

function seedNousDraft(name: string) {
  const p = eikon.ensure(name)
  const source = join(p.source, "base.png")
  writeFileSync(source, PX)

  const lines = readFileSync(join(import.meta.dir, "../assets/eikons/default/default.eikon"), "utf8").trimEnd().split("\n")
  const head = JSON.parse(lines[0]!)
  head.id = `liftaris/${name}`
  head.title = name
  head.author = { name: "herm-e2e" }
  writeFileSync(p.file, `${JSON.stringify(head)}\n${lines.slice(1).join("\n")}\n`)
  writeFileSync(join(p.dir, "manifest.json"), JSON.stringify({
    name,
    version: 1,
    source: "source/base.png",
    states: { idle: { file: "source/base.png" } },
  }, null, 2) + "\n")
  eikon.writeStudio(name, {
    rasterizer: "e2e-stub",
    spatial: { zoom: 1, ox: 0.5, oy: 0.5 },
    tone: { contrast: 1, invert: true, flip: "none" },
    fps: 12,
    base: {},
    per: {},
    glyph: "◆",
    sources: { base: "base.png" },
  })
  prefs.set("eikon", name)
  return p
}

async function selectRow(t: Harness, name: string) {
  await until(t, () => t.frame().includes(name))
  for (let i = 0; i < 30; i++) {
    if (t.frame().split("\n").some(l => l.includes("▸") && l.includes(name))) return
    act(() => t.keys.pressArrow("down"))
    await t.settle()
  }
  throw new Error(`row not selected: ${name}\n${t.frame()}`)
}

function rowVisible(t: Harness, name: string) {
  return t.frame().split("\n").some(l => l.includes(name) && !l.includes("Deleted"))
}

function snap(label: string, t: Harness, frames: Record<string, string>) {
  frames[label] = t.frame()
  if (process.env.EIKON_E2E_DUMP) console.log(`\n--- ${label} ---\n${frames[label]}`)
}

afterEach(() => {
  prefs.set("eikon", undefined)
  rmSync(join(HH, "eikons"), { recursive: true, force: true })
})

test("Eikon visual E2E: duplicate Nous draft, studio preview, submit, delete reload", async () => {
  const name = "nous-e2e"
  const seeded = seedNousDraft(name)
  const un = eikon.register(stub)
  const requests: SubmitRequest[] = []
  const backend: SubmitBackend = {
    async check() { return { ok: true as const } },
    async create(req) {
      requests.push(req)
      return { kind: "submitted" as const, url: "https://example.test/submissions/nous-e2e", request: req }
    },
  }
  const submit = (input: { path: string }) => eikonSubmit({ path: input.path, backend })
  const frames: Record<string, string> = {}

  try {
    await using gallery = await mountNode(<EikonGallery focused onEdit={() => {}} submit={submit} />, { width: 180, height: 54 })
    await selectRow(gallery, name)
    await until(gallery, () => gallery.frame().includes(`Preview — ${name}`))
    snap("gallery", gallery, frames)
    expect(frames.gallery).toContain(`● ${name}`)
    expect(frames.gallery).toContain("● source")
    expect(frames.gallery).toContain("Preview")

    await using studio = await mountNode(<EikonStudio focused name={name} />, { width: 180, height: 60 })
    const previewReady = caps.ffmpeg ? "E2E-PREVIEW" : "ffmpeg not installed"
    await until(studio, () => studio.frame().includes(`Settings — ${name}`) && studio.frame().includes(previewReady))
    snap("studio", studio, frames)
    expect(frames.studio).toContain("base.png")
    expect(frames.studio).toContain("States")
    expect(frames.studio).toContain("e2e-stub")

    act(() => gallery.keys.pressKey("u"))
    await until(gallery, () => gallery.frame().includes("Submit eikon"))
    snap("submit-open", gallery, frames)
    act(() => gallery.keys.pressEnter())
    await until(gallery, () => gallery.frame().includes("Included files"))
    snap("submit-preview", gallery, frames)
    expect(frames["submit-preview"]).toContain(`${name}.eikon`)
    expect(frames["submit-preview"]).toContain("manifest.json")
    expect(frames["submit-preview"]).toContain("source/base.png")
    expect(requests).toHaveLength(0)

    act(() => gallery.keys.pressEnter())
    await until(gallery, () => gallery.frame().includes("Submitted") && gallery.frame().includes("nous-e2e"))
    snap("submitted", gallery, frames)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.bundle.files.map(f => f.path).sort()).toEqual(["manifest.json", `${name}.eikon`, "source/base.png"])
    expect(requests[0]!.bundle.catalog.name).toBe(name)
    expect(requests[0]!.bundle.catalog.runtimeUrl).toContain(`${name}.eikon`)

    act(() => gallery.keys.pressEscape())
    await until(gallery, () => !gallery.frame().includes("Submit eikon"))
    await selectRow(gallery, name)
    act(() => gallery.keys.pressKey("d"))
    await until(gallery, () => gallery.frame().includes(`Delete '${name}'?`))
    snap("delete-confirm", gallery, frames)
    act(() => gallery.keys.pressEnter())
    await until(gallery, () => !existsSync(seeded.dir) && !rowVisible(gallery, name))
    snap("delete-reload", gallery, frames)
    expect(prefs.get("eikon")).toBeUndefined()
  } finally {
    un()
  }
})
