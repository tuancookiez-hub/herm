import { describe, it, expect } from "bun:test"
import { TERMINAL_MODE_RESET, isPipeNoise } from "./terminal-reset"

describe("terminal-reset", () => {
  it("reset blob includes alt-screen leave and cursor-visible", () => {
    expect(TERMINAL_MODE_RESET).toContain("\x1b[?1049l")
    expect(TERMINAL_MODE_RESET).toContain("\x1b[?25h")
  })

  it("isPipeNoise matches EPIPE", () => {
    expect(isPipeNoise(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }))).toBe(true)
    expect(isPipeNoise("Error: EPIPE: broken pipe, write")).toBe(true)
    expect(isPipeNoise(new Error("gateway exited (1)"))).toBe(false)
  })
})
