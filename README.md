# Herm

![Herm startup splash screen](./assets/readme-splash.png)

Chat stays on the left. The sidebar and tabs expose model/profile state,
sessions, context, agents, analytics, skills, cron, toolsets, config, env,
memory, and kanban without leaving the terminal.

> **herm** /hɜːm/ _noun_ : a sculptured head of Hermes on a square stone
> pillar, used in ancient Greece as a boundary marker at crossroads.

## Why Herm

Herm gives Hermes Agent an operator-focused TUI instead of scattering work
across shell commands, config files, and browser windows.

- **Stay in the terminal** while chatting with Hermes Agent, resuming sessions,
  and inspecting context.
- **Operate your Hermes home** through dashboard tabs for profiles, skills,
  cron jobs, toolsets, config, env, and memory.
- **Run agentic work through kanban** with boards, task detail views,
  diagnostics, and dispatch controls.
- **Make the shell yours** with rebindable keys, a command palette, slash
  commands, theme picker, and profile switching.

Herm is built with [OpenTUI](https://github.com/anomalyco/opentui) and
[Bun](https://bun.sh/). It is a client for the Hermes Agent gateway, not a
separate agent runtime.

## Quickstart

Herm requires:

- a working [Hermes Agent](https://github.com/NousResearch/hermes-agent) install
- [Bun](https://bun.sh/) or a Node package runner
- a Hermes home at `~/.hermes`, or `HERMES_HOME` pointing somewhere else

Try Herm without installing:

```bash
bunx herm-tui
```

Install it globally:

```bash
bun add -g herm-tui        # stable
npm i -g herm-tui          # also fine
bun add -g herm-tui@next   # bleeding edge, every dev push
```

Run it:

```bash
herm       # fresh session
herm -c    # resume last session
```

Or run from source:

```bash
git clone https://github.com/liftaris/herm.git
cd herm
bun install
bun run src/index.tsx
```

See [`.env.example`](./.env.example) for rarely-needed overrides.

## What you can do

### Chat with Hermes Agent

- Stream responses with markdown rendering, LaTeX-to-unicode conversion, inline
  images through `chafa`, diff chips, and expandable tool calls.
- Add file and diff context with `@` references.
- Use slash commands for session control, model switching, skins, keybindings,
  and app actions.
- Resume, title, and manage sessions without dropping back to another command.

### Operate your Hermes home

- Switch Hermes profiles from inside the TUI.
- Inspect and manage operational surfaces: sessions, context, agents,
  analytics, skills, cron, toolsets, config, env, and memory.

### Run kanban work

- Use the kanban tab as an agent work surface rather than a detached project
  board.
- Open board and task detail views, inspect diagnostics, and dispatch work from
  the same shell you use for chat.

### Share and install eikons

Eikons are 48×24 terminal avatars. The shipped lifecycle is deterministic:
discover, inspect, install, use, update, and remove.

In Herm:

- Open Eikon → Marketplace, or run `/marketplace`, to browse shared catalog
  entries.
- Preview rows before installing. Trust is shown as `Verified`, `Unverified`,
  or `Mismatch` beside source and compatibility state.
- Install adds the eikon to your local library without activating it.
- Use selects an installed eikon as the active avatar.
- Update or remove an active eikon only after confirming that the active
  avatar's backing package will change or be cleared.

From the shell:

```bash
herm eikon search [query]
herm eikon inspect <name|github.com/user/repo/eikon-name|dir>
herm eikon install <name|github.com/user/repo/eikon-name|dir>
herm eikon use <name>
herm eikon info <name>
herm eikon update <name> --active-ok
herm eikon remove <name> --active-ok
```

`install` never activates. `use` is the activation action. JSON output is
available for automation with `--json`.

Default Marketplace installs fetch built package artifacts referenced by the
catalog, not creator repositories. Direct GitHub installs are for sharing
outside the default catalog and support both single-package repos and
multi-eikon catalog repos addressed as `github.com/user/repo/eikon-name`.
Private GitHub repos use normal git authentication.

Creators can share eikons through normal GitHub repositories. Use upstream
`eikon pack`, `eikon index`, and `eikon manifest` to prepare single-package or
multi-eikon repos for direct installs. `eikon publish` remains a GitHub PR
contribution helper for the configured/default catalog repo; it is not a
hosted marketplace account, upload, dashboard, or moderation flow.

Use `eikon.liftaris.dev` as a discovery gallery only; it previews catalog
entries and gives copyable Herm install instructions.

Herm owns native Marketplace behavior. The eikon repo owns the registry,
browser mirror, shared catalog/player exports, install resolver, and publish
preflight. Herm imports public eikon package exports rather than browser mirror
internals or unexported source paths.

### Customize the shell

- Press `Ctrl+K` for the command palette.
- Type `/` for the slash popover.
- Type `/theme` to browse built-in themes.
- Type `/keys` to view and rebind keybindings, including OpenCode-compatible
  bindings.
- Use `Tab` / `Shift+Tab` to move between top-level tabs. Arrow keys navigate
  within a tab.

If text is hard to read in tmux or a dark terminal, try a light theme such as
`daylight`, `mercury`, or `github`. If tmux is the issue,
`set -g default-terminal "tmux-256color"` in `~/.tmux.conf` often fixes color
handling.

## Status and compatibility

Herm does not guarantee backward compatibility with older versions of Hermes.
Hermes is constantly updating, and things are bound to break. Regular Hermes
parity sweeps and updates are done to keep Herm current.

Herm is the dashboard TUI for Hermes Agent. It does not replace Hermes Agent,
implement model providers itself, or own Hermes runtime behavior.

## Development

```bash
bun run dev
bun run typecheck
bun test
```

## Differences from Upstream

This is a personal fork of [liftaris/herm](https://github.com/liftaris/herm)
tracking `v1.9.0-dev.22` with local customizations. It is **not** a
drop-in replacement for upstream — the changes below stay in `dev` and
are not contributed back. Sync the base branch (`git fetch upstream &&
git rebase v1.9.0-dev.<latest>`) before pulling in new upstream
features.

### Sidebar additions

Four extra widgets render in the sidebar's identity block, above the
existing `ContextGauge`:

| Widget | File | Purpose |
|---|---|---|
| `CronStatus` | `src/components/sidebar/CronStatus.tsx` | Live summary of active cron jobs polled via `cron.manage` |
| `ReasoningRow` | `src/components/sidebar/ReasoningRow.tsx` | Reads `agent.reasoning_effort` from `useHome("config")` |
| `ProviderRow` | `src/components/sidebar/ProviderRow.tsx` | Resolves the model's owning provider; reads `~/.hermes/models_dev_cache.json` first, then `config.providers[].models[]`, then a small prefix-inference table, then em-dash |
| `OverheadGauge` | `src/components/sidebar/OverheadGauge.tsx` | Stacked-bar breakdown of context overhead (Identity / Context / Skills / Memory / Tools / Guidance) with a 2-row legend |

The `Provider` row is the non-obvious one: it handles
`*`-free models correctly (e.g. `deepseek-v4-flash-free` resolves to
**OpenCode Zen**, not **DeepSeek**, because that's where the catalog
lists it). Pure UI work — no `SessionInfo` wire-type changes, no
gateway edits, no Python changes. The widget re-reads
`models_dev_cache.json` at most once per session via a module-scope
Promise cache.

### Build / runtime pins

- `package.json` pins `react` to `19.2.6` exact (upstream uses `^19.2.5`).
  Some `v1.9.0-dev.*` tags shipped React internals drift that surfaced
  as `ReactSharedInternals.H is null` after a `bun install`; the exact
  pin matches the version this fork was built and tested against.
- `scripts/build.ts` is patched to use `cpSync()` from `node:fs` instead
  of the shell `cp -r` calls. The shell variant fails on Windows
  (`cp: illegal option -- r`); `cpSync()` is cross-platform and drops
  the MSYS dependency. The build output is otherwise identical.
- `package.json` `version` is stamped to the current upstream tag
  (`1.9.0-dev.22`); upstream's root `package.json` is the placeholder
  `1.0.0-dev.1` and the real version only lands in `dist/package.json`
  on CI. This fork stamps both, so `herm --version` reports the real
  tag locally.

### Test harness tweaks

- `test/preload.ts` keeps the OpenTUI `TreeSitterClient` singleton
  alive across the suite (Bun 1.3.x segfaults under the standard
  per-test spawn/terminate churn — see the comments in the file).
- `test/rehome.test.ts` and `test/git.test.ts` exercise the env-rebind
  path for `src/home/rehome.ts`.

### What this fork does NOT carry

- No changes to gateway behavior, RPC handlers, or event mapping.
- No edits to `src/context/wire.ts` `SessionInfo` — the wire type
  still lacks a `provider` field; the `ProviderRow` widget resolves
  that locally instead of pushing the field through the gateway.
- No contributed PRs to upstream. To propose one of these changes
  upstream, rebase onto `origin/dev`, drop the local-only pieces,
  and open a PR against `liftaris/herm#dev`.

## Acknowledgments

- [Hermes Agent](https://github.com/NousResearch/hermes-agent) - the agent
  runtime Herm operates
- [OpenTUI](https://github.com/anomalyco/opentui) - the TUI framework
- [OpenCode](https://github.com/anomalyco/opencode) - interface inspiration

## License

MIT - see [LICENSE](./LICENSE).
