import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { previewSubmitBundle, submit as eikonSubmit, type SubmitFailure, type SubmitResult } from "eikon"
import { file, header } from "./eikon"
export type { SubmitResult } from "eikon"

const TOKEN = /(gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|Bearer\s+[A-Za-z0-9._~+/=-]+|token\s+[A-Za-z0-9._~+/=-]+|\*{3,})/gi

export type SubmitInput = {
  path: string
}

export type SubmitPreview = {
  name: string
  files: { path: string; bytes: number }[]
}

export type Submit = (input: SubmitInput) => Promise<SubmitResult>

export type PublishedInfo = { source: string }

export function submitPath(name: string) {
  return file(name)
}

export function publishedInfo(path: string): PublishedInfo | undefined {
  const head = header(path)
  if (typeof head?.source_url === "string" && head.source_url.trim()) return { source: head.source_url }
  const mf = join(dirname(path), "manifest.json")
  if (!existsSync(mf)) return undefined
  try {
    const man = JSON.parse(readFileSync(mf, "utf8")) as Record<string, unknown>
    const origin = man.origin as Record<string, unknown> | undefined
    const src = origin?.source ?? man.sourceUrl ?? man.source_url
    if (typeof src === "string" && src.trim()) return { source: src }
  } catch {}
  return undefined
}

export function redact(message: string) {
  return message.replace(TOKEN, "[redacted]")
}

export function failureText(xs: SubmitFailure[]) {
  return xs.map(x => redact(x.message)).join("\n")
}

export async function preview(input: SubmitInput): Promise<SubmitPreview> {
  const b = await previewSubmitBundle(input)
  return {
    name: b.meta.name,
    files: b.files.map(f => ({ path: f.path, bytes: f.bytes })),
  }
}

export async function submit(input: SubmitInput) {
  return eikonSubmit(input)
}
