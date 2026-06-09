import { memo } from "react"
import { useHome } from "../../home"
import { useTheme } from "../../theme"

// Map known model-name prefixes to their owning provider. Used as a
// fallback when the gateway hasn't populated a provider on SessionInfo
// (which is the current state — wire.ts SessionInfo has no provider
// field) and the config lookup below can't resolve it. Order matters
// only for diagnostics; first match wins.
const PREFIX = [
  [/^minimax[-/]/, "minimax"],
  [/^gpt[- ]/, "openai"],
  [/^o[1-9]/, "openai"],
  [/^claude[-/]/, "anthropic"],
  [/^gemini[-/]/, "google"],
  [/^grok[-/]/, "xai"],
  [/^llama[-/]?3/i, "meta"],
  [/^mistral[-/]/, "mistral"],
  [/^deepseek[-/]/, "deepseek"],
  [/^qwen[-/]/, "alibaba"],
  [/^command[-/]/, "cohere"],
] as const

const infer = (model: string): string | undefined => {
  const m = model.toLowerCase()
  for (const [re, name] of PREFIX) if (re.test(m)) return name
  return undefined
}

export const ProviderRow = memo((props: { model?: string | null }) => {
  const theme = useTheme().theme
  const config = useHome("config")
  const model = (props.model ?? "").trim()
  if (!model) return null

  // 1. Config-driven: HermesConfig.providers[].models[] is the canonical
  //    ownership list. A custom provider with model "minimax-m3" wins
  //    over the prefix guess.
  let provider: string | undefined
  const providers = (config as { providers?: Array<{ slug?: string; name?: string; models?: string[] }> } | null)?.providers
  if (providers?.length) {
    const hit = providers.find(p => (p.models ?? []).some(m => m === model))
    if (hit) provider = hit.name ?? hit.slug
  }

  // 2. Prefix inference.
  if (!provider) provider = infer(model)

  const value = provider ?? "—"
  const pad = 12
  const inner = 48 - 4
  const truncated = value.length <= inner - pad - 2 ? value : value.slice(0, inner - pad - 3) + "…"

  return (
    <box height={1}>
      <text>
        <span fg={theme.textMuted}>{`  ${"Provider".padEnd(pad)}`}</span>
        <span fg={theme.textMuted}>{truncated}</span>
      </text>
    </box>
  )
})
