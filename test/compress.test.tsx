// Regression: /compress must preserve the live visual transcript, matching
// auto-compression. The gateway returns compacted `messages`, but replacing
// `turn.messages` with that response makes the chat appear to delete the
// earlier conversation immediately after a manual compress.

import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mount, until, MockGateway } from "./harness"

const preCompactMessages = [
  { role: "user" as const, text: "draft the rfc" },
  { role: "assistant" as const, text: "Here's a long draft of the RFC …" },
  { role: "user" as const, text: "shorter" },
  { role: "assistant" as const, text: "Tighter version …" },
]

const postCompactMessages = [
  { role: "user" as const, text: "MARKER_POST_COMPACT_USER" },
  { role: "assistant" as const, text: "Tighter version …" },
]

const mkGw = () => new MockGateway({
  "commands.catalog": () => ({ pairs: [["/compress", "compress transcript"]] }),
  "session.resume": () => ({
    session_id: "pre-sid",
    messages: preCompactMessages,
  }),
  "session.compress": () => ({
    status: "compressed",
    removed: 2,
    before_messages: 4,
    after_messages: 3,
    before_tokens: 8000,
    after_tokens: 2500,
    messages: postCompactMessages,
    info: { model: "test-model", session_id: "post-sid", tools: {}, skills: {} },
    usage: { input: 1000, output: 500, total: 1500, context_used: 2500, context_max: 200000, context_percent: 1, compressions: 1 },
    summary: { headline: "Compacted 4→3 messages", token_line: "8.0k → 2.5k" },
  }),
})

const run = async (t: Awaited<ReturnType<typeof mount>>) => {
  await act(async () => { await t.keys.typeText("/compress") })
  act(() => t.keys.pressEnter())
}

describe("/compress", () => {
  test("preserves visible transcript when rpc returns compacted messages", async () => {
    const gw = mkGw()
    const t = await mount({ gw, launch: { mode: "resume", sid: "pre-sid", splash: false } })
    await until(t, () => t.frame().includes("draft the rfc"))

    await run(t)

    await until(t, () => t.frame().includes("Compacted 4→3 messages"))
    expect(t.frame()).toContain("draft the rfc")
    expect(t.frame()).not.toContain("MARKER_POST_COMPACT_USER")

    t.destroy()
  })

  test("keeps follow-up RPCs on the active gateway session", async () => {
    const gw = mkGw()
    const t = await mount({ gw, launch: { mode: "resume", sid: "pre-sid", splash: false } })
    await until(t, () => t.frame().includes("draft the rfc"))

    await run(t)
    await until(t, () => t.frame().includes("Compacted 4→3 messages"))

    await act(async () => { await t.keys.typeText("/title After Compress") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.gw.last("session.title")?.params.title === "After Compress")
    expect(t.gw.last("session.title")?.params.session_id).toBe("pre-sid")

    t.destroy()
  })

  test("summary headline dispatches as system line + toast", async () => {
    const gw = mkGw()
    const t = await mount({ gw, launch: { mode: "resume", sid: "pre-sid", splash: false } })
    await until(t, () => t.frame().includes("draft the rfc"))

    await run(t)

    // Headline lands in transcript (system row).
    await until(t, () => t.frame().includes("Compacted 4→3 messages"))
    expect(t.frame()).toContain("8.0k → 2.5k")

    t.destroy()
  })

  test("noop response doesn't wipe the transcript", async () => {
    const gw = new MockGateway({
      "commands.catalog": () => ({ pairs: [["/compress", "compress transcript"]] }),
      "session.resume": () => ({ session_id: "pre-sid", messages: preCompactMessages }),
      "session.compress": () => ({
        status: "skipped",
        removed: 0,
        summary: { noop: true, headline: "No changes — 4 messages" },
      }),
    })
    const t = await mount({ gw, launch: { mode: "resume", sid: "pre-sid", splash: false } })
    await until(t, () => t.frame().includes("draft the rfc"))

    await run(t)
    await t.settle()

    // Messages untouched (no `messages` field in response) — original
    // turns still visible.
    expect(t.frame()).toContain("draft the rfc")

    t.destroy()
  })
})
