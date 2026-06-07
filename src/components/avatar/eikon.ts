// Shim over the `eikon` package so existing herm imports keep their
// names while the format logic lives upstream. Herm-specific shapes
// (EikonMeta.states) are preserved for AnimatedAvatar/Gallery.

import { readdirSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { parse, header as peek, type Eikon, type Clip, type Meta } from "eikon"

export type EikonMeta = Meta
export type EikonState = Clip
export type ParsedEikon = { meta: EikonMeta; states: Map<string, EikonState> }

type ListedEikon = { path: string; meta: EikonMeta }

const STREAM_EXT = /\.eikon$/

function readManifestEntrypoint(path: string): string | undefined {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
    const entrypoints = raw.entrypoints
    if (!entrypoints || typeof entrypoints !== "object" || Array.isArray(entrypoints)) return undefined
    const value = (entrypoints as Record<string, unknown>).default
    return typeof value === "string" && STREAM_EXT.test(value) ? value : undefined
  } catch {
    return undefined
  }
}

export function parseEikon(text: string): ParsedEikon {
  const e = parse(text)
  return { meta: e.meta, states: e.clips }
}

export function listEikons(dirs: string[]): ListedEikon[] {
  return dirs.flatMap(dir => {
    let ents: string[]
    try { ents = readdirSync(dir, { recursive: true }) as string[] }
    catch { return [] }

    const paths = ents.map(e => join(dir, e))
    const streamFiles = paths.filter(path => STREAM_EXT.test(path))

    // Package roots list exactly the manifest entrypoint. Sibling runtime
    // streams under the same package root are ignored unless referenced.
    const packageEntrypoints = new Map<string, string>()
    for (const manifest of paths.filter(path => path.endsWith("manifest.json"))) {
      const entrypoint = readManifestEntrypoint(manifest)
      if (entrypoint) {
        const root = dirname(manifest)
        packageEntrypoints.set(root, join(root, entrypoint))
      }
    }

    const packageRootFor = (path: string): string | undefined => {
      for (const root of packageEntrypoints.keys()) {
        const rel = relative(root, path)
        if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return root
      }
      return undefined
    }

    return streamFiles
      .sort((a, b) => a.localeCompare(b))
      .filter(path => {
        const packageRoot = packageRootFor(path)
        return packageRoot ? path === packageEntrypoints.get(packageRoot) : true
      })
      .map(path => ({ path, meta: peek(resolve(path)) }))
      .filter((x): x is ListedEikon => x.meta !== null)
  })
}

export type { Eikon }
