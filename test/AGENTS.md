# Test harness guide

## Choosing the test tier

- Pure helpers/reducers: import the function directly; no renderer.
- `~/.hermes` readers/writers: use `tmpHome()` from `test/fixture/home`.
- Component UI: use `mountNode()`; no global `useAppKeys` routing.
- Shell/user flows: use `mount()` so app key routing and dialogs run.
- Real process/CONTROL checks: use a sized pty + `/frame`; keep out of
  default unit coverage unless explicitly scoped.
- Host tools (git, chafa, ffmpeg, editors): gate or skip when the
  binary/fixture is absent.

## Mount

```ts
import { mount, mountNode, until, MockGateway } from "./harness"

// Full app under test renderer. gw.start() fires automatically via
// render() → settle() → settle().
await using t = await mount({ handlers: { "foo.bar": p => ({...}) } })
await until(t, () => t.frame().includes("Ready"))

// Arbitrary subtree wrapped in all providers (for component tests).
const ref = createRef<FooHandle>()
await using t = await mountNode(<Foo ref={ref} />, { gw })
```

`await using` → `[Symbol.asyncDispose]` destroys the renderer on
block exit. Omit and call `t.destroy()` manually if you need to assert
after cleanup.

## Home fixtures

```ts
import { tmpHome } from "./fixture/home"

await using h = await tmpHome({
  config: { memory: { provider: "mem0" } },
  files: { "memories/MEMORY.md": "one" },
  prefs: { theme: "opencode" },
})
```

`tmpHome()` creates a fresh `HERMES_HOME` and `HERM_CONFIG_DIR`, seeds
files, calls `rehome()`, and restores the previous env on dispose. Use it
for stateful service tests instead of sharing the preload sandbox. Dispose
it after any renderer using it (`await using h` before `await using t`) so
watchers close before the temp dir is removed.

## MockGateway

- `new MockGateway({ "method": p => result })` — override any RPC.
  Defaults stub `session.create/resume/history/undo/close`,
  `commands.catalog`, `config.get`, `cli.exec`, `complete.path`.
- `gw.on$("method", fn)` — add/override post-construction.
- `gw.push({ type: "message.delta", payload: {...} })` — emit event.
- `gw.last("method")` — most recent call or undefined.
- `gw.calls` — full call log.

## Driving input

```ts
await act(async () => { await t.keys.typeText("hello") })
act(() => t.keys.pressEnter())
act(() => t.keys.pressEscape())
act(() => t.keys.pressKey("c", { ctrl: true }))
act(() => t.keys.pressArrow("down"))
```

Always wrap in `act()`. Mouse: `t.mouse.pressDown(x, y)` (frame
coordinates, 0-indexed).

## Assertions

`t.frame()` returns the rendered screen as one newline-joined string.
Prefer `until(t, predicate)` over `await t.settle(); expect(...)` — it
settles first then polls, and times out with a frame dump on failure.

## Pitfalls

- **`HERMES_HOME` isolation**: `test/preload.ts` sets it to a mktemp
  per `bun test` run. Do NOT write one-off repro scripts that `import
  from "../src/"` without first setting `HERMES_HOME` — they resolve
  `~/.hermes` and clobber real user data.
- **settle() races**: two settles on mount handle the `effect → drain
  → state → second frame` sequence. Post-interaction, one `until()`
  usually suffices; chains of `act()` without settle between may batch.
- **Popover predicates**: `until(t, () => frame.includes("/clear"))`
  can match stale text from a *previous* frame if the predicate was
  already true. Write dialog-only predicates (e.g. wait for the
  dialog-specific string, not one that also appears in the popover).
- **mountNode ≠ useAppKeys**: global keyboard routing (tab switch,
  popover nav via Tab/↑/↓, Esc interrupt) lives in `useAppKeys` which
  only `mount()` wires. For `mountNode` component tests, drive the
  imperative handle (`ref.current.popAccept()`) instead of pressing
  keys that the shell would normally route.
- **kitty keyboard**: harness sets `kittyKeyboard: true` so
  `pressEscape()` is a clean single event (raw ESC is an arrow-key
  prefix and the parser waits).
