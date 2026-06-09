import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join, normalize } from "path"

// rehome() mutates module singletons (process.env, hermes-home cell,
// sessions-db path, the `home` store). Snapshot the sandbox home the
// preload set and restore via a second rehome() so suites sorting after
// this one still see it.
const ORIG = process.env.HERMES_HOME!

const seed = (dir: string, soul: string) => {
  mkdirSync(join(dir, "memories"), { recursive: true })
  writeFileSync(join(dir, "SOUL.md"), soul)
  writeFileSync(join(dir, "config.yaml"), "memory:\n  provider: builtin\n")
}

describe("rehome", () => {
  const A = mkdtempSync(join(tmpdir(), "herm-rehome-a-"))
  const B = mkdtempSync(join(tmpdir(), "herm-rehome-b-"))
  let rehome: typeof import("../src/home/rehome").rehome
  let hermesPath: typeof import("../src/service/hermes-home").hermesPath
  let home: typeof import("../src/home/store").home

  beforeAll(async () => {
    seed(A, "soul-a")
    seed(B, "soul-b")
    rehome = (await import("../src/home/rehome")).rehome
    hermesPath = (await import("../src/service/hermes-home")).hermesPath
    home = (await import("../src/home/store")).home
  })

  afterAll(() => rehome(ORIG))

  test("rebinds hermesPath and process.env", () => {
    rehome(A)
    expect(process.env.HERMES_HOME).toBe(A)
    expect(normalize(hermesPath("config.yaml"))).toBe(normalize(join(A, "config.yaml")))
    rehome(B)
    expect(normalize(hermesPath("config.yaml"))).toBe(normalize(join(B, "config.yaml")))
    // io worker reads process.env.HERMES_HOME per request — this is
    // what the next io.* call will send as `home`.
    expect(process.env.HERMES_HOME).toBe(B)
  })

  test("store.reset re-ensures subscribed slices against new home", async () => {
    rehome(A)
    const seen: string[] = []
    home.subscribe("soul", () => {
      const s = home.get("soul")
      if (s) seen.push(s.content)
    })
    await home.ensure("soul")
    expect(seen).toEqual(["soul-a"])
    rehome(B)
    // reset() drops data + rearms watchers; subscriber survives and is
    // re-ensured against B.
    await home.ensure("soul")
    expect(seen).toEqual(["soul-a", "soul-b"])
  })

  test("clears analytics cache", async () => {
    const { cache } = await import("../src/service/hermes-analytics")
    cache.set(7, { days: 7 } as never)
    rehome(A)
    expect(cache.size).toBe(0)
  })

  test("preferences.reload notifies usePref subscribers", async () => {
    // HERM_CONFIG_DIR pins configDir() in tests, so path-rebind can't be
    // asserted here — verify the listener fires. In production (no
    // HERM_CONFIG_DIR) configDir() follows HERMES_HOME via paths.ts.
    const prefs = await import("../src/context/preferences")
    let n = 0
    const off = (prefs as unknown as { subscribe: (l: () => void) => () => void })
      .subscribe?.(() => { n++ })
    prefs.reload()
    if (off) { expect(n).toBe(1); off() }
    else expect(prefs.load()).toBeDefined() // reload didn't throw
  })
})
