// Browse available .eikon avatars from known directories with a live
// preview. ↑/↓ to navigate, Enter to select, Esc closes (via DialogProvider).

import { useMemo, useState } from "react"
import { readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { useListKeys } from "../keys"
import { useTheme } from "../theme"
import { useDialog } from "../ui/dialog"
import { AnimatedAvatar } from "../components/avatar/AnimatedAvatar"
import { BUNDLED_EIKON_DIR } from "../components/avatar/bundled"
import { listEikons, parseEikon, type ParsedEikon } from "../components/avatar/eikon"

const trunc = (s: string, n: number) => s.length <= n ? s : s.slice(0, n - 1) + "…"

// Bundled avatars (assets/eikons/) first so a fresh install shows
// something; user-dropped files in $HERMES_HOME/eikons follow.
const defaultDirs = (): string[] => {
  const hermesHome = process.env.HERMES_HOME || join(homedir(), ".hermes")
  return [BUNDLED_EIKON_DIR, join(hermesHome, "eikons")]
}

export const EikonPickerDialog = (props: {
  dirs?: string[]
  onSelect: (name: string) => void
}) => {
  const theme = useTheme().theme
  const dialog = useDialog()
  const dirs = props.dirs ?? defaultDirs()

  const found = useMemo(() => listEikons(dirs), [dirs])
  const [cursor, setCursor] = useState(0)

  const cur = found[cursor]
  const parsed = useMemo<ParsedEikon | undefined>(() => {
    if (!cur) return undefined
    try { return parseEikon(readFileSync(cur.path, "utf8")) }
    catch { return undefined }
  }, [cur])

  useListKeys({
    active: true,
    count: found.length, setSel: setCursor,
    onActivate: () => { if (cur) { props.onSelect(cur.meta.name.toLowerCase()); dialog.clear() } },
  })

  const w = (parsed?.meta.width ?? 48) + 2
  const h = Math.max(parsed?.meta.height ?? 24, 12)

  return (
    <box flexDirection="column" width={40 + w} height={h + 4}>
      <box height={1}><text fg={theme.primary}><strong>Pick Avatar</strong></text></box>
      <box height={1}><text fg={theme.textMuted}>{`${found.length} found · ↑↓ nav · Enter select · Esc close`}</text></box>
      <box height={1} />
      <box flexDirection="row" flexGrow={1}>
        {/* list */}
        <box width={38} marginRight={2}>
          <scrollbox scrollY flexGrow={1}>
            <box flexDirection="column" width="100%">
              {found.length === 0 ? (
                <box key="empty" height={1}><text fg={theme.textMuted}>No .eikon files found.</text></box>
              ) : found.map((e, i) => {
                const on = i === cursor
                return (
                  <box key={e.path} flexDirection="column" paddingLeft={1} paddingRight={1}
                       backgroundColor={on ? theme.backgroundElement : undefined}
                       onMouseDown={() => setCursor(i)}>
                    <box height={1}>
                      <text fg={on ? theme.text : theme.textMuted}><strong>{trunc(e.meta.name, 34)}</strong></text>
                    </box>
                    <box height={1}>
                      <text fg={theme.textMuted}>
                        {`${e.meta.author ?? "—"} · ${e.meta.states.length} states`}
                      </text>
                    </box>
                  </box>
                )
              })}
            </box>
          </scrollbox>
        </box>
        {/* preview */}
        <box flexGrow={1} flexDirection="column" overflow="hidden">
          {parsed
            ? <AnimatedAvatar key={cur?.path ?? "none"} state="idle" eikon={parsed} />
            : <box key="blank" height={1}><text fg={theme.textMuted}>No preview.</text></box>}
        </box>
      </box>
    </box>
  )
}

export const openEikonPicker = (dialog: ReturnType<typeof useDialog>, onSelect: (name: string) => void) =>
  dialog.replace(<EikonPickerDialog onSelect={onSelect} />)
