# dsh-session-link

Pass context between DSH sessions without the download–transfer–unzip dance.

`dsh-session-link` is a plugin for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness). One click in the session header copies a reference to the current session; any other session picks it up and reads the whole conversation back as clean `user:`/`assistant:` text.

[![license](https://badgen.net/badge/license/MIT/green)](LICENSE)
[![dsh-plugin](https://badgen.net/badge/topic/dsh-plugin/8257D0)](https://github.com/topics/dsh-plugin)
[![中文](https://badgen.net/badge/lang/中文/blue)](README.zh.md)

<div align="center">

| Copy | Mention | Read |
|---|---|---|
| Header button → `@session-<uuid>` on the clipboard | `@` menu lists sessions by title | `session_read` projects the conversation |

</div>

## When you'd want this

- **Session A figured something out; session B needs it.** Without this, you export the session log, move the file, unzip it, and read zstd JSONL by hand. Here, A's header button copies `@session-<uuid>`, you paste it into B, and the model calls `session_read` — done.
- **The reference stays a first-class object.** `@session-<uuid>` is all ASCII, so it renders as a colored chip in the composer and in sent bubbles — not as a blob of text you have to explain.
- **What comes back is readable, not raw.** `session_read` projects the event stream to conversation rows and skips chunk/tool/reasoning noise; a 7MB log typically reads back as ~60KB of dialogue.

## What you get

- **Header action「🔗 复制 Session ID」** — one click copies the current session's `@session-<uuid>`. Pure clipboard work; no host round-trip.
- **`@` mention source `session`** — typing `@` in the composer lists every local session by title (searchable by title or id); picking one inserts the reference as a chip.
- **Chip repaint** — `@session-…` references show blue-on-white in sent bubbles, scoped precisely so other `@` mentions are never touched.
- **`session_read` tool** — the model resolves `@session-<uuid>`, a `dsh-session:` URI, or `@title` and receives `{ sessionId, title, cwd, logPath, seqRange, transcript, truncated }`. Read-only, live-first, works for sandboxed sessions too.

## Install

Pinned to a release — build artifacts are committed, so there is nothing to
build and no registry involved:

```sh
dsh plugin --profile web add "github:jinhuang712/dsh-session-link#v0.1.0"
# restart dsh web, then refresh the page
```

Or track `main` to pick up unreleased commits:

```sh
dsh plugin --profile web add "github:jinhuang712/dsh-session-link#main"
```

Or from a local checkout, linked so edits show up on refresh:

```sh
git clone https://github.com/jinhuang712/dsh-session-link.git
dsh plugin --profile web add "link:$PWD/dsh-session-link"
```

If your dsh profile directory is a pnpm workspace, pnpm asks for `-w` before
touching its root — pass it through: `dsh plugin --profile web add -w …`.

After install (and one restart), the header button, the `@` menu group and
the `session_read` tool are available permanently in every session. The
companion skill `dsh-session-link` registers with the install
(`dsh.skills` declaration) and teaches the model when and how to read a
reference.

## Usage

**Share a session:** open it, click「🔗 复制 Session ID」in the header, paste
into any other session's composer — the reference appears as a chip — and
send.

**Pick a session without switching:** type `@` in the composer, find the
session by title in the `session` group, insert it.

**Read a reference:** the model calls

```json
session_read({ "link": "@session-7fc2d98e-…" })
```

| Input | Behaviour |
|---|---|
| `@session-<uuid>` | Exact, recommended — what the button produces |
| `dsh-session:<b64>` | The URI form from older link payloads |
| `@title` | Exact title match; a miss or ambiguity returns candidates/ids — retry by id |

Optional: `maxChars` (projection budget, default 64000), `truncate`
(`"tail"` keeps the most recent rows — default; `"head"` keeps the earliest),
`raw` (debug: first 200000 chars of the original JSONL).

## Boundaries (measured, not guessed)

- Chinese titles (`@分析…`) don't chip — the shipped `@`-mention regex has no
  `/u` flag. The copy format is the id, never the title, precisely for this.
- `@title` resolution needs the host's `sessionQuery` title snapshots; when
  unavailable the tool says so and points at the id form.
- Reading is read-only and live-first: `sessionQuery.readSession` reflects a
  running session at its current state; the on-disk log path is resolved for
  reference (`logPath`) but never written.

## Architecture

- **Host half** (`lib/index.mjs`): Cordis entry
  - `defineTool` registers `session_read`; `execute` parses the reference,
    resolves titles via `sessionQuery`, projects the JSONL event stream, and
    caps it by budget
  - no webServer routes — the copy button is pure clipboard
- **Client half** (`src/` → `lib/client.js`): `__ModuleLoader__.load` bundle
  - `runtime.js` binds the host's React from the loader's `require` — never
    bundled, so the plugin shares the host's React instance
  - `copy-button.js` the header action; `mention.js` the `@` session source;
    `chips.js` the MutationObserver repaint
- **Skill** (`skills/dsh-session-link/SKILL.md`): usage guide shipped with the install

### Develop

`lib/client.js` and its source map are build output, committed so the GitHub
install stays one line. Edit `src/`, then:

```sh
pnpm install
pnpm build      # esbuild src/index.js -> lib/client.js + lib/client.js.map
```

## Verify

It loaded at all:

- `__DSH_BOOT__` includes the `dsh-session-link` client row, and
  `/plugins/dsh-session-link/client.js` returns 200
- `cordis_inspect_query` (Tool.listTools) lists `session_read`

Then exercise the loop:

| Look at | Expect |
|---|---|
| the session header | the「🔗 复制 Session ID」button; clicking flips it to「✓ 已复制」 and the clipboard holds `@session-<uuid>` |
| the composer | pasting the reference shows a chip; typing `@` offers the `session` group by title |
| a sent message | the reference renders as a blue chip, other `@` mentions unchanged |
| `session_read` on the pasted reference | returns the session's `title`/`cwd` and a `user:`/`assistant:` transcript |

## Uninstall

- Remove the `dsh-session-link` insert row from the web profile's
  `cordis.patch.yml`
- Remove the `dsh-session-link` dependency from the web profile's
  `dsh.profile.bundles` and run `pnpm remove`

## License

MIT
