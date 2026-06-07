import { useEffect, useRef, useState } from "react"
import type { Gateway } from "../context/gateway"
import { frecency } from "./frecency"

export type CompletionItem = {
  readonly text: string
  readonly display: string
  readonly meta: string
}

export type CompletionRequest =
  | { method: "complete.path"; params: { word: string }; replaceFrom: number }
  | { method: "complete.slash"; params: { text: string }; replaceFrom: number }

const TAB_PATH_RE = /((?:["']?(?:[A-Za-z]:[\\/]|\.{1,2}\/|~\/|\/|@|[^"'`\s]+\/))[^\s]*)$/

function looksLikeSlashCommand(text: string) {
  return /^\/[^\s/]*(?:\s|$)/.test(text)
}

function clear(setItems: (items: CompletionItem[]) => void, setCursor: (idx: number) => void, setReplace: (idx: number) => void) {
  setItems([])
  setCursor(0)
  setReplace(0)
}

export function completionRequest(input: string): CompletionRequest | null {
  const slash = looksLikeSlashCommand(input)
  const word = slash ? null : (input.match(TAB_PATH_RE)?.[1] ?? null)
  if (!slash && !word) return null
  if (slash && /^\/model(?:\s|$)/.test(input)) return null
  if (slash) return { method: "complete.slash", params: { text: input }, replaceFrom: 1 }
  return { method: "complete.path", params: { word: word! }, replaceFrom: input.length - word!.length }
}

export function acceptCompletion(input: string, item: CompletionItem, replaceFrom: number) {
  const replace = item.text.startsWith("/") && input.startsWith("/") ? 0 : replaceFrom
  const left = input.slice(0, replace)
  if (item.text.includes(":")) frecency.bump(item.text)
  const space = item.text.endsWith("/") || /\s$/.test(item.text) ? "" : " "
  return left + item.text + space
}

export function useCompletion(input: string, blocked: boolean, gw: Gateway) {
  const [items, setItems] = useState<CompletionItem[]>([])
  const [cursor, setCursor] = useState(0)
  const [replaceFrom, setReplace] = useState(0)
  const seq = useRef(0)
  const dismissed = useRef<string | null>(null)

  useEffect(() => {
    if (blocked) {
      seq.current++
      dismissed.current = null
      clear(setItems, setCursor, setReplace)
      return
    }
    const req = completionRequest(input)
    if (!req) {
      seq.current++
      dismissed.current = null
      clear(setItems, setCursor, setReplace)
      return
    }
    if (dismissed.current === input) return
    dismissed.current = null
    const me = ++seq.current
    const t = setTimeout(() => {
      gw.request<{ items?: CompletionItem[]; replace_from?: number }>(req.method, req.params)
        .then(r => {
          if (seq.current !== me) return
          const ranked = (r.items ?? [])
            .map(i => ({ i, s: frecency.score(i.text) }))
            .sort((a, b) => b.s - a.s)
            .map(x => x.i)
          setItems(ranked)
          setCursor(0)
          setReplace(req.method === "complete.slash" ? (r.replace_from ?? req.replaceFrom) : req.replaceFrom)
        })
        .catch(e => {
          if (seq.current !== me) return
          setItems([{ text: "", display: "completion unavailable", meta: e instanceof Error && e.message ? e.message : "unavailable" }])
          setCursor(0)
          setReplace(req.replaceFrom)
        })
    }, 60)
    return () => clearTimeout(t)
  }, [blocked, gw, input])

  const open = items.length > 0
  const dismiss = () => {
    seq.current++
    dismissed.current = input
    clear(setItems, setCursor, setReplace)
  }

  return { open, items, cursor, setCursor, replaceFrom, dismiss }
}
