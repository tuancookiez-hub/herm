import { describe, expect, mock, test } from "bun:test"
import { act } from "react"
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { mountNode, until, type Harness } from "./harness"
import { EikonGallery } from "../src/tabs/EikonGallery"
import { eikon } from "../src/service/eikon"
import * as submit from "../src/service/eikon-submit"
import * as prefs from "../src/context/preferences"

const HH = process.env.HERMES_HOME!

function seed(name: string, opts: { published?: boolean } = {}) {
  const p = eikon.ensure(name)
  const src = Bun.file(join(import.meta.dir, "../assets/eikons/default/default.eikon")).text()
  return src.then(raw => {
    const lines = raw.trimEnd().split("\n")
    const baseHead = JSON.parse(lines[0]!)
    const head = { ...baseHead, id: `liftaris/${name}`, title: name, author: { name: "kaio" } }
    writeFileSync(eikon.file(name), JSON.stringify(head) + "\n" + lines.slice(1).join("\n") + "\n")
    mkdirSync(join(p.dir, "source"), { recursive: true })
    writeFileSync(join(p.dir, "source", "base.png"), "png")
    const manifest = { name, version: 1, source: "source/base.png", states: { idle: { file: "source/base.png" } }, ...(opts.published ? { origin: { source: "https://catalog.example/eikons/draft", at: "2026-05-31T00:00:00Z" } } : {}) }
    writeFileSync(join(p.dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
    prefs.set("eikon", name)
  })
}

async function selectDraft(t: Harness) {
  await until(t, () => t.frame().includes("draft"))
  for (let i = 0; i < 20; i++) {
    if (t.frame().split("\n").some(l => l.includes("▸") && l.includes("draft"))) return
    act(() => t.keys.pressArrow("down"))
    await t.settle()
  }
  throw new Error(`draft row not selectable\n${t.frame()}`)
}

async function open(t: Harness) {
  await selectDraft(t)
  act(() => t.keys.pressKey("u"))
  await until(t, () => t.frame().includes("Submit eikon"))
}

async function stage(t: Harness) {
  act(() => t.keys.pressEnter())
  await until(t, () => t.frame().includes("Included files"))
}

describe("Eikon submit dialog", () => {
  test("Enter previews included files before backend invocation", async () => {
    await seed("draft")
    const fn = mock(async () => ({ kind: "submitted" as const, url: "https://github.com/liftaris/eikon/pull/1", request: {} as never }))
    await using t = await mountNode(<EikonGallery focused submit={fn} />, { width: 160, height: 48 })
    await open(t)
    await stage(t)
    expect(t.frame()).toContain("source/base.png")
    expect(t.frame()).toContain("manifest.json")
    expect(fn).not.toHaveBeenCalled()
  })

  test("published marketplace installs are blocked from duplicate submission", async () => {
    await seed("draft", { published: true })
    const fn = mock(async () => ({ kind: "submitted" as const, url: "https://github.com/liftaris/eikon/pull/1", request: {} as never }))
    await using t = await mountNode(<EikonGallery focused submit={fn} />, { width: 160, height: 48 })
    await selectDraft(t)
    act(() => t.keys.pressKey("u"))
    await until(t, () => t.frame().includes("Create a local draft before submitting"))
    expect(t.frame()).not.toContain("Submit eikon")
    expect(fn).not.toHaveBeenCalled()
  })

  test("preflight preview lists safe included files and omits secret symlink escapes", async () => {
    await seed("draft")
    const root = eikon.dir("draft")
    writeFileSync(join(root, "README.md"), "ok")
    writeFileSync(join(root, ".env"), "TOKEN=***")
    writeFileSync(join(HH, "escape.txt"), "outside")
    symlinkSync(join(HH, "escape.txt"), join(root, "source", "escape.txt"))
    const seen = await submit.preview({ path: eikon.file("draft") })
    const paths = seen.files.map(f => f.path)
    expect(paths).toContain("source/base.png")
    expect(paths).toContain("manifest.json")
    expect(paths).not.toContain(".env")
    expect(paths).not.toContain("source/escape.txt")
    const fn = mock(async () => ({ kind: "submitted" as const, url: "https://github.com/liftaris/eikon/pull/7", request: {} as never }))
    await using t = await mountNode(<EikonGallery focused submit={fn} />, { width: 180, height: 60 })
    await open(t)
    await stage(t)
    expect(t.frame()).toContain("manifest.json")
    expect(t.frame()).not.toContain(".env")
    expect(t.frame()).not.toContain("escape.txt")
    expect(fn).not.toHaveBeenCalled()
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Submitted") && t.frame().includes("pull/7"))
    expect(fn).toHaveBeenCalledWith({ path: eikon.file("draft") })
  })

  test("preflight setup guidance does not submit", async () => {
    await seed("draft")
    const fn = mock(async () => ({ kind: "setup-needed" as const, failures: [{ code: "missing-auth" as const, message: "Run gh auth login" }] }))
    await using t = await mountNode(<EikonGallery focused submit={fn} />, { width: 160, height: 48 })
    await open(t)
    await stage(t)
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Setup needed") && t.frame().includes("Run gh auth login"))
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith({ path: eikon.file("draft") })
  })

  test("happy path displays the returned submission URL", async () => {
    await seed("draft")
    const fn = mock(async () => ({ kind: "submitted" as const, url: "https://github.com/liftaris/eikon/pull/7", request: {} as never }))
    await using t = await mountNode(<EikonGallery focused submit={fn} />, { width: 160, height: 48 })
    await open(t)
    await stage(t)
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Submitted") && t.frame().includes("pull/7"))
    expect(fn).toHaveBeenCalledWith({ path: eikon.file("draft") })
  })

  test("failure redacts displayed auth tokens", async () => {
    await seed("draft")
    const fn = mock(async () => ({ kind: "backend-failed" as const, failures: [{ code: "backend-failed" as const, message: "gh failed token ***" }] }))
    await using t = await mountNode(<EikonGallery focused submit={fn} />, { width: 160, height: 48 })
    await open(t)
    await stage(t)
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Submit failed"))
    expect(t.frame()).toContain("[redacted]")
    expect(t.frame()).not.toContain("***")
    expect(fn).toHaveBeenCalledWith({ path: eikon.file("draft") })
  })

  test("repeated Enter while in flight creates one backend submission", async () => {
    await seed("draft")
    let release: ((value: submit.SubmitResult) => void) | undefined
    const fn = mock(() => new Promise<submit.SubmitResult>(res => { release = res }))
    await using t = await mountNode(<EikonGallery focused submit={fn} />, { width: 160, height: 48 })
    await open(t)
    await stage(t)
    act(() => t.keys.pressEnter())
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Submitting…"))
    expect(fn).toHaveBeenCalledTimes(1)
    release!({ kind: "submitted", url: "https://github.com/liftaris/eikon/pull/9", request: {} as never })
    await until(t, () => t.frame().includes("pull/9"))
  })

  test("rejected submit clears busy state", async () => {
    await seed("draft")
    let calls = 0
    const fn = mock(async () => { calls++; throw new Error("gh failed Bearer abc.def") })
    await using t = await mountNode(<EikonGallery focused submit={fn} />, { width: 160, height: 48 })
    await open(t)
    await stage(t)
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Submit failed") && t.frame().includes("[redacted]"))
    act(() => t.keys.pressEnter())
    await until(t, () => calls === 2)
  })

  test("Submit entry is hidden for bundled eikons", async () => {
    prefs.set("eikon", "default")
    const fn = mock(async () => ({ kind: "submitted" as const, url: "https://github.com/liftaris/eikon/pull/1", request: {} as never }))
    await using t = await mountNode(<EikonGallery focused submit={fn} />, { width: 160, height: 48 })
    await until(t, () => t.frame().includes("(bundled)"))
    expect(t.frame()).not.toContain("submit")
    act(() => t.keys.pressKey("u"))
    await t.settle()
    expect(t.frame()).not.toContain("Submit eikon")
    expect(fn).not.toHaveBeenCalled()
  })
})
