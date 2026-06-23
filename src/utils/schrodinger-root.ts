// Shared resolver for the Schrödinger's Box project root.
// Walks up from cwd looking for `.schrodinger/` (current on-disk
// dir). For backward compatibility with forks created before the
// rename, also recognizes `.multiverse/`. Used by both the herm tab
// plugin and app.tsx so the env var is never required.

import { existsSync } from "fs"
import { join } from "path"

const ON_DISK_DIRS = [".schrodinger", ".multiverse"]

export function resolveSchrodingerRoot(): string {
  // 1. Explicit env var (preferred, win-fast)
  const env = (typeof process !== "undefined" && process.env?.SCHRODINGER_PROJECT_ROOT) || ""
  if (env && ON_DISK_DIRS.some(d => existsSync(join(env, d)))) return env
  // 2. Backward-compat: legacy env var name
  const legacy = (typeof process !== "undefined" && process.env?.MULTIVERSE_PROJECT_ROOT) || ""
  if (legacy && ON_DISK_DIRS.some(d => existsSync(join(legacy, d)))) return legacy
  // 3. Walk up from process.cwd() looking for any of the on-disk dirs
  let dir = (typeof process !== "undefined" && process.cwd?.()) || ""
  for (let i = 0; i < 8 && dir; i++) {
    if (ON_DISK_DIRS.some(d => existsSync(join(dir, d)))) return dir
    const parent = join(dir, "..")
    if (parent === dir) break
    dir = parent
  }
  // 4. Fall back to env var (even if dir doesn't exist yet) or cwd
  return env || legacy || (typeof process !== "undefined" && process.cwd?.()) || ""
}

/**
 * Returns the on-disk directory name for a given root, preferring the
 * current `.schrodinger/` and falling back to legacy `.multiverse/`.
 * Used by callers that need to compose paths to manifests/active.json.
 */
export function schrodingerDirFor(root: string): string {
  if (existsSync(join(root, ".schrodinger"))) return ".schrodinger"
  return ".multiverse"
}
