# Relay deployment – webhooks and URL setup

Use this after deploying **relay-client** and **relay-www** to Vercel and Convex.

| Service   | URL |
|----------|-----|
| **Client** | https://relay-client-taupe.vercel.app |
| **WWW**    | https://relay-www-delta.vercel.app |
| **Convex (cloud)** | https://animated-herring-638.convex.cloud |
| **Convex (HTTP / webhooks)** | https://animated-herring-638.convex.site |

---

## 1. Convex environment variables

In [Convex Dashboard](https://dashboard.convex.dev) → **animated-herring-638** → **Settings** → **Environment Variables**, set:

| Variable | Value |
|----------|--------|
| `BASE_APP_URL` | `https://relay-client-taupe.vercel.app` |

This is where users land after auth (client app). Leave all other Convex env vars as already configured.

---

## 2. Stack Auth

[Stack Auth](https://stack-auth.com) → your project → **Redirect URLs** and **Webhooks**.

### 2.1 Redirect URLs

Add (one per line):

- `https://relay-client-taupe.vercel.app`
- `https://relay-client-taupe.vercel.app/`
- `https://relay-client-taupe.vercel.app/sign-in`
- `https://relay-client-taupe.vercel.app/team-picker`
- `https://relay-www-delta.vercel.app/handler/after-sign-in`

### 2.2 Webhook (teams/users sync)

- **Endpoint URL:** `https://animated-herring-638.convex.site/stack_webhook`
- **Method:** POST
- **Signing secret:** same value as `STACK_WEBHOOK_SECRET` in Convex (already set).
- **Events:** e.g. `user.created`, `user.updated`, `team.created`, `team.updated` (or your project’s defaults).

Save and ensure recent deliveries show success (200).

---

## 3. GitHub App (if you use repos/PRs)

GitHub → **Settings** (org or user) → **Developer settings** → **GitHub Apps** → your app.

### 3.1 Basic / callback

- **Homepage URL:** `https://relay-www-delta.vercel.app`
- **Callback URL:** `https://relay-www-delta.vercel.app/handler/connect-github`

### 3.2 Webhook

- **Webhook URL:** `https://animated-herring-638.convex.site/github_webhook`
- **Content type:** `application/json`
- **Secret:** same value as `GITHUB_APP_WEBHOOK_SECRET` in Convex.

Save; optionally send a test delivery and confirm 200 in **Recent Deliveries**.

---

## 4. Vercel environment variables

### 4.1 relay-client (apps/client)

In Vercel → **relay-client** → **Settings** → **Environment Variables** (Production), ensure:

| Variable | Value |
|----------|--------|
| `NEXT_PUBLIC_CONVEX_URL` | `https://animated-herring-638.convex.cloud` |
| `NEXT_PUBLIC_WWW_ORIGIN` | `https://relay-www-delta.vercel.app` |
| `NEXT_PUBLIC_STACK_PROJECT_ID` | (from Stack Auth) |
| `NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY` | (from Stack Auth) |
| `NEXT_PUBLIC_WEB_MODE` | `true` |
| `NEXT_PUBLIC_GITHUB_APP_SLUG` | (optional; from GitHub App URL slug) |

Redeploy the client after changing env vars so the build picks them up.

### 4.2 relay-www (apps/www)

Ensure **Production** env includes at least:

- All required vars from `apps/www/lib/utils/www-env.ts` (Stack, Convex, Morph, GitHub App, JWT secret, etc.).
- No URL changes needed if they already point at Convex and your APIs; if any var was set to a different app URL, set it to the relay URLs above.

Redeploy www after changing env vars.

---

## 5. Verification

1. **Client:** Open https://relay-client-taupe.vercel.app → sign in → should redirect and land on client (e.g. team-picker).
2. **Stack webhook:** Stack Auth dashboard → Webhooks → recent deliveries to `.../stack_webhook` → 200.
3. **GitHub webhook (if used):** GitHub App → Advanced → Recent Deliveries → 200 for `.../github_webhook`.
4. **Convex:** Dashboard shows no failed function runs; client loads without console errors.

---

## 6. Optional: custom domains

If you add custom domains in Vercel (e.g. `app.relay.example.com` for client, `relay.example.com` for www):

1. Update **Stack Auth** redirect URLs and **GitHub App** callback/homepage to the new domains.
2. Set Convex `BASE_APP_URL` to the new client URL.
3. Set client’s `NEXT_PUBLIC_WWW_ORIGIN` to the new www URL and redeploy.

---

## Quick reference – URLs to paste

```
# Convex BASE_APP_URL
https://relay-client-taupe.vercel.app

# Stack webhook
https://animated-herring-638.convex.site/stack_webhook

# GitHub App webhook
https://animated-herring-638.convex.site/github_webhook

# GitHub App callback
https://relay-www-delta.vercel.app/handler/connect-github

# Stack after-sign-in handler
https://relay-www-delta.vercel.app/handler/after-sign-in
```
