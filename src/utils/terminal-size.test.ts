import { describe, expect, it } from "bun:test"
import {
  clampStdoutDimensions,
  sanitizeTerminalDimension,
  sanitizeTerminalSize,
} from "./terminal-size"

describe("terminal-size", () => {
  it("leaves sane terminal dimensions unchanged", () => {
    expect(sanitizeTerminalDimension(120, "columns")).toBe(120)
    expect(sanitizeTerminalDimension(40, "rows")).toBe(40)
    expect(sanitizeTerminalSize({ columns: 100, rows: 32 })).toEqual({ columns: 100, rows: 32 })
  })

  it("falls back for zero, NaN, missing, non-number, and too-small values", () => {
    for (const value of [0, 1, NaN, undefined, null, "120", Infinity, -1]) {
      expect(sanitizeTerminalDimension(value, "columns")).toBe(80)
      expect(sanitizeTerminalDimension(value, "rows")).toBe(24)
    }
  })

  it("clamps oversized dimensions", () => {
    expect(sanitizeTerminalSize({ columns: 131_072, rows: 10_000 })).toEqual({ columns: 500, rows: 200 })
  })

  it("patches stdout dimensions through live getters", () => {
    let cols: unknown = 100
    let rows: unknown = 40
    const out = {}
    Object.defineProperty(out, "columns", {
      configurable: true,
      get: () => cols,
      set: value => { cols = value },
    })
    Object.defineProperty(out, "rows", {
      configurable: true,
      get: () => rows,
      set: value => { rows = value },
    })

    expect(clampStdoutDimensions(out)).toBe(true)
    expect((out as { columns: number }).columns).toBe(100)
    expect((out as { rows: number }).rows).toBe(40)

    cols = 131_072
    rows = 1
    expect((out as { columns: number }).columns).toBe(500)
    expect((out as { rows: number }).rows).toBe(24)

    ;(out as { columns: unknown }).columns = 88
    ;(out as { rows: unknown }).rows = 33
    expect(cols).toBe(88)
    expect(rows).toBe(33)
    expect((out as { columns: number }).columns).toBe(88)
    expect((out as { rows: number }).rows).toBe(33)
  })

  it("patches writable data descriptors without freezing a startup snapshot", () => {
    const out = { columns: 131_072 as unknown, rows: 10_000 as unknown }

    expect(clampStdoutDimensions(out)).toBe(true)
    expect(out.columns).toBe(500)
    expect(out.rows).toBe(200)

    out.columns = 120
    out.rows = 30
    expect(out.columns).toBe(120)
    expect(out.rows).toBe(30)
  })

  it("does not throw on non-configurable descriptor edges", () => {
    const out = {}
    Object.defineProperty(out, "columns", { configurable: false, value: 131_072 })
    Object.defineProperty(out, "rows", { configurable: true, value: 1 })

    expect(() => clampStdoutDimensions(out)).not.toThrow()
    expect(clampStdoutDimensions(out)).toBe(true)
    expect((out as { columns: number }).columns).toBe(131_072)
    expect((out as { rows: number }).rows).toBe(24)
  })
})
