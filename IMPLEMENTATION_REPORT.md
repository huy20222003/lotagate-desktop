# LotaGate Desktop — Implementation Report

Date: 2026-08-25

## Delivered

The new `desktop/` application is an independent Electron Agent Workspace.
It is not based on the deleted VS Code/Electron fork. The implementation keeps
the server and the independent `sdk`, `agent-sdk`, and `cli` packages unchanged.

The runtime now includes:

- normal password login through the existing user API, with no OAuth or 2FA;
- checked-in public runtime endpoints in `.env`, loaded natively in development
  and copied into packaged resources;
- corrected the API endpoint to the versioned backend base
  `https://api.lotagate.com/api/v1` and made blank inherited environment
  variables fall back to the desktop `.env` values;
- main-process API transport, cookies, CSRF, crypto bootstrap, encrypted
  request/response envelopes, rotation, refresh retry, logout reset, and an
  explicit non-admin route allowlist;
- typed, validated preload IPC and sender checks;
- CLI JSONL process management with protocol validation, request correlation,
  bounded input, event projection, approvals, project trust, model selection,
  command discovery/execution/cancellation, diagnostics, and shutdown;
- persisted local workspaces, multi-root identity, trust, tasks, activities,
  artifacts, task lifecycle operations, settings, and automation records;
- Codex-like dark conversation workspace using the traced CLI palette, with the
  approval decision inline in the composer;
- Git status/diff/worktree/restore/stage/unstage/commit/branch/patch operations,
  patch artifacts, terminal evidence adapter, isolated approved browser window,
  console/error/screenshot/recording evidence, and Windows tray/notification/
  diagnostic/update/deep-link operations;
- reusable typed UI primitives and a 600-line executable source/test guard.
- corrected Electron development startup so main and preload bundles are
  emitted to the `.vite/build` path used by the CommonJS host entry;
- added native File/Edit/View/Window/Help menus, including New Task, Open
  Workspace, Settings, and standard editing/debugging/window commands through
  typed preload IPC;
- replaced `net.request` with Electron `Session.fetch` after reproducing that
  the server's unchanged `Cross-Origin-Resource-Policy: same-origin` blocks
  the former Origin-bearing request path;
- aligned response crypto validation with the existing web client/server:
  response timestamp and sequence are independently authenticated, while
  request id and key id remain bound;
- treated an unauthenticated startup `401 /auth/me` as the normal login state
  without attempting a failing refresh, and kept refresh retry for protected
  requests after a valid session expires;
- kept the native application menu hidden on login and enabled it only after
  successful session resolution/login;
- removed the obsolete renderer console diagnostic listener after tracing the
  blank screen, while retaining a concise `did-fail-load` diagnostic for real
  navigation failures.

## Verification results

Passed:

- `npm run typecheck`
- `npm run lint`
- `npm run check:file-size`
- `npm test` — 7 files, 16 tests passed
- `npm run build`
- `npm run package:smoke` — renderer remained in `app.asar`; CLI binary and
  public `.env` were copied to `resources/`
- `npm run package` — renderer verified inside `app.asar`
- `npx playwright test --reporter=line` — 1 packaged Windows cold-start test
  passed
- packaged cold-start E2E also verified that the login window has no native
  application menu;
- real CLI fixture: `initialize` returned protocol version 1 and the expected
  capability catalog
- packaged `resources/lotagate.exe`: real JSONL `initialize` and graceful
  `shutdown` handshake passed
- `npm audit --omit=dev` — 0 production vulnerabilities
- `npm run make` — Windows Squirrel package and ZIP created
- development Electron cold start — accessibility state confirmed the login
  screen and File/Edit/View/Window/Help menus; the renderer no longer opens
  blank

Generated Windows artifacts are under `desktop/out/make/`:

- `squirrel.windows/x64/lotagate-desktop-0.1.0 Setup.exe`
- `squirrel.windows/x64/lotagate_desktop-0.1.0-full.nupkg`
- `zip/win32/x64/lotagate-desktop-win32-x64-0.1.0.zip`

## Run from a clean checkout

```powershell
cd D:\nguyenhuyofficial\tools\lota-gate\desktop
npm install
npm run dev
```

For release validation:

```powershell
npm run typecheck
npm run lint
npm test
npm run package:smoke
npm run make
```

## Release notes and boundaries

- The desktop source is complete for the current Windows development/runtime
  contract. macOS/Linux packaging, signing, installer smoke, and provider
  credentials must be exercised on their native release hosts.
- CLI skills/plugins/hooks/MCP remain CLI-owned. Desktop discovers their
  authoritative command descriptors and offers a generic argument/options
  surface; no command catalog or policy is duplicated in the desktop.
- Full dependency audit retains development-only Forge-chain advisories. The
  production dependency audit is clean; no forced breaking upgrade was run.
- `server/`, `sdk/`, `agent-sdk/`, and `cli/` were not modified.
- The historical `@desktop/*` TypeScript warning belongs to an older checkout;
  the pushed `tsconfig.json` has no unused path mapping. Pull the latest
  desktop commit before rerunning development mode.
