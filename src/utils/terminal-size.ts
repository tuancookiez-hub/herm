type Dim = "columns" | "rows"

type Size = {
  columns: number
  rows: number
}

type StdoutLike = {
  columns?: unknown
  rows?: unknown
}

const DEFAULT_COLUMNS = 80
const DEFAULT_ROWS = 24
const MAX_COLUMNS = 500
const MAX_ROWS = 200

const cfg = {
  columns: { fallback: DEFAULT_COLUMNS, max: MAX_COLUMNS },
  rows: { fallback: DEFAULT_ROWS, max: MAX_ROWS },
} as const

export function sanitizeTerminalDimension(value: unknown, dim: Dim): number {
  if (typeof value !== "number") return cfg[dim].fallback
  if (!Number.isFinite(value)) return cfg[dim].fallback
  const n = Math.floor(value)
  if (n < 2) return cfg[dim].fallback
  return Math.min(n, cfg[dim].max)
}

export function sanitizeTerminalSize(size: Partial<Record<Dim, unknown>>): Size {
  return {
    columns: sanitizeTerminalDimension(size.columns, "columns"),
    rows: sanitizeTerminalDimension(size.rows, "rows"),
  }
}

function findDescriptor(stream: object, dim: Dim): PropertyDescriptor | undefined {
  let cur: object | null = stream
  while (cur) {
    const desc = Object.getOwnPropertyDescriptor(cur, dim)
    if (desc) return desc
    cur = Object.getPrototypeOf(cur)
  }
  return undefined
}

function patchDimension(stream: StdoutLike, dim: Dim): boolean {
  const desc = findDescriptor(stream, dim)
  if (desc && desc.configurable === false) return false

  let raw = desc && "value" in desc ? desc.value : undefined
  const read = desc?.get
  const write = desc?.set

  try {
    Object.defineProperty(stream, dim, {
      configurable: true,
      enumerable: desc?.enumerable ?? true,
      get() {
        const value = read ? read.call(stream) : raw
        return sanitizeTerminalDimension(value, dim)
      },
      set(value: unknown) {
        if (write) {
          write.call(stream, value)
          return
        }
        raw = value
      },
    })
    return true
  } catch {
    return false
  }
}

export function clampStdoutDimensions(stream: StdoutLike = process.stdout): boolean {
  if (!stream || typeof stream !== "object") return false

  const columns = patchDimension(stream, "columns")
  const rows = patchDimension(stream, "rows")
  return columns || rows
}
