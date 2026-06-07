import * as svc from "../service/eikon"
import * as prefs from "../context/preferences"

export const EIKON_CLI_USAGE = `\
herm eikon — install and manage Herm avatars

Usage:
  herm eikon install <name|url|dir> [--name N] [--no-source] [--no-use] [--json]
  herm eikon peek <name|url|dir> [--json]
  herm eikon list [--json]
  herm eikon use <name> [--json]
  herm eikon -h, --help
`

type FetchOpts = { name?: string; media?: boolean; progress?: (d: number, t: number) => void }

export type EikonCliDeps = {
  fetchSource: (source: string, opts?: FetchOpts) => Promise<svc.Fetched>
  peekSource: typeof svc.peekSource
  list: typeof svc.list
  baked: typeof svc.baked
  setActive: (name: string) => void
  getActive: () => string | undefined
}

export type EikonCliIO = {
  stdout: (s: string) => void
  stderr: (s: string) => void
}

const defaultDeps = (): EikonCliDeps => ({
  fetchSource: svc.fetchSource,
  peekSource: svc.peekSource,
  list: svc.list,
  baked: svc.baked,
  setActive: name => prefs.set("eikon", name),
  getActive: () => prefs.get("eikon"),
})

const defaultIO = (): EikonCliIO => ({
  stdout: s => process.stdout.write(s),
  stderr: s => process.stderr.write(s),
})

type Parsed = {
  values: string[]
  json: boolean
  name?: string
  media?: boolean
  use?: boolean
  error?: string
}

function parse(rest: readonly string[]): Parsed {
  const out: Parsed = { values: [], json: false, media: true, use: true }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!
    if (a === "--json") { out.json = true; continue }
    if (a === "--no-source") { out.media = false; continue }
    if (a === "--no-use") { out.use = false; continue }
    if (a === "--name") {
      const v = rest[++i]
      if (!v || v.startsWith("-")) return { ...out, error: "--name requires a value" }
      out.name = v
      continue
    }
    if (a.startsWith("-")) return { ...out, error: `unknown option ${a}` }
    out.values.push(a)
  }
  return out
}

function emitError(io: EikonCliIO, msg: string, json: boolean): 1 {
  io.stderr(json ? JSON.stringify({ ok: false, error: msg }) + "\n" : `error: ${msg}\n`)
  return 1
}

function emit(io: EikonCliIO, text: string): 0 {
  io.stdout(text.endsWith("\n") ? text : text + "\n")
  return 0
}

export async function handleEikonCli(
  argv: readonly string[],
  deps: EikonCliDeps = defaultDeps(),
  io: EikonCliIO = defaultIO(),
): Promise<number | null> {
  if (argv[0] !== "eikon") return null
  const cmd = argv[1]
  if (!cmd || cmd === "-h" || cmd === "--help") return emit(io, EIKON_CLI_USAGE)

  const p = parse(argv.slice(2))
  if (p.error) return emitError(io, p.error, p.json)

  try {
    if (cmd === "install") {
      const source = p.values[0]
      if (!source) return emitError(io, "usage: herm eikon install <name|url|dir>", p.json)
      const out = await deps.fetchSource(source, { name: p.name, media: p.media })
      if (p.use !== false) deps.setActive(out.name)
      const active = deps.getActive() ?? null
      if (p.json) return emit(io, JSON.stringify({ ok: true, name: out.name, n: out.n, bytes: out.bytes, sources: out.sources, active }))
      return emit(io, `Installed '${out.name}' (${out.n} files)${active === out.name ? " and set active" : ""}`)
    }

    if (cmd === "peek") {
      const source = p.values[0]
      if (!source) return emitError(io, "usage: herm eikon peek <name|url|dir>", p.json)
      const out = await deps.peekSource(source)
      if (!out) return emitError(io, `Could not peek '${source}'`, p.json)
      if (p.json) return emit(io, JSON.stringify({ ok: true, source, n: out.n, bytes: out.bytes }))
      return emit(io, `${source}: ${out.n} files, ${out.bytes} bytes`)
    }

    if (cmd === "list") {
      const rows = deps.list().map(e => ({ name: e.name, file: e.file, hasSource: e.hasSource, sourceUrl: e.sourceUrl }))
      const active = deps.getActive() ?? null
      if (p.json) return emit(io, JSON.stringify({ ok: true, active, eikons: rows }))
      return emit(io, rows.length ? rows.map(e => `${e.name}${e.name === active ? " *" : ""}`).join("\n") : "No installed eikons")
    }

    if (cmd === "use") {
      const name = p.values[0]
      if (!name) return emitError(io, "usage: herm eikon use <name>", p.json)
      if (!deps.baked(name)) return emitError(io, `No installed or bundled eikon named '${name}'`, p.json)
      deps.setActive(name)
      if (p.json) return emit(io, JSON.stringify({ ok: true, active: name }))
      return emit(io, `Avatar → ${name}`)
    }

    return emitError(io, `unknown eikon command '${cmd}'`, p.json)
  } catch (e) {
    return emitError(io, e instanceof Error ? e.message : String(e), p.json)
  }
}
