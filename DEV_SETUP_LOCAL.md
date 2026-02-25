# Local Development Setup Guide

This guide is for new developers who have freshly cloned the repo and want to run the cmux (Relay) web app locally. It walks through prerequisites, environment setup, and starting the dev server.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone and Install](#2-clone-and-install)
3. [Environment Variables](#3-environment-variables)
4. [Convex: Local vs Team Cloud](#4-convex-local-vs-team-cloud)
5. [Starting the Dev Server](#5-starting-the-dev-server)
6. [What Runs and Where](#6-what-runs-and-where)
7. [Stopping and Cleanup](#7-stopping-and-cleanup)
8. [Verification](#8-verification)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Prerequisites

### Required

| Tool | Purpose | How to get it |
|------|---------|----------------|
| **Bun** | Package manager and runtime (recommended) | https://bun.sh — install then run `bun --version` |
| **Node 24+** | Used by some tooling; Bun is primary | https://nodejs.org (optional if using Bun) |
| **Git** | Clone the repo | Usually pre-installed; `git --version` |
| **Rust toolchain** | Builds the native addon used by the server | https://rustup.rs — run `rustup default stable` |

The project uses a **Rust N-API addon** in `apps/server/native/core`. The dev script runs `bunx @napi-rs/cli build --platform`, which needs Rust. Install Rust with rustup; the rest is automatic.

### Optional (depending on what you run)

| Tool | When you need it |
|------|-------------------|
| **Docker** | Required if you run **local Convex** (see §4). Needed for the Convex backend container and (later) for sandbox/worker images. |
| **nvm** or **fnm** | Used by the dev script to run `convex dev`; optional if your system Node/Bun is compatible. |

### Check your setup

```bash
bun --version    # e.g. 1.2.x
git --version
rustc --version  # e.g. 1.xx.x
# If using local Convex:
docker --version
```

---

## 2. Clone and Install

From a directory where you keep projects:

```bash
git clone <repository-url>
cd manaflow
bun install
```

`bun install` installs dependencies for the whole monorepo (apps and packages). This can take a couple of minutes.

---

## 3. Environment Variables

The app expects a **`.env` file at the repository root**. The dev script loads it automatically when you run `./scripts/dev.sh`.

### Do you have a team `.env`?

- **If yes:** Copy the file to the repo root as `.env`. Skip to §4 (Convex).
- **If no:** You need to create `.env` with at least the variables below.

### Minimum `.env` for local dev

Create a file named **`.env`** in the repo root (same folder as `package.json`). Add at least:

```env
# Convex — see §4 (use a team URL or leave blank for local setup)
NEXT_PUBLIC_CONVEX_URL=http://localhost:9777

# Stack Auth (auth and teams). Get from https://stack-auth.com → your project → API Keys / Dashboard.
NEXT_PUBLIC_STACK_PROJECT_ID=<your-stack-project-id>
NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=<your-stack-publishable-key>
STACK_SECRET_SERVER_KEY=<your-stack-secret-server-key>
STACK_SUPER_SECRET_ADMIN_KEY=<your-stack-admin-key>

# App URLs (local dev)
NEXT_PUBLIC_WWW_ORIGIN=http://localhost:9779
BASE_APP_URL=http://localhost:5173

# Required by Convex/backend — generate with: openssl rand -hex 32
STACK_WEBHOOK_SECRET=<generate-or-get-from-stack>
CMUX_TASK_RUN_JWT_SECRET=<generate-with-openssl-rand-hex-32>

# Data vault (www) — min 32 chars, e.g. openssl rand -hex 32
STACK_DATA_VAULT_SECRET=<generate-32-chars>

# GitHub App (if you need repo/PR features). From GitHub → Settings → Developer settings → GitHub Apps.
CMUX_GITHUB_APP_ID=<app-id>
CMUX_GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----"
GITHUB_APP_WEBHOOK_SECRET=<webhook-secret>

# Morph (sandboxes). Optional for basic UI; required for task runs with Morph.
# MORPH_API_KEY=<from cloud.morph.so>

# Modal (optional for some features)
# MODAL_TOKEN_ID=
# MODAL_TOKEN_SECRET=

# AI providers (optional for agents / code review)
# ANTHROPIC_API_KEY=
# OPENAI_API_KEY=
```

**Generating secrets:**

```bash
openssl rand -hex 32   # use for CMUX_TASK_RUN_JWT_SECRET, STACK_DATA_VAULT_SECRET
```

**Important:** Do not commit `.env`. It is in `.gitignore`.

### Where these are used

- **Root `.env`** is sourced by `./scripts/dev.sh`, so **www**, **client**, and **server** all see these variables in local dev.
- **Convex** gets its config from `packages/convex/.env.local` (created by Convex when you run it or by the setup script). The **root `.env`** is used by `bun run convex:setup` to push variables into Convex (see §4).

---

## 4. Convex: Local vs Team Cloud

The app uses **Convex** for the backend (database, functions, HTTP). You can either use a **local Convex** instance or a **shared team Convex** (Convex Cloud).

### Option A: Local Convex (good for offline / full-stack work)

You need **Docker** installed and running.

1. Ensure root **`.env`** is filled (see §3). Convex setup will sync these into your local Convex.
2. One-time setup (starts a temporary Convex, syncs env, runs seed, then exits):

   ```bash
   bun run convex:setup
   ```

   Or with verbose output:

   ```bash
   bun run --env-file .env --cwd packages/convex setup
   cd packages/convex && bun run setup -- --verbose
   ```

   This creates/updates `packages/convex/.env.local` and seeds the local deployment.

3. Start the dev server **with Convex enabled** (starts the Convex backend in Docker):

   ```bash
   ./scripts/dev.sh --skip-convex=false
   ```

Your **root `.env`** should have `NEXT_PUBLIC_CONVEX_URL=http://localhost:9777` so the client and www talk to the local Convex.

### Option B: Team Convex (Convex Cloud)

If your team uses a shared Convex project:

1. Get the **Convex deployment URL** from a teammate or the Convex dashboard (e.g. `https://happy-animal-123.convex.cloud`).
2. Put it in root **`.env`**:

   ```env
   NEXT_PUBLIC_CONVEX_URL=https://happy-animal-123.convex.cloud
   ```

3. Link the Convex CLI to that deployment (one time):

   ```bash
   cd packages/convex
   bunx convex dev
   ```

   When prompted, log in and select the team/project. This writes `packages/convex/.env.local` with the deployment URL. You can then stop the process (Ctrl+C).

4. Start the dev server **without** starting the local Convex backend:

   ```bash
   ./scripts/dev.sh
   ```

   Default is `--skip-convex=true`, so Docker Convex is not started; `convex dev` in the script will use the Cloud deployment from `.env.local`.

---

## 5. Starting the Dev Server

From the **repository root**:

```bash
./scripts/dev.sh
```

For **local Convex** (Docker):

```bash
./scripts/dev.sh --skip-convex=false
```

### Useful flags

| Flag | Effect |
|------|--------|
| `--skip-convex=false` | Start the Convex backend in Docker (required for fully local Convex). |
| `--force-docker-build` | Rebuild the worker Docker image (e.g. after Dockerfile changes). |
| `--show-compose-logs` | Show Docker Compose logs in the terminal (useful when Convex is running). |
| `--electron` | Also start the Electron app. |
| `--convex-agent` | Run Convex dev in agent mode. |

### First run

- The script will run `bun install` if `node_modules` is missing.
- It will build the **Rust N-API addon** in `apps/server/native/core` (requires Rust).
- If you use Docker Convex, the first run may pull images and start containers; give it a minute.

When everything is up, you should see something like:

```
Terminal app is running!
Frontend: http://localhost:5173
Backend: http://localhost:9776
WWW: http://localhost:9779
Convex: http://localhost:9777   # only if Convex is running
Press Ctrl+C to stop all services
```

---

## 6. What Runs and Where

| Service | Port | URL | Purpose |
|---------|------|-----|---------|
| **Client** (Vite) | 5173 | http://localhost:5173 | Main web app (React SPA). Open this in the browser. |
| **WWW** (Next.js) | 9779 | http://localhost:9779 | API, auth handlers, preview dashboard. |
| **Server** | 9776 | http://localhost:9776 | Backend server (Socket.IO, etc.). |
| **Convex** | 9777 | http://localhost:9777 | Convex backend (only when `--skip-convex=false`). |

Additionally, the dev script starts the **OpenAPI client generator** (watch mode) so that API changes in www are reflected in the generated client used by the app.

Logs are written under **`logs/`** (e.g. `logs/client.log`, `logs/server.log`, `logs/convex-dev.log`). Use `tail -f logs/<name>.log` to follow a service.

---

## 7. Stopping and Cleanup

- **Normal stop:** Press **Ctrl+C** in the terminal where `./scripts/dev.sh` is running. The script will shut down all child processes and (if applicable) Docker Compose.

- **If the terminal died or you closed it:** Another `./scripts/dev.sh` run will try to take over and kill the previous instance. If something is stuck, run:

  ```bash
  ./scripts/cleanup-dev.sh
  ```

  This kills any orphaned dev-server processes for this project. Use `./scripts/cleanup-dev.sh --all` to clean up all projects.

- **Port already in use:** The script checks ports 5173, 9776, 9779 and may try to free them. If you see "address already in use", close other apps using those ports or run `cleanup-dev.sh` and try again.

---

## 8. Verification

1. **Frontend:** Open http://localhost:5173 — the app should load (you may need to sign in).
2. **WWW API:** Open http://localhost:9779/api/health — should return JSON with `"status":"healthy"`.
3. **Sign-in:** If Stack Auth is configured, use the sign-in flow; redirect should go to your handlers on localhost:9779.
4. **Convex:** If you use local Convex, the Convex dashboard is typically at http://localhost:6791 when Docker Convex is running (see `.devcontainer/docker-compose.convex.yml`).

---

## 9. Troubleshooting

### "Failed to start Convex Dev" or Convex never becomes ready

- **Local Convex:** Ensure Docker is running and you used `./scripts/dev.sh --skip-convex=false`. Run `bun run convex:setup` first if you haven’t.
- **Team Convex:** Ensure `packages/convex/.env.local` exists and has the correct deployment (from `bunx convex dev` in `packages/convex`).

### Rust / native addon build failed

- Install Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`, then `rustup default stable`.
- On macOS with Apple Silicon, the script builds the correct target automatically.

### Port 5173, 9776, or 9779 already in use

- Stop other dev servers or services using those ports.
- Run `./scripts/cleanup-dev.sh` and then `./scripts/dev.sh` again.

### Client or www show "missing env" or Convex connection errors

- Ensure **root `.env`** exists and has `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_STACK_PROJECT_ID`, `NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY`, and `NEXT_PUBLIC_WWW_ORIGIN=http://localhost:9779`.
- The dev script sources root `.env`; no need to copy it into `apps/client` for the dev server.

### OpenAPI client generator never finishes

- The script waits for the message `watch-openapi complete` in `logs/openapi-client.log`. If www fails to start (e.g. missing env), the generator can hang. Fix www env and restart `./scripts/dev.sh`.

### Docker build fails when using `--skip-convex=false`

- Ensure Docker has enough memory and disk. On Mac, increase resources in Docker Desktop if needed.
- Try `./scripts/dev.sh --force-docker-build --skip-convex=false` to force a clean build.

### "Stale dev.sh lock" or "Failed to acquire lock"

- Run `./scripts/cleanup-dev.sh` to remove lock files and kill old dev processes, then start again.

---

## Quick reference

| Goal | Command |
|------|--------|
| First-time install | `bun install` |
| One-time Convex setup (local) | `bun run convex:setup` |
| Start dev (team Convex) | `./scripts/dev.sh` |
| Start dev (local Convex) | `./scripts/dev.sh --skip-convex=false` |
| Stop dev | Ctrl+C in the dev.sh terminal |
| Clean up stuck processes | `./scripts/cleanup-dev.sh` |
| Run checks after code changes | `bun check` |

For production deployment and all environment variables in one place, see **DEPLOY_END_TO_END.md**.
