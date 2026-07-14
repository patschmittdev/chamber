# Contributing to Chamber

## Development Setup

```bash
git clone https://github.com/ianphil/chamber
cd chamber
npm install
npm start        # launch with hot reload
```

## Workflow

1. **File a GitHub Issue** — every change starts with an issue. Label it `now`, `next`, or `later` to indicate priority.
2. **Branch from `master`** — use a descriptive branch name referencing the issue: `fix/stale-model-picker-97`, `feat/auth-flow-42`.
3. **Make your changes** — keep commits focused. One logical change per commit.
4. **Open a PR** — reference the issue with `Fixes #N` or `Closes #N` in the PR body so it auto-closes on merge.

## Code Quality

### Static validation

Static validation runs TypeScript, ESLint, and dependency boundary checks.

```bash
npm run lint
```

Zero errors, zero warnings. Fix lint issues before pushing.

### Tests

```bash
npm test              # run all Vitest tests once
npm run test:coverage # generate coverage report
```

All tests must pass before merging. If you change behavior, update or add tests to cover it.

### End-to-end tests (Playwright)

Two Playwright projects live under [tests/e2e/](tests/e2e):

| Script | What it runs | Needs |
|---|---|---|
| `npm run smoke:web` | Vite web shell + fake-chat server | nothing extra |
| `npm run smoke:desktop` | Spawns the Electron desktop app, connects via CDP | working Electron build |
| `npm run smoke:cross-surface-gate` | Deterministic cross-surface quality gate (required CI gate) | working Electron build |

All scripts auto-install the Chromium headless shell on first run via `npm run playwright:install` (idempotent: fast no-op once the binary is present).

#### Cross-surface quality gate (required CI job)

The `electron-cross-surface-gate` CI job runs on every pull request and is
required for merge. It covers Extension scope, keyboard navigation, rail
resizing, and Settings task routing without credentials or live SDK calls.

Run it locally with:

```bash
npm run smoke:cross-surface-gate
```

Environment requirements:

- Windows x64 or macOS arm64 (the Electron binary targets those platforms).
- No GitHub credentials or Copilot account required. The spec seeds an
  isolated mind under a temp directory and navigates the UI via keyboard.
- The first run downloads the pinned WTD development runtime from the public
  `ianphil/ttasks-wtd` repository as part of `npm start`. Subsequent runs
  skip the download if the runtime is already present.

The gate runs a single Playwright worker (`--workers=1`) with zero retries
(`--retries=0`). Selectors are role-based and stable. Do not add sleeps,
broad retries, or animation-timing assertions to this spec. If a transient
startup failure is observed and reproduced, document the evidence before
adding a narrow retry with trace retention.

### Smoke tests

Run the smoke test that matches the surface you touched:

| Script | Purpose |
|---|---|
| `npm run smoke:sdk` | Copilot SDK runtime smoke |
| `npm run smoke:server-sdk` | Loopback server SDK smoke |
| `npm run smoke:web` | Browser app smoke |
| `npm run smoke:desktop` | Electron desktop app smoke |
| `npm run smoke:cross-surface-gate` | Deterministic cross-surface quality gate (required CI) |
| `npm run smoke:packaged-runtime` | Packaged app/runtime smoke |

Useful environment variables:

| Variable | Purpose |
|---|---|
| `CHAMBER_E2E_USER_DATA` | Override Electron's `userData` dir for test isolation. Honored by `apps/desktop/src/main.ts`. |
| `CHAMBER_E2E_FAKE_CHAT=1` | Make the server short-circuit `chat.send` to a deterministic reply. Set automatically by the web project. |
| `CHAMBER_E2E_FAKE_CHAT_REPLY` | Override the deterministic reply (default `CHAMBER_BROWSER_LOOPBACK_ACK`). |
| `CHAMBER_E2E_GENESIS_BASE_PATH` | Force the Genesis wizard to write new minds under a temp dir. |
| `CHAMBER_E2E_GENESIS_MEMORY_APPEND` | Inject text into a freshly-created mind's working memory before the first turn. |
| `CHAMBER_E2E_LIVE_GENESIS=1` | Opt in to the live Copilot Genesis spec (requires a logged-in account, several minutes per run). Default off. |
| `CHAMBER_E2E_*_CDP_PORT` | Per-spec CDP port overrides (default 9333–9337). |

### Type Checking

TypeScript strict mode. Run the compiler to catch type issues:

```bash
npx tsc --noEmit
```

## Versioning

Chamber uses [Model B release versioning](ai-docs/release-channels.md). `master`'s `package.json#version` always equals the last shipped stable version — it is stale between releases and **must not be bumped in feature or fix PRs**. Version bumps happen only on `release/bump-vX.Y.Z` branches opened automatically by the `post-release-bump` workflow after a stable release succeeds.

The next stable version is computed at release time from the conventional `### Headings` in `## [Unreleased]` in `CHANGELOG.md`. Use `ship` to append entries; the release skill handles version computation and tagging.

## Changelog

`CHANGELOG.md` follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). Every
released version gets an entry written by the post-release bump PR
opened by the `release` skill. Follow the existing format:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added

- **Short summary** — longer explanation of what changed and why. (#issue)
```

Sub-headings follow the Keep a Changelog canonical vocabulary
(**Added**, **Changed**, **Deprecated**, **Removed**, **Fixed**,
**Security**), plus a Chamber-specific **Breaking** heading and a few
area-tag extensions (**Performance**, **Docs**, **Tests**, **CI**,
**Build**, **Packaging**, **Release**, **Chore**) that all default to a
patch bump.

Guidelines:

- **Bold the lead phrase** — scan-friendly one-liner, then the detail after the dash.
- **Reference the issue** — append `(#N)` so readers can find the discussion.
- **Use `ship`, not hand edits** — `npm run ship` invokes
  `scripts/append-changelog-entry.js`, which keeps the file consistent.
- **Don't promote `## [Unreleased]` by hand** — that's the release
  skill's post-release bump PR.

## Issues & Labels

All work is tracked via [GitHub Issues](https://github.com/ianphil/chamber/issues). Priority labels:

| Label | Meaning |
|-------|---------|
| `now` | Current sprint — actively being worked |
| `next` | Queued — will be picked up soon |
| `later` | Backlog — important but not urgent |

## Releases

Chamber uses a two-channel Model B release process. See
[`ai-docs/release-channels.md`](ai-docs/release-channels.md) for the full
model and the release skill (`.github/skills/release/SKILL.md`) for the
operational runbook. In brief:

1. Use `ship` to append bullets to `## [Unreleased]` in `CHANGELOG.md`.
2. Dispatch `release-insiders.yml` to cut an insider build (invite-only,
   Windows + macOS arm64, Azure Blob).
3. After testers validate, dispatch `release.yml` with `source_ref` set to
   the insider tag to promote to stable (public GitHub Releases).
4. The `post-release-bump.yml` workflow opens the bump PR automatically on
   stable tag push — review and merge it to advance `master`.

## Stack

- **Electron 41** + Forge/Vite bundling + electron-builder NSIS packaging
- **React 19**, TypeScript, Tailwind CSS v4
- **shadcn/ui** (Radix + CVA)
- **@github/copilot-sdk**
- **electron-updater** for desktop auto-update
- **Vitest** for testing
