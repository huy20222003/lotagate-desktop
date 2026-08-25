# LotaGate Desktop — Complete Task Register

Status: desktop-owned implementation complete and verified on Windows.
Architecture and product requirements are defined in `PLAN.md`; this file is
the execution register and handoff report. The old editor fork is not an
implementation dependency.

## Mandatory boundary decisions

- [x] Trace the repository, root `AGENTS.md`, client auth/crypto, server routes,
  CLI desktop protocol, command catalog, and existing reusable services before
  adding desktop code.
- [x] Keep `server/` read-only. No server route, guard, config, schema,
  migration, contract, or web-client behavior was changed.
- [x] Treat `sdk`, `agent-sdk`, and `cli` as independent external packages.
  Desktop declares `@lotagate/cli` as an npm dependency and uses its installed
  executable plus JSONL protocol only.
- [x] Add the desktop `.env` runtime configuration with the verified public API
  base URL and trusted web origin; load it with the Node runtime API in both
  development and packaged resources.
- [x] No package logic was moved, no external package version was changed, and
  no package README update was needed because the desktop-owned adapter was
  sufficient.
- [x] Use normal `/login` password authentication only. No OAuth and no 2FA.
- [x] Keep executable `.ts`, `.tsx`, `.js` and executable test files at or
  below 600 lines. Documentation, configuration, schemas, lockfiles, assets,
  fixtures, and generated output are reviewed separately and are exempt.

## Foundation and architecture

- [x] Create an independent Electron/React/TypeScript desktop package with
  strict compiler settings, npm manifests, Vite, Forge, icons, CSP, sandbox,
  context isolation, and no renderer Node/Electron access.
- [x] Establish modular main-process owners for API, agents, persistence,
  workspaces, tasks, Git, terminal, browser, artifacts, automation, settings,
  operations, security, IPC, and window creation.
- [x] Establish versioned agent and IPC contracts with Zod runtime validation
  at trust boundaries and narrow typed preload methods.
- [x] Add deterministic renderer build output to the packaged `app.asar` and
  align the CommonJS Electron host bundle with electron-vite output.
- [x] Add a reusable UI foundation: Button, Label, Input, Textarea, Checkbox,
  Radio, Tooltip, Modal, Dropdown, Avatar, Card, Spinner/Loading, Table,
  Tabs, Badge, Field, Divider, EmptyState, safe links, and focus behavior.
- [x] Define CLI-brand semantic tokens and the quiet Codex-like conversation
  layout; keep approval in the composer instead of a permanent sidebar item.

## API, authentication, and user context

- [x] Implement main-process native API transport with persistent Electron
  cookies, credential isolation, trusted Origin, CSRF cookie/header handling,
  safe errors, timeout/retry boundaries, and renderer profile projection only.
- [x] Reproduce the existing client crypto boundary: ECDH P-256 bootstrap,
  HKDF-SHA-256 request/response keys, AES-256-GCM envelopes, metadata headers,
  sequence/request-id/timestamp/key-id validation, rotation, tamper failure,
  reset after refresh/logout/failure, and encrypted response handling.
- [x] Enforce the user API allowlist for crypto session, login, refresh, logout,
  me, own profile, organizations, permitted workspaces, and workspace models.
  Admin routes are rejected before network access.
- [x] Build the dedicated login screen with validation, loading, invalid
  credentials, unsupported additional-auth response, API unavailable, and
  missing configuration states.
- [x] Load `/auth/me`, render user name/avatar/email/organization/workspace,
  surface user organization context, and route unrecoverable expiry to login.
- [x] Implement confirmed logout with a modal; cancel leaves all state intact,
  confirm calls server logout, clears cookies/crypto/profile/agent state, and
  returns to login.

## CLI agent runtime and lifecycle

- [x] Resolve the executable shipped by the installed `@lotagate/cli` package,
  including Electron asar-unpacked release paths, without shell interpolation;
  start one process per active workspace execution context.
- [x] Implement bounded JSONL framing, request correlation, response/event
  validation, ordered event delivery, duplicate/unknown-id diagnostics,
  malformed/oversized input handling, cancellation, and graceful shutdown.
- [x] Consume the existing CLI methods exactly: initialize, session create/list/
  resume, turn start/cancel, approval respond, trust respond, model list, auth
  status boundary, command list/execute/cancel, and shutdown.
- [x] Persist task projection/event cursors, serialize event ordering per cwd,
  distinguish failed/interrupted/cancelled/completed states, preserve the last
  reason, and bound automatic process recovery with visible diagnostics.
- [x] Render streaming assistant markdown/GFM, tool/command/file/usage/context
  activity, approvals, trust requests, model selection, draft recovery, safe
  links, empty/loading/error/interrupted states, retry/cancel/resume/archive/
  pin controls, and task activity without cross-task contamination.
- [x] Keep approval decision metadata and trust presentation in desktop while
  leaving authorization, remembered policy, tools, skills, plugins, MCP, hooks,
  and session truth owned by CLI.
- [x] Discover CLI command descriptors at runtime, including positional
  arguments/options, and provide a generic extension command configuration view
  without duplicating the CLI catalog.

## Workspace, Git, terminal, and artifacts

- [x] Persist workspace metadata outside repositories with add/remove/rename/
  reorder/multi-root/trust/settings operations and Git-root detection.
- [x] Persist tasks, activities, artifacts, drafts, event cursors, terminal
  evidence, settings, and automation records with atomic writes and serialized
  read-modify-write updates.
- [x] Implement Git status/branch/dirty/staged/unstaged/untracked parsing,
  diff, stage/unstage, restore confirmation, commit confirmation, branch
  creation, isolated worktree add/remove, and validated repository paths.
- [x] Export Git patches as typed task artifacts with preview metadata rather
  than only a transient renderer string.
- [x] Implement a main-process user terminal adapter with explicit cwd,
  argument arrays, bounded/redacted stdout/stderr, timeout, duration, exit
  code, and task verification timeline records.
- [x] Implement typed file/image/audio/video/markdown/text/json/patch artifact
  import, metadata, preview, open-in-system-app, deletion confirmation, and
  recovery-aware storage.
- [x] Implement browser isolation with separate sessions, HTTP(S)-only URLs,
  explicit navigation approval, no remote Electron APIs, console/error
  evidence, screenshot evidence, capped recording frames, and download block.

## Automation and desktop operations

- [x] Implement desktop-owned automation create/update/remove/list, ISO trigger,
  workspace/prompt/execution-policy persistence, pause state, next/last/error
  display, scheduler polling, and manual run into a local CLI task.
- [x] Implement tray/menu-bar guard, notification adapter, single-instance
  focus, `lotagate://` deep-link forwarding, graceful quit, interruption
  marking, redacted diagnostics export, HTTPS update-manifest validation, and
  no-secret operational output.
- [x] Implement persisted appearance/language/execution-policy/default-model/
  reduced-motion/notifications/telemetry settings with English/Vietnamese
  message keys and safe loading/error behavior.
- [x] Keep telemetry opt-in and exclude prompts, source, cookies, keys, tokens,
  and private file content from diagnostics.

## Verification and release handoff

- [x] `npm run typecheck` passed.
- [x] `npm run lint` passed with no unexplained suppressions.
- [x] `npm run check:file-size` passed.
- [x] `npm test` passed: 7 test files, 16 tests.
- [x] `npm run build` passed for main, preload, and renderer bundles.
- [x] `npm run package:smoke` passed; renderer presence in `app.asar` and the
  installed CLI binary at `resources/lotagate.exe` were verified.
- [x] `npm run make` passed and produced Windows Squirrel Setup.exe, nupkg,
  RELEASES metadata, and ZIP artifacts under `out/make`.
- [x] `npx playwright test --reporter=line` passed the packaged Windows
  cold-start/login E2E.
- [x] Real fixture `lotagate agent desktop` returned protocol version 1 and
  the expected sessions/streaming/approval/trust/models/auth/commands catalog.
- [x] The packaged `resources/lotagate.exe` completed a real JSONL initialize
  and graceful shutdown handshake.
- [x] `npm audit --omit=dev` found 0 production vulnerabilities. Development-
  only Forge-chain advisories remain documented; no breaking force-fix was run.
- [x] `git diff -- server sdk agent-sdk cli` returned no source diff.
- [x] Final source review found no executable source/test file over 600 lines.

## Runbook

```powershell
cd D:\nguyenhuyofficial\tools\lota-gate\desktop
npm install
npm run dev
```

For release verification:

```powershell
npm run typecheck
npm run lint
npm run check:file-size
npm test
npm run package:smoke
npx playwright test --reporter=line
npm run make
```

Native macOS/Linux packaging, signing, installer smoke, and provider-specific
credentials require their respective release hosts. They do not authorize
changes to `server/`, `sdk/`, `agent-sdk/`, or `cli/`.
