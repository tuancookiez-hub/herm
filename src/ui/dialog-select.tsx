/**
 * Filterable select dialog — reusable pick-list for dialogs.
 *
 * Keyboard: list.* (↑↓/PgUp/PgDn/Home/End navigate, Enter selects), typing
 * filters. With `filterable: false`, a native OpenTUI select owns ↑↓ and
 * Space/Enter selects.
 * Mouse: filterable lists support hover highlights and click selection.
 * Grouped by category with headers when filterable.
 */

import { useState, useMemo, useEffect, useRef } from "react"
import type { ReactNode } from "react"
import { useKeyboard } from "@opentui/react"
import type { ParsedKey, ScrollBoxRenderable } from "@opentui/core"
import { useTheme } from "../theme"
import { useKeys } from "../keys/context"
import { handleListKey } from "../keys/list"

export type SelectOption = {
  readonly title: string
  readonly value: string
  readonly description?: string
  readonly hint?: string
  readonly category?: string
}

type Props = {
  readonly title: string
  readonly options: ReadonlyArray<SelectOption>
  readonly onSelect: (option: SelectOption) => void
  readonly onMove?: (option: SelectOption) => void
  /** Printable-key interceptor — return true to consume (skip filter append). */
  readonly onKey?: (key: ParsedKey) => boolean
  readonly placeholder?: string
  readonly current?: string
  readonly footer?: ReactNode
  /** Show the type-to-filter input. Default true. Set false for small
   *  fixed-choice lists (priority, status, …) where filtering is noise
   *  and Space/Enter should be the only way to pick. */
  readonly filterable?: boolean
}

export const DialogSelect = (props: Props) => {
  const filterable = props.filterable ?? true
  const [filter, setFilter] = useState("")
  const [cursor, setCursor] = useState(0)
  // Refs keep closures (useKeyboard) from going stale when Enter fires
  // before React re-renders after a Down arrow state update.
  const cursorRef = useRef(0)
  const filteredRef = useRef<SelectOption[]>([])
  const onSelectRef = useRef(props.onSelect)
  onSelectRef.current = props.onSelect
  // Suppress synthetic mouse-over after a keyboard nav or filter
  // reflow: when the list shrinks/scrolls under a stationary pointer,
  // OpenTUI fires onMouseOver for whatever row now sits beneath it,
  // which would snap the cursor back. Only honor the pointer once it
  // has genuinely moved.
  const mode = useRef<"kb" | "mouse">("kb")
  // onMove is a live-preview hook for USER moves only. Programmatic
  // cursor syncs (the props.current effect below) must not fire it:
  // preview → consumer setState → new options identity → sync effect →
  // preview again is an infinite ping-pong (the /theme picker crash).
  const moved = useRef(false)
  const sb = useRef<ScrollBoxRenderable | null>(null)
  const theme = useTheme().theme
  const opts = useMemo(() => props.options.map(o => ({
    name: `${props.current == null ? "" : o.value === props.current ? "● " : "  "}${o.title}`,
    description: o.hint
      ? [o.description, o.hint].filter(Boolean).join(" — ")
      : o.description ?? "",
    value: o.value,
  })), [props.current, props.options])
  const sel = props.current == null
    ? 0
    : Math.max(0, props.options.findIndex(o => o.value === props.current))
  const desc = props.options.some(o => !!o.description || !!o.hint)

  const filtered = useMemo(() => {
    const lower = filter.toLowerCase()
    return props.options.filter(o =>
      o.title.toLowerCase().includes(lower) ||
      (o.description ?? "").toLowerCase().includes(lower)
    )
  }, [filter, props.options])

  // Sync filteredRef on every render
  filteredRef.current = filtered

  // Group by category
  const groups = useMemo(() => {
    const map = new Map<string, SelectOption[]>()
    filtered.forEach(o => {
      const cat = o.category ?? ""
      const arr = map.get(cat) ?? []
      arr.push(o)
      map.set(cat, arr)
    })
    return map
  }, [filtered])

  const rowId = (i: number) => `ds-row-${i}`

  const scrollTo = (i: number) => sb.current?.scrollChildIntoView(rowId(i))

  // Clamp cursor
  useEffect(() => {
    if (cursor >= filtered.length) setCursor(Math.max(0, filtered.length - 1))
  }, [filtered.length, cursor])

  useEffect(() => {
    if (!props.current) { setCursor(0); cursorRef.current = 0; return }
    const i = filtered.findIndex(o => o.value === props.current)
    const n = Math.max(0, i)
    setCursor(n)
    cursorRef.current = n
    scrollTo(n)
  }, [props.current, filtered])

  // Notify on user-driven move only (keyboard nav / mouse hover).
  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    const item = filtered[cursor]
    if (item && props.onMove) props.onMove(item)
  }, [cursor, filtered, props.onMove])

  const keys = useKeys()

  // setCursor that also updates the ref synchronously — so onActivate
  // reads the current cursor even if React hasn't re-rendered yet.
  const setCursorSync = (fn: ((p: number) => number) | number) => {
    setCursor(p => {
      const n = typeof fn === "number" ? fn : fn(p)
      cursorRef.current = n
      return n
    })
  }

  useKeyboard((key) => {
    if (!filterable) return
    const consumed = handleListKey(keys, key, {
      count: filtered.length,
      setSel: (fn) => { mode.current = "kb"; moved.current = true; setCursorSync(fn) },
      scrollTo,
      page: Math.max(1, (sb.current?.viewport.height ?? 10) - 1),
      onActivate: () => {
        const item = filteredRef.current[cursorRef.current]
        if (item) onSelectRef.current(item)
      },
    })
    if (consumed) return
    if (props.onKey?.(key)) return
  })

  // Build flat list with index tracking
  let idx = 0
  const entries = Array.from(groups.entries())

  if (!filterable) return (
    <box flexDirection="column" width={60}>
      <text fg={theme.text}>
        <strong>{props.title}</strong>
      </text>
      <box height={1} />
      <select
        focused={true}
        width={58}
        height={Math.min(16, Math.max(1, props.options.length * (desc ? 2 : 1)))}
        options={opts}
        selectedIndex={sel}
        showDescription={desc}
        showScrollIndicator={props.options.length > 8}
        backgroundColor={theme.backgroundPanel}
        focusedBackgroundColor={theme.backgroundPanel}
        textColor={theme.textMuted}
        focusedTextColor={theme.text}
        selectedBackgroundColor={theme.backgroundElement}
        selectedTextColor={theme.text}
        descriptionColor={theme.textMuted}
        selectedDescriptionColor={theme.textMuted}
        fastScrollStep={Math.max(1, props.options.length)}
        keyBindings={[
          { name: "home", action: "move-up-fast" },
          { name: "end", action: "move-down-fast" },
          { name: "pageup", action: "move-up-fast" },
          { name: "pagedown", action: "move-down-fast" },
          { name: "space", action: "select-current" },
          { name: " ", action: "select-current" },
        ]}
        onChange={(i) => {
          const item = props.options[i]
          if (item && props.onMove) props.onMove(item)
        }}
        onSelect={(i) => {
          const item = props.options[i]
          if (item) props.onSelect(item)
        }}
      />
      {props.footer != null ? <box paddingTop={1}>{props.footer}</box> : null}
    </box>
  )

  return (
    <box flexDirection="column" width={60}>
      <text fg={theme.text}>
        <strong>{props.title}</strong>
      </text>
      <box height={1} />
      {filterable ? (
        <>
          <input
            value={filter}
            onInput={(v) => { mode.current = "kb"; setFilter(v) }}
            placeholder={props.placeholder ?? "Type to filter..."}
            focused={true}
            textColor={theme.text}
            placeholderColor={theme.textMuted}
            backgroundColor={theme.backgroundElement}
            focusedBackgroundColor={theme.backgroundElement}
          />
          <box height={1} />
        </>
      ) : null}
      {/* ScrollBox root is flex-row ([wrapper, v-scrollbar]); column stacking
          belongs on the content box, not here. With no filter input the
          scrollbox itself takes focus so ↑↓ and Space/Enter work. */}
      <scrollbox ref={sb} scrollY maxHeight={16} focused={!filterable}
        contentOptions={{ flexDirection: "column" }} paddingRight={1}>
        {filtered.length === 0 ? (
          <text fg={theme.textMuted}>{"No results found"}</text>
        ) : null}
        {entries.map(([cat, items]) => {
          const elements: React.ReactNode[] = []
          if (cat) {
            elements.push(
              <text key={`cat-${cat}`} fg={theme.textMuted}>
                <strong>{cat}</strong>
              </text>
            )
          }
          items.forEach(item => {
            const i = idx++
            const active = i === cursor
            const current = item.value === props.current
            elements.push(
              <box
                key={item.value}
                id={rowId(i)}
                flexDirection="row"
                backgroundColor={active ? theme.backgroundElement : undefined}
                onMouseMove={() => { mode.current = "mouse"; moved.current = true; setCursorSync(c => c === i ? c : i) }}
                onMouseOver={() => { if (mode.current === "mouse") { moved.current = true; setCursorSync(() => i) } }}
                onMouseDown={() => props.onSelect(item)}
                paddingLeft={1}
                paddingRight={1}
              >
                <box flexGrow={1} height={1} overflow="hidden">
                  <text fg={active ? theme.text : theme.textMuted}>
                    {current ? "● " : "  "}{item.title}{item.description ? ` — ${item.description}` : ""}
                  </text>
                </box>
                {item.hint ? (
                  <box flexShrink={0} height={1}>
                    <text fg={theme.textMuted}>{item.hint}</text>
                  </box>
                ) : null}
              </box>
            )
          })
          return elements
        }).flat()}
      </scrollbox>
      {props.footer != null ? <box paddingTop={1}>{props.footer}</box> : null}
    </box>
  )
}
