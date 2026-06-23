// Serialized JSON writes for Schrödinger's Box on-disk state.
// Poll, Run, and merge all touch manifest.json / active.json — queue per path.

import { mkdirSync, writeFileSync } from "fs"
import { dirname } from "path"

const tails = new Map<string, Promise<void>>()

const GROUP_ID_RE = /^[a-zA-Z0-9_-]{8,48}$/

export function safeGroupId(id: string): string | null {
  const s = id.trim()
  return GROUP_ID_RE.test(s) ? s : null
}

export function writeJsonQueued(path: string, data: unknown): Promise<void> {
  const prev = tails.get(path) ?? Promise.resolve()
  const next = prev
    .then(() => {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify(data, null, 2), "utf-8")
    })
    .catch((err) => {
      process.stderr.write(`schrodinger-io: write failed ${path}: ${String(err)}\n`)
    })
  tails.set(path, next)
  return next
}