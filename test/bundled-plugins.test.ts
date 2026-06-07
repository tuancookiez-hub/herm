import { describe, test, expect, beforeEach } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"
import { hermesPath } from "../src/service/hermes-home"
import { plugins } from "../src/service/bundled-plugins"

const ROOT = hermesPath("plugins")
const CFG = hermesPath("config.yaml")
const enabled = () => parse(readFileSync(CFG, "utf8"))?.plugins?.enabled ?? []

describe("bundled-plugins", () => {
  beforeEach(() => {
    rmSync(ROOT, { recursive: true, force: true })
    rmSync(CFG, { force: true })
  })

  test("sync() installs and enables the eikon tool plugin", () => {
    expect(plugins.sync()).toEqual(["eikon"])
    expect(existsSync(join(ROOT, "eikon/plugin.yaml"))).toBe(true)
    expect(existsSync(join(ROOT, "eikon/__init__.py"))).toBe(true)
    expect(enabled()).toEqual(["eikon"])
    expect(plugins.sync()).toEqual([])
    expect(enabled()).toEqual(["eikon"])
  })

  test("sync() respects an explicit plugin disable", () => {
    mkdirSync(hermesPath(""), { recursive: true })
    writeFileSync(CFG, "plugins:\n  disabled:\n    - eikon\n")

    expect(plugins.sync()).toEqual(["eikon"])
    expect(parse(readFileSync(CFG, "utf8"))?.plugins?.enabled).toBeUndefined()
  })

  test("sync() does not overwrite or enable a user-owned eikon plugin", () => {
    mkdirSync(join(ROOT, "eikon"), { recursive: true })
    writeFileSync(join(ROOT, "eikon/plugin.yaml"), "name: eikon\ndescription: custom\n")

    expect(plugins.sync()).toEqual([])
    expect(readFileSync(join(ROOT, "eikon/plugin.yaml"), "utf8")).toContain("custom")
    expect(existsSync(CFG)).toBe(false)
  })
})
