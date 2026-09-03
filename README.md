# LotaGate Desktop Agent Workspace

Dedicated Electron workspace for local LotaGate agents. It is not an editor
fork and does not modify `server/`, `sdk/`, `agent-sdk/`, or `cli/`.

## Requirements

- Node.js 22+
- npm
- The `@lotagate/cli` package installed through `npm install`; Desktop resolves
  its packaged executable and does not depend on a system `PATH` entry. During
  CLI development, use the local link workflow below.
- The local `.env` runtime configuration for the LotaGate production API. The
  packaging step converts it to an encrypted `runtime.dat` artifact.
  It contains public endpoints only; never place passwords, tokens, or private
  keys in this file.
- The desktop uses normal password login at `/auth/login`; it does not
  implement OAuth or 2FA.

## Development

From the repository root:

```powershell
cd desktop
npm install
npm run dev
```

After login, add a local workspace, select or create a task, and submit a
prompt. The composer owns approval decisions; CLI trust remains the authority.

### Remote Control development

Remote Control is an optional Desktop host connection to the standalone
`lotagate-remote-server` relay. Configure its public or local base URL in the
Desktop runtime `.env` without adding credentials:

```dotenv
LOTAGATE_REMOTE_SERVER_URL=http://127.0.0.1:8787
LOTAGATE_REMOTE_SERVER_GLOBAL_PREFIX=api/v1
LOTAGATE_REMOTE_SERVER_ENROLLMENT_TOKEN=<same-long-random-value-configured-on-remote-server>
```

The Desktop creates a short-lived session, displays the relay URL as a QR code,
and revokes the session on sign-out, workspace removal, application shutdown,
or manual disconnect. The CLI remains the execution authority; the relay only
transports validated commands and Desktop events.

### Local CLI development

The Desktop package remains pinned to the registry version in
`package.json`. To develop against the sibling `cli/` workspace without
publishing every change, run:

```powershell
npm run cli:link
npm run dev
```

`cli:link` builds the local CLI JavaScript and links `../cli` into Desktop.
While the link is active, Desktop starts the local Node launcher so native
package artifacts are not required. This affects only the local Desktop
workspace; standalone CLI installations continue to use their normal npm
package and native executable flow.

When the local work is complete, restore the registry dependency with:

```powershell
npm run cli:unlink
```

The unlink script reads the exact CLI version declared by Desktop and runs a
normal npm install so the native executable is restored as well. Publish a new
CLI version only when the release is ready, then update Desktop's declared
version deliberately.

## Execution boundaries

Desktop protocol v2 sends filesystem and shell actions through the Desktop
execution broker. Interactive turns and automations request the sandbox by
default; the broker mounts only the selected workspace into a disposable
Docker/Podman container, disables networking by default, applies memory and
process limits, and never passes Desktop credentials into the container. Set
`LOTAGATE_SANDBOX_RUNTIME` or `LOTAGATE_SANDBOX_IMAGE` when a non-default
runtime or image is required. If the sandbox is unavailable, `ask` policies
reuse the existing approval card before retrying the exact action on the host;
`deny` policies fail closed. Standalone CLI execution remains local because it
does not receive the Desktop host bridge.

## UI architecture

The renderer uses a code-owned component system based on Radix Primitives,
Tailwind CSS v4, and CSS variables. Shared controls live in
`src/renderer/components/ui/`, with `ui.tsx` retained as a small export barrel;
feature components own layout and data flow. Styles are loaded through
`src/renderer/styles/index.css`, which composes ordered layers for tokens, base
rules, workspace, settings, file changes, responsive rules, and shared UI
styling. Do not move business logic, API calls, IPC calls, or data mapping into
shared UI components.

The renderer feature layout follows ownership boundaries rather than screen
history. `features/automation/` owns the Workspace automation surface;
`features/settings/` owns desktop preferences and extension administration;
`features/workspace/` is grouped into `shell/`, `conversation/`, `composer/`,
`review/`, `artifacts/`, `integrations/`, `orchestration/`, and `state/`.
Stable cross-feature model catalogs, attachment types, runtime status types, and
model preferences live under `renderer/services/`. Approval primitives and
shared drawers live under `renderer/components/`. Keep feature-to-feature
imports intentional, and move a concept to a shared layer only when it has
multiple semantic consumers.

Electron main is composed in `src/main/index.ts`. Automation execution lives in
`src/main/automation/automation-execution-service.ts`, while IPC registration is
split by command namespace under `src/main/ipc/`; `register-ipc.ts` remains the
composition root. The versioned JSONL and IPC contract barrels under
`src/contracts/` are public boundaries and should be extended there before
adding duplicate local types.

For a packaged Windows cold-start smoke test:

```powershell
npm run package
npx playwright test --reporter=line
```

## Verification

```powershell
npm run typecheck
npm run lint
npm run check:file-size
npm test
npm run build
npm run package:smoke
npm run make
```

`npm run make` creates a Windows WiX MSI and ZIP artifact, a macOS DMG, and
Linux DEB/RPM artifacts under `out/make`. A macOS PKG is also generated when
`LOTAGATE_MAC_INSTALLER_IDENTITY` names an available installer certificate.
Linux and macOS makers require their respective native build environments.

For the complete validated native build flow, run:

```bash
npm run make:installers
```

This command installs dependencies only when `node_modules` is absent, then
runs typecheck, lint, file-size checks, tests, the production bundle build, and
the native Forge makers for the current operating system. It prints the exact
artifact paths after a successful build. Run the same command on a Windows,
macOS, and Linux build host to produce the complete multi-platform release set;
native installers are not cross-compiled by this script.

Useful options for local development or CI diagnostics:

```bash
node scripts/build-installers.mjs --dry-run
node scripts/build-installers.mjs --skip-validation
node scripts/build-installers.mjs --arch arm64
```

The Windows MSI uses the standard install wizard and the product license
agreement from `resources/installer/eula.rtf`. Building the MSI requires WiX
Toolset 3 (`candle.exe` and `light.exe`) on the Windows build host. If WiX is
not available on `PATH`, the build script downloads the official WiX 3.14.1
binaries, verifies their SHA-256, and caches them under `.tools/wix`; an
existing installation can be selected with `LOTAGATE_WIX_HOME`. The MSI uses a
stable upgrade code so later versions can upgrade the same installation.
The ZIP maker uses a small in-repository compatibility override at
`vendor/cross-zip` to replace the deprecated recursive `fs.rmdir` call with
`fs.rm` while preserving the Electron Forge maker API.

The Electron main/preload bundle uses the CommonJS output emitted by the
current electron-vite integration; the renderer remains Vite-managed.

## Agent, MCP, and update behavior

Desktop starts the CLI with `lotagate agent desktop` and exchanges only the
versioned JSONL Desktop protocol. Each request has a bounded timeout; malformed
protocol data, mismatched responses, and stalled sidecars fail closed and are
reported through the diagnostic bridge. Shutdown sends a best-effort request
and then terminates the process within the configured close deadlines.

Every Desktop JSONL event declares a `scope`: `session` for session-owned
streaming/tool events or `control` for workspace-level command events. Session
events also carry their session identity in the event data so renderer state
and approval handling can reject stale or cross-session updates.

The CLI owns MCP configuration, transport, connection pooling, warm-up, and
tool discovery. Desktop receives only sanitized MCP lifecycle/catalog events
for status display. Development/link mode does not check for updates; the
current update endpoint is enabled only for packaged applications. Release
update verification and installer application remain release-pipeline work,
not an automatic development action.

Persistent human-operated browser data uses a stable, hashed profile partition
per workspace. Agent browser data uses a separate stable partition per CLI
session, preventing cookies and local storage from being shared between
concurrent sessions. Session profiles are ephemeral, while TTL profiles clear
storage and evidence when they expire. The renderer never owns browser
transport or Electron session objects.

## Boundaries

- API calls run in Electron main through the native network stack and typed
  preload IPC; the renderer never receives cookies, tokens, or crypto keys.
- Only the allowlisted user routes are available. `/admin/**` is rejected
  before a network request.
- CLI control traffic is consumed as a versioned JSONL protocol. Extension list
  commands return a redacted structured payload for Desktop together with a
  human-readable fallback, while standalone CLI commands retain their text
  output.
- Local task/workspace/settings data is stored in the Electron user-data
  directory, not inside a repository.
- Runtime logs are written as redacted JSONL files under
  `<userData>/desktop-data/logs/desktop-YYYY-MM-DD.log` and retained for 30
  days. Dynamic account/model data is cached under
  `<userData>/desktop-data/cache/` with feature-specific TTLs; the cache is
  cleared when the authenticated session is cleared. Billing and usage
  responses are intentionally not persisted in the cache.
- Executable TypeScript/JavaScript and executable tests are checked at 600
  lines or fewer. Configuration, lockfiles, docs, schemas, and assets are
  exempt from that executable-source gate.
