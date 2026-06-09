import { memo, useEffect, useState } from "react"
import { useHome } from "../../home"
import { useTheme } from "../../theme"
import { hermesPath } from "../../service/hermes-home"

// Map known model-name prefixes to their owning provider. Pure fallback
// for when the catalog lookup below can't resolve (missing file, model
// not in catalog, or catalog read failed) and the SessionInfo wire
// doesn't carry a provider field — which is the current state, see
// src/context/wire.ts SessionInfo.
const PREFIX = [
  [/^minimax[-/]/, "MiniMax"],
  [/^gpt[- ]/, "OpenAI"],
  [/^o[1-9]/, "OpenAI"],
  [/^claude[-/]/, "Anthropic"],
  [/^gemini[-/]/, "Google"],
  [/^grok[-/]/, "xAI"],
  [/^llama[-/]?3/i, "Meta"],
  [/^mistral[-/]/, "Mistral"],
  [/^deepseek[-/]/, "DeepSeek"],
  [/^qwen[-/]/, "Alibaba"],
  [/^command[-/]/, "Cohere"],
] as const

const infer = (model: string): string | undefined => {
  const m = model.toLowerCase()
  for (const [re, name] of PREFIX) if (re.test(m)) return name
  return undefined
}

// `models_dev_cache.json` is the gateway's canonical provider catalog.
// It lives at $HERMES_HOME/models_dev_cache.json and lists every
// provider (slug, name, models[]). Reading it once and caching the
// parsed object at module scope keeps the 1.8MB file from being
// re-parsed on every sidebar render. The catalog is a snapshot of
// models.dev data — it doesn't change mid-session, so a one-time read
// is safe; future improvements could subscribe to a file watcher.
type Catalog = Record<string, { name?: string; models?: Record<string, unknown> }> | null
let catalogPromise: Promise<Catalog> | null = null
const loadCatalog = (): Promise<Catalog> => {
  if (!catalogPromise) {
    const f = Bun.file(hermesPath("models_dev_cache.json"))
    catalogPromise = f.exists()
      .then(ok => ok ? f.json() as Promise<Catalog> : null)
      .catch(() => null)
  }
  return catalogPromise
}

const lookupCatalog = async (model: string, cat: Catalog): Promise<string | undefined> => {
  if (!cat) return undefined
  for (const prov of Object.values(cat)) {
    if (prov?.models && model in prov.models) return prov.name
  }
  return undefined
}

const PAD_L = 12
const WIDTH = 48
const INNER = WIDTH - 4
const trunc = (s: string, max: number) => s.length <= max ? s : s.slice(0, max - 1) + "…"

export const ProviderRow = memo((props: { model?: string | null }) => {
  const theme = useTheme().theme
  const config = useHome("config")
  const model = (props.model ?? "").trim()
  const [resolved, setResolved] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!model) { setResolved(undefined); return }
    let cancelled = false
    loadCatalog().then(cat => {
      if (cancelled) return
      lookupCatalog(model, cat).then(name => {
        if (cancelled) return
        setResolved(name ?? infer(model))
      })
    })
    return () => { cancelled = true }
  }, [model])

  if (!model) return null

  // Config-driven fallback: HermesConfig.providers[].models[] (rare —
  // only present if the user explicitly configures a custom provider
  // in config.yaml). Mostly a no-op on this host because config.yaml
  // has no providers section.
  const providers = (config as { providers?: Array<{ slug?: string; name?: string; models?: string[] }> } | null)?.providers
  const configHit = providers?.find(p => (p.models ?? []).some(m => m === model))
  const value = resolved ?? configHit?.name ?? configHit?.slug ?? infer(model) ?? "—"
  const truncated = value.length <= INNER - PAD_L - 2 ? value : value.slice(0, INNER - PAD_L - 3) + "…"

  return (
    <box height={1}>
      <text>
        <span fg={theme.textMuted}>{`  ${"Provider".padEnd(PAD_L)}`}</span>
        <span fg={theme.textMuted}>{truncated}</span>
      </text>
    </box>
  )
})
