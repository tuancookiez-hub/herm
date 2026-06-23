// Per-message action menu — oc routes/session/dialog-message.tsx.
// Opened by clicking a user message. Copy is local; Rewind and Fork
// delegate to callbacks owned by app.tsx (they need turn state +
// gateway + composer).

import { DialogSelect } from "../ui/dialog-select"
import type { DialogContext } from "../ui/dialog"
import type { ToastContext } from "../ui/toast"
import type { Message } from "../types/message"
import { copyText } from "../utils/clipboard"

export type MessageOps = {
  rewind: (m: Message) => void
  fork: (m: Message) => void
  /** Fork + open Schrödinger's Box tab with model pickers + parallel run.
   *  Only meaningful on assistant messages. */
  forkSchrodinger?: (m: Message) => void
  toast?: ToastContext
}

export function openMessage(dialog: DialogContext, m: Message, ops: MessageOps) {
  const text = m.parts
    .filter(p => p.type === "text")
    .map(p => p.content)
    .join("")

  const isAssistant = m.role === "assistant"

  const options: Array<{ title: string; value: string; description: string }> = [
    { title: "Copy", value: "copy", description: "message text to clipboard" },
    { title: "Rewind here", value: "rewind", description: "undo back to this turn (destructive)" },
    { title: "Fork here", value: "fork", description: "branch a new session at this point" },
  ]
  if (isAssistant && ops.forkSchrodinger) {
    options.push({
      title: "Fork into Schrödinger's Box",
      value: "fork-schrodinger",
      description: "branch + run 2 models in parallel, you pick the merge",
    })
  }

  dialog.replace(
    <DialogSelect
      title="Message Actions"
      options={options}
      onSelect={(o) => {
        dialog.clear()
        if (o.value === "copy") return void copyText(text, ops.toast)
        if (o.value === "rewind") return ops.rewind(m)
        if (o.value === "fork") return ops.fork(m)
        if (o.value === "fork-schrodinger") return ops.forkSchrodinger?.(m)
      }}
    />,
  )
}
