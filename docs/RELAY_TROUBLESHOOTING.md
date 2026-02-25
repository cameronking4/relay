# Relay deployment troubleshooting

This guide resolves common errors when running the relay stack (client on Vercel, www on Vercel, Convex, relay server on Render). Each section maps **symptoms → cause → fix** with exact env vars and UIs.

---

## Error index

| Symptom | Section |
|--------|---------|
| Convex returns **501 "webhook not configured"** on GitHub webhook deliveries | [1. GitHub webhook secret](#1-github-webhook-secret-501-webhook-not-configured) |
| Client shows **"GitHub App not configured. Please contact support."** | [2. GitHub App slug on client](#2-github-app-slug-on-client) |
| www / API returns **501 "GitHub App not configured"** | [3. GitHub App ID and private key on www](#3-github-app-id-and-private-key-on-www) |
| **"Token expired"** / **InvalidAuthHeader** when loading API keys or calling Convex from relay server | [4. Convex token expiry (relay server)](#4-convex-token-expiry-relay-server) |
| **"GitHub account not connected"** (Stack Auth) in relay server logs | [5. GitHub account not connected](#5-github-account-not-connected) |
| **HTTP server closed** / process exits after errors | [6. Server stability](#6-server-stability) |
| **"Failed to start sandbox"** / **"Error loading diffs"** in task UI | [7. Sandbox and agent failures](#7-sandbox-and-agent-failures) |

---

## 1. GitHub webhook secret (501 "webhook not configured")

**Symptom:** GitHub App → Recent Deliveries shows **501** with response body `webhook not configured`. Convex HTTP route `/github_webhook` is hit but returns 501.

**Cause:** The Convex handler requires `GITHUB_APP_WEBHOOK_SECRET` to be set. If it’s missing, it returns 501 and does not process the payload. GitHub must sign payloads with the **same** secret so Convex can verify them.

**Fix:**

1. **Generate a secret** (e.g. 32+ random bytes):
   ```bash
   openssl rand -hex 32
   ```
   Save this value; you’ll use it in two places.

2. **Convex**
   - Go to [Convex Dashboard](https://dashboard.convex.dev) → your deployment (e.g. **animated-herring-638**) → **Settings** → **Environment Variables**.
   - Add: **Name** `GITHUB_APP_WEBHOOK_SECRET`, **Value** = the secret from step 1.
   - Save. Convex will use this to verify `X-Hub-Signature-256` on incoming webhooks.

3. **GitHub App**
   - GitHub → Your organization/user → **Settings** → **Developer settings** → **GitHub Apps** → your app.
   - Open **Webhook**.
   - **Webhook URL:** `https://<your-deployment>.convex.site/github_webhook` (e.g. `https://animated-herring-638.convex.site/github_webhook`).
   - **Secret:** paste the **exact same** value as in Convex. Do not leave this empty.
   - **Active:** checked.
   - Save.

4. **Verify:** In GitHub App → **Recent Deliveries**, redeliver or trigger a new event. Response should be **200**; body may be empty or `OK`.

---

## 2. GitHub App slug on client

**Symptom:** In the client app (e.g. relay-client on Vercel), clicking the action that opens the GitHub App installation flow shows an alert: **"GitHub App not configured. Please contact support."**

**Cause:** The client checks `NEXT_PUBLIC_GITHUB_APP_SLUG` before opening the install URL. If it’s missing, it shows that message and does not open the GitHub App install page.

**Fix:**

1. **Find your GitHub App slug**
   - GitHub → Your org/user → **Settings** → **Developer settings** → **GitHub Apps** → your app.
   - The slug is in the URL: `https://github.com/organizations/<org>/settings/apps/<slug>` or in the app’s “Public link”: `https://github.com/apps/relayagents`.

2. **Set env on the client**
   - Vercel → project **relay-client** (or whatever project serves `apps/client`) → **Settings** → **Environment Variables**.
   - Add: **Name** `NEXT_PUBLIC_GITHUB_APP_SLUG`, **Value** = your app’s slug (e.g. `my-cmux-app`).
   - Apply to the environments you use (Production, Preview, etc.).

3. **Redeploy** the client so the build picks up the new variable.

4. **Verify:** Reload the client; the install action should open `https://github.com/apps/<slug>/installations/new` instead of showing the alert.

---

## 3. GitHub App ID and private key on www

**Symptom:** API calls to www (e.g. PRs, repos, install state) return **501** with body like `{ "error": "GitHub App not configured" }`.

**Cause:** The www app considers the GitHub App “configured” only when both `CMUX_GITHUB_APP_ID` and `CMUX_GITHUB_APP_PRIVATE_KEY` are set. Without them, GitHub App–backed routes return 501.

**Fix:**

1. **GitHub App ID**
   - GitHub → Your app → **General** (or **About**). Copy the **App ID** (numeric).

2. **Private key**
   - In the same app → **General** → **Private keys** → generate or use an existing key. Download the `.pem` file.
   - The value for the env var is the **entire file contents**: `-----BEGIN RSA PRIVATE KEY-----` … `-----END RSA PRIVATE KEY-----`, including newlines. In Vercel you can paste with real newlines or use `\n` for line breaks depending on how the UI stores them.

3. **Set env on www**
   - Vercel → project **relay-www** (or whatever serves `apps/www`) → **Settings** → **Environment Variables**.
   - Add:
     - **Name** `CMUX_GITHUB_APP_ID`, **Value** = the App ID (e.g. `2925274`).
     - **Name** `CMUX_GITHUB_APP_PRIVATE_KEY`, **Value** = full PEM contents (see above).
   - Apply to the right environments.

4. **Redeploy** www.

5. **Verify:** Call an endpoint that uses the GitHub App (e.g. repos or install state). You should get 200 or a normal error (e.g. 401/404), not 501 “GitHub App not configured”.

---

## 4. Convex token expiry (relay server)

**Symptom:** Relay server logs show: **"Failed to load API keys for team … Error: … InvalidAuthHeader … Token expired N seconds ago"**. Convex HTTP client used by the relay server is rejecting requests.

**Cause:** The relay server calls Convex using the **user’s JWT** (Stack Auth access token). That token is sent by the client when connecting to the relay (socket handshake and `authenticate` events). If the JWT is expired when the server uses it, Convex returns InvalidAuthHeader / Token expired.

Common reasons:

- Client sent an expired token (e.g. long-lived socket, token expired before the next refresh).
- Very short JWT TTL and refresh interval (client refreshes every 5 minutes; if TTL &lt; 5 min, tokens can expire).
- Server or auth provider clock skew (server time ahead → token appears expired earlier).

**Fix:**

1. **Confirm client token refresh**
   - The client refreshes auth and sends it to the relay every **5 minutes** via the socket `authenticate` event. Ensure the client is actually connected and that no firewall/proxy is dropping or delaying those events.
   - If your Stack Auth access tokens have a TTL **shorter than 5 minutes**, either increase the TTL in Stack Auth or reduce the refresh interval in the client (e.g. in `apps/client/src/contexts/socket/socket-provider.tsx`, the interval is `5 * 60 * 1000` ms).

2. **Check server time (Render)**
   - If the relay runs on Render, ensure the instance clock is correct. Large skew can make valid tokens look expired. Render normally uses NTP; if you see consistent “expired N seconds ago” with small N, clock skew is a possible cause.

3. **Avoid long idle sockets with stale tokens**
   - If users leave a tab open for a long time, the socket might still hold an old token if refresh failed (e.g. tab in background, network issues). A full page reload forces a new connection with a fresh token. For development, reload after long idle if you see token expiry.

4. **Convex client cache**
   - The relay caches Convex HTTP clients by token; when the token changes (e.g. after `authenticate`), a new client is created with the new token. No extra config is needed; fixing token freshness (above) is the main fix.

---

## 5. GitHub account not connected

**Symptom:** Relay server logs: **"[getGitHubOAuthToken] Stack Auth error: GitHub account not connected"**.

**Cause:** The relay server asks the **www** API for the current user’s GitHub OAuth token (using the user’s Stack Auth context). The www API returns an error indicating that the **user** has not connected their GitHub account (e.g. via “Connect GitHub” / GitHub App install with user OAuth). This is a **user** configuration issue, not a missing env var.

**Fix:**

1. **For production/relay**
   - Ensure **Stack Auth** and **www** are configured for the relay (redirect URLs, webhooks, env) as in the main relay setup docs.
   - Have **users** complete the GitHub connection flow in the app (e.g. install the GitHub App with “Request user authorization (OAuth) during installation” and complete the callback to www). Until they do, `getGitHubOAuthToken` will return null and the server will log the above message for that user’s requests.

2. **Optional**
   - If some flows don’t require GitHub, the code already treats a missing token as non-fatal (returns null). The log is a warning; fix is to have users who need GitHub features connect their account.

---

## 6. Server stability

**Symptom:** **"HTTP server closed"** in logs; relay process exits after some errors.

**Cause:** An unhandled rejection or uncaught exception can bring down the Node/Bun process. For example, a Convex call that throws and is not caught in a code path that runs outside the socket handler’s try/catch can trigger this.

**Fix:**

1. **Ensure errors are caught**
   - Socket handlers (e.g. `check-provider-status`) already wrap logic in try/catch and call `callback({ success: false, error: … })`. If you added new handlers, ensure they do the same and don’t let rejections escape.

2. **Add process-level handlers (optional)**
   - To avoid exiting on first unhandled rejection and to log for debugging:
     - `process.on("unhandledRejection", (reason, promise) => { console.error("Unhandled Rejection at:", promise, "reason:", reason); });`
     - Optionally `process.on("uncaughtException", ...)` to log and optionally exit gracefully. Prefer fixing the underlying error (e.g. token expiry) so the server doesn’t rely on these.

3. **Fix root causes**
   - Resolving the Convex token expiry (Section 4) and other config issues reduces the chance of fatal errors.

---

## 7. Sandbox and agent failures

**Symptom:** In the task UI: **"Failed to start sandbox"**, **"claude/opus-4.6: Failed to start sandbox"**, **"Error loading diffs"**, or **"No Git repository found"** in the open workspace.

**Cause:** The task runs inside an isolated sandbox (e.g. Morph). “No Git repository found” and “Error loading diffs” usually mean the **sandbox** hasn’t cloned the repo yet or the agent failed before clone completed. “Failed to start sandbox” points to sandbox provisioning (Morph/env, network, or credentials).

**Fix:**

1. **Confirm upstream config**
   - Ensure Convex, GitHub App (webhook + www + client slug), and Stack Auth are set as in sections 1–3 and 5. Missing config can prevent the relay from getting repo/PR data or tokens needed for clone and agent runs.

2. **Relay server env (Render)**
   - Relay needs at least:
     - `NEXT_PUBLIC_CONVEX_URL` = your Convex URL (e.g. `https://animated-herring-638.convex.cloud`).
     - `NEXT_PUBLIC_WEB_MODE` = `true` for web-only mode.
     - `NEXT_PUBLIC_WWW_ORIGIN` = www origin (e.g. `https://relay-www-delta.vercel.app`) so the server can call www for GitHub OAuth and other APIs.
   - If you use Morph for sandboxes, set `MORPH_API_KEY` on the relay (or wherever the spawner runs) as required by your deployment docs.

3. **Inspect logs**
   - Check relay server logs (e.g. Render logs) and Convex dashboard for errors when a task is started (e.g. JWT errors, missing keys, failed mutations). Fix those first; sandbox and “No Git repository” often improve once auth and config are correct.

---

## Quick checklist

Use this after deploying or when debugging:

- [x] **Convex:** `GITHUB_APP_WEBHOOK_SECRET` set; `BASE_APP_URL` points to client URL.
- [x] **GitHub App (webhook):** Secret set and **identical** to Convex `GITHUB_APP_WEBHOOK_SECRET`; URL = `https://<deployment>.convex.site/github_webhook`.
- [x] **Vercel – relay-client:** `NEXT_PUBLIC_GITHUB_APP_SLUG` set; `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_WWW_ORIGIN`, `NEXT_PUBLIC_SERVER_ORIGIN` (if used) correct.
- [x] **Vercel – relay-www:** `CMUX_GITHUB_APP_ID` and `CMUX_GITHUB_APP_PRIVATE_KEY` set; Stack Auth and other required www env vars set per main setup docs.
- [ ] **Stack Auth:** Redirect URLs and webhook include your client/www URLs; webhook secret matches Convex `STACK_WEBHOOK_SECRET`.
- [ ] **Relay server (Render):** `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_WEB_MODE`, `NEXT_PUBLIC_WWW_ORIGIN` set; optional: process-level unhandledRejection logging.
- [ ] **Users:** GitHub connected in app for users who need repo/PR/agent features.
- [ ] **Verification:** GitHub App Recent Deliveries → 200 for webhook; client opens GitHub App install; www API no longer returns 501 “GitHub App not configured”; relay logs show no Token expired after fixing token refresh / TTL.

---

## References in codebase

- Convex 501 “webhook not configured”: `packages/convex/convex/github_webhook.ts` (check for `GITHUB_APP_WEBHOOK_SECRET`).
- Client “GitHub App not configured” alert: `apps/client/src/components/dashboard/DashboardInputControls.tsx` (`NEXT_PUBLIC_GITHUB_APP_SLUG`).
- www GitHub App check: `apps/www/lib/utils/githubPrivateKey.ts` (`isGitHubAppConfigured`: `CMUX_GITHUB_APP_ID` + `CMUX_GITHUB_APP_PRIVATE_KEY`).
- Relay Convex client (uses request auth token): `apps/server/src/utils/convexClient.ts` and `requestContext.ts`.
- Client socket auth refresh (5 min): `apps/client/src/contexts/socket/socket-provider.tsx` (`authenticate` event).
- Server socket auth update: `apps/server/src/socket-handlers.ts` (`authenticate` handler updates `currentAuthToken` / `currentAuthHeaderJson`).
