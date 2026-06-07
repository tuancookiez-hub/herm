import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { readFileSync } from "node:fs"
import { basename, dirname } from "node:path"
import { useTheme } from "../theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { TabShell } from "../ui/shell"
import { HintBar } from "../ui/hint"
import { VBAR } from "../ui/table"
import { useKeys, handleListKey, useFollow } from "../keys"
import { openConfirm } from "../dialogs/confirm"
import { openEikonSubmit } from "../dialogs/eikon-submit"
import { openNewEikon } from "../dialogs/new-eikon"
import * as submitSvc from "../service/eikon-submit"
import { useKeyboard } from "@opentui/react"
import { AnimatedAvatar } from "../components/avatar/AnimatedAvatar"
import { listEikons, parseEikon, type ParsedEikon } from "../components/avatar/eikon"
import { BUNDLED_EIKON_DIR } from "../components/avatar/bundled"
import { hermesPath } from "../service/hermes-home"
import * as prefs from "../context/preferences"
import { eikon } from "../service/eikon"

type Row = {
  path: string; name: string; slug: string; author?: string; bundled: boolean
  w: number; h: number; url?: string; hasSource: boolean
}

type Props = {
  focused: boolean
  onEdit?: (name: string) => void
  submit?: submitSvc.Submit
}

export const EikonGallery = memo((props: Props) => {
  const theme = useTheme().theme
  const dialog = useDialog()
  const toast = useToast()
  const keys = useKeys()
  const rev = useSyncExternalStore(eikon.onRevision, eikon.revision)

  const rows = useMemo<Row[]>(() => {
    const user = hermesPath("eikons")
    const own = new Map(eikon.list().map(x => [x.name.toLowerCase(), x]))
    return listEikons([BUNDLED_EIKON_DIR, user]).map(e => {
      const slug = e.path.startsWith(BUNDLED_EIKON_DIR)
        ? e.meta.name.toLowerCase() : basename(dirname(e.path))
      const mine = own.get(slug)
      return {
        path: e.path, name: e.meta.name, slug, author: e.meta.author,
        bundled: e.path.startsWith(BUNDLED_EIKON_DIR),
        w: e.meta.width, h: e.meta.height,
        url: mine?.sourceUrl,
        hasSource: mine?.hasSource ?? !!eikon.findSource(slug),
      }
    })
  }, [rev])

  const active = prefs.usePref("eikon")
  const [sel, setSel] = useState(0)
  const galleryFollow = useFollow("gal", i => rows[i]?.slug ?? i)

  useEffect(() => { if (sel >= rows.length) setSel(Math.max(0, rows.length - 1)) }, [rows.length, sel])

  const cur = rows[sel]
  const parsed = useMemo<ParsedEikon | undefined>(() => {
    if (!cur) return undefined
    try { return parseEikon(readFileSync(cur.path, "utf8")) } catch { return undefined }
  }, [cur])

  const activate = (row = cur) => {
    if (!row) return
    prefs.set("eikon", row.slug)
    toast.show({ variant: "success", message: `Avatar → ${row.name}` })
  }

  const doNew = useCallback(async () => {
    const res = await openNewEikon(dialog, {})
    if (!res) return
    if (res.from === "blank") {
      eikon.ensure(res.name)
      return props.onEdit?.(res.name)
    }
    if (res.from === "file") {
      eikon.ensure(res.name)
      try { eikon.adopt(res.name, res.file, "base") }
      catch (e) { return toast.error(e instanceof Error ? e : new Error(String(e))) }
      return props.onEdit?.(res.name)
    }
    toast.show({ variant: "info", message: `Installing '${res.name}' from ${res.src}…` })
    await eikon.installPackage(res.src, { name: res.name })
      .then(out => {
        toast.show({ variant: "success", message: `Installed '${out.name}' (${out.n} files)` })
      })
      .catch(e => toast.error(e instanceof Error ? e : new Error(String(e))))
  }, [dialog, toast, props])

  const submitLocal = useCallback(async () => {
    if (!cur || cur.bundled) return
    const path = submitSvc.submitPath(cur.slug)
    const pub = submitSvc.publishedInfo(path)
    if (pub) {
      toast.show({ variant: "warning", title: "Published eikon", message: "Create a local draft before submitting", duration: 6000 })
      return
    }
    await openEikonSubmit(dialog, {
      name: cur.name,
      path,
      submit: props.submit ?? submitSvc.submit,
    })
  }, [cur, dialog, props.submit, toast])

  const del = async () => {
    if (!cur || cur.bundled) return
    const ok = await openConfirm(dialog, {
      title: `Delete '${cur.name}'?`, danger: true,
      body: `Removes ${dirname(cur.path)} and all its sources. This cannot be undone.`,
    })
    if (!ok) return
    eikon.remove(cur.slug)
    toast.show({ variant: "info", message: `Deleted ${cur.name}` })
  }

  useKeyboard(key => {
    if (!props.focused || dialog.open()) return
    if (handleListKey(keys, key, {
      count: rows.length,
      setSel,
      page: galleryFollow.opts.page,
      scrollTo: n => galleryFollow.ref.current?.scrollChildIntoView(galleryFollow.id(n)),
      onActivate: () => activate(),
      onDelete: () => void del(),
      onNew: doNew,
    })) return
    if (key.name === "u" && cur && !cur.bundled) return void submitLocal()
    if (key.name === "e" && cur && props.onEdit) props.onEdit(cur.slug)
  })

  return (
    <box flexDirection="column" flexGrow={1} minWidth={0}>
      <box flexDirection="row" flexGrow={1}>
        <TabShell title={`Gallery (${rows.length})`} focus={props.focused} grow={3}>
          <scrollbox ref={galleryFollow.ref} scrollY flexGrow={1} verticalScrollbarOptions={VBAR}>
            {rows.length === 0
              ? <text fg={theme.textMuted}>No eikons found.</text>
              : rows.map((r, i) => {
                  const on = i === sel
                  const here = r.slug === active
                  return (
                    <box key={r.path} id={galleryFollow.id(i)} flexDirection="row" height={2}
                         backgroundColor={on ? theme.backgroundElement : undefined}
                         onMouseMove={() => setSel(i)} onMouseDown={() => { setSel(i); activate(r) }}>
                      <box width={2}><text fg={on ? theme.primary : theme.textMuted}>{on ? "▸ " : "  "}</text></box>
                      <box flexDirection="column" flexGrow={1} minWidth={0}>
                        <box height={1}><text fg={here ? theme.accent : theme.text}>
                          {here ? "● " : "  "}<strong>{r.name}</strong>
                          <span fg={theme.textMuted}>{r.bundled ? "  (bundled)" : ""}</span>
                        </text></box>
                        <box height={1}><text fg={theme.textMuted}>
                          {`  ${r.author ?? "—"} · `}
                          <span fg={r.hasSource ? theme.success : r.url ? theme.textMuted : theme.border}>
                            {r.hasSource ? "● source" : r.url ? "○ source available" : "— no source"}
                          </span>
                        </text></box>
                      </box>
                    </box>
                  )
                })}
          </scrollbox>
        </TabShell>
        <TabShell title={cur ? `Preview — ${cur.name}` : "Preview"} grow={3}>
          <box alignItems="center" justifyContent="center" flexGrow={1}>
            {parsed
              ? <AnimatedAvatar key={cur!.path} state="idle" eikon={parsed} />
              : <text fg={theme.textMuted}>No preview.</text>}
          </box>
        </TabShell>
      </box>
      <HintBar pairs={[
        ["↑↓", "select"], [keys.print("list.activate"), "use"],
        ...(cur && props.onEdit ? [["e", "edit in studio"] as const] : []),
        ...(cur && !cur.bundled ? [["u", "submit"] as const] : []), [keys.print("list.new"), "new / install"],
        ...(cur && !cur.bundled ? [[keys.print("list.delete"), "delete"] as const] : []),
      ]} />
    </box>
  )
})
