# LotaGate Desktop Agent Workspace

Dedicated Electron workspace for local LotaGate agents. It is not an editor
fork and does not modify `server/`, `sdk/`, `agent-sdk/`, or `cli/`.

## Requirements

- Node.js 22+
- npm
- The `@lotagate/cli` package installed through `npm install`; desktop resolves
  its packaged executable and does not depend on a system `PATH` entry.
- The checked-in `.env` runtime configuration for the LotaGate production API.
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

## UI architecture

The renderer uses a code-owned component system based on Radix Primitives,
Tailwind CSS v4, and CSS variables. Shared controls live in
`src/renderer/components/ui.tsx`; feature components own layout and data flow,
while `src/renderer/styles/ui.css` owns shared visual primitives and
`src/renderer/styles/theme.css` plus `feature-layout.css` own application
tokens and feature layout. Do not move business logic, API calls, IPC calls,
or data mapping into shared UI components.

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

`npm run make` creates Windows Squirrel and ZIP artifacts under `out/make`.
Linux and macOS makers require their respective native build environments.

The Electron main/preload bundle uses the CommonJS output emitted by the
current electron-vite integration; the renderer remains Vite-managed.

## Boundaries

- API calls run in Electron main through the native network stack and typed
  preload IPC; the renderer never receives cookies, tokens, or crypto keys.
- Only the allowlisted user routes are available. `/admin/**` is rejected
  before a network request.
- CLI JSONL is consumed as a versioned protocol; human-readable CLI output is
  never parsed.
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
  exempt as documented in `PLAN.md`.

See [PLAN.md](./PLAN.md) for architecture and [TASK.md](./TASK.md) for the
implementation register and verification audit.
