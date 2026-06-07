// Pick provider → model. Default scope is the *current session* (the
// gateway applies the switch to the live agent when `session_id` is
// passed); Tab toggles to global persist. The gateway's `config.set`
// accepts a single space-separated arg string with `--provider` /
// `--global` flags (same grammar as the `/model` slash command) and
// routes through `_apply_model_switch`, so we send one request rather
// than a provider/model pair.

import { useEffect, useState, useCallback } from "react"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type SelectOption } from "../ui/dialog-select"
import { useTheme } from "../theme"
import { useToast } from "../ui/toast"
import type { Gateway } from "../context/gateway"
import type { ConfigSetResponse, ModelOptionsResponse } from "../context/wire"

type Step = "provider" | "model"

type Props = {
  gw: Gateway
  /** Override the default "switch this session / global" apply. When
   *  set, the scope toggle is hidden and the caller owns the write. */
  onApply?: (provider: string, model: string) => Promise<void>
  title?: string
}

const ModelPickerDialog = (props: Props) => {
  const dialog = useDialog()
  const toast = useToast()
  const theme = useTheme().theme
  const [data, setData] = useState<ModelOptionsResponse | null>(null)
  const [step, setStep] = useState<Step>("provider")
  const [provider, setProvider] = useState<string | null>(null)
  const [global, setGlobal] = useState(false)

  useEffect(() => {
    props.gw.request<ModelOptionsResponse>("model.options")
      .then(setData)
      .catch(() => setData({ providers: [] }))
  }, [props.gw])

  const apply = useCallback((model: string, prov: string) => {
    if (props.onApply) return void props.onApply(prov, model)
      .catch((e: Error) => toast.show({ variant: "error", message: e.message }))
    const value = `${model} --provider ${prov}${global ? " --global" : ""}`
    props.gw.request<ConfigSetResponse>("config.set", global
      ? { key: "model", value, session_id: undefined }
      : { key: "model", value })
      .then(r => {
        toast.show({ variant: "success", message: `model → ${r.value ?? model}${global ? " (global)" : ""}` })
        if (r.warning) toast.show({ variant: "warning", message: r.warning })
      })
      .catch((e: Error) => toast.show({ variant: "error", message: e.message }))
  }, [props.gw, props.onApply, global, toast])

  const onKey = useCallback((k: { name: string }) => {
    if (k.name === "tab" && !props.onApply) { setGlobal(g => !g); return true }
    if (k.name === "left" && step === "model") { setStep("provider"); return true }
    return false
  }, [step, props.onApply])

  const footer = props.onApply
    ? <text fg={theme.textMuted}>{step === "model" ? "←: providers" : " "}</text>
    : (
      <text fg={theme.textMuted}>
        <span>Scope: </span>
        <span fg={global ? theme.warning : theme.accent}>
          {global ? "global (persists to config)" : "this session"}
        </span>
        <span> · Tab: toggle{step === "model" ? " · ←: providers" : ""}</span>
      </text>
    )

  if (!data) return <box width={50} padding={1}><text>Loading models…</text></box>

  if (step === "provider") {
    const options: SelectOption[] = (data.providers ?? [])
      .toSorted((a, b) => Number(Boolean(b.is_current)) - Number(Boolean(a.is_current)))
      .map(p => ({
        title: p.name,
        value: p.slug,
        description: p.total_models ? `${p.total_models} models` : undefined,
        category: p.is_current ? "Current" : "Available",
      }))
    return (
      <DialogSelect
        title={props.title ?? "Switch Provider"}
        options={options}
        current={data.provider}
        onSelect={(o) => { setProvider(o.value); setStep("model") }}
        onKey={onKey}
        placeholder="Search providers..."
        footer={footer}
      />
    )
  }

  const p = data.providers?.find(pp => pp.slug === provider)
  const options: SelectOption[] = (p?.models ?? []).map(m => {
    const caps = p?.capabilities?.[m]
    const badges = [
      caps?.fast ? "fast" : "",
      caps?.reasoning ? "reasoning" : "",
    ].filter(Boolean)
    return {
      title: m,
      value: m,
      hint: badges.length > 0 ? badges.join(" · ") : undefined,
    }
  })

  return (
    <DialogSelect
      title={props.title ? `${props.title} · ${p?.name ?? provider}` : `Switch Model (${p?.name ?? provider})`}
      options={options}
      current={provider === data.provider ? data.model : undefined}
      onSelect={(o) => {
        if (provider) apply(o.value, provider)
        dialog.clear()
      }}
      onKey={onKey}
      placeholder="Search models..."
      footer={footer}
    />
  )
}

export const openModelPicker = (
  dialog: ReturnType<typeof useDialog>, gw: Gateway,
  opts?: { title?: string; onApply?: (provider: string, model: string) => Promise<void> },
) => {
  dialog.replace(<ModelPickerDialog gw={gw} title={opts?.title} onApply={opts?.onApply} />)
}
