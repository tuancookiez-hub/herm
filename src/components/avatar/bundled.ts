// Bundled eikon packages shipped with herm (assets/eikons/<name>/).
// The active gateway skin picks its matching launch stream when the
// user hasn't set an explicit avatar. User-installed eikons are listed
// alongside these in the picker.

import { existsSync, readFileSync } from "fs"
import { join, dirname } from "path"

// In dev, import.meta.dir is src/components/avatar/ and assets/ sits
// three dirs up at the repo root. In the published bundle every
// module collapses into dist/index.js, so import.meta.dir is the
// install root and assets/ sits right beside it (copied there by
// build.ts). Walk up from here until assets/eikons is found —
// hitting dist/ first in the built layout, <repo>/ in dev.
const locate = () => {
  let d = import.meta.dir
  for (let i = 0; i < 5; i++) {
    const p = join(d, "assets/eikons")
    if (existsSync(p)) return p
    const up = dirname(d)
    if (up === d) break
    d = up
  }
  // Unreachable in a correct install; return the dev path so the
  // picker's "No .eikon files found" state renders instead of
  // crashing on a bogus readdir.
  return join(import.meta.dir, "../../../assets/eikons")
}

/** Shipped avatar directory — resolved for both dev and built layouts. */
export const BUNDLED_EIKON_DIR = locate()

const packageEntrypoint = (dir: string): string | undefined => {
  const manifest = join(dir, "manifest.json")
  if (!existsSync(manifest)) return undefined
  try {
    const raw = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, unknown>
    const entrypoints = raw.entrypoints
    const value = entrypoints && typeof entrypoints === "object" && !Array.isArray(entrypoints)
      ? (entrypoints as Record<string, unknown>).default
      : undefined
    const path = typeof value === "string" ? join(dir, value) : undefined
    return path && existsSync(path) ? path : undefined
  } catch {
    return undefined
  }
}

/** Path to the bundled eikon for a skin name, if one ships with herm. */
export function bundledEikonPath(name: string | undefined): string | undefined {
  if (!name) return undefined
  const packageDir = join(BUNDLED_EIKON_DIR, name)
  const entry = packageEntrypoint(packageDir)
  if (entry) return entry
  for (const p of [
    join(packageDir, `${name}.eikon`),
    join(BUNDLED_EIKON_DIR, `${name}.eikon`),
  ]) if (existsSync(p)) return p
  return undefined
}
