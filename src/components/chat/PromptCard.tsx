// Inline agent prompts — approval / clarify / sudo / secret.
//
// These render *in the transcript* as a Part of the in-progress
// assistant message, not in a modal. The composer stays focused for
// approval/clarify; the shell's global key handler routes keys to
// the pending card via the imperative handle so number/arrow/Enter
// work without the textarea eating them. Sudo/secret own a masked
// <input> and take focus explicitly (the value must never echo into
// the composer).
//
// Responding is exactly-once per card but NOT unmount-triggered — the
// card can scroll out of the viewport (culling) without auto-denying.
// Esc is the only cancel path.

import {
  memo, useRef, useState, forwardRef, useImperativeHandle,
} from "react"
import { LEFT_BAR } from "../../ui/borders"
import type { ParsedKey, SubmitEvent } from "@opentui/core"
import { useTheme } from "../../theme"
import { useGateway } from "../../context/gateway"
import { mkApproval, remember } from "../../context/approval-memory"
import type { PromptPart, PromptReq, Part } from "../../types/message"

export type PromptCardHandle = {
  /** Offer a key to the pending card. Returns true if consumed. */
  feed: (key: ParsedKey) => boolean
  /** True if this card owns a focused <input> (sudo/secret). */
  masked: boolean
}

type Answer = (label: string, ok: boolean) => void

function digit(name: string): number | null {
  const n = parseInt(name, 10)
  return Number.isFinite(n) ? n : null
}

// ┃-bar panel frame — matches the oc permission grammar that prompts
// already used inside the modal, minus the fixed width.
const Frame = (p: { tint: import("@opentui/core").RGBA; children: React.ReactNode }) => {
  const theme = useTheme().theme
  return (
    <box
      flexDirection="column"
      border={["left"]}
      borderColor={p.tint}
      customBorderChars={LEFT_BAR}
      backgroundColor={theme.backgroundPanel}
      marginBottom={1}
    >
      {p.children}
    </box>
  )
}

const Pill = (p: { on: boolean; hot: string; label: string; onPick: () => void }) => {
  const theme = useTheme().theme
  return (
    <box height={1} paddingX={1}
         backgroundColor={p.on ? theme.primary : undefined}
         onMouseDown={p.onPick}>
      <text>
        <span fg={p.on ? theme.background : theme.textMuted}>{p.hot} </span>
        <span fg={p.on ? theme.background : theme.text}>{p.label}</span>
      </text>
    </box>
  )
}

const CHOICES = ["once", "session", "never", "deny"] as const
type Choice = typeof CHOICES[number]
const LABELS: Record<Choice, string> = {
  once: "Allow once",
  session: "Allow this session",
  never: "Never ask",
  deny: "Deny",
}
const RESPOND: Record<Choice, string> = {
  once: "once",
  session: "session",
  never: "always",
  deny: "deny",
}

const Approval = forwardRef<PromptCardHandle, {
  req: Extract<PromptReq, { variant: "approval" }>
  onAnswer: Answer
}>((p, ref) => {
  const theme = useTheme().theme
  const gw = useGateway()
  const [sel, setSel] = useState(0)
  const [steering, setSteering] = useState(false)
  const [custom, setCustom] = useState("")
  const [note, setNote] = useState("")
  const done = useRef(false)

  const prompt = mkApproval(p.req)

  const send = (c: Choice) => {
    if (done.current) return
    done.current = true
    if (c === "never") remember(prompt)
    void gw.request("approval.respond", { choice: RESPOND[c] }).catch(() => {})
    p.onAnswer(LABELS[c], c !== "deny")
  }

  const steer = (text: string) => {
    const body = text.trim()
    if (!body) { setSteering(false); return }
    setCustom("")
    setSteering(false)
    setNote("steer sent — approval still pending")
    void gw.request("session.steer", { text: body }).catch(() =>
      setNote("steer failed — approval still pending"),
    )
  }

  useImperativeHandle(ref, () => ({
    masked: steering,
    feed: (key) => {
      if (steering) {
        if (key.name === "escape") { setSteering(false); return true }
        return false
      }
      if (key.name === "s") { setSteering(true); setNote(""); return true }
      if (key.name === "left" || key.name === "h") {
        setSel(s => (s + CHOICES.length - 1) % CHOICES.length); return true
      }
      if (key.name === "right" || key.name === "l") {
        setSel(s => (s + 1) % CHOICES.length); return true
      }
      if (key.name === "return") { send(CHOICES[sel]); return true }
      if (key.name === "escape") { send("deny"); return true }
      const n = digit(key.name)
      if (n !== null && n >= 1 && n <= CHOICES.length) { send(CHOICES[n - 1]); return true }
      return false
    },
  }), [sel, steering])

  return (
    <Frame tint={theme.warning}>
      <box flexDirection="column" gap={1} paddingLeft={1} paddingRight={2} paddingY={1}>
        <box flexDirection="row" gap={1} height={1}>
          <text fg={theme.warning}>△</text>
          <text fg={theme.text}>Permission required</text>
          <text fg={theme.textMuted}>· {prompt.question}</text>
        </box>
        <box flexDirection="row" gap={1} paddingLeft={2} minHeight={1}>
          <text fg={theme.textMuted}>#</text>
          <text fg={theme.text} wrapMode="word">{p.req.description || "Shell command"}</text>
        </box>
        <box paddingLeft={2} minHeight={1}>
          <text fg={theme.text} wrapMode="word">$ {p.req.command}</text>
        </box>
        {p.req.pattern_keys?.length ? (
          <box paddingLeft={2} minHeight={1}>
            <text fg={theme.textMuted} wrapMode="word">
              matched: {p.req.pattern_keys.join(", ")}
            </text>
          </box>
        ) : null}
      </box>
      {steering ? (
        <box flexDirection="column" gap={1} flexShrink={0}
             paddingX={2} paddingY={1} backgroundColor={theme.backgroundElement}>
          <box flexDirection="row" height={1}>
            <text fg={theme.textMuted}>{"> "}</text>
            <input
              value={custom} onInput={setCustom}
              onSubmit={(() => steer(custom)) as unknown as (e: SubmitEvent) => void}
              focused flexGrow={1}
              textColor={theme.text}
              backgroundColor={theme.backgroundElement}
              focusedBackgroundColor={theme.backgroundElement}
            />
          </box>
          <text fg={theme.textMuted}>Enter steer · Esc back to approval</text>
        </box>
      ) : (
        <box flexDirection="row" gap={2} flexShrink={0}
             paddingX={2} paddingY={1} backgroundColor={theme.backgroundElement}>
          {CHOICES.map((c, i) => (
            <Pill key={c} on={sel === i} hot={String(i + 1)} label={LABELS[c]}
                  onPick={() => send(c)} />
          ))}
          <Pill on={false} hot="s" label="Steer" onPick={() => { setSteering(true); setNote("") }} />
          <box height={1}>
            <text fg={theme.textMuted}>subject: {prompt.subject}</text>
          </box>
          <box flexGrow={1} />
          <box height={1}>
            <text fg={theme.textMuted}>←/→ · enter · s steer · esc deny</text>
          </box>
        </box>
      )}
      {note ? (
        <box paddingLeft={2} paddingBottom={1} backgroundColor={theme.backgroundElement}>
          <text fg={theme.textMuted}>{note}</text>
        </box>
      ) : null}
    </Frame>
  )
})

const Clarify = forwardRef<PromptCardHandle, {
  req: Extract<PromptReq, { variant: "clarify" }>
  onAnswer: Answer
}>((p, ref) => {
  const theme = useTheme().theme
  const gw = useGateway()
  const choices = p.req.choices ?? []
  const [sel, setSel] = useState(0)
  const [typing, setTyping] = useState(choices.length === 0)
  const [custom, setCustom] = useState("")
  const done = useRef(false)

  const send = (answer: string) => {
    if (done.current) return
    done.current = true
    void gw.request("clarify.respond", {
      request_id: p.req.request_id, answer,
    }).catch(() => {})
    p.onAnswer(answer || "(cancelled)", answer !== "")
  }

  useImperativeHandle(ref, () => ({
    // Freeform mode owns a focused <input>; list mode doesn't.
    masked: typing,
    feed: (key) => {
      if (typing) {
        // <input> handles text; we only intercept cancel-back.
        if (key.name === "escape") {
          if (choices.length) { setTyping(false); return true }
          send(""); return true
        }
        return false
      }
      if (key.name === "escape") { send(""); return true }
      if (key.name === "up")   { setSel(s => Math.max(0, s - 1)); return true }
      if (key.name === "down") { setSel(s => Math.min(choices.length, s + 1)); return true }
      if (key.name === "return") {
        if (sel === choices.length) { setTyping(true); return true }
        const c = choices[sel]
        if (c) send(c)
        return true
      }
      const n = digit(key.name)
      if (n !== null && n >= 1 && n <= choices.length) { send(choices[n - 1]); return true }
      return false
    },
  }), [typing, sel, choices])

  const head = (
    <box minHeight={1}>
      <text wrapMode="word">
        <span fg={theme.accent}><strong>ask </strong></span>
        <span fg={theme.text}><strong>{p.req.question}</strong></span>
      </text>
    </box>
  )

  return (
    <Frame tint={theme.accent}>
      <box flexDirection="column" paddingLeft={1} paddingRight={2} paddingY={1}>
        {head}
        <box height={1} />
        {typing ? (
          <>
            <box flexDirection="row" height={1}>
              <text fg={theme.textMuted}>{"> "}</text>
              <input
                value={custom} onInput={setCustom}
                onSubmit={(() => send(custom)) as unknown as (e: SubmitEvent) => void}
                focused flexGrow={1}
                textColor={theme.text}
                backgroundColor={theme.backgroundElement}
                focusedBackgroundColor={theme.backgroundElement}
              />
            </box>
            <text fg={theme.textMuted}>Enter send · Esc {choices.length ? "back" : "cancel"}</text>
          </>
        ) : (
          <>
            {[...choices, "Other (type your answer)"].map((c, i) => (
              <box key={i} height={1} onMouseDown={() =>
                    i === choices.length ? setTyping(true) : send(choices[i])}>
                <text fg={sel === i ? theme.text : theme.textMuted}>
                  {sel === i ? "▸ " : "  "}{i + 1}. {c}
                </text>
              </box>
            ))}
            <box height={1} />
            <text fg={theme.textMuted}>↑/↓ · Enter · 1-{choices.length} · Esc cancel</text>
          </>
        )}
      </box>
    </Frame>
  )
})

const Masked = forwardRef<PromptCardHandle, {
  title: string
  note: string
  onSubmit: (v: string) => void
  onAnswer: Answer
}>((p, ref) => {
  const theme = useTheme().theme
  const [value, setValue] = useState("")
  const done = useRef(false)

  const go = (v: string) => {
    if (done.current) return
    done.current = true
    p.onSubmit(v)
    p.onAnswer(v ? "(provided)" : "(cancelled)", v !== "")
  }

  useImperativeHandle(ref, () => ({
    masked: true,
    feed: (key) => {
      if (key.name === "escape") { go(""); return true }
      return false
    },
  }), [])

  return (
    <Frame tint={theme.warning}>
      <box flexDirection="column" paddingLeft={1} paddingRight={2} paddingY={1}>
        <text fg={theme.warning}><strong>{p.title}</strong></text>
        <text fg={theme.text}>{p.note}</text>
        <box height={1} />
        <box flexDirection="row" height={1} position="relative">
          <text fg={theme.textMuted}>{"> "}</text>
          <input
            value={value} onInput={setValue}
            onSubmit={(() => go(value)) as unknown as (e: SubmitEvent) => void}
            focused flexGrow={1}
            textColor={theme.backgroundElement}
            cursorColor={theme.accent}
            backgroundColor={theme.backgroundElement}
            focusedBackgroundColor={theme.backgroundElement}
          />
          <box position="absolute" left={2} top={0} height={1}>
            <text fg={theme.text} bg={theme.backgroundElement}>{"•".repeat(value.length)}</text>
          </box>
        </box>
        <text fg={theme.textMuted}>Enter submit · Esc cancel</text>
      </box>
    </Frame>
  )
})

const Outcome = memo(({ part }: { part: PromptPart }) => {
  const theme = useTheme().theme
  const a = part.answered!
  const glyph = a.ok ? "✓" : "✗"
  const fg = a.ok ? theme.success : theme.error
  const what =
    part.variant === "approval" ? a.label
    : part.variant === "clarify" ? `chose: ${a.label}`
    : part.variant === "sudo" ? `sudo ${a.label}`
    : `${(part.req as { env_var?: string }).env_var ?? "secret"} ${a.label}`
  return (
    <box height={1} paddingLeft={3} marginBottom={1}>
      <text>
        <span fg={fg}>{glyph} </span>
        <span fg={theme.textMuted}>{what}</span>
      </text>
    </box>
  )
})

export const PromptCard = memo(forwardRef<PromptCardHandle, {
  part: PromptPart
  onAnswer: (id: string, label: string, ok: boolean) => void
}>((p, ref) => {
  const gw = useGateway()
  if (p.part.answered) return <Outcome part={p.part} />
  const answer: Answer = (label, ok) => p.onAnswer(p.part.id, label, ok)
  const req = p.part.req
  if (req.variant === "approval")
    return <Approval ref={ref} req={req} onAnswer={answer} />
  if (req.variant === "clarify")
    return <Clarify ref={ref} req={req} onAnswer={answer} />
  if (req.variant === "sudo")
    return <Masked ref={ref} title="🔒 Sudo required"
                   note="Enter your password to elevate privileges."
                   onSubmit={v => void gw.request("sudo.respond",
                     { request_id: req.request_id, password: v }).catch(() => {})}
                   onAnswer={answer} />
  return <Masked ref={ref} title={`🔑 Secret: ${req.env_var}`}
                 note={req.prompt}
                 onSubmit={v => void gw.request("secret.respond",
                   { request_id: req.request_id, value: v }).catch(() => {})}
                 onAnswer={answer} />
}))

/** Find the single pending prompt across all messages. The gateway
 *  blocks on the answer, so there's at most one. */
export function pending(messages: ReadonlyArray<{ role: string; parts: ReadonlyArray<Part> }>): PromptPart | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== "assistant") continue
    for (let j = m.parts.length - 1; j >= 0; j--) {
      const part = m.parts[j]
      if (part.type === "prompt" && !part.answered) return part
    }
  }
  return null
}
