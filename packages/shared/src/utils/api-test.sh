#!/usr/bin/env bash
set -euo pipefail

# Required:
# WWW_ORIGIN=https://relay-www-delta.vercel.app
# TEAM=relay-org
#
# Auth mode (default: team_key):
# AUTH_MODE=team_key
# TEAM_API_KEY="<team_api_key>"
# ACTOR_USER_ID="<stack_user_id>"
#
# Legacy mode:
# AUTH_MODE=legacy_bearer
# AUTH_HEADER_VALUE="Bearer <stack_access_token>"
#
# Optional test payload overrides:
# CLI, PROMPT, REPO_URL, PROJECT_FULL_NAME, BRANCH

command -v jq >/dev/null || { echo "jq is required"; exit 1; }

: "${WWW_ORIGIN:?set WWW_ORIGIN}"
: "${TEAM:?set TEAM}"
AUTH_MODE="${AUTH_MODE:-team_key}"

AUTH_HEADER_NAME="${AUTH_HEADER_NAME:-}"
AUTH_HEADER_VALUE="${AUTH_HEADER_VALUE:-}"
ACTOR_HEADER_NAME="${ACTOR_HEADER_NAME:-X-Cmux-Actor-User-Id}"
ACTOR_USER_ID="${ACTOR_USER_ID:-}"

if [[ "$AUTH_MODE" == "team_key" ]]; then
  AUTH_HEADER_NAME="${AUTH_HEADER_NAME:-X-Stack-Api-Key}"
  AUTH_HEADER_VALUE="${AUTH_HEADER_VALUE:-${TEAM_API_KEY:-}}"
  : "${AUTH_HEADER_VALUE:?set TEAM_API_KEY or AUTH_HEADER_VALUE}"
  : "${ACTOR_USER_ID:?set ACTOR_USER_ID for team_key mode}"
elif [[ "$AUTH_MODE" == "legacy_bearer" ]]; then
  AUTH_HEADER_NAME="${AUTH_HEADER_NAME:-Authorization}"
  AUTH_HEADER_VALUE="${AUTH_HEADER_VALUE:-${STACK_ACCESS_TOKEN:-}}"
  : "${AUTH_HEADER_VALUE:?set AUTH_HEADER_VALUE or STACK_ACCESS_TOKEN for legacy_bearer mode}"
  if [[ "$AUTH_HEADER_NAME" == "Authorization" && "$AUTH_HEADER_VALUE" != Bearer* ]]; then
    AUTH_HEADER_VALUE="Bearer ${AUTH_HEADER_VALUE}"
  fi
else
  echo "Unsupported AUTH_MODE: ${AUTH_MODE}"
  echo "Use AUTH_MODE=team_key or AUTH_MODE=legacy_bearer"
  exit 1
fi

CLI="${CLI:-codex/gpt-5.3-codex-xhigh}"
PROMPT="${PROMPT:-Implement a health check endpoint and tests}"
REPO_URL="${REPO_URL:-https://github.com/owner/repo.git}"
PROJECT_FULL_NAME="${PROJECT_FULL_NAME:-owner/repo}"
BRANCH="${BRANCH:-main}"

BASE="${WWW_ORIGIN%/}/api/teams/${TEAM}/task-invocations"

CODE=""
BODY=""

request() {
  local send_auth="$1"; shift
  local send_actor="$1"; shift
  local method="$1"; shift
  local url="$1"; shift
  local body="${1:-}"; shift || true

  local tmp
  tmp="$(mktemp)"
  local -a args=(-sS -o "$tmp" -w "%{http_code}" -X "$method" "$url")
  if [[ "$send_auth" == "1" ]]; then
    args+=(-H "${AUTH_HEADER_NAME}: ${AUTH_HEADER_VALUE}")
    if [[ "$AUTH_MODE" == "team_key" && "$send_actor" == "1" ]]; then
      args+=(-H "${ACTOR_HEADER_NAME}: ${ACTOR_USER_ID}")
    fi
  fi
  while (($#)); do
    args+=(-H "$1")
    shift
  done
  if [[ -n "$body" ]]; then
    args+=(-d "$body")
  fi

  CODE="$(curl "${args[@]}")"
  BODY="$(cat "$tmp")"
  rm -f "$tmp"
}

expect_code() {
  local expected="$1"
  if [[ "$CODE" != "$expected" ]]; then
    echo "Expected HTTP $expected, got $CODE"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
    exit 1
  fi
}

echo "1) Start invocation (202)"
IDEMP="inv-test-$(date +%s)"
START_BODY="$(jq -n \
  --arg prompt "$PROMPT" \
  --arg cli "$CLI" \
  --arg repoUrl "$REPO_URL" \
  --arg projectFullName "$PROJECT_FULL_NAME" \
  --arg branch "$BRANCH" \
  '{prompt:$prompt, clis:[$cli], target:{repoUrl:$repoUrl, projectFullName:$projectFullName, branch:$branch}}'
)"
request 1 1 POST "$BASE" "$START_BODY" "Content-Type: application/json" "Idempotency-Key: ${IDEMP}"
expect_code 202
INVOCATION_ID="$(echo "$BODY" | jq -r '.invocationId')"
[[ "$INVOCATION_ID" != "null" && -n "$INVOCATION_ID" ]] || { echo "No invocationId"; echo "$BODY"; exit 1; }
echo "invocationId=$INVOCATION_ID"

echo "2) Get status (200)"
request 1 1 GET "${BASE}/${INVOCATION_ID}" ""
expect_code 200
echo "$BODY" | jq '{phase, runCounts, prState, links}'

echo "3) Wait for commit_complete (200)"
request 1 1 GET "${BASE}/${INVOCATION_ID}/wait?until=commit_complete&timeoutSeconds=30&pollMs=2000" ""
expect_code 200
echo "$BODY" | jq '{phase, timedOut, phaseReason, runCounts, prState}'

echo "4) Idempotency reuse: same key + same payload (202, same invocationId)"
request 1 1 POST "$BASE" "$START_BODY" "Content-Type: application/json" "Idempotency-Key: ${IDEMP}"
expect_code 202
REUSED_ID="$(echo "$BODY" | jq -r '.invocationId')"
[[ "$REUSED_ID" == "$INVOCATION_ID" ]] || { echo "Expected reused invocationId=$INVOCATION_ID, got $REUSED_ID"; exit 1; }

echo "5) Idempotency conflict: same key + different payload (409)"
CONFLICT_BODY="$(echo "$START_BODY" | jq '.prompt = "Different payload for conflict test"')"
request 1 1 POST "$BASE" "$CONFLICT_BODY" "Content-Type: application/json" "Idempotency-Key: ${IDEMP}"
expect_code 409

echo "6) Invalid CLI (400)"
BAD_CLI_BODY="$(echo "$START_BODY" | jq '.clis = ["not/a-real-cli"]')"
request 1 1 POST "$BASE" "$BAD_CLI_BODY" "Content-Type: application/json"
expect_code 400

echo "7) Unauthorized (401)"
request 0 0 GET "${BASE}/${INVOCATION_ID}" ""
expect_code 401

if [[ "$AUTH_MODE" == "team_key" ]]; then
  echo "8) Missing actor header in team_key mode (400)"
  request 1 0 GET "${BASE}/${INVOCATION_ID}" ""
  expect_code 400
fi

echo "All checks passed."
