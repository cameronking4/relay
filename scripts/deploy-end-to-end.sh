#!/usr/bin/env bash
# Deploy cmux web app end-to-end: Convex, then www and client to Vercel.
# Uses .env (or .env.production) at repo root for CONVEX_DEPLOY_KEY and build env.
# Prerequisites: bun, npx (Node 24+), Vercel CLI (npx vercel). Convex and Vercel projects must be linked.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Resolve env file: prefer .env, fall back to .env.production for Convex deploy key
ENV_FILE=""
if [[ -f "$ROOT_DIR/.env" ]]; then
  ENV_FILE="$ROOT_DIR/.env"
elif [[ -f "$ROOT_DIR/.env.production" ]]; then
  ENV_FILE="$ROOT_DIR/.env.production"
fi

if [[ -z "$ENV_FILE" ]]; then
  echo "No .env or .env.production found at repo root. Create one with CONVEX_DEPLOY_KEY and Vercel build env vars." >&2
  exit 1
fi

echo "==> Using env file: $ENV_FILE"

# Export all vars from env file so Convex CLI and local builds see them
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
# If CONVEX_DEPLOY_KEY is only in .env.production, load that var so .env can hold app vars and key in .env.production
if [[ -z "${CONVEX_DEPLOY_KEY:-}" && -f "$ROOT_DIR/.env.production" && "$ENV_FILE" != "$ROOT_DIR/.env.production" ]]; then
  CONVEX_DEPLOY_KEY="$(grep -E '^CONVEX_DEPLOY_KEY=' "$ROOT_DIR/.env.production" 2>/dev/null | cut -d= -f2- | sed 's/^"//;s/"$//')"
  export CONVEX_DEPLOY_KEY
fi
set +a

SKIP_CONVEX=""
if [[ -z "${CONVEX_DEPLOY_KEY:-}" ]]; then
  echo "CONVEX_DEPLOY_KEY not set in $ENV_FILE (or .env.production); skipping Convex deploy (www + client only)." >&2
  SKIP_CONVEX=1
fi

echo ""
if [[ -z "$SKIP_CONVEX" ]]; then
  echo "==> 1/3 Deploying Convex (production)"
  PREVIEW_ARG=""
  if [[ "${CONVEX_DEPLOY_KEY:-}" == preview:* ]]; then
    PREVIEW_NAME="$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || echo "preview")"
    PREVIEW_ARG="--preview-create $PREVIEW_NAME"
  fi
  (cd "$ROOT_DIR/packages/convex" && bunx convex deploy --env-file "$ENV_FILE" $PREVIEW_ARG --yes)
  echo ""
else
  echo "==> 1/3 Skipping Convex (no CONVEX_DEPLOY_KEY)"
  echo ""
fi

# Vercel CLI requires --scope in non-interactive mode. Set VERCEL_SCOPE in .env (team slug e.g. cameron-s-org, or team id e.g. team_453G2BJMC0rcHI0zANxGimEo).
VERCEL_SCOPE_ARGS=()
if [[ -n "${VERCEL_SCOPE:-}" ]]; then
  VERCEL_SCOPE_ARGS=(--scope "$VERCEL_SCOPE")
  echo "==> Vercel scope: $VERCEL_SCOPE"
fi

echo "==> 2/3 Building and deploying www (Next.js) to Vercel"
cd "$ROOT_DIR"
bun install --frozen-lockfile
cd "$ROOT_DIR/apps/www"
# vercel build writes .vercel/output; deploy --prebuilt uses it (env from current shell)
npx vercel build "${VERCEL_SCOPE_ARGS[@]}" --yes
npx vercel deploy --prebuilt --prod "${VERCEL_SCOPE_ARGS[@]}" --yes
echo ""

echo "==> 3/3 Building and deploying client (Vite) to Vercel"
cd "$ROOT_DIR/apps/client"
npx vercel build "${VERCEL_SCOPE_ARGS[@]}" --yes
npx vercel deploy --prebuilt --prod "${VERCEL_SCOPE_ARGS[@]}" --yes
echo ""

echo "==> End-to-end deploy complete."
echo "    Convex: see Convex Dashboard for URL (NEXT_PUBLIC_CONVEX_URL)."
echo "    WWW and Client: see output above for Vercel URLs, or run: npx vercel ls"
