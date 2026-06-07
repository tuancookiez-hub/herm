import { describe, expect, test, afterEach } from "bun:test"
import { act } from "react"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { mount, mountNode, until } from "./harness"
import { EikonGroup } from "../src/tabs/EikonGroup"
import { eikon } from "../src/service/eikon"
import * as prefs from "../src/context/preferences"
import type { SidebarPreview } from "../src/components/sidebar/Sidebar"

const HH = process.env.HERMES_HOME!
const launchBody = (name: string, author: string, frames: Record<string, string>) => {
  const rows = (line: string) => Array.from({ length: 24 }, (_, i) => (i === 0 ? line : "").padEnd(48))
  return [
    JSON.stringify({
      type: "header", eikon: 1, id: `liftaris/${name}`, version: "1.0", title: name,
      author: { name: author }, size: { cols: 48, rows: 24 }, defaultSignal: "state.idle",
      signals: Object.fromEntries(Object.keys(frames).map(state => [
        `state.${state}`,
        state === "idle" ? { clip: state } : { clip: state, fallback: "state.idle" },
      ])),
    }),
    ...Object.entries(frames).flatMap(([state, frame]) => [
      JSON.stringify({ type: "clip", name: state, fps: 1, frameCount: 1, loopFrom: 0 }),
      JSON.stringify({ type: "frame", clip: state, index: 0, rows: rows(frame) }),
    ]),
  ].join("\n") + "\n"
}
const body = launchBody("ares", "Kaio", { idle: "ARES-IDLE", thinking: "ARES-THINKING" })
const monoBody = launchBody("mono", "Nous", { idle: "MONO-IDLE" })
const png = new Uint8Array([137, 80, 78, 71])
const servers = new Set<ReturnType<typeof Bun.serve>>()
const baseTestPerf = process.env.HERM_TEST_PERF
const baseAvatarTimerStarts = globalThis.__hermAvatarTimerStarts

type Route = { path: string; body: BodyInit | object; status?: number; headers?: HeadersInit }

function serve(routes: Route[]) {
  const srv = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname
      const hit = routes.findLast(r => r.path === path)
      if (!hit) return new Response("404", { status: 404 })
      if (typeof hit.body === "object" && !(hit.body instanceof Uint8Array))
        return Response.json(hit.body, { status: hit.status ?? 200, headers: hit.headers })
      return new Response(hit.body as BodyInit, { status: hit.status ?? 200, headers: hit.headers })
    },
  })
  servers.add(srv)
  return srv
}

function catalog(extra: Route[] = []) {
  const srv = serve([
    { path: "/eikons/index.json", body: [
      { name: "ares", author: "Kaio", width: 48, height: 24, poster: "ARES-POSTER", source: "ares/", description: "red warrior" },
      { name: "mono", author: "Nous", width: 48, height: 24, poster: "MONO-POSTER", source: "mono/", description: "quiet lines" },
      { name: "delta", author: "Other", width: 48, height: 24, poster: "DELTA-POSTER", source: "delta/", description: "triangle field" },
      { name: "echo", author: "Echo", width: 48, height: 24, poster: "ECHO-POSTER", source: "echo/", description: "sound wall" },
      { name: "foxtrot", author: "Fox", width: 48, height: 24, poster: "FOX-POSTER", source: "foxtrot/", description: "fox field" },
      { name: "gamma", author: "Gamma", width: 48, height: 24, poster: "GAMMA-POSTER", source: "gamma/", description: "green field" },
    ] },
    { path: "/eikons/ares/ares.eikon", body },
    { path: "/eikons/ares/manifest.json", body: { name: "ares", source: "source.png" } },
    { path: "/eikons/ares/source.png", body: png },
    { path: "/eikons/mono/mono.eikon", body: monoBody },
    { path: "/eikons/mono/manifest.json", body: { name: "mono", source: "source.png" } },
    { path: "/eikons/mono/source.png", body: png },
    ...extra,
  ])
  return { srv, base: `http://localhost:${srv.port}/eikons` }
}

function local(name: string) {
  const p = eikon.ensure(name)
  writeFileSync(join(p.source, "base.png"), png)
  writeFileSync(eikon.file(name), JSON.stringify({ eikon: 1, name, author: "Local", width: 48, height: 24 }) + "\n")
}

function group(props: { sub?: number; sidebarPreview?: (p?: SidebarPreview) => void } = {}) {
  let sub = props.sub ?? 2
  return <EikonGroup focused sub={sub} setSub={i => { sub = i }} sidebarPreview={props.sidebarPreview} />
}

async function openMarketplaceTab(t: Awaited<ReturnType<typeof mount>>) {
  act(() => t.keys.pressKey("5", { meta: true }))
  await until(t, () => t.frame().includes("Gallery ("))
  act(() => t.keys.pressArrow("right", { shift: true }))
  act(() => t.keys.pressArrow("right", { shift: true }))
  await until(t, () => t.frame().includes("Marketplace ("))
}

afterEach(() => {
  for (const srv of servers) {
    try { srv.stop() } catch {}
  }
  servers.clear()
  if (baseTestPerf === undefined) delete process.env.HERM_TEST_PERF
  else process.env.HERM_TEST_PERF = baseTestPerf
  if (baseAvatarTimerStarts === undefined) delete globalThis.__hermAvatarTimerStarts
  else globalThis.__hermAvatarTimerStarts = baseAvatarTimerStarts
  delete process.env.EIKON_URL
  prefs.set("eikon", undefined)
  rmSync(join(HH, "eikons"), { recursive: true, force: true })
})

describe("EikonMarketplace tab", () => {
  test("Gallery is separate from Marketplace tab", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    await using t = await mountNode(group({ sub: 0 }), { width: 120, height: 28 })
    await until(t, () => t.frame().includes("Gallery ("))
    expect(t.frame()).not.toContain("[ Marketplace ]")
    expect(t.frame()).not.toContain("ARES-POSTER")
    fx.srv.stop()
  })

  test("poster grid does not fetch previews or start per-card avatar timers", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    const prevTestPerf = process.env.HERM_TEST_PERF
    process.env.HERM_TEST_PERF = "1"
    globalThis.__hermAvatarTimerStarts = 0
    const startsBefore = globalThis.__hermAvatarTimerStarts ?? 0
    await using t = await mountNode(group(), { width: 120, height: 28 })
    await until(t, () => t.frame().includes("Marketplace (6)") && t.frame().includes("ARES-POSTER"))

    expect((globalThis.__hermAvatarTimerStarts ?? 0) - startsBefore).toBe(0)
    delete globalThis.__hermAvatarTimerStarts
    if (prevTestPerf === undefined) delete process.env.HERM_TEST_PERF
    else process.env.HERM_TEST_PERF = prevTestPerf
    fx.srv.stop()
  })

  test("poster cards reserve the full ASCII thumbnail height", async () => {
    const poster = Array.from({ length: 24 }, (_, i) => `ARES-${String(i).padStart(2, "0")}`).join("\n")
    const fx = catalog([{ path: "/eikons/index.json", body: [
      { name: "ares", author: "Kaio", width: 48, height: 24, poster, source: "ares/", description: "red warrior" },
    ] }])
    process.env.EIKON_URL = fx.base
    await using t = await mountNode(group({ sidebarPreview: () => {} }), { width: 120, height: 36 })
    await until(t, () => t.frame().includes("Marketplace (1)") && t.frame().includes("ARES-23"))
    expect(t.frame()).toContain("by Kaio")
    fx.srv.stop()
  })

  test("searches by author and Escape exits search without leaving the tab", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    await using t = await mountNode(group(), { width: 160, height: 48 })
    await until(t, () => t.frame().includes("Marketplace (6)") && t.frame().includes("ARES-POSTER"))
    expect(t.frame()).toContain("red warrior")
    expect(t.frame()).toContain("digest unknown")
    expect(t.frame()).toContain("Install")

    await act(async () => { await t.keys.typeText("/") })
    await until(t, () => t.frame().includes("Search:"))
    await act(async () => { await t.keys.typeText("nous") })
    await until(t, () => t.frame().includes("Marketplace (1)") && t.frame().includes("mono"))
    expect(t.frame()).not.toContain("ares  Kaio")

    act(() => t.keys.pressEscape())
    await until(t, () => t.frame().includes("Marketplace (1)") && !t.frame().includes("Search:"))
    fx.srv.stop()
  })

  test("Enter installs, stays selected, then Enter uses", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    mkdirSync(join(HH, "eikons"), { recursive: true })
    local("localone")
    prefs.set("eikon", "localone")
    await using t = await mountNode(group(), { width: 160, height: 48 })
    await until(t, () => t.frame().includes("Marketplace (6)") && t.frame().includes("Install"))

    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Use") && prefs.get("eikon") === "localone")
    expect(t.frame()).toContain("installed")
    expect(t.frame()).toContain("ares")

    act(() => t.keys.pressEnter())
    await until(t, () => prefs.get("eikon") === "ares" && t.frame().includes("Active"))
    expect(t.frame()).toContain("▸ ● ares")
    fx.srv.stop()
  })

  test("grid navigation clamps and Space does not install", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    await using t = await mountNode(group(), { width: 120, height: 28 })
    await until(t, () => t.frame().includes("Marketplace (6)") && /▸ .*ares/.test(t.frame()))
    expect(t.frame()).toContain("[Space] preview state")

    act(() => t.keys.pressArrow("right"))
    await until(t, () => /▸ .*mono/.test(t.frame()))
    act(() => t.keys.pressArrow("down"))
    await until(t, () => /▸ .*echo/.test(t.frame()))
    act(() => t.keys.pressArrow("left"))
    await until(t, () => /▸ .*delta/.test(t.frame()))
    act(() => t.keys.pressArrow("up"))
    await until(t, () => /▸ .*ares/.test(t.frame()))

    act(() => t.keys.pressKey("END"))
    await until(t, () => /▸ .*gamma/.test(t.frame()))
    act(() => t.keys.pressArrow("down"))
    await t.settle()
    expect(t.frame()).toMatch(/▸ .*gamma/)
    act(() => t.keys.pressKey("HOME"))
    await until(t, () => /▸ .*ares/.test(t.frame()))
    await act(async () => { await t.keys.pressKey(" ") })
    await t.settle()
    expect(eikon.list().some(x => x.name === "ares")).toBe(false)
    fx.srv.stop()
  })

  test("sidebar preview preserves state across selections and falls back when unsupported", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    const previews: string[] = []
    await using t = await mountNode(
      group({ sidebarPreview: p => previews.push(p ? `${p.eikon.meta.name}:${p.state}` : "clear") }),
      { width: 160, height: 48 },
    )
    await until(t, () => previews.includes("ares:idle"))

    await act(async () => { await t.keys.pressKey(" ") })
    await until(t, () => previews.includes("ares:thinking"))
    expect(t.frame()).toContain("[Space] preview state")

    act(() => t.keys.pressArrow("right"))
    await until(t, () => previews.includes("mono:idle"))
    expect(previews).not.toContain("mono:thinking")
    expect(prefs.get("eikon")).toBeUndefined()
    fx.srv.stop()
  })

  test("sidebar preview clears on load failure", async () => {
    const fx = catalog([{ path: "/eikons/ares/ares.eikon", body: "missing", status: 500 }])
    process.env.EIKON_URL = fx.base
    const previews: string[] = []
    await using t = await mountNode(
      group({ sidebarPreview: p => previews.push(p ? p.eikon.meta.name : "clear") }),
      { width: 160, height: 48 },
    )
    await until(t, () => t.frame().includes("Marketplace (6)"))
    await until(t, () => previews.includes("clear"))
    expect(previews).not.toContain("ares")
    fx.srv.stop()
  })

  test("late preview load does not overwrite newer selection", async () => {
    let releaseAres!: (value: Response) => void
    const delayedAres = new Promise<Response>(resolve => { releaseAres = resolve })
    const fx = catalog([{ path: "/eikons/ares/ares.eikon", body: delayedAres as unknown as BodyInit }])
    const stop = fx.srv.stop.bind(fx.srv)
    fx.srv.stop()
    const srv = Bun.serve({
      port: 0,
      async fetch(req) {
        const path = new URL(req.url).pathname
        if (path === "/eikons/ares/ares.eikon") return delayedAres
        const hit = [
          { path: "/eikons/index.json", body: [
            { name: "ares", author: "Kaio", width: 48, height: 24, poster: "ARES-POSTER", source: "ares/", description: "red warrior" },
            { name: "mono", author: "Nous", width: 48, height: 24, poster: "MONO-POSTER", source: "mono/", description: "quiet lines" },
          ] },
          { path: "/eikons/mono/mono.eikon", body: monoBody },
        ].find(r => r.path === path)
        if (!hit) return new Response("404", { status: 404 })
        if (typeof hit.body === "object" && !(hit.body instanceof Uint8Array)) return Response.json(hit.body)
        return new Response(hit.body as BodyInit)
      },
    })
    servers.add(srv)
    process.env.EIKON_URL = `http://localhost:${srv.port}/eikons`
    const previews: string[] = []
    await using t = await mountNode(
      group({ sidebarPreview: p => previews.push(p ? p.eikon.meta.name : "clear") }),
      { width: 160, height: 48 },
    )
    await until(t, () => t.frame().includes("Marketplace (2)"))
    act(() => t.keys.pressArrow("right"))
    await until(t, () => previews.includes("mono"))
    releaseAres(new Response(body))
    await t.settle(); await t.settle()
    expect(previews.at(-1)).toBe("mono")
    srv.stop()
    stop()
  })

  test("narrow marketplace renders selected preview in detail pane", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    await using t = await mountNode(group(), { width: 100, height: 40 })
    await until(t, () => t.frame().includes("Marketplace (6)") && t.frame().includes("ARES-IDLE"))
    await act(async () => { await t.keys.pressKey(" ") })
    await until(t, () => t.frame().includes("ARES-THINKING"))
    fx.srv.stop()
  })

  test("wide marketplace renders detail preview when the app sidebar is hidden", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    await using t = await mount({ width: 160, height: 48 })
    await until(t, () => t.frame().includes("Ready"))
    await openMarketplaceTab(t)

    act(() => t.keys.pressKey("x", { ctrl: true }))
    await t.settle()
    await act(async () => { await t.keys.typeText("b") })
    await until(t, () => t.frame().includes("ARES-IDLE"))
    await act(async () => { await t.keys.pressKey(" ") })
    await until(t, () => t.frame().includes("ARES-THINKING"))
    fx.srv.stop()
  })

  test("marketplace row click activates the clicked card without hover", async () => {
    const fx = catalog()
    process.env.EIKON_URL = fx.base
    await using t = await mountNode(group(), { width: 160, height: 48 })
    await until(t, () => t.frame().includes("Marketplace (6)") && /▸ .*ares/.test(t.frame()))

    const y = () => t.frame().split("\n").findIndex(l => l.includes("mono") && l.includes("Install"))
    await act(async () => { await t.mouse.click(52, y()) })
    await until(t, () => eikon.list().some(x => x.name === "mono"))
    expect(eikon.list().some(x => x.name === "ares")).toBe(false)
    expect(t.frame()).toMatch(/▸ .*mono/)
    fx.srv.stop()
  })
})
