import { useState, useEffect, useRef, memo } from "react"
import { STATE_FRAMES, type AvatarState } from "./states"
import type { ParsedEikon, EikonState } from "./eikon"
import { useTheme } from "../../theme"
import * as prefs from "../../context/preferences"
import * as perf from "../../utils/perf"

/**
 * Forward-only state driver (SPEC.md Playback Rules):
 *
 *   intro:  0 .. loopFrom-1   played once on state entry
 *   loop:   loopFrom .. N-1   repeated
 *
 * loopFrom = 0       → no intro, loop whole sequence
 * loopFrom = N       → play once, hold last frame (timer stops)
 *
 * State change restarts from frame 0, so the intro always plays.
 * When an `eikon` is supplied and defines the current state, it wins;
 * states missing from the eikon fall back to the baked-in set (which
 * palindromes its frames to preserve the legacy ping-pong look under
 * this forward-only driver).
 */

export const AnimatedAvatar = memo(({ state = "idle", eikon, onHold }: {
  state?: AvatarState
  eikon?: ParsedEikon
  /** Fired once when a play-once state (loopFrom === frames.length)
   *  reaches its last frame. Consumer decides fallthrough policy. */
  onHold?: (state: AvatarState) => void
}) => {
  const theme = useTheme().theme
  const [frame, setFrame] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holdRef = useRef(onHold); holdRef.current = onHold

  const clip: EikonState = eikon?.states.get(state) ?? STATE_FRAMES[state]
  const { frames, fps, loopFrom } = clip
  const count = frames.length

  const animate = prefs.usePref("animations") !== false
  const targetFps = prefs.usePref("targetFps") ?? 30
  const dt = 1000 / Math.max(1, Math.min(fps, targetFps))

  useEffect(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    setFrame(0)
    if (!animate || count < 2) return
    perf.count("avatar:timer:start")
    if (process.env.HERM_TEST_PERF === "1") globalThis.__hermAvatarTimerStarts = (globalThis.__hermAvatarTimerStarts ?? 0) + 1
    let idx = 0

    const tick = () => {
      perf.count("avatar:tick")
      idx++
      if (idx >= count) {
        if (loopFrom >= count) { setFrame(count - 1); holdRef.current?.(state); return }
        idx = loopFrom
      }
      setFrame(idx)
      timer.current = setTimeout(tick, dt)
    }

    timer.current = setTimeout(tick, dt)
    return () => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
        perf.count("avatar:timer:stop")
      }
    }
  }, [state, count, loopFrom, animate, dt])

  const end = perf.mark("avatar:render")
  const lines = frames[Math.min(frame, count - 1)] ?? []

  const result = (
    <box flexDirection="column">
      {lines.map((line, i) => (
        <text key={i}>
          <span fg={theme.hermAvatar}>{line}</span>
        </text>
      ))}
    </box>
  )
  end()
  return result
})
