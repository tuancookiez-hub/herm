// Polls the gateway for a provider's quota/usage snapshot. The gateway
// exposes `provider.quota { provider }` which dispatches to the same
// `account_usage.fetch_account_usage` machinery used by the /usage slash
// command — so anything new added there (Codex, Anthropic, OpenRouter,
// MiniMax) lights up here for free.
//
// State model is a discriminated union so callers can render each case
// distinctly (no_key → hide the widget entirely, error → small chip,
// available → full progress bars).

import { useEffect, useState } from "react"
import { useGateway } from "../context/gateway"

export type QuotaWindow = {
  label: string
  used_percent: number
  reset_at: string | null
  detail: string | null
}

export type QuotaSnapshot = {
  provider: string
  source: string
  fetched_at: string
  title: string
  plan: string | null
  windows: QuotaWindow[]
  details: string[]
  unavailable_reason: string | null
}

export type QuotaResponse =
  | { state: "no_key"; provider: string }
  | (QuotaSnapshot & { state?: never })

export type QuotaState =
  | { state: "loading" }
  | { state: "no_key" }
  | { state: "error"; message: string }
  | { state: "available"; snapshot: QuotaSnapshot }

const POLL_MS = 60_000

const isQuotaSnapshot = (v: QuotaResponse): v is QuotaSnapshot => {
  return Array.isArray((v as QuotaSnapshot).windows)
}

const formatReset = (iso: string | null): string => {
  if (!iso) return ""
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ""
  const delta = t - Date.now()
  if (delta <= 0) return "now"
  const mins = Math.floor(delta / 60_000)
  if (mins < 60) return `in ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) {
    const rem = mins - hours * 60
    return rem > 0 ? `in ${hours}h ${rem}m` : `in ${hours}h`
  }
  const days = Math.floor(hours / 24)
  const remH = hours - days * 24
  return remH > 0 ? `in ${days}d ${remH}h` : `in ${days}d`
}

export const useProviderQuota = (provider: string): QuotaState => {
  const gw = useGateway()
  const [state, setState] = useState<QuotaState>({ state: "loading" })

  useEffect(() => {
    if (!provider) return
    let cancelled = false
    const load = () => {
      gw.request<QuotaResponse>("provider.quota", { provider })
        .then((res: QuotaResponse) => {
          if (cancelled) return
          if (!isQuotaSnapshot(res)) {
            setState({ state: "no_key" })
            return
          }
          setState({ state: "available", snapshot: res })
        })
        .catch((e: unknown) => {
          if (cancelled) return
          const msg = e instanceof Error ? e.message : String(e)
          if (/no.*key|missing.*key|unauth/i.test(msg)) {
            setState({ state: "no_key" })
            return
          }
          setState({ state: "error", message: msg })
        })
    }
    load()
    const id = setInterval(load, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [gw, provider])

  return state
}

export { formatReset }

export * as providers from "./providers"
