// Shared list navigation — maps list.* catalog actions onto a selection
// index + per-tab action callbacks. Two entry points:
//
//   handleListKey()  plain dispatcher, returns true if consumed. Tabs with
//                    text-capture sub-modes (search/edit) call this from
//                    their own useKeyboard after the sub-mode branch.
//   useListKeys()    hook wrapper that owns the useKeyboard subscriber for
//                    tabs that don't need a bespoke one.
//
// Callers own the `active` guard (focused ∧ no dialog ∧ no sub-mode) so this
// layer doesn't depend on ui/dialog. Leader-armed correctness falls out of
// keys.match(): list.* chords have leader=false, so a bare letter while
// armed never matches here and falls through to useAppKeys.

import { useRef, type Dispatch, type SetStateAction } from "react"
import { useKeyboard } from "@opentui/react"
import type { ParsedKey, ScrollBoxRenderable } from "@opentui/core"
import { useKeys, type Keys } from "./context"

export type ListOpts = {
  count: number
  setSel: Dispatch<SetStateAction<number>>
  /** PgUp/PgDn stride; typically viewport height − 1. */
  page?: number
  /** Called with the clamped target after every nav move (scroll-into-view). */
  scrollTo?: (i: number) => void
  onActivate?: () => void
  onDelete?: () => void
  onRefresh?: () => void
  onNew?: () => void
  onToggle?: () => void
  onSearch?: () => void
}

export function handleListKey(keys: Keys, key: ParsedKey, o: ListOpts): boolean {
  const move = (next: (p: number) => number) => {
    o.setSel(p => {
      const n = Math.max(0, Math.min(o.count - 1, next(p)))
      o.scrollTo?.(n)
      return n
    })
  }
  const pg = o.page ?? 10
  if (keys.match("list.up", key))       { move(p => p - 1); return true }
  if (keys.match("list.down", key))     { move(p => p + 1); return true }
  if (keys.match("list.pageUp", key))   { move(p => p - pg); return true }
  if (keys.match("list.pageDown", key)) { move(p => p + pg); return true }
  if (keys.match("list.home", key))     { move(() => 0); return true }
  if (keys.match("list.end", key))      { move(() => o.count - 1); return true }
  if (o.onActivate && keys.match("list.activate", key)) { o.onActivate(); return true }
  if (o.onDelete   && keys.match("list.delete",   key)) { o.onDelete();   return true }
  if (o.onRefresh  && keys.match("list.refresh",  key)) { o.onRefresh();  return true }
  if (o.onNew      && keys.match("list.new",      key)) { o.onNew();      return true }
  if (o.onToggle   && keys.match("list.toggle",   key)) { o.onToggle();   return true }
  if (o.onSearch   && keys.match("list.search",   key)) { o.onSearch();   return true }
  return false
}

export function useListKeys(o: ListOpts & {
  active: boolean | (() => boolean)
  /** Tab-scoped actions; runs if no list.* action matched. */
  also?: (key: ParsedKey, keys: Keys) => void
}): Keys {
  const keys = useKeys()
  useKeyboard(key => {
    const on = typeof o.active === "function" ? o.active() : o.active
    if (!on) return
    if (handleListKey(keys, key, o)) return
    o.also?.(key, keys)
  })
  return keys
}

// Scroll-follow for list tabs: returns a scrollbox ref, a row-id
// generator, and the two ListOpts fields (scrollTo, page) derived from
// them. `scrollChildIntoView` resolves by element id, so each row's
// root box must set `id={follow.id(i)}` and the scrollbox
// `ref={follow.ref}`. Spread the rest into handleListKey/useListKeys:
//
//   const follow = useFollow("tab")
//   handleListKey(keys, key, { count, setSel, ...follow.opts, ... })
//   <scrollbox ref={follow.ref}>
//     <Row id={follow.id(i)} ... />
//
export function useFollow(prefix: string, key?: (i: number) => string | number | undefined) {
  const ref = useRef<ScrollBoxRenderable | null>(null)
  const id = (i: number) => `${prefix}-row-${key?.(i) ?? i}`
  return {
    ref, id,
    opts: {
      scrollTo: (n: number) => ref.current?.scrollChildIntoView(id(n)),
      get page() { return Math.max(1, (ref.current?.viewport.height ?? 10) - 1) },
    },
  }
}
