import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mountNode, until, type Harness } from "./harness"
import { MessageList } from "../src/components/chat/MessageList"
import { Tool } from "../src/components/chat/tool"
import { isDiff } from "../src/components/chat/DiffBlock"
import { splitContent } from "../src/components/chat/MediaChip"
import { turnReducer, initialTurn } from "../src/app/turnReducer"
import { spec } from "../src/components/chat/tool/preview"
import type { Message, ToolPart } from "../src/types/message"

// Fixture mirrors the wire: tool.start gives a preview string (via
// _tool_ctx → build_tool_preview, ≤80ch), tool.complete gives summary
// + optional inline_diff. No raw args JSON, no stdout body.
const turn: Message[] = [
  {
    id: "u1", role: "user", timestamp: 0,
    parts: [{ type: "text", content: "run the build", streaming: false }],
  },
  {
    id: "a1", role: "assistant", timestamp: 0, model: "test-model",
    usage: { input: 12, output: 34, total: 46 }, duration: 250,
    parts: [
      { type: "text", content: "On it.", streaming: false },
      {
        type: "tool", id: "t1", name: "terminal", args: "",
        preview: "bun run build", status: "done", duration: 87,
        result: "Completed in 0.1s",
      },
      {
        type: "tool", id: "t2", name: "read_file", args: "",
        preview: "src/index.tsx", status: "done", duration: 12,
      },
    ],
  },
]

async function tool(part: ToolPart, w = 100) {
  const t: Harness = await mountNode(
    <box flexDirection="column" width="100%" height="100%"><Tool tool={part} /></box>,
    { width: w, height: 30 },
  )
  await t.settle()
  return t
}

function locate(t: Harness, needle: string) {
  const rows = t.frame().split("\n")
  const y = rows.findIndex(l => l.includes(needle))
  return { x: rows[y].indexOf(needle), y }
}

describe("MessageList", () => {
  test("markdown image links render as media, not alt text", () => {
    expect(splitContent("![base](/tmp/owl.png)")).toEqual([{ media: "/tmp/owl.png" }])
    expect(splitContent("see ![base](/tmp/owl.png) now")).toEqual([
      { md: "see " }, { media: "/tmp/owl.png" }, { md: " now" },
    ])
    expect(splitContent("```md\n![base](/tmp/owl.png)\n```")).toEqual([
      { code: "![base](/tmp/owl.png)", lang: "md" },
    ])
  })

  test("message.complete does not append duplicate final text", () => {
    const s = turnReducer(turnReducer(initialTurn, { kind: "message.delta", chunk: "Keep, regenerate, or adjust?" }), {
      kind: "message.complete", text: "Keep, regenerate, or adjust?\n",
    })
    const msg = s.messages[0]
    expect(msg.parts).toHaveLength(1)
    expect(msg.parts[0]).toMatchObject({ type: "text", content: "Keep, regenerate, or adjust?", streaming: false })
  })

  test("renders gutter + header + trail badge; body is text-only", async () => {
    const t: Harness = await mountNode(
      <box flexDirection="column" width="100%" height="100%">
        <MessageList messages={turn} streaming={false} />
      </box>,
      { width: 120, height: 30 },
    )
    await until(t, () => t.frame().includes("On it."))
    const f = t.frame()

    expect(f).toContain("run the build")
    expect(f).toContain("│")
    // Agent header: "Hermes · <tokens> · <duration>" (model is shown
    // in the sidebar/status bar, not in message headers).
    expect(f).toContain("Hermes · 12→34 tok · 250ms")
    // trail badge (right-aligned), not inline tool bodies
    expect(f).toContain("terminal · read_file")
    expect(f).not.toContain("$ bun run build")
    t.destroy()
  })

  test("renders ─── separator above non-first user turns only", async () => {
    const msgs: Message[] = [
      { id: "u1", role: "user", timestamp: 0, parts: [{ type: "text", content: "first question", streaming: false }] },
      { id: "a1", role: "assistant", timestamp: 0, parts: [{ type: "text", content: "first answer", streaming: false }] },
      { id: "u2", role: "user", timestamp: 0, parts: [{ type: "text", content: "second question", streaming: false }] },
      { id: "a2", role: "assistant", timestamp: 0, parts: [{ type: "text", content: "second answer", streaming: false }] },
      { id: "u3", role: "user", timestamp: 0, parts: [{ type: "text", content: "third question", streaming: false }] },
    ]
    const t: Harness = await mountNode(
      <box flexDirection="column" width="100%" height="100%">
        <MessageList messages={msgs} streaming={false} />
      </box>,
      { width: 120, height: 40 },
    )
    await until(t, () => t.frame().includes("third question"))
    const lines = t.frame().split("\n")
    const y1 = lines.findIndex(l => l.includes("first question"))
    const y2 = lines.findIndex(l => l.includes("second question"))
    const y3 = lines.findIndex(l => l.includes("third question"))
    // First user turn: the line directly above must NOT be a separator.
    expect(lines[y1 - 1] ?? "").not.toContain("───")
    // Second + third user turns: separator sits directly above.
    expect(lines[y2 - 1]).toContain("───")
    expect(lines[y3 - 1]).toContain("───")
    t.destroy()
  })
})

describe("tool/inline", () => {
  test("terminal + read_file render icon/verb rows", async () => {
    let t = await tool(turn[1].parts[1] as ToolPart)
    await until(t, () => t.frame().includes("$ bun run build"))
    expect(t.frame()).toContain("87ms")
    t.destroy()

    t = await tool(turn[1].parts[2] as ToolPart)
    await until(t, () => t.frame().includes("→ Read src/index.tsx"))
    t.destroy()
  })

  test("running tool shows pending gerund until preview arrives", async () => {
    const t = await tool({
      type: "tool", id: "tr", name: "search_files", args: "",
      status: "running", startedAt: Date.now(),
    })
    await until(t, () => t.frame().includes("~ Searching…"))
    // braille spinner glyph in place of the icon while running
    expect(t.frame()).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] ~ Searching…/)
    t.destroy()
  })

  test("failed tool row is error-tinted and shows error body", async () => {
    const t = await tool({
      type: "tool", id: "te", name: "terminal", args: "",
      preview: "rm -rf /", status: "error", duration: 5,
      result: "permission denied",
    })
    await until(t, () => t.frame().includes("$ rm -rf /"))
    expect(t.frame()).toContain("permission denied")
    t.destroy()
  })
})

const UDIFF = [
  "--- a/foo.ts",
  "+++ b/foo.ts",
  "@@ -1,3 +1,3 @@",
  " keep",
  "-old line",
  "+new line",
].join("\n")

describe("tool/file-edit", () => {
  test("isDiff matches unified headers and hunk markers", () => {
    expect(isDiff(UDIFF)).toBe(true)
    expect(isDiff("@@ -1 +1 @@\n-a\n+b")).toBe(true)
    expect(isDiff("diff --git a/x b/x\n@@ -1 +1 @@")).toBe(true)
    expect(isDiff("plain text\nno markers")).toBe(false)
    expect(isDiff("prefix --- a/not-at-line-start")).toBe(false)
    expect(isDiff(undefined)).toBe(false)
  })

  test("patch renders as generic edit row; no diff body here", async () => {
    const t = await tool({
      type: "tool", id: "td", name: "patch", args: "",
      preview: "src/foo.ts", status: "done", duration: 42, diff: UDIFF,
    })
    await until(t, () => t.frame().includes("Edit src/foo.ts"))
    const f = t.frame()
    expect(f).not.toContain("changed")
    // diff body does NOT render in ThoughtCloud — InlineDiff in the
    // assistant message owns that.
    expect(f).not.toContain("┃")
    expect(f).not.toContain("@@")
    expect(f).not.toContain("+new line")
    t.destroy()
  })

  test("write_file renders generic write row", async () => {
    const t = await tool({
      type: "tool", id: "tw", name: "write_file", args: "",
      preview: "notes/README.md", status: "done", duration: 9,
    })
    await until(t, () => t.frame().includes("Write notes/README.md"))
    expect(t.frame()).not.toContain("changed")
    expect(t.frame()).not.toContain("┃")
    t.destroy()
  })

  test("file-edit without preview falls back to generic inline row", async () => {
    const t = await tool({
      type: "tool", id: "tn", name: "patch", args: "",
      status: "done", duration: 5, diff: UDIFF,
    })
    await until(t, () => t.frame().includes("Edit") && !t.frame().includes("changed"))
    t.destroy()
  })

  test("message diff tab click expands and collapses without picking message", async () => {
    const picks: Message[] = []
    const msgs: Message[] = [{
      id: "a1", role: "assistant", timestamp: 0,
      parts: [
        { type: "text", content: "patched", streaming: false },
        { type: "tool", id: "td", name: "patch", args: "",
          preview: "src/foo.ts", status: "done", duration: 42, diff: UDIFF },
      ],
    }]
    const t = await mountNode(
      <box flexDirection="column" width="100%" height="100%">
        <MessageList messages={msgs} streaming={false} onPick={m => picks.push(m)} />
      </box>,
      { width: 100, height: 18 },
    )
    await until(t, () => t.frame().includes("foo.ts"))
    expect(t.frame()).not.toContain("+new line")

    const hit = locate(t, "foo.ts")
    await act(async () => { await t.mouse.click(hit.x, hit.y) })
    await until(t, () => t.frame().includes("+new line"))
    expect(picks).toHaveLength(0)

    const again = locate(t, "foo.ts")
    await act(async () => { await t.mouse.click(again.x, again.y) })
    await until(t, () => !t.frame().includes("+new line"))
    expect(picks).toHaveLength(0)
    t.destroy()
  })
})

describe("ErrorBlock", () => {
  test("failed turn renders bordered card with head + collapsed body + copy", async () => {
    const stack = ["RuntimeError: boom", ...Array.from({ length: 10 }, (_, i) => `  at frame${i}`)].join("\n")
    const msgs: Message[] = [{
      id: "ae", role: "assistant", timestamp: 0, parts: [], error: stack,
    }]
    const t = await mountNode(
      <box flexDirection="column" width="100%" height="100%">
        <MessageList messages={msgs} streaming={false} />
      </box>,
      { width: 100, height: 30 },
    )
    await until(t, () => t.frame().includes("✗ RuntimeError: boom"))
    const f = t.frame()
    expect(f).toContain("┃")
    expect(f).toContain("copy")
    expect(f).toContain("at frame0")
    expect(f).toContain("at frame5")
    expect(f).not.toContain("at frame6")
    expect(f).toContain("click to expand")

    const p = locate(t, "at frame0")
    await act(async () => { await t.mouse.pressDown(p.x, p.y) })
    await until(t, () => t.frame().includes("at frame9"))
    t.destroy()
  })
})

describe("tool/preview spec table", () => {
  test("every hermes tool has a single-char icon and non-empty pending", () => {
    const names = [
      "terminal", "process", "execute_code", "read_file", "write_file",
      "patch", "search_files", "web_search", "web_extract", "session_search",
      "browser_navigate", "browser_click", "browser_type", "browser_snapshot",
      "browser_vision", "vision_analyze", "todo", "memory", "clarify",
      "skill_view", "skills_list", "skill_manage", "delegate_task", "cronjob",
      "text_to_speech", "image_generate",
    ]
    for (const n of names) {
      const s = spec(n)
      expect([...s.icon].length).toBe(1)
      expect(s.pending.length).toBeGreaterThan(0)
    }
    expect(spec("unknown_tool").icon).toBe("⚙")
    expect(spec("mcp__foo").icon).toBe("◇")
    expect(spec("subagent[0]").icon).toBe("⊙")
  })
})
