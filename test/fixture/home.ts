import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { prefs } from "../../src/context/preferences"
import { home } from "../../src/home/store"
import { rehome } from "../../src/home/rehome"

type Json = Record<string, unknown> | unknown[]

type Seed = {
  config?: string | Json
  dirs?: string[]
  files?: Record<string, string>
  prefs?: Json
}

const base = () => join(process.env.HOME || homedir(), ".hermes")

const write = (root: string, rel: string, body: string) => {
  const file = join(root, rel)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, body)
}

const yaml = (cfg: string | Json) =>
  typeof cfg === "string" ? cfg : `${JSON.stringify(cfg, null, 2)}\n`

export async function tmpHome(seed: Seed = {}) {
  const prev = {
    home: process.env.HERMES_HOME,
    cfg: process.env.HERM_CONFIG_DIR,
  }
  const root = mkroot()
  const path = join(root, "hermes")
  const cfg = join(root, "config")

  mkdirSync(path, { recursive: true })
  mkdirSync(cfg, { recursive: true })
  for (const dir of seed.dirs ?? []) mkdirSync(join(path, dir), { recursive: true })
  for (const [rel, body] of Object.entries(seed.files ?? {})) write(path, rel, body)
  if (seed.config !== undefined) write(path, "config.yaml", yaml(seed.config))
  if (seed.prefs !== undefined) writeFileSync(join(cfg, "tui.json"), `${JSON.stringify(seed.prefs, null, 2)}\n`)

  process.env.HERM_CONFIG_DIR = cfg
  rehome(path)

  return {
    root,
    path,
    cfg,
    write: (rel: string, body: string) => write(path, rel, body),
    [Symbol.asyncDispose]: async () => {
      home.close()
      if (prev.cfg) process.env.HERM_CONFIG_DIR = prev.cfg
      else delete process.env.HERM_CONFIG_DIR
      rehome(prev.home ?? base())
      if (!prev.home) delete process.env.HERMES_HOME
      prefs.reload()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

function mkroot() {
  return mkdtempSync(join(tmpdir(), "herm-home-"))
}
