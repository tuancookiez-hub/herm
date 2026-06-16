import { test, expect, beforeEach } from "bun:test"
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs"
import { configDir } from "../src/utils/paths"
import * as prefs from "../src/context/preferences"

beforeEach(() => {
  // Reset the cached snapshot so each test starts from a clean state
  prefs.reset()
  // Wipe tui.json from disk so tests don't leak into each other
  const f = `${configDir()}/tui.json`
  if (existsSync(f)) unlinkSync(f)
})

test("getSessionTheme: undefined when no sessionThemes map", () => {
  expect(prefs.getSessionTheme("sess-1")).toBeUndefined()
})

test("getSessionTheme: undefined when session not in map", () => {
  prefs.set("sessionThemes", { "sess-1": "catppuccin" })
  expect(prefs.getSessionTheme("sess-2")).toBeUndefined()
})

test("getSessionTheme: returns stored theme for session", () => {
  prefs.set("sessionThemes", { "sess-1": "catppuccin", "sess-2": "nord" })
  expect(prefs.getSessionTheme("sess-1")).toBe("catppuccin")
  expect(prefs.getSessionTheme("sess-2")).toBe("nord")
})

test("getSessionTheme: returns undefined for empty sid", () => {
  prefs.set("sessionThemes", { "sess-1": "catppuccin" })
  expect(prefs.getSessionTheme("")).toBeUndefined()
  expect(prefs.getSessionTheme(undefined)).toBeUndefined()
})

test("setSessionTheme: writes per-session value", () => {
  prefs.setSessionTheme("sess-1", "catppuccin")
  expect(prefs.getSessionTheme("sess-1")).toBe("catppuccin")
})

test("setSessionTheme: preserves other session themes", () => {
  prefs.setSessionTheme("sess-1", "catppuccin")
  prefs.setSessionTheme("sess-2", "nord")
  expect(prefs.getSessionTheme("sess-1")).toBe("catppuccin")
  expect(prefs.getSessionTheme("sess-2")).toBe("nord")
})

test("setSessionTheme: overwrites existing session theme", () => {
  prefs.setSessionTheme("sess-1", "catppuccin")
  prefs.setSessionTheme("sess-1", "nord")
  expect(prefs.getSessionTheme("sess-1")).toBe("nord")
})

test("setSessionTheme: no-op on empty sid", () => {
  prefs.setSessionTheme("", "catppuccin")
  expect(prefs.getSessionTheme("sess-1")).toBeUndefined()
})

test("setSessionTheme: persists to tui.json", () => {
  prefs.setSessionTheme("sess-1", "catppuccin")
  // Reset cache and re-read from disk
  prefs.reset()
  expect(prefs.getSessionTheme("sess-1")).toBe("catppuccin")
})

test("setSessionTheme: global theme unchanged when setting per-session", () => {
  prefs.set("theme", "catppuccin")
  prefs.setSessionTheme("sess-1", "nord")
  expect(prefs.get("theme")).toBe("catppuccin")
  expect(prefs.getSessionTheme("sess-1")).toBe("nord")
})

test("setSessionTheme: notifies session theme subscribers even when global theme is unchanged", () => {
  let seen = prefs.getSessionTheme("sess-1")
  const off = prefs.subscribeSessionTheme("sess-1", value => { seen = value })
  prefs.set("theme", "catppuccin")
  prefs.setSessionTheme("sess-1", "nord")
  off()
  expect(prefs.get("theme")).toBe("catppuccin")
  expect(seen).toBe("nord")
})
