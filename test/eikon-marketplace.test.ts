import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Catalog } from "eikon"
import * as market from "../src/service/eikon-marketplace"
import { eikon } from "../src/service/eikon"
import * as prefs from "../src/context/preferences"

const HH = process.env.HERMES_HOME!
if (!HH || HH.includes("/.hermes")) throw new Error("sandbox not applied")

const body = "{\"eikon\":1,\"name\":\"ares\",\"author\":\"Kaio\",\"width\":48,\"height\":24}\n"
const launch = [
  JSON.stringify({ type: "header", eikon: 1, size: { cols: 4, rows: 2 }, defaultSignal: "state.idle", signals: { "state.idle": { clip: "idle" } } }),
  JSON.stringify({ type: "clip", name: "idle", fps: 12, frameCount: 1 }),
  JSON.stringify({ type: "frame", clip: "idle", index: 0, rows: ["abcd", "efgh"] }),
].join("\n") + "\n"
const png = new Uint8Array([137, 80, 78, 71])

type RouteBody = BodyInit | object | ((req: Request) => BodyInit | object)
type Route = { path: string; body: RouteBody; status?: number; headers?: HeadersInit }
type CatalogEntrySeed = {
  name: string
  id?: string
  version?: string
  author?: string
  description?: string
  poster?: string
  source?: string
  sourceKey?: string
  preview?: string
  runtimeUrl?: string
  packageUrl?: string
}

function url(raw: string, base: string) {
  return new URL(raw, base.endsWith("/") ? base : `${base}/`).toString()
}

function catalogRow(seed: CatalogEntrySeed, base: string) {
  const dir = url(seed.source ?? `${seed.name}/`, base)
  const runtimeUrl = seed.runtimeUrl ? url(seed.runtimeUrl, dir) : url(`${seed.name}.eikon`, dir)
  const packageUrl = seed.packageUrl ? url(seed.packageUrl, dir) : url("manifest.json", dir)
  return {
    kind: "eikon.catalog.entry",
    schemaVersion: "1.0",
    id: seed.id ?? seed.name,
    version: seed.version ?? "1.0.0",
    sourceKey: seed.sourceKey ?? dir,
    name: seed.name,
    title: seed.name,
    ...(seed.author ? { author: seed.author } : {}),
    ...(seed.description ? { description: seed.description } : {}),
    poster: seed.poster ?? seed.name,
    preview: seed.preview ? url(seed.preview, dir) : runtimeUrl,
    runtimeUrl,
    packageUrl,
    compatibility: { eikon: ">=1 <2", available: true },
    trust: {},
  }
}

function entry(seed: CatalogEntrySeed): Catalog["entries"][number] {
  const raw = catalogRow(seed, "https://example.com/eikons/")
  return {
    ...raw,
    w: 48,
    h: 24,
    width: 48,
    height: 24,
    trust: raw.trust,
    identityKey: raw.sourceKey,
    raw,
  } as Catalog["entries"][number]
}

function serve(routes: Route[], seen: string[] = []) {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname
      seen.push(path)
      const hit = routes.find(r => r.path === path)
      if (!hit) return new Response("404", { status: 404 })
      const body = typeof hit.body === "function" ? hit.body(req) : hit.body
      if (typeof body === "object" && !(body instanceof Uint8Array))
        return Response.json(body, { status: hit.status ?? 200, headers: hit.headers })
      return new Response(body as BodyInit, { status: hit.status ?? 200, headers: hit.headers })
    },
  })
}

function fixture() {
  const seen: string[] = []
  const srv = serve([
    { path: "/eikons/index.json", body: req => {
      const base = `${new URL(req.url).origin}/eikons/`
      return [
        catalogRow({ name: "ares", author: "Kaio", poster: "ARES", source: "ares/" }, base),
        catalogRow({ name: "mono", author: "Nous", poster: "MONO", source: "mono/" }, base),
        catalogRow({ name: "ares", author: "Other", poster: "ALT", source: "alt/" }, base),
      ]
    } },
    { path: "/eikons/ares/ares.eikon", body },
    { path: "/eikons/ares/manifest.json", body: { name: "ares", source: "source.png" } },
    { path: "/eikons/ares/source.png", body: png },
    { path: "/eikons/mono/mono.eikon", body: body.replace("ares", "mono") },
    { path: "/eikons/mono/manifest.json", body: { name: "mono", source: "source.png" } },
    { path: "/eikons/mono/source.png", body: png },
    { path: "/eikons/alt/ares.eikon", body: body.replace("Kaio", "Other") },
    { path: "/eikons/alt/manifest.json", body: { name: "ares", source: "source.png" } },
    { path: "/eikons/alt/source.png", body: png },
  ], seen)
  return { srv, seen, base: `http://localhost:${srv.port}/eikons` }
}

afterEach(() => {
  prefs.set("eikon", undefined)
  rmSync(join(HH, "eikons"), { recursive: true, force: true })
})

describe("service/eikon-marketplace", () => {
  test("loads and searches remote rows without full preview fetches", async () => {
    const fx = fixture()
    const state = await market.load({ catalog: fx.base, allowPrivate: true, query: "kaio" })
    expect(state.status).toBe("ready")
    expect(state.query).toBe("kaio")
    expect(state.rows.map(r => r.entry.name)).toEqual(["ares"])
    expect(state.rows[0]!.entry.poster).toBe("ARES")
    expect(state.rows[0]!.installed).toBe(false)
    expect(fx.seen).toEqual(["/eikons/index.json"])
    fx.srv.stop()
  })

  test("returns recoverable error state for catalog load failure", async () => {
    const srv = serve([{ path: "/eikons/index.json", body: "nope", status: 503 }])
    const state = await market.load({ catalog: `http://localhost:${srv.port}/eikons`, allowPrivate: true })
    expect(state.status).toBe("error")
    expect(state.error).toContain("catalog: HTTP 503")
    expect(state.rows).toEqual([])
    srv.stop()
  })

  test("maps installed and active state by catalog identity before name fallback", async () => {
    const fx = fixture()
    eikon.ensure("ares")
    writeFileSync(eikon.file("ares"), `${JSON.stringify({ eikon: 1, name: "ares", source_url: `${fx.base}/alt/` })}\n`)
    writeFileSync(join(eikon.dir("ares"), "manifest.json"), JSON.stringify({
      name: "ares",
      origin: { source: `${fx.base}/alt/`, at: "2026-05-31T00:00:00.000Z" },
    }, null, 2))
    prefs.set("eikon", "ares")

    const state = await market.load({ catalog: fx.base, allowPrivate: true })
    const byPoster = new Map(state.rows.map(r => [r.entry.poster, r]))
    expect(byPoster.get("ALT")!.installed).toBe(true)
    expect(byPoster.get("ALT")!.active).toBe(true)
    expect(byPoster.get("ARES")!.installed).toBe(false)
    expect(byPoster.get("ALT")!.installedManifest?.origin?.source).toBe(`${fx.base}/alt/`)
    fx.srv.stop()
  })

  test("legacy name fallback is deliberate and colliding names stay ambiguous", async () => {
    const fx = fixture()
    eikon.ensure("ares")
    writeFileSync(eikon.file("ares"), `${JSON.stringify({ eikon: 1, name: "ares" })}\n`)

    const state = await market.load({ catalog: fx.base, allowPrivate: true })
    const rows = state.rows.filter(r => r.entry.name === "ares")
    expect(rows.every(r => r.installed)).toBe(true)
    expect(rows.every(r => r.installState === "legacy-name-match")).toBe(true)
    fx.srv.stop()
  })

  test("flat legacy files do not satisfy marketplace installed state", async () => {
    const fx = fixture()
    mkdirSync(join(HH, "eikons"), { recursive: true })
    writeFileSync(join(HH, "eikons", "mono.eikon"), body.replace("ares", "mono"))

    const state = await market.load({ catalog: fx.base, allowPrivate: true })
    expect(state.rows.find(r => r.entry.name === "mono")!.installed).toBe(false)
    fx.srv.stop()
  })

  test("available rows are installable when no eikon is active", async () => {
    const fx = fixture()
    const state = await market.load({ catalog: fx.base, allowPrivate: true })
    const row = state.rows.find(r => r.entry.name === "mono")!

    expect(row.installed).toBe(false)
    expect(row.active).toBe(false)
    expect(row.installState).toBe("available")
    expect(row.action).toBe("install")
    fx.srv.stop()
  })

  test("legacy name fallback is not suppressed by unrelated keyed installs", async () => {
    const fx = fixture()
    eikon.ensure("ares")
    writeFileSync(eikon.file("ares"), `${JSON.stringify({ eikon: 1, name: "ares", source_url: `${fx.base}/alt/` })}\n`)
    eikon.ensure("mono")
    writeFileSync(eikon.file("mono"), `${JSON.stringify({ eikon: 1, name: "mono" })}\n`)

    const state = await market.load({ catalog: fx.base, allowPrivate: true })
    const mono = state.rows.find(r => r.entry.name === "mono")!
    const alt = state.rows.find(r => r.entry.poster === "ALT")!
    const ares = state.rows.find(r => r.entry.poster === "ARES")!

    expect(mono.installed).toBe(true)
    expect(mono.installState).toBe("legacy-name-match")
    expect(alt.installed).toBe(true)
    expect(ares.installed).toBe(false)
    fx.srv.stop()
  })

  test("preview loads selected entry with cache and abort support", async () => {
    const fx = fixture()
    const state = await market.load({ catalog: fx.base, allowPrivate: true })
    const svc = state.service!
    const row = state.rows[0]!

    expect(await svc.preview(row.entry.identityKey)).toBe(body)
    expect(await svc.preview(row.entry.identityKey)).toBe(body)
    expect(fx.seen.filter(p => p.endsWith("ares.eikon"))).toHaveLength(1)

    const ctl = new AbortController()
    ctl.abort()
    await expect(svc.preview(state.rows[1]!.entry.identityKey, { signal: ctl.signal })).rejects.toThrow(/aborted/i)
    fx.srv.stop()
  })

  test("preview deduplicates concurrent requests and caps cached entries", async () => {
    const fx = fixture()
    const state = await market.load({ catalog: fx.base, allowPrivate: true, previewCacheLimit: 1 })
    const svc = state.service!
    const ares = state.rows.find(r => r.entry.poster === "ARES")!
    const mono = state.rows.find(r => r.entry.name === "mono")!

    const [left, right] = await Promise.all([
      svc.preview(ares.entry.identityKey),
      svc.preview(ares.entry.identityKey),
    ])
    expect(left).toBe(body)
    expect(right).toBe(body)
    expect(fx.seen.filter(p => p.endsWith("ares.eikon"))).toHaveLength(1)

    expect(await svc.preview(mono.entry.identityKey)).toContain("mono")
    expect(await svc.preview(ares.entry.identityKey)).toBe(body)
    expect(fx.seen.filter(p => p.endsWith("ares.eikon"))).toHaveLength(2)
    fx.srv.stop()
  })

  test("preview limits concurrent network loads", async () => {
    let active = 0
    let peak = 0
    const pending: (() => void)[] = []
    const waits: (() => void)[] = []
    const waitForFetch = () => pending.length > 0 ? Promise.resolve() : new Promise<void>(resolve => waits.push(resolve))
    const cat: Catalog = {
      base: "https://example.com/eikons",
      entries: ["one", "two", "three"].map(name => entry({ name })),
      load: async () => "",
    }
    const svc = new market.MarketplaceService(cat, {
      concurrency: 1,
      fetcher: async input => {
        active += 1
        peak = Math.max(peak, active)
        const done = waits.shift()
        if (done) done()
        await new Promise<void>(resolve => pending.push(resolve))
        active -= 1
        return new Response(String(input))
      },
    })

    const xs = cat.entries.map(e => svc.preview(e.identityKey))
    await waitForFetch()
    expect(active).toBe(1)
    pending.shift()!()
    await waitForFetch()
    expect(active).toBe(1)
    pending.shift()!()
    await waitForFetch()
    expect(active).toBe(1)
    pending.shift()!()

    await Promise.all(xs)
    expect(peak).toBe(1)
  })

  test("marketplace install writes files, bumps revision, and does not activate", async () => {
    const fx = fixture()
    prefs.set("eikon", "old")
    const before = eikon.revision()
    const state = await market.load({ catalog: fx.base, allowPrivate: true })
    const out = await state.service!.install(state.rows[0]!.entry.identityKey)

    expect(out.name).toBe("ares")
    expect(existsSync(eikon.file("ares"))).toBe(true)
    expect(existsSync(join(eikon.sourceDir("ares"), "base.png"))).toBe(true)
    expect(prefs.get("eikon")).toBe("old")
    expect(eikon.revision()).toBe(before + 1)
    const man = JSON.parse(readFileSync(join(eikon.dir("ares"), "manifest.json"), "utf8"))
    expect(man.origin.source).toBe(`${fx.base}/ares/manifest.json`)
    fx.srv.stop()
  })

  test("marketplace installs launch package catalog entries from explicit manifest URLs", async () => {
    const pkgManifest = {
      kind: "eikon.package",
      schemaVersion: "1.0",
      id: "liftaris/pkg",
      version: "1.0.0",
      name: "pkg",
      compatibility: { eikon: ">=1 <2" },
      entrypoints: { default: "streams/pkg.eikon" },
      files: [
        { path: "streams/pkg.eikon", role: "runtime", mediaType: "application/vnd.eikon.stream+jsonl" },
        { path: "source/base.png", role: "source.base", mediaType: "image/png" },
        { path: "source/idle.mp4", role: "source.clip", mediaType: "video/mp4" },
      ],
      source: { base: "source/base.png", states: { idle: { file: "source/idle.mp4" } } },
    }
    const srv = serve([
      { path: "/eikons/index.json", body: req => {
        const u = new URL(req.url)
        return [catalogRow({
          id: "liftaris/pkg",
          version: "1.0.0",
          name: "pkg",
          source: "packages/pkg/",
          sourceKey: `registry:${u.host}:liftaris/pkg@1.0.0`,
          runtimeUrl: "streams/pkg.eikon",
          packageUrl: "manifest.json",
        }, `${u.origin}/eikons/`)]
      } },
      { path: "/eikons/packages/pkg/manifest.json", body: pkgManifest },
      { path: "/eikons/packages/pkg/streams/pkg.eikon", body: launch },
      { path: "/eikons/packages/pkg/source/base.png", body: png },
      { path: "/eikons/packages/pkg/source/idle.mp4", body: new Uint8Array(8) },
    ])
    const state = await market.load({ catalog: `http://localhost:${srv.port}/eikons`, allowPrivate: true })
    expect(state.status).toBe("ready")
    const out = await state.service!.install(state.rows[0]!.entry.identityKey)

    expect(out.name).toBe("pkg")
    expect(existsSync(eikon.file("pkg"))).toBe(true)
    expect(existsSync(join(eikon.sourceDir("pkg"), "base.png"))).toBe(true)
    expect(existsSync(join(eikon.sourceDir("pkg"), "idle.mp4"))).toBe(true)
    expect(JSON.parse(readFileSync(eikon.file("pkg"), "utf8").split("\n", 1)[0]!).type).toBe("header")
    srv.stop()
  })

  test("failed marketplace install is retryable and does not activate or mark installed", async () => {
    const srv = serve([
      { path: "/eikons/index.json", body: req => [catalogRow({ name: "bad", poster: "B", source: "bad/" }, `${new URL(req.url).origin}/eikons/`)] },
      { path: "/eikons/bad/manifest.json", body: "missing", status: 404 },
    ])
    const state = await market.load({ catalog: `http://localhost:${srv.port}/eikons`, allowPrivate: true })
    await expect(state.service!.install(state.rows[0]!.entry.identityKey)).rejects.toThrow(/manifest: HTTP 404/)
    expect(prefs.get("eikon")).toBeUndefined()
    expect(eikon.list().some(x => x.name === "bad")).toBe(false)
    srv.stop()
  })

  test("empty and no-results states are stable", async () => {
    const srv = serve([{ path: "/eikons/index.json", body: [] }])
    const state = await market.load({ catalog: `http://localhost:${srv.port}/eikons`, allowPrivate: true, query: "none" })
    expect(state.status).toBe("empty")
    expect(state.rows).toEqual([])
    expect(state.selected).toBeUndefined()
    srv.stop()
  })

  test("unsafe public catalog URLs are rejected before fetch", async () => {
    const state = await market.load({ catalog: "http://127.0.0.1/eikons" })
    expect(state.status).toBe("error")
    expect(state.error).toContain("private host")
  })
})
