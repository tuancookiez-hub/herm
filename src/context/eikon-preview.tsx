import { createContext, useContext, useMemo, useState, type ReactNode } from "react"
import type { ParsedEikon } from "../components/avatar/eikon"

export type EikonPreview = {
  id: string
  title: string
  source: string
  eikon: ParsedEikon
}

type PreviewContext = {
  preview?: EikonPreview
  setPreview: (p?: EikonPreview) => void
  clearPreview: (id?: string) => void
}

const Ctx = createContext<PreviewContext | null>(null)

export function EikonPreviewProvider(props: { children: ReactNode }) {
  const [preview, setPreview] = useState<EikonPreview | undefined>(undefined)
  const value = useMemo<PreviewContext>(() => ({
    preview,
    setPreview,
    clearPreview: id => setPreview(p => id && p?.id !== id ? p : undefined),
  }), [preview])
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>
}

export function useEikonPreview(): PreviewContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useEikonPreview outside provider")
  return ctx
}
