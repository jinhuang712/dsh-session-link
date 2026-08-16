# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-17

First packaged release, grown out of the `dsh-session-crosser` design docs
(kept under `docs/`, in Chinese).

### Added

- Header action「🔗 复制 Session ID」— one click copies the current session's
  reference `@session-<uuid>` to the clipboard (pure client-side).
- `@` mention source named `session` — the composer menu lists every local
  session by title (id as description, searchable), picking one inserts
  `@session-<uuid>` as a chip.
- Chip repaint — `@session-…` reference chips render blue-on-white in sent
  bubbles, scoped precisely so other `@` mentions are untouched.
- `session_read` host tool — resolves `@session-<uuid>`, a `dsh-session:`
  URI, or `@title` and projects the session to readable `user:`/`assistant:`
  text (noise events skipped, 64KB budget, `tail`/`head` truncation, `raw`
  debug mode). Read-only; live sessions read through `sessionQuery`, sandbox
  sessions included.
- Companion skill `dsh-session-link` registering with the install.
