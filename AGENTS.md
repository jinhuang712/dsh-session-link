# AGENTS.md

Notes for coding agents and language models working on this repository, or
deciding whether to call the tool it provides.

## What this package is

`dsh-session-link` adds cross-session references to [DeepSeek Harness]. A
session stops being a silo: its id is one click away in the header, any other
session can be picked from the `@` menu, and `session_read` turns a reference
into readable conversation text.

[DeepSeek Harness]: https://github.com/deepseek-ai/DeepSeek-Harness

Three surfaces, one reference format (`@session-<uuid>`):

- **Copy** — the header button writes `@session-<uuid>` to the clipboard.
  Pure client-side; no host call.
- **Mention** — typing `@` in the composer lists every local session by
  title; picking one inserts the same reference as a chip.
- **Read** — the `session_read` tool takes the reference (also a
  `dsh-session:` URI or `@title`) and returns the session projected to
  `user:`/`assistant:` rows.

## Calling session_read

`session_read({ link, maxChars?, truncate?, raw? })`. `link` is required and
accepts `@session-<uuid>` (recommended — what the copy button produces), a
`dsh-session:<b64>` URI, or `@title` (exact title match; ambiguity or a miss
returns candidates/ids in the error message — retry by id).

The result is `{ sessionId, title, cwd, logPath, seqRange, transcript,
truncated }`. `transcript` is the projected conversation: session header
block, then `user:` / `assistant:` / `user（注入）:` rows. Chunk, tool and
reasoning events are skipped by design — if you need the raw event stream,
pass `raw: true` (first 200000 chars).

Budget: `maxChars` defaults to 64000 characters of projected text. Over
budget, `truncate: "tail"` (default) keeps the most recent rows, `"head"`
keeps the earliest. Read-only, concurrency-safe; live sessions are read
through the host's session query, so a running session reads at its current
state.

## Writing references back to the user

The id format is all ASCII, so `@session-<uuid>` renders as a colored chip in
both the composer and sent bubbles. Chinese titles do not chip (shipped
regex has no `/u` flag) — that is why the copy format is the id, never the
title.

## Repository layout

- `src/` — client source; `pnpm build` bundles it to `lib/client.js` via esbuild
  - `runtime.js` binds the host's React from the loader's `require`
  - `chips.js` the MutationObserver repaint of `@session-…` chips
  - `mention.js` the `@` session mention source
  - `copy-button.js` the header action
- `lib/index.mjs` — host half: registers the `session_read` tool
- `lib/client.js` — built artifact, committed so installing from GitHub needs
  no build step. Edit `src/`, never this file.
- `skills/dsh-session-link/` — usage guide shipped with the install
- `docs/` — design history in Chinese (evidence, boundaries, alternatives);
  paths and names there are historical

Run `pnpm build` after any change under `src/`, and commit the rebuilt
`lib/client.js` and `lib/client.js.map` alongside it.
