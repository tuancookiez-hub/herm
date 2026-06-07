import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { handleEikonCli, EIKON_CLI_USAGE, type EikonCliDeps } from "../src/app/eikon-cli"

function capture() {
  let stdout = ""
  let stderr = ""
  return {
    io: {
      stdout: (s: string) => { stdout += s },
      stderr: (s: string) => { stderr += s },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  }
}

function deps(overrides: Partial<EikonCliDeps> = {}): EikonCliDeps {
  let active: string | undefined
  return {
    fetchSource: async (source, opts) => ({
      name: opts?.name ?? source,
      sources: opts?.media === false ? {} : { base: "base.png" },
      n: opts?.media === false ? 0 : 1,
      bytes: opts?.media === false ? 0 : 42,
    }),
    peekSource: async () => ({ n: 2, bytes: 2048 }),
    list: () => [{ name: "ares", file: "/tmp/ares/ares.eikon", source: "/tmp/ares/source", hasSource: true, sourceUrl: "https://eikon.liftaris.dev/eikons/ares/" }],
    baked: name => name === "ares" ? "/tmp/ares/ares.eikon" : undefined,
    setActive: name => { active = name },
    getActive: () => active,
    ...overrides,
  }
}

describe("eikon headless CLI", () => {
  test("ignores non-eikon argv", async () => {
    expect(await handleEikonCli(["--version"], deps(), capture().io)).toBeNull()
  })

  test("prints eikon usage without launching the TUI", async () => {
    const c = capture()
    expect(await handleEikonCli(["eikon", "--help"], deps(), c.io)).toBe(0)
    expect(c.stdout()).toContain("herm eikon install <name|url|dir>")
    expect(EIKON_CLI_USAGE).toContain("herm eikon use <name>")
  })

  test("install passes name/media options, emits json, and can skip activation", async () => {
    const calls: Array<{ source: string; opts: { name?: string; media?: boolean } }> = []
    const c = capture()
    const d = deps({
      fetchSource: async (source, opts) => {
        calls.push({ source, opts: opts ?? {} })
        return { name: opts?.name ?? "ares", sources: {}, n: 0, bytes: 0 }
      },
    })

    expect(await handleEikonCli(["eikon", "install", "ares", "--name", "war", "--no-source", "--no-use", "--json"], d, c.io)).toBe(0)

    expect(calls).toEqual([{ source: "ares", opts: { name: "war", media: false } }])
    expect(JSON.parse(c.stdout())).toEqual({ ok: true, name: "war", n: 0, bytes: 0, sources: {}, active: null })
  })

  test("install activates by default", async () => {
    const c = capture()
    const d = deps()

    expect(await handleEikonCli(["eikon", "install", "ares", "--json"], d, c.io)).toBe(0)

    expect(JSON.parse(c.stdout()).active).toBe("ares")
  })

  test("peek and list expose machine-readable json", async () => {
    const p = capture()
    expect(await handleEikonCli(["eikon", "peek", "ares", "--json"], deps(), p.io)).toBe(0)
    expect(JSON.parse(p.stdout())).toEqual({ ok: true, source: "ares", n: 2, bytes: 2048 })

    const l = capture()
    expect(await handleEikonCli(["eikon", "list", "--json"], deps({ getActive: () => "ares" }), l.io)).toBe(0)
    expect(JSON.parse(l.stdout())).toEqual({
      ok: true,
      active: "ares",
      eikons: [{ name: "ares", file: "/tmp/ares/ares.eikon", hasSource: true, sourceUrl: "https://eikon.liftaris.dev/eikons/ares/" }],
    })
  })

  test("use rejects unknown eikons", async () => {
    const c = capture()

    expect(await handleEikonCli(["eikon", "use", "missing", "--json"], deps(), c.io)).toBe(1)

    expect(JSON.parse(c.stderr())).toEqual({ ok: false, error: "No installed or bundled eikon named 'missing'" })
  })

  test("entrypoint routes eikon help before global help", async () => {
    const repo = resolve(import.meta.dir, "..")
    const p = Bun.spawn([process.execPath, "src/index.tsx", "eikon", "--help"], {
      cwd: repo,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, CONTROL: "", PERF: "" },
    })
    const [code, stdout, stderr] = await Promise.all([
      p.exited,
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
    ])

    expect(code).toBe(0)
    expect(stderr).toBe("")
    expect(stdout).toContain("herm eikon install <name|url|dir>")
    expect(stdout).not.toContain("OpenTUI client")
  })
})
