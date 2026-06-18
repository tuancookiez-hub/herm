import { memo, useEffect, useState } from "react"
import { useHome } from "../../home"
import { useTheme } from "../../theme"
import { hermesPath } from "../../service/hermes-home"

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
  [/^zai-org\//, "ZhipuAI"],
  [/^z-ai\//, "ZhipuAI"],
  [/^glm[-/]/i, "ZhipuAI"],
] as const

const infer = (model: string): string | undefined => {
  const m = model.toLowerCase()
  for (const [re, name] of PREFIX) if (re.test(m)) return name
  return undefined
}

const DOMAIN: ReadonlyArray<readonly [string, string]> = [
  ["router.huggingface.co", "HuggingFace"],
  ["api.openai.com", "OpenAI"],
  ["api.anthropic.com", "Anthropic"],
  ["api.x.ai", "xAI"],
  ["generativelanguage.googleapis.com", "Google"],
  ["api.mistral.ai", "Mistral"],
  ["api.deepseek.com", "DeepSeek"],
  ["api.together.xyz", "Together"],
  ["openrouter.ai", "OpenRouter"],
  ["api.groq.com", "Groq"],
  ["api.fireworks.ai", "Fireworks"],
  ["api.novita.ai", "Novita"],
  ["api.siliconflow.cn", "SiliconFlow"],
  ["api.moonshot.cn", "Moonshot"],
  ["api.minimax.chat", "MiniMax"],
  ["dashscope.aliyuncs.com", "Alibaba"],
  ["api.cerebras.ai", "Cerebras"],
  ["api.perplexity.ai", "Perplexity"],
  ["api.cohere.ai", "Cohere"],
  ["codestral.mistral.ai", "Mistral"],
]

const fromUrl = (url: string): string | undefined => {
  try {
    const host = new URL(url).hostname
    for (const [d, name] of DOMAIN) if (host === d) return name
    const parts = host.split(".")
    return parts[parts.length - 2]?.replace(/^\w/, c => c.toUpperCase())
  } catch { return undefined }
}

const SLUG = new Map([
  ["openai", "OpenAI"], ["anthropic", "Anthropic"], ["xai", "xAI"],
  ["google", "Google"], ["mistral", "Mistral"], ["deepseek", "DeepSeek"],
  ["together", "Together"], ["openrouter", "OpenRouter"], ["groq", "Groq"],
  ["fireworks", "Fireworks"], ["novita", "Novita"], ["siliconflow", "SiliconFlow"],
  ["nous", "Nous"], ["moonshot", "Moonshot"], ["minimax", "MiniMax"],
  ["alibaba", "Alibaba"], ["cerebras", "Cerebras"], ["perplexity", "Perplexity"],
  ["cohere", "Cohere"], ["huggingface", "HuggingFace"],
])

const fromConfig = (
  provider: string | undefined,
  baseUrl: string | undefined,
): string | undefined => {
  if (!provider || provider === "auto") return undefined
  if (provider === "custom") return baseUrl ? fromUrl(baseUrl) : undefined
  return SLUG.get(provider) ?? provider.charAt(0).toUpperCase() + provider.slice(1)
}

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

  const cfg = config?.model
  const primary = model === cfg?.default
    ? fromConfig(cfg?.provider, cfg?.base_url)
    : undefined
  const value = primary ?? resolved ?? infer(model) ?? "—"
  const truncated = value.length <= INNER - PAD_L - 2 ? value : value.slice(0, INNER - PAD_L - 3) + "…"

  return (
    <box height={1}>
      <text>
        <span fg={theme.textMuted}>{`  ${"Provider".padEnd(PAD_L)}`}</span>
        <span fg={theme.text}>{truncated}</span>
      </text>
    </box>
  )
})
