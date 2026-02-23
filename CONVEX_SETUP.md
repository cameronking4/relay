# Convex Setup: Self-Hosted vs Cloud

## What is Convex?

**Convex** is this project's backend: database, serverless functions, and HTTP endpoints (e.g. webhooks for Stack Auth and GitHub). The frontend and the Next.js API both talk to Convex for data and real-time updates.

---

## Two ways to run Convex

### 1. **Convex Cloud** (hosted by Convex)

- Convex runs your backend in their cloud.
- You get a URL like `https://happy-animal-123.convex.cloud`.
- No Docker, no local Convex process.
- Good for: production, team sharing, and simple local dev (you point your app at that one URL everywhere).

### 2. **Self-hosted / local Convex** (what we've been using)

- Convex runs **on your machine** inside **Docker**.
- URL is `http://localhost:9777` (and site proxy on `9778`).
- Good for: fully offline work, or not touching a shared cloud backend while you experiment.

So: **"self-hosted" = Convex runs in Docker on your laptop. "The other option" = Convex runs in Convex's cloud (Convex Cloud).**

---

## Do you "want" self-hosted?

It's a tradeoff:

| | **Self-hosted (local Docker)** | **Convex Cloud** |
|---|-------------------------------|-------------------|
| **Setup** | Need Docker; run `convex:setup` once, then `./scripts/dev.sh --skip-convex=false` | Create project at convex.dev, get URL, put it in `.env` |
| **Data** | Stored locally; wiped if you reset Convex/Docker | Stored in Convex's cloud; persists |
| **Offline** | Works without internet (after images are pulled) | Needs internet |
| **Sharing** | Only on your machine | Same URL for whole team / prod |
| **Best for** | Solo local dev, experiments, no cloud account | Team dev, production, "one backend URL" |

For a **newbie**, Convex Cloud is often easier: no Docker for Convex, one URL, and the docs assume it. Self-hosted is for when you explicitly want everything local (including the DB).

---

## What we changed and why

When you run **self-hosted**:

1. **Docker** runs the Convex backend (e.g. `./scripts/dev.sh --skip-convex=false`).
2. **`convex dev`** (the CLI) must **connect to that local backend**, not to a cloud deployment.

The CLI gets its "which backend?" from either:

- **Convex Cloud:** `CONVEX_DEPLOYMENT` / deployment URL (often from `packages/convex/.env.local`), or  
- **Self-hosted:** `CONVEX_SELF_HOSTED_URL` + `CONVEX_SELF_HOSTED_ADMIN_KEY` (from the root `.env`).

If **both** are set, the CLI complains: *"CONVEX_DEPLOYMENT must not be set when CONVEX_SELF_HOSTED_* are set."*

So we changed the **dev script** so that when you start with **self-hosted** (`--skip-convex=false`), it **unsets `CONVEX_DEPLOYMENT`** before running `convex dev`. That way the CLI uses only the self-hosted vars and talks to your local Docker Convex.

**Implications:**

- **Local self-hosted:** The script now correctly points `convex dev` at your local Convex (Docker). No change to how you deploy.
- **Convex Cloud:** You don't use `--skip-convex=false`; you use the default (skip local Convex). The CLI uses `CONVEX_DEPLOYMENT` from `.env.local` and talks to the cloud. No change there either.

---

## What you should know: local vs deployment

### Running **locally** (development)

- **Option A – Self-hosted (what we set up)**  
  - Docker Desktop on.  
  - `./scripts/dev.sh --skip-convex=false`  
  - Convex = `http://localhost:9777` (and 9778 for HTTP).  
  - Data lives in Docker/Convex on your machine only.

- **Option B – Convex Cloud**  
  - Create a Convex project at [convex.dev](https://convex.dev), get the deployment URL.  
  - Put in root `.env`: `NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud`.  
  - In `packages/convex`, run `bunx convex dev` once, log in, link the project (this writes `packages/convex/.env.local`).  
  - Then: `./scripts/dev.sh` (no `--skip-convex=false`).  
  - Convex = that cloud URL; data is in Convex's cloud.

So: **locally you can choose** "Convex in Docker on my machine" (self-hosted) **or** "Convex in the cloud" (Convex Cloud). The change we made only fixes the self-hosted path.

### **Deployment** (production)

- For **production**, this app is meant to use **Convex Cloud** (see DEPLOY_END_TO_END.md): you deploy the Convex backend to Convex's cloud and point the deployed app (Vercel, etc.) at that Convex URL.
- **Self-hosted** in the script is a **local development** option, not the normal production setup.

---

## Short answers to your questions

- **Difference:** Self-hosted = Convex runs in Docker on your machine; the other option = Convex runs in Convex Cloud.
- **Do we want self-hosted?** Only if you want everything (including DB) local and are okay using Docker. Otherwise, Convex Cloud is simpler.
- **What you should know:**  
  - **Locally:** Either self-hosted (Docker + `--skip-convex=false`) or Convex Cloud (no Docker for Convex, `./scripts/dev.sh` and a cloud URL in `.env`).  
  - **Deployment:** Use Convex Cloud; self-hosted in the script is for local dev only.  
- **Implications of the change:** When you *do* use self-hosted, the dev script now correctly tells `convex dev` to use your local Convex instead of a cloud deployment, so the "must not be set" error goes away.
