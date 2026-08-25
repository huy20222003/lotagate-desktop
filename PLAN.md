# LotaGate Desktop — Agent Workspace Plan
Status: architecture and product plan. The previous VS Code/Electron fork is out
of scope and must not be copied into this project.
## 1. Non-negotiable engineering rules
- Build a dedicated Agent Workspace, not an editor or IDE.
- Trace the existing repository flow before changing or duplicating behavior.
- Reuse existing abstractions when the responsibility and ownership match.
- Treat `server/` as a read-only external integration boundary for this desktop
  project. The desktop must not modify server source, routes, guards,
  configuration, Prisma schema, migrations, or API contracts; other web
  clients depend on that behavior.
- Use only explicitly approved user-facing server APIs. Never call admin APIs,
  admin controllers, admin permissions, or admin data endpoints from desktop.
- Treat `sdk`, `agent-sdk`, and `cli` as independent external packages.
- Do not move logic into those packages by default.
- Before moving any logic into an external package, compare a CLI-owned and a
  desktop-owned solution, assess independent-package impact, and ask for owner
  approval. If approved, update the package version and README before release.
- Do not add compatibility layers, migrations, or legacy behavior for the
  deleted desktop fork.
- The product scope is complete when every capability in this document is
  implemented, tested, secured, and operationally supported. Do not label any
  capability as a later phase or leave intentional placeholders.
- Use TypeScript strict mode and preserve the repository's Node.js 22 baseline.
- Keep executable logic files (`.ts`, `.tsx`, `.js`, and equivalent test code)
  at or below 600 lines. Split by cohesive responsibility, not by arbitrary
  line count. This limit does not apply to plans, README/docs, configuration,
  Prisma schemas/migrations, fixtures/snapshots, generated files, lockfiles, or
  binary/text assets; those still require sensible structure and reviewability.
- Do not hardcode models, paths, commands, limits, routes, permissions, or
  environment-specific values.
- Every changed unit must have focused verification, followed by integrated
  protocol, UI, packaging, and security verification.
## 2. Evidence-first repository trace
### Repository boundaries
The repository is a modular product repository containing:
- `server/`: NestJS API, billing, auth, gateway, persistence, and workers.
- `client/`: Next.js web product with reusable branding, translations, and UI
  primitives. It is not the desktop runtime and must not be imported directly
  into Electron renderer code.
- `cli/`: the application-owned terminal runtime. It owns commands, local tools,
  workspace policy, trust, sessions, persistence, plugins, skills, MCP, agent
  orchestration, logging, and the desktop JSONL adapter.
- `agent-sdk/`: provider-neutral public agent runtime and MCP client. It is an
  independent package and must remain usable without the CLI or desktop.
- `sdk/`: public LotaGate API client. It is an independent package and must not
  receive desktop-specific concepts.
- `desktop/`: recreated as a new application directory. The old fork is deleted
  and is not an implementation dependency.
### Existing reusable implementation discovered in `cli/`
The desktop must use the existing CLI behavior through its public executable and
protocol instead of recreating these concepts:
- `cli/src/application/protocol/desktop-agent-command.ts`: versioned desktop
  JSONL bridge, session lifecycle, turn execution, approval, trust, models,
  auth, commands, cancellation, and cleanup.
- `cli/src/application/protocol/jsonl-protocol.ts`: bounded JSONL parsing,
  request validation, in-flight limits, cancellation, backpressure, and safe
  structured errors.
- `cli/src/application/protocol/desktop-command-catalog.ts`: authoritative
  desktop-visible command catalog.
- `cli/src/application/protocol/desktop-command-executor.ts` and
  `desktop-command-output.ts`: command parsing, execution, activity, output, and
  cancellation adapters.
- `cli/src/application/agent/cli-agent-execution-service.ts`: CLI-owned
  composition of the public Agent SDK with workspace instructions, skills,
  plugins, MCP, tools, approvals, subagents, context handling, and persistence.
- `cli/src/application/session/`, `cli/src/infrastructure/sessions/`, and
  `cli/src/domain/session/`: project identity, journals, session history,
  turn lifecycle, compaction, and repair.
- `cli/src/application/security/` and
  `cli/src/domain/workspace/`: approval, risk classification, workspace trust,
  permission rules, and remembered decisions.
- `cli/src/application/orchestration/`: goals, task graphs, subagents,
  scheduling, handoffs, plan generation, and event projection.
- `cli/src/application/workspace/` and `cli/src/infrastructure/workspace/`:
  workspace indexing, file references, instructions, and settings.
- `cli/src/infrastructure/logging/`: structured logging, redaction, rotation,
  and logging policy.
### Existing end-to-end turn flow
```text
Electron main process
  → spawn `lotagate agent desktop` with a selected workspace cwd
  → initialize
  → session.create or session.resume
  → turn.start
  → CLI project trust and execution config
  → CLI auth and model catalog/client
  → prepareCliAgent()
  → Agent SDK loop + CLI tools/policy/skills/MCP/subagents
  → event projection and session journal persistence
  → JSONL events to Electron main
  → typed IPC to React renderer
```
The approval and trust flow is bidirectional. The CLI emits a request event and
waits; the desktop sends the corresponding response request. The desktop must
not infer authorization from a hidden UI control.
### Existing desktop JSONL surface
Current requests exposed by `lotagate agent desktop`:
| Request | Current ownership | Desktop use |
| --- | --- | --- |
| `initialize` | CLI protocol | capability and version negotiation |
| `session.create` | CLI session store | create a durable project session |
| `session.list` | CLI session store | render recent sessions |
| `session.resume` | CLI session store | load history and resume context |
| `turn.start` | CLI agent runtime | start a prompt turn |
| `turn.cancel` | CLI runtime | abort active work |
| `approval.respond` | CLI policy | approve or reject a tool action |
| `trust.respond` | CLI policy | trust or reject a project |
| `model.list` | CLI model adapter | model picker |
| `auth.status` | CLI auth service | connection/profile state |
| `command.list` | CLI command registry | discover safe desktop commands |
| `command.execute` | CLI command executor | run a catalogued command |
| `command.cancel` | CLI command executor | cancel a command |
| `shutdown` | CLI protocol | graceful child-process shutdown |
Current events include `turn.started`, `assistant.delta`, `turn.completed`,
`turn.failed`, `turn.cancelled`, `tool.started`, `tool.completed`,
`approval.requested`, `trust.requested`, `file.changed`, `context.compacted`,
`usage.updated`, `command.started`, `command.output`, command activity events,
`command.completed`, `command.failed`, and `command.cancelled`.
The desktop must consume these events as a discriminated union and preserve
ordering per process. It must not parse human-readable CLI output as a protocol.
### Reusable product assets
The desktop may reuse the LotaGate brand assets from
`client/public/logo/branding/`, especially `lota-app-icon.png` and the full logo.
The desktop must recreate only the UI primitives it needs, using the visual
tokens and accessibility conventions found in `client/src/components/common/`
and `client/src/styles/globals.css`; it must not import Next.js components,
server actions, or client route modules.

### Existing user API and authentication trace
The server and web client already provide the authentication contract that the
desktop must consume without changing it:

- `server/src/main.ts` enables credentialed CORS from configured web origins.
- `server/src/modules/auth/auth.controller.ts` owns the existing login,
  session, crypto-session, profile, and other auth routes. Desktop selects only
  the normal password-login contract from that surface.
- `server/src/modules/auth/auth-cookie.util.ts` sets the HttpOnly access and
  refresh cookies used by the authenticated session.
- `server/src/common/guards/csrf-protection.guard.ts` validates trusted origins
  and CSRF tokens for unsafe authenticated requests, with a dedicated login
  origin check.
- `client/src/services/auth.service.ts` already describes the web auth calls.
- `client/src/services/api-client.ts` already implements credentials, refresh,
  CSRF headers, encrypted request/response handling, and retry preparation.
- `client/src/lib/api-crypto.ts` is the existing reference implementation for
  the production API crypto protocol. Desktop must reproduce the protocol
  behavior at its own transport boundary; it must not weaken or bypass it.
- `client/src/types/user.types.ts` already models the profile, organizations,
  workspaces, roles, and permissions needed by the desktop sidebar.

The desktop user API allowlist is deliberately narrow:

| Server capability | Allowed desktop use | Boundary |
| --- | --- | --- |
| `POST /auth/crypto-session` | Establish the API crypto session | Main-process API transport |
| `POST /auth/login` | Password login | Dedicated login screen |
| `POST /auth/refresh-token` | Refresh the authenticated session | Main-process auth manager |
| `POST /auth/logout` | End the session after user confirmation | Logout confirmation modal |
| `GET /auth/me` | Load the current user profile | Main-process auth manager |
| `GET /users/profile` | Read the user's own profile when needed | Account settings |
| `PUT /users/profile` | Update the user's own profile only if explicitly designed | Account settings |
| `PUT /users/change-password` | Change the user's own password only if explicitly designed | Account security |
| `GET /organizations` | Load organizations the current user belongs to | Workspace picker |
| `GET /organizations/:organizationCode` | Load the selected organization | Workspace context |
| `GET /organizations/:organizationCode/workspaces` | Load permitted workspaces | Workspace picker |
| `GET /organizations/:organizationCode/workspaces/:workspaceCode/models` | Read workspace model policy when required | Model/context display |

The allowlist does not include `/admin/**`, admin services, admin users,
provider management, billing administration, queue administration, site
settings administration, or any route whose authorization is intended for
administrators. Agent execution, tools, files, Git, approvals, trust, sessions,
and task history remain CLI/desktop responsibilities rather than server-admin
responsibilities.

### Desktop API transport and CORS boundary
The renderer must not call the server directly from a packaged `file://` or
custom Electron origin. The transport topology is:

```text
React renderer
  → narrow typed preload IPC
  → Electron main-process ApiTransport
  → HTTPS API server
  → HttpOnly cookies + decrypted UserProfile projection
```

The main process uses Electron's native network stack and a dedicated persistent
session/cookie store, so browser CORS enforcement does not apply to the native
request. It must still honor the server's existing CSRF origin policy; the
desktop transport must use a registered trusted application origin or an
explicitly approved native-client policy. It must never disable web security,
allow wildcard credentialed CORS, accept an arbitrary `file://`/`null` origin,
or expose raw cookies to the renderer.

The desktop transport must match the web client's production crypto behavior:

- Bootstrap with ECDH P-256 using `POST /auth/crypto-session`.
- Derive request and response keys with HKDF-SHA-256 and the existing protocol
  info labels.
- Encrypt JSON bodies with AES-256-GCM and preserve the existing envelope,
  version, algorithm, key id, timestamp, sequence, and request id fields.
- Preserve the existing `x-lg-crypto-kid`, `x-lg-crypto-ts`,
  `x-lg-crypto-seq`, and `x-lg-crypto-rid` headers.
- Decrypt response envelopes and validate key id, timestamp, sequence, request
  id, and authenticated data before exposing payloads to application code.
- Rotate/rebootstrap according to the same expiration and request-count rules
  as the web client, and reset the crypto session after refresh or logout.
- Keep password, access token, refresh token, crypto keys, and cookie values in
  the main-process boundary or OS-protected storage only; never log them.

No server change is permitted to make the desktop transport easier. If the
existing CSRF/native-origin interaction cannot be satisfied without changing
server behavior, stop and request an explicit design decision rather than
weakening the server or silently adding a new auth contract.
## 3. Product research synthesis
The benchmark is not an editor feature checklist. It is an Agent Workspace
feature model.
### Codex desktop patterns to adopt
- Command-center view for multiple coding agents in parallel.
- Long-running and background tasks with visible progress and decisions.
- Isolated worktrees and reviewable diffs that can be edited, discarded, or
  turned into a pull request.
- Local CLI, desktop, and IDE workflow continuity.
- Reusable skills and automations.
- Workspace-scoped permissions, approvals, sandboxing, and explicit sensitive
  action review.
- Task retry, failure recovery, terminal output, diffs, screenshots, and test
  results as first-class task context.
### Cursor patterns to adopt
- Agents Window as the primary multi-task surface.
- Parallel asynchronous agents with one isolated worktree per task.
- Plan, implement, debug, review, and verify as visible task states.
- Rules, skills, plugins, MCP, hooks, and integrations as configurable
  extensions rather than hardcoded UI behavior.
- Explicit execution modes: allowlist, review, and fully autonomous modes.
- Git-native review, apply, discard, commit, and pull-request actions.
- Multi-root workspace support for related repositories.
### Antigravity patterns to adopt
- Agent Manager rather than an editor-first home screen.
- Agents operate across workspace files, terminal, and browser surfaces.
- Parallel local agents across multiple workspaces.
- Tasks and artifacts as the durable communication unit.
- Verification and transparency: plans, diffs, architecture diagrams, images,
  browser recordings, terminal evidence, and test results.
### Feature conclusion
The desktop must be a task orchestration product with conversation as the main
surface. Workspace files, Git changes, terminal actions, approvals, artifacts,
browser evidence, and agent progress are task context panels—not a full IDE.
## 4. Architecture decision
### Chosen stack
- Runtime: Electron, latest stable release pinned exactly at implementation
  time.
- UI: React with TypeScript and strict compiler settings.
- Build: Vite through the Electron ecosystem's Vite integration.
- Electron development build contract: the CommonJS main entry in
  `package.json` is `.vite/build/index.js`; electron-vite must emit both the
  main bundle and `bridge.js` preload bundle into `.vite/build`. The preload
  build must preserve the main bundle (`emptyOutDir: false`), while the
  renderer continues to use `ELECTRON_RENDERER_URL` for HMR and the packaged
  renderer remains under `out/renderer`.
- Package manager: npm, matching the repository and external package metadata.
- Runtime configuration: the desktop-owned `.env` file is loaded by Node's
  native `process.loadEnvFile`; it contains only public API endpoints, while
  credentials and session material remain runtime/user-owned. Forge copies the
  same non-secret `.env` into packaged resources.
- Packaging: Electron Forge with platform makers and signed release artifacts;
  use the repository's release infrastructure when it is introduced.
- State: Zustand for UI/session presentation state. Do not store the source of
  truth for agent sessions in the renderer.
- Runtime validation: Zod for desktop-owned IPC and persisted settings. The
  JSONL protocol remains validated by the CLI boundary.
- Markdown: `react-markdown` with `remark-gfm`, rendered with a safe allowlist
  and no arbitrary HTML execution.
- Icons: `lucide-react`, consistent with the existing client UI.
- Tests: Vitest for pure modules and protocol adapters, Testing Library for
  renderer behavior, Playwright for Electron E2E, and process-level fixtures for
  the real CLI child process.
- Git: native Git executable through a desktop-owned, argument-array adapter;
  no arbitrary shell string construction.
### Why Electron instead of Tauri
Electron aligns with the existing Node.js 22 and TypeScript CLI, can supervise
the CLI process directly, and provides mature window, tray, notification,
utility-process, packaging, and cross-platform behavior. Tauri could reduce
binary size, but it would introduce a Rust host boundary around a TypeScript
runtime without solving a current product requirement. The decision should be
revisited only after a measured performance or distribution problem.
### Architecture style
Use a modular monolith with ports and adapters:
- Domain rules live in the owning desktop module.
- Application services orchestrate use cases.
- Infrastructure adapters own Electron, process, Git, filesystem, secure store,
  browser, and update APIs.
- React components render state and dispatch typed commands.
- Renderer never imports Electron or Node APIs.
- Main process never contains React rendering logic.
- CLI remains the authority for agent execution and policy.
## 5. Target folder structure
```text
desktop/
├─ PLAN.md
├─ package.json
├─ package-lock.json
├─ tsconfig.json
├─ vite.config.ts
├─ forge.config.ts
├─ resources/
│  ├─ icons/
│  └─ entitlements/
├─ src/
│  ├─ main/
│  │  ├─ bootstrap/
│  │  ├─ lifecycle/
│  │  ├─ windows/
│  │  ├─ ipc/
│  │  ├─ agents/
│  │  ├─ workspaces/
│  │  ├─ git/
│  │  ├─ browser/
│  │  ├─ security/
│  │  ├─ storage/
│  │  ├─ updater/
│  │  └─ observability/
│  ├─ preload/
│  │  ├─ bridge.ts
│  │  └─ bridge-contract.ts
│  ├─ renderer/
│  │  ├─ app/
│  │  ├─ routes/
│  │  ├─ features/
│  │  │  ├─ agent-manager/
│  │  │  ├─ workspace-picker/
│  │  │  ├─ task-detail/
│  │  │  ├─ conversation/
│  │  │  ├─ composer/
│  │  │  ├─ activity-timeline/
│  │  │  ├─ approvals/
│  │  │  ├─ diff-review/
│  │  │  ├─ terminal-evidence/
│  │  │  ├─ artifacts/
│  │  │  ├─ browser-evidence/
│  │  │  ├─ models/
│  │  │  ├─ auth/
│  │  │  ├─ automations/
│  │  │  └─ settings/
│  │  ├─ components/
│  │  │  ├─ primitives/
│  │  │  │  ├─ button/
│  │  │  │  ├─ label/
│  │  │  │  ├─ input/
│  │  │  │  ├─ checkbox/
│  │  │  │  ├─ radio/
│  │  │  │  ├─ tooltip/
│  │  │  │  ├─ modal/
│  │  │  │  ├─ textarea/
│  │  │  │  ├─ dropdown/
│  │  │  │  ├─ avatar/
│  │  │  │  ├─ card/
│  │  │  │  ├─ loading/
│  │  │  │  └─ table/
│  │  │  ├─ layout/
│  │  │  ├─ feedback/
│  │  │  └─ data-display/
│  │  ├─ stores/
│  │  ├─ hooks/
│  │  └─ styles/
│  ├─ contracts/
│  │  ├─ agent-protocol/v1/
│  │  ├─ ipc/v1/
│  │  ├─ tasks/v1/
│  │  └─ artifacts/v1/
│  ├─ application/
│  │  ├─ tasks/
│  │  ├─ workspaces/
│  │  ├─ approvals/
│  │  ├─ changes/
│  │  ├─ artifacts/
│  │  ├─ automations/
│  │  └─ settings/
│  ├─ domain/
│  │  ├─ task/
│  │  ├─ workspace/
│  │  ├─ change-set/
│  │  ├─ artifact/
│  │  ├─ approval/
│  │  └─ execution-policy/
│  └─ infrastructure/
│     ├─ electron/
│     ├─ process/
│     ├─ filesystem/
│     ├─ git/
│     ├─ secure-store/
│     ├─ browser/
│     ├─ updates/
│     └─ telemetry/
├─ tests/
│  ├─ unit/
│  ├─ component/
│  ├─ contract/
│  ├─ integration/
│  ├─ e2e/
│  ├─ fixtures/
│  └─ security/
└─ scripts/
   ├─ resolve-cli.ts
   ├─ verify-package.ts
   └─ release-check.ts
```
No file may become a global dumping ground. Each folder has one owner and a
single direction of dependency.
## 6. Runtime topology and lifecycle
### Process topology
```text
Electron main
├─ Window manager
├─ IPC controller
├─ Agent runtime pool
│  ├─ workspace agent process A: lotagate agent desktop
│  ├─ workspace agent process B: lotagate agent desktop
│  └─ worktree agent process N: lotagate agent desktop
├─ Git/worktree service
├─ API auth/session service
│  ├─ encrypted user API transport
│  ├─ Electron cookie/session store
│  └─ profile and organization projection
├─ Browser session service
├─ Secure settings service
└─ Update and diagnostics service
Renderer
└─ Agent Manager + task detail windows/views
```
One CLI process is started per active workspace execution context. A worktree
task receives its worktree as `cwd`; this keeps the existing CLI protocol honest
because the current `runDesktopAgentCommand()` binds a process to one cwd.
### Startup
1. Electron validates the packaged resource layout and application version.
2. The main process initializes the dedicated API session and loads non-secret
   settings without exposing credentials to the renderer.
3. If no valid API session exists, the renderer enters the standalone `/login`
   screen. The app must not start agent processes or show the workspace shell
   until authentication succeeds.
4. `/login` submits the username/email and password to the existing server
   endpoint `POST /auth/login`. Desktop has no additional-auth screen or
   secondary login flow. If the unchanged server reports that the account
   requires an unsupported additional challenge, desktop stops the login
   transition and shows a clear account-security message instead of guessing
   or bypassing it. On normal success, main calls `/auth/me`, validates the
   response, and publishes a redacted `UserProfile` projection through typed
   IPC.
5. The renderer transitions to the Agent Workspace shell and displays the
   authenticated user's name, avatar, email, organization, and workspace in
   the bottom account area.
6. The workspace registry restores recent projects without starting agents.
7. A task starts an `AgentProcess` using a platform-safe resolver for the
   executable installed by the npm `@lotagate/cli` dependency.
8. Main sends `initialize` and verifies protocol/version/capabilities.
9. Main creates or resumes a session and publishes connection state to renderer.

### Authentication and logout user flows
- Login is a dedicated `/login` Codex-like screen, not a browser page embedded
  inside the task shell. It includes username/email, password, submit,
  validation, loading, invalid-credential, unverified-account, rate-limit, and
  server-error states. There is no secondary authentication UI or desktop
  additional-auth flow.
- A successful login is followed by `/auth/me`; the renderer receives only the
  typed profile projection needed for display and authorization-aware UI.
- Session refresh happens in main before an authenticated request is retried.
  A refresh failure clears the local projection and returns the renderer to the
  Login screen with a non-sensitive explanation.
- Selecting the bottom account control opens account actions. Selecting
  `Sign out` first opens a confirmation modal; it must state that active agent
  tasks may continue or be stopped according to the selected policy.
- Confirmed logout cancels or detaches desktop-owned API work as configured,
  calls the existing `/auth/logout`, clears the Electron auth session and
  crypto state, stops or safely detaches agent processes according to their
  explicit lifecycle policy, clears the renderer profile, and returns to Login.
- Dismissed logout leaves every session and task state unchanged.
- No logout or account action is placed in the primary sidebar navigation.
### Turn execution
1. Renderer dispatches a typed `task.turn.start` intent.
2. Main validates workspace ownership, active task state, and request limits.
3. The JSONL client sends `turn.start` with a correlation id.
4. Main persists a local task activity envelope before displaying optimistic UI.
5. Events are validated, ordered, stored in the task event store, and projected
   into renderer state.
6. Approval, trust, cancel, retry, and reconnect actions return through main.
7. Completion closes the turn, records usage and evidence, and updates Git state.
### Crash and recovery
- Detect child exit, protocol parse failure, broken pipe, timeout, and malformed
  events as distinct failure classes.
- Keep the last valid event cursor and task state in desktop local storage.
- Never fabricate a completed response after a process crash.
- Offer resume when the CLI session is still recoverable; otherwise show an
  explicit interrupted state and preserve evidence.
- Bound restart attempts with configurable backoff and a user-visible reason.
## 7. Complete Agent Workspace feature scope
### Workspace and project management
- Open, add, remove, rename, and reorder local workspaces.
- Support multi-root projects without conflating project identity.
- Detect Git root, branch, dirty state, worktrees, conflicts, and repository
  health.
- Persist workspace metadata outside the repository using an OS-specific app
  data directory.
- Display project trust status and the exact path that requires approval.
- Support workspace instructions, project rules, skills, plugins, and MCP
  discovery through the existing CLI command/runtime surface.
### Agent Manager
- List active, queued, completed, failed, cancelled, and paused tasks.
- Run multiple tasks in parallel across workspaces and worktrees.
- Show task name, model, workspace, branch/worktree, elapsed time, status,
  current activity, approvals waiting, and changed-file count.
- Pin, archive, rename, duplicate, retry, cancel, and resume tasks.
- Open a task in a focused detail view without losing manager context.
- Keep per-task event streams and avoid cross-task state contamination.
### Conversation and composer
- Streaming assistant response with markdown, GFM, code blocks, and safe links.
- Prompt draft persistence and recovery after renderer reload.
- File, folder, image, audio, and video attachments where the CLI contract
  already supports the corresponding command or input.
- Workspace-relative file references and explicit path display.
- Model selection, execution mode, approval mode, and task target selection.
- Slash/command palette backed by `command.list`; no duplicated command catalog.
- Approval requests are rendered inline in the composer, in the same interaction
  area where the user is deciding whether to continue. The composer may expand
  to show risk, tool, target, consequence, and `Approve`/`Deny` actions, but the
  approval is not a primary sidebar item and not a permanent dashboard panel.
- The inline approval component maps exactly to `approval.requested` and
  `approval.respond`; it never grants permission merely because the composer
  is visible.
- Keyboard shortcuts, IME-safe composition, accessible focus management, and
  clear empty/loading/error states.
### Agent activity and transparency
- Timeline entries for planning, reasoning summary, tool start/completion,
  command output, file changes, context compaction, usage, errors, and final
  answer.
- Collapsible tool details with command, arguments, affected paths, duration,
  exit status, and approval decision.
- Separate user-visible summary from raw diagnostic logs.
- Live progress, last successful action, waiting reason, and next required user
  decision.
- Exportable task transcript and evidence bundle with secret redaction.
### Approval, trust, and execution policy
- Project trust prompt before a task can use trusted project extensions/tools.
- Tool approval dialog with risk, tool name, display name, exact target, and
  consequence.
- Approve once, approve for the session, remember by policy rule, or reject.
- Explicit modes for ask, allowlist, review, and autonomous execution.
- Workspace path boundary and optional network policy visible in settings.
- Never rely on UI hiding; CLI remains the server-side authorization boundary.
- Audit every approval and denial with task, workspace, tool, rule, and reason.
### Git, worktrees, and changes
- Detect branch, status, staged/unstaged/untracked files, conflicts, and hooks.
- Create and delete isolated worktrees safely with validated repository paths.
- Select a branch/worktree before starting an agent task.
- Display file-level and hunk-level diffs with syntax highlighting.
- Review, accept, reject, restore, stage, unstage, commit, branch, and apply
  changes with explicit confirmation for destructive operations.
- Show binary changes and generated artifacts without pretending they are text.
- Provide patch export and pull-request handoff integration points.
- Never run Git commands from renderer and never concatenate shell commands.
### Terminal and command evidence
- Render `command.output` and command activity events in an ANSI-safe terminal
  surface.
- Show command input, cwd, environment policy, duration, exit code, and output
  truncation state.
- Link terminal output to the task timeline and changed files.
- Provide a user-owned terminal surface only through a dedicated main-process
  adapter; agent command execution remains governed by CLI.
### Artifacts and verification
- Treat markdown plans, reports, diagrams, images, screenshots, browser
  recordings, patches, logs, test results, and generated files as typed artifacts.
- Attach artifacts to a task, action, or verification run.
- Provide preview, open-in-system-app, copy path, download/export, and delete
  with clear ownership and recovery behavior.
- Record verification command, cwd, result, duration, and relevant output.
- Allow an agent to summarize evidence without replacing the underlying file or
  raw result.
### Extensions and knowledge
- Surface CLI-owned skills, plugins, hooks, MCP servers, and workspace rules.
- Provide enable/disable/configure views that invoke existing CLI commands.
- Show capability origin: built-in, project, user, or external integration.
- Validate manifests and scope before enabling an extension.
- Keep extension UI generic; do not hardcode one provider or one MCP server.
### Browser workspace
- Provide an isolated browser surface for agent verification and user review.
- Show URL, navigation state, screenshots, console/error evidence, and captured
  recordings as task artifacts.
- Gate navigation, downloads, clipboard, credentials, and full CDP access with
  explicit policy and approvals.
- Keep browser content isolated from the renderer and never expose Electron APIs
  to remote pages.
- Browser control is desktop-owned. Do not move browser implementation into
  `sdk`, `agent-sdk`, or `cli` without the approval procedure in section 9.
### Models, auth, and account
- Display the authenticated server profile, base URL, credential reference, and
  connection status without exposing secrets.
- Populate models through `model.list`; do not hardcode model identifiers.
- Show model capabilities only when provided by the contract.
- Support server user sign-in through the existing user auth API and support
  local agent connection through the existing CLI `auth.status` contract. These
  are separate states and must not be conflated.
- Show the current server user at the bottom of the sidebar using `/auth/me`.
- Do not call or render admin APIs, admin navigation, or admin-only profile data.
- Surface rate limits, usage, insufficient balance, and retryable errors safely.
### Automation and integrations
- Schedule or trigger tasks using a desktop-owned automation registry.
- Persist trigger, workspace, prompt, execution mode, and approval policy.
- Show next run, last run, failure, pause, and manual-run controls.
- Add integration adapters for GitHub, GitLab, Slack, Linear, and similar
  services only behind explicit capability and credential boundaries.
- Keep cloud/background execution separate from the local JSONL process model.
### Desktop operations
- Tray/menu-bar presence, notifications, deep links, single-instance locking,
  safe shutdown, crash reporting, diagnostics export, and update checks.
- Native application menus must provide File, Edit, View, Window, and Help
  groups. File commands dispatch through typed preload IPC for New Task, Open
  Workspace, Settings, and Exit; renderer features remain the owners of the
  corresponding state changes.
- Settings for appearance, language, keybindings, default model, execution
  policy, storage, network, notifications, and telemetry.
- Accessibility: keyboard navigation, screen-reader labels, focus traps,
  reduced motion, color contrast, and visible error announcements.
- Internationalization with message keys, not repeated literal UI strings.
### UI foundation and brand system
The visual language follows the existing CLI theme and the supplied Codex-like
reference: conversation-first, quiet, flat, spacious, and task-oriented. The
desktop must not introduce a separate colorful dashboard theme.

The initial semantic token source is the CLI dark theme in
`cli/src/presentation/themes/theme.ts`:

| Token | Value | Use |
| --- | --- | --- |
| `background` | `#10151c` | App background |
| `surface` | `#171e27` | Sidebar, composer, ordinary surfaces |
| `surfaceRaised` | `#202a36` | Menus, focused cards, elevated controls |
| `text` | `#e6edf3` | Primary text |
| `muted` | `#8b949e` | Secondary text and metadata |
| `accent` | `#5ba7d8` | Focus, active controls, links, primary action |
| `border` | `#3b424b` | Dividers and control borders |
| `selection` | `#2a3a4d` | Selected task/workspace state |
| `warning` | `#d6b574` | Approval and caution state |
| `user` | `#1b2b3d` | User message surface |
| `success` | `#86c991` | Completed/connected state |
| `error` | `#e06c75` | Failure/destructive state |
| `diffAdded` / `diffRemoved` | `#173323` / `#3a2028` | Diff context |
| `code` / `link` | `#d6b574` / `#75b7e7` | Code and safe links |

The reusable component library is desktop-owned and accessible. It must be
token-driven, keyboard-testable, composable, and independent of Next.js:

- Form primitives: `Button`, `Label`, `Input`, `Textarea`, `Checkbox`,
  `Radio`, `Dropdown`, `Select`, and field/error helpers.
- Overlay primitives: `Modal`, confirmation modal, `Tooltip`, popover, command
  palette, focus trap, escape handling, and outside-click policy.
- Display primitives: `Avatar`, `Card`, `Badge`, `Divider`, `EmptyState`,
  `Loading`, skeleton, spinner, `Table`, `Tabs`, and status indicators.
- Workspace primitives: sidebar item, task row, workspace selector, composer,
  inline approval block, activity entry, artifact preview, diff row, and
  account menu.

Each primitive has one semantic owner, typed variants instead of arbitrary
style strings, loading/empty/error states where applicable, focus-visible
behavior, reduced-motion behavior, and component tests. Feature components
compose primitives; they do not duplicate input, modal, approval, or loading
logic. No single executable component or test file may exceed 600 lines.

## 8. Desktop-owned module responsibilities
| Module | Owns | Must not own |
| --- | --- | --- |
| Agent manager | task list, process assignment, task state projection | model calls or tool policy |
| JSONL client | framing, correlation, event validation, backpressure | agent business rules |
| Runtime pool | child process lifecycle and cwd binding | transcript rendering |
| Workspace registry | local projects, roots, trust presentation | CLI trust decisions |
| Git adapter | safe Git/worktree/diff operations | arbitrary shell execution |
| Change review | diff presentation and user decisions | rewriting CLI file-change rules |
| Artifact store | desktop evidence metadata and previews | model/session journal truth |
| Browser service | isolated browser window/session and evidence | remote page trust assumptions |
| Approval UI | explain and submit decisions | granting authorization locally |
| API auth/session service | user login, refresh, logout, encrypted transport, profile projection | server auth rules, admin data, raw credential exposure |
| UI component system | accessible tokens and reusable primitives | feature business state and API calls |
| Secure store | OS-protected secrets/references | plaintext token logging |
| Renderer stores | view state and projections | durable agent truth |
## 9. External package boundary policy
### `@lotagate/sdk`
Desktop may use it only through an explicit desktop integration need. It must
not receive Electron types, window concepts, task state, Git, browser, or UI.
### `@lotagate/agent-sdk`
It remains provider-neutral and reusable. Desktop must not add renderer APIs,
Electron lifecycle, worktrees, approval dialogs, or desktop persistence to it.
### `@lotagate/cli`
Desktop treats `@lotagate/cli` as an independent npm package and uses its
installed executable through the `lotagate agent desktop` JSONL protocol. The
CLI-owned policy, sessions, tools, commands, logging, and persistence remain
behind that boundary; desktop does not copy their implementation. The package
binary is unpacked from Electron asar for process execution.
### Required approval before package changes
Before any package change, record:
1. The missing behavior and why desktop-owned code is insufficient.
2. A CLI-owned alternative and a desktop-owned alternative.
3. Independent-package user impact and whether the API remains useful alone.
4. Runtime, bundle, security, versioning, and README impact.
5. Tests for both the package and desktop integration.
6. Explicit owner approval.
If approved, update the package version exactly once at the end of the change,
update the affected README, rebuild the package, run package tests, and run the
desktop contract test against the new version. No package change is permitted
as an incidental convenience.
## 10. Protocol plan
### Keep current commands unchanged
The first implementation must consume the existing methods exactly as exposed:
```text
initialize
session.create
session.list
session.resume
turn.start
turn.cancel
approval.respond
trust.respond
model.list
auth.status
command.list
command.execute
command.cancel
shutdown
```
The desktop must not create an alternate request format for the same behavior.
### Desktop protocol adapter requirements
- Use a request id registry with typed pending promises.
- Validate every response and event at runtime.
- Preserve event order per agent process.
- Bound line size, output size, pending requests, and event buffer size using
  configured limits.
- Apply backpressure when the renderer is unavailable or hidden.
- Abort pending requests when a task or process is cancelled.
- Reject duplicate ids and unknown response ids with diagnostic errors.
- Store protocol version and capabilities in connection state.
- Distinguish protocol errors, CLI errors, child-process errors, and UI errors.
- Never expose raw provider failures or secrets to the renderer.
### Protocol gaps requiring explicit design approval
The current CLI protocol does not itself expose all desktop-product concepts,
including worktree lifecycle, browser control, artifact indexing, automation
scheduling, Git review actions, and multi-process task management. These remain
desktop-owned services initially. If the Agent must invoke a desktop-owned
browser or automation tool inside the CLI agent loop, a host-tool bridge may be
needed; that is a package-boundary decision and requires owner approval before
changing CLI, Agent SDK, or SDK.
## 11. Security and reliability baseline
- Electron renderer: `nodeIntegration: false`, `contextIsolation: true`,
  sandbox enabled, restrictive CSP, no arbitrary remote code.
- Preload exposes narrow typed functions, never raw `ipcRenderer`.
- Main validates every IPC sender and payload.
- Remote browser content gets a separate session and no privileged APIs.
- Workspace access is explicit, path-normalized, and bounded.
- Git and process adapters use argument arrays, not shell interpolation.
- Credentials use OS secure storage; logs use redaction policies.
- Server user auth is performed only through the approved user API allowlist.
  Admin endpoints and admin permissions are structurally unavailable to the
  desktop API client.
- Password entry exists only on the login screen and is sent through the
  main-process encrypted transport; it is never persisted in renderer state.
- Access/refresh cookies remain HttpOnly inside the dedicated Electron session;
  profile data is the only auth result exposed over preload IPC.
- Logout confirmation is required for an explicit user sign-out and clears
  server session, cookie, crypto, and renderer profile state after success.
- API crypto envelope validation, CSRF headers, trusted-origin checks, refresh
  retry, and key rotation are tested as security boundaries, not treated as UI
  implementation details.
- All child processes receive bounded environment and explicit cwd.
- Timeouts, cancellation, restart backoff, output limits, and graceful shutdown
  are configured centrally.
- Crash recovery never converts partial work into a success state.
- Telemetry is opt-in/configurable and excludes prompts, source, secrets, and
  private file content by default.
- Destructive actions require an explicit confirmation and are auditable.
## 12. Testing and verification matrix
### Unit tests
- JSONL framing, correlation, limits, backpressure, cancellation, and malformed
  event handling.
- API crypto key derivation, envelope construction, authenticated-data
  validation, response decryption, sequence handling, rotation, and reset.
- Native API transport cookie isolation, CSRF header propagation, trusted-origin
  handling, refresh retry, logout cleanup, and redacted error mapping.
- User API allowlist rejects every admin route before a network request is made.
- Agent state reducer and event projection.
- Task lifecycle and concurrent-task isolation.
- Workspace path validation and trust presentation.
- Git argument construction, status parsing, diff parsing, and worktree rules.
- Approval presentation and retry/error classification.
- Artifact metadata and redaction.
- Settings schema and migration-free initialization.
### Contract tests
- Run a real CLI fixture with `lotagate agent desktop`.
- Verify initialize capabilities and protocol version.
- Create/list/resume a session.
- Start, stream, cancel, fail, and complete a turn.
- Exercise approval and trust round trips.
- Exercise command catalog, output, activity, completion, and cancellation.
- Verify unknown events, oversized lines, child exit, and broken pipes.
### Renderer and E2E tests
- Cold start without a valid server session opens `/login` and does not start a
  CLI process; successful normal password login transitions to the workspace
  shell.
- `/auth/me` profile projection renders the correct name, avatar, email,
  organization, and workspace at the bottom of the sidebar without secrets.
- Logout opens a confirmation modal, cancel leaves state unchanged, and confirm
  clears the server session and returns to Login.
- Login validation, loading, invalid credentials, unverified account,
  unsupported additional-auth response, expired session, refresh failure, API
  crypto failure, and server outage states are rendered safely.
- Component tests cover Button, Label, Input, Checkbox, Radio, Tooltip, Modal,
  Textarea, Dropdown, Avatar, Card, Loading, Table, composer, and inline
  approval states with keyboard and screen-reader behavior.
- Agent Manager with multiple tasks and independent event streams.
- Workspace selection, task creation, resume, retry, cancel, archive, and
  restart.
- Transcript streaming, markdown safety, attachments, and long-history scroll.
- Approval/trust flows and keyboard/screen-reader behavior.
- Diff review and destructive Git confirmation.
- Artifact preview/export and verification evidence.
- Browser isolation and permission prompts.
- Tray, notifications, deep links, single-instance behavior, and shutdown.
### Release verification
- Verify no desktop build artifact contains server source, admin API routes,
  password values, cookie values, API crypto keys, or raw auth responses.
- Run a user-API allowlist audit and an authenticated API contract test against
  the unchanged server build before packaging.
- Typecheck, lint, unit, component, contract, integration, E2E, packaging, and
  installer smoke checks on Windows, macOS, and Linux targets.
- Verify executable resolution for npm-installed development and packaged CLI
  installations, including the Electron asar-unpacked binary.
- Verify code signing, update metadata, crash diagnostics, and clean uninstall.
- Run dependency audit and inspect Electron security warnings before release.
## 13. Completion criteria
The desktop is complete only when:
- Every capability in section 7 has a user flow, owner module, contract, test,
  error state, loading state, empty state, and security decision.
- No feature duplicates a current CLI source of truth.
- No executable logic or test file exceeds 600 lines. Documentation, plans,
  configuration, schemas, migrations, generated output, fixtures, snapshots,
  lockfiles, and assets are exempt from this code-file limit.
- The desktop can run multiple isolated tasks without cross-talk.
- A crashed CLI process is recoverable without false completion.
- Approval and trust remain enforced by CLI and auditable in desktop.
- Cold start routes unauthenticated users to the dedicated Login screen;
  authenticated users enter the workspace shell with a server-backed profile.
- Logout requires confirmation and reliably clears server session, Electron
  cookies, API crypto state, local profile projection, and agent connection
  state according to the documented lifecycle policy.
- API calls are limited to the documented user allowlist; no admin API is
  reachable through the desktop transport.
- The desktop API transport matches the client API crypto contract and passes
  encrypted request/response, cookie, CSRF, refresh, and logout tests.
- `server/` has no source, configuration, schema, migration, or contract diff
  as a result of desktop implementation.
- Git changes are reviewable before apply/commit/PR operations.
- Artifacts and verification evidence remain available after the task finishes.
- The package boundary audit is complete and no unapproved external-package
  changes exist.
- All documented verification commands pass, or failures are explicitly
  recorded with their cause and ownership.
## 14. References
- OpenAI Help Center, Codex app and local/cloud workflow: https://help.openai.com/en/articles/11369540-use-the-codex-app-for-enabling-multiple-codex-agents-in-parallel
- OpenAI release notes, Codex desktop capabilities: https://help.openai.com/en/articles/6825453-chatgpt-release-notes
- Cursor documentation: https://cursor.com/docs
- Cursor worktrees: https://cursor.com/docs/configuration/worktrees
- Cursor run modes and sandboxing: https://cursor.com/docs/agent/security/run-modes
- Google Antigravity overview: https://antigravity.google/docs/ide/overview/
- Electron process model: https://www.electronjs.org/docs/latest/tutorial/process-model
- Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security
- Electron context isolation: https://www.electronjs.org/docs/latest/tutorial/context-isolation
- Vite guide: https://vite.dev/guide/
