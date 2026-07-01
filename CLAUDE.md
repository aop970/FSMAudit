# FSM Invoice Audit — CLAUDE.md

React + TypeScript + Vite SPA for auditing FSM invoices. Audit logic runs entirely in the browser. As of 2026-07-01 (T-491) there is also an optional **eval-persistence API** (`server/`, Node/Express + Neon) deployed as a second Railway service — it stores audit runs and finding labels for building the eval ground-truth set. The SPA works without it (degrades gracefully); the API never sees raw file bytes, only structured findings.

## Tech Stack

- React 19, TypeScript ~6, Vite 8
- Tailwind CSS 3, PostCSS
- papaparse (CSV), xlsx (Excel), react-markdown
- Node 20 (pinned — Vite 8 requires Node 20+)

## Development

```bash
npm install
npm run dev        # Vite dev server with HMR on localhost:5173
npm run build      # tsc -b && vite build  (outputs to dist/)
npm run preview    # vite preview — serves dist/ locally
npm run lint       # eslint
```

## Deployment

**Production URL:** https://blissful-flexibility-production.up.railway.app
**Custom domain:** https://fsm-audit.allanpi.dev (Cloudflare Tunnel on Pi routing to Railway — DNS does not resolve publicly from outside the tunnel; tunnel config lives on the Pi, not in this repo)

**Platform:** Railway (project: **FSM Audit** — renamed 2026-07-01 from the auto-generated name "blissful-flexibility"; service ID: 19392d1d-25df-4892-99ac-012e2a1f396e)
- ⚠️ Only the *project display name* changed. The **service name and production URL remain `blissful-flexibility-production.up.railway.app`** — that URL is load-bearing (Cloudflare tunnel origin for fsm-audit.allanpi.dev + registered Azure OAuth redirect URI), so it was deliberately left unchanged. Do not rename the service without updating the CF tunnel ingress and Azure redirect URIs in lockstep.
- Connected to GitHub repo `aop970/FSMAudit`
- **Auto-deploys on every push to `main`** (Railway GitHub integration, no GitHub Actions workflow needed)
- Builder: Dockerfile (node:20-alpine multi-stage)
- Build command (in Dockerfile): `VITE_BASE_PATH=/ npm run build`
- Start command (in Dockerfile): `serve -s dist -l ${PORT:-3000}`
- Restart policy: ON_FAILURE

**Required build-time env vars / secrets (names only):**
- `VITE_BRAGI_API_KEY` — passed as a Docker ARG and baked into the JS bundle at build time by Vite. Must be set in Railway's environment variables for production builds.

**gh-pages status: ALIVE BUT STALE (not production)**
- Branch `origin/gh-pages` exists; last pushed 2026-05-01 (commit `56695e3`)
- `main` is ahead by ~7 days (latest: 2026-05-08)
- gh-pages was used as an earlier deploy target; Railway is now the authoritative production platform
- The `vite.config.ts` base path defaults to `/FSMAudit/` (for gh-pages) and overrides to `/` via `VITE_BASE_PATH=/` in the Dockerfile for Railway

**Known gotchas:**
- Node 20 is required — Vite 8 dropped support for older Node versions. nixpacks.toml pins `nodejs_20` as a fallback; Dockerfile uses `node:20-alpine`.
- `VITE_BRAGI_API_KEY` is baked into the bundle — changing it requires a full redeploy (Railway triggers this automatically on push to main).
- Rolldown/native bindings: early Vite 8 builds had macOS/Linux cross-compilation issues with native binaries; resolved by switching to Dockerfile build (`railway.json` uses `builder: DOCKERFILE`).
- Port binding: Railway injects `$PORT` — the `serve` command in the Dockerfile reads `${PORT:-3000}`. Do not hardcode ports.
- No `.github/workflows/` — CI/CD is entirely Railway's GitHub integration. No manual `railway up` needed for normal deploys.

## Eval Persistence API (`server/`, added T-491, 2026-07-01)

- **Service:** `fsm-audit-api` (second service in the same Railway "FSM Audit" project) → **https://fsm-audit-api-production.up.railway.app**
- **Build:** `Dockerfile.api` (set via `RAILWAY_DOCKERFILE_PATH=Dockerfile.api` on the service). Node 20 + Express + `@neondatabase/serverless`, run with `tsx`.
- **DB:** a **separate** Neon project named `fsm-audit` (isolated from Weekly Scorecard's DB). Tables `audit_runs` + `audit_findings` (+4 indexes); migrate with `tsx server/migrate.ts` (idempotent).
- **Endpoints:** `POST/GET /api/runs`, `GET /api/runs/:id/findings`, `PATCH /api/findings/:id/label`, `POST /api/runs/:run_id/missed-finding`. Health: `GET /health`.
- **Auth:** `X-Audit-Token` header gated on `AUDIT_API_TOKEN` env var (set on both this service and the frontend).
- **Env vars:** `DATABASE_URL` (Neon), `AUDIT_API_TOKEN`, `CORS_ORIGIN` (frontend URL), `RAILWAY_DOCKERFILE_PATH`.
- **Frontend wiring:** `VITE_AUDIT_API_URL` + `VITE_AUDIT_API_TOKEN` (baked at build time — redeploy frontend to change).
- ⚠️ **Deploy caveat:** this service was deployed via `railway up` (direct upload), NOT GitHub auto-deploy — Railway's GitHub-App authorization can't be granted from the CLI. It does NOT auto-redeploy on push to `main` (the frontend still does). To enable push auto-deploy, connect the `fsm-audit-api` service to `aop970/FSMAudit` in the Railway dashboard.

## PostToolUse Hook Reasoning

There is no local backend server (no FastAPI, Express, or any Node server process running during development). The app is a purely static SPA served by Vite's dev server, which handles hot module replacement (HMR) automatically. No `pkill && restart` hook is needed or appropriate — Vite's HMR picks up file changes without a server restart. See `.claude/settings.json` for the documented N/A entry.
