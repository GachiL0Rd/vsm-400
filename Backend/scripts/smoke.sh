#!/usr/bin/env bash
# Сквозной прогон API: demo, открытие смены, билет и отчёт.
# Сервер уже слушает. База с prisma:seed.
#   BASE_URL=http://127.0.0.1:3000 npm run smoke
# Админ: ADMIN_PASSWORD='пароль из лога первого старта' npm run smoke
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BASE="${BASE_URL:-http://127.0.0.1:${PORT:-3000}}"
BASE="${BASE%/}"

if ! command -v jq >/dev/null 2>&1; then
  echo "fail: нужен jq" >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "fail: нужен curl" >&2
  exit 1
fi

if [[ -z "${GAME_SERVER_TOKEN:-}" && -f .env ]]; then
  GAME_SERVER_TOKEN="$(grep -E '^GAME_SERVER_TOKEN=' .env | head -1 | cut -d= -f2- | tr -d '\r')"
fi
if [[ -z "${GAME_SERVER_TOKEN:-}" ]]; then
  echo "fail: нет GAME_SERVER_TOKEN" >&2
  exit 1
fi

WORK="$(mktemp -d)"
JAR="$WORK/demo.cookies"
ADMIN_JAR="$WORK/admin.cookies"
trap 'rm -rf "$WORK"' EXIT

step() {
  printf 'ok  %s\n' "$*"
}

die() {
  printf 'fail %s\n' "$*" >&2
  if [[ -n "${2:-}" && -f "$2" ]]; then
    cat "$2" >&2
    printf '\n' >&2
  fi
  exit 1
}

req() {
  local method="$1"
  local path="$2"
  local out="$3"
  shift 3
  local code
  code="$(curl -sS --max-time 30 -o "$out" -w '%{http_code}' -b "$JAR" -c "$JAR" -X "$method" "$BASE$path" "$@")"
  printf '%s' "$code"
}

expect() {
  local got="$1"
  local want="$2"
  local title="$3"
  local body="$4"
  if [[ "$got" != "$want" ]]; then
    die "$title: HTTP $got, ждали $want" "$body"
  fi
}

echo "smoke $BASE"

login_body="$WORK/login.json"
code="$(curl -sS --max-time 30 -o "$login_body" -w '%{http_code}' -c "$JAR" -b "$JAR" \
  -H 'content-type: application/json' \
  -d '{"login":"demo","password":"demo"}' \
  "$BASE/api/v1/auth/login")"
expect "$code" 200 "login demo" "$login_body"
callsign="$(jq -er '.user.callsign' "$login_body")"
[[ "$callsign" == "A7F3" ]] || die "login demo: callsign=$callsign" "$login_body"
step "login demo ($callsign)"

me="$WORK/me.json"
code="$(req GET /api/v1/me "$me")"
expect "$code" 200 "GET /me" "$me"
level="$(jq -er '.level' "$me")"
[[ "$level" == "7" ]] || die "GET /me: level=$level" "$me"
step "GET /api/v1/me level=$level points=$(jq -r '.points' "$me")"

runs_before="$WORK/runs-before.json"
code="$(req GET '/api/v1/me/runs?limit=5' "$runs_before")"
expect "$code" 200 "GET /me/runs" "$runs_before"
total_before="$(jq -er '.total' "$runs_before")"
step "GET /api/v1/me/runs total=$total_before"

board="$WORK/board.json"
code="$(req GET /api/v1/leaderboards/brigade "$board")"
expect "$code" 200 "GET /leaderboards/brigade" "$board"
jq -e '.rows | type == "array" and length > 0' "$board" >/dev/null \
  || die "рейтинг бригады пуст" "$board"
step "GET /api/v1/leaderboards/brigade rows=$(jq -r '.rows | length' "$board") total=$(jq -r '.total' "$board")"

notes="$WORK/notes.json"
code="$(req GET /api/v1/notifications "$notes")"
expect "$code" 200 "GET /notifications" "$notes"
jq -e '.items | type == "array"' "$notes" >/dev/null || die "notifications без items" "$notes"
step "GET /api/v1/notifications unread=$(jq -r '.unreadCount' "$notes") items=$(jq -r '.items | length' "$notes")"

rejected="$WORK/open-rest.json"
code="$(req POST /api/v1/game-sessions "$rejected" -H 'content-type: application/json' -d '{"transport":"REST"}')"
expect "$code" 422 "POST game-sessions REST" "$rejected"
step "POST /api/v1/game-sessions REST 422"

opened="$WORK/open-ws.json"
code="$(req POST /api/v1/game-sessions "$opened" -H 'content-type: application/json' -d '{}')"
expect "$code" 200 "POST game-sessions" "$opened"
ws_id="$(jq -er '.sessionId' "$opened")"
ticket="$(jq -er '.ticket' "$opened")"
launch="$(jq -er '.launchUrl' "$opened")"
[[ "$launch" == *"sessionKey="* ]] || die "launchUrl без sessionKey" "$opened"
step "POST /api/v1/game-sessions session=$ws_id"

verify="$WORK/verify.json"
code="$(curl -sS --max-time 30 -o "$verify" -w '%{http_code}' \
  -H 'content-type: application/json' \
  -H "X-Service-Token: $GAME_SERVER_TOKEN" \
  -d "$(jq -nc --arg ticket "$ticket" '{ticket:$ticket}')" \
  "$BASE/api/internal/v1/tickets/verify")"
expect "$code" 200 "tickets/verify" "$verify"
[[ "$(jq -r '.status' "$verify")" == "ACTIVE" ]] || die "билет не перевёл сессию в ACTIVE" "$verify"
[[ "$(jq -r '.sessionId' "$verify")" == "$ws_id" ]] || die "verify.sessionId не совпал" "$verify"
step "POST /api/internal/v1/tickets/verify ACTIVE"

reused="$WORK/reused.json"
code="$(curl -sS --max-time 30 -o "$reused" -w '%{http_code}' \
  -H 'content-type: application/json' \
  -H "X-Service-Token: $GAME_SERVER_TOKEN" \
  -d "$(jq -nc --arg ticket "$ticket" '{ticket:$ticket}')" \
  "$BASE/api/internal/v1/tickets/verify")"
expect "$code" 409 "tickets/verify повтор" "$reused"
[[ "$(jq -r '.code' "$reused")" == "TICKET_REUSED" ]] || die "повтор билета не TICKET_REUSED" "$reused"
step "POST tickets/verify повтор 409 TICKET_REUSED"

report="$WORK/report.json"
report_req="$WORK/report-req.json"
cat >"$report_req" <<'JSON'
{
  "contractVersion": 1,
  "protocolVersion": 1,
  "scenarioId": "ride-unwell",
  "simulationSeconds": 40,
  "outcome": "completed",
  "outcomeNote": "Смена сдана",
  "safety": 88,
  "loyalty": 84,
  "facts": { "prevented": 1, "incidents": 0, "complaints": 0, "interventions": 0 },
  "decisions": [
    {
      "id": "ask",
      "time": "09:40",
      "stage": "ride",
      "situation": "Пассажиру плохо",
      "action": "Вызвать начальника поезда",
      "verdict": "correct",
      "safety": 4,
      "loyalty": 2,
      "reactionSec": 2
    }
  ],
  "checks": [
    {
      "id": "panel",
      "detected": true,
      "reportRequired": true,
      "reported": true,
      "actionCorrect": true,
      "consequenceRolled": false
    }
  ]
}
JSON
code="$(curl -sS --max-time 30 -o "$report" -w '%{http_code}' \
  -H 'content-type: application/json' \
  -H "X-Service-Token: $GAME_SERVER_TOKEN" \
  --data-binary @"$report_req" \
  "$BASE/api/internal/v1/game-sessions/$ws_id/report")"
expect "$code" 200 "report" "$report"
ws_run="$(jq -er '.runId' "$report")"
step "POST report runId=$ws_run"

runs_ws="$WORK/runs-ws.json"
code="$(req GET '/api/v1/me/runs?limit=5' "$runs_ws")"
expect "$code" 200 "GET /me/runs после отчёта" "$runs_ws"
[[ "$(jq -r '.runs[0].id' "$runs_ws")" == "$ws_run" ]] || die "отчёт не первый в журнале" "$runs_ws"
[[ "$(jq -r '.total' "$runs_ws")" == "$((total_before + 1))" ]] || die "total после отчёта" "$runs_ws"
step "GET /api/v1/me/runs рейс отчёта первым total=$(jq -r '.total' "$runs_ws")"

if [[ -n "${ADMIN_PASSWORD:-}" ]]; then
  admin_login="$WORK/admin-login.json"
  code="$(curl -sS --max-time 30 -o "$admin_login" -w '%{http_code}' -c "$ADMIN_JAR" -b "$ADMIN_JAR" \
    -H 'content-type: application/json' \
    -d "$(jq -nc --arg password "$ADMIN_PASSWORD" '{login:"admin", password:$password}')" \
    "$BASE/api/v1/auth/login")"
  expect "$code" 200 "login admin" "$admin_login"
  [[ "$(jq -r '.user.role' "$admin_login")" == "ADMIN" ]] || die "роль не ADMIN" "$admin_login"
  [[ "$(jq -r '.user.mustChangePassword' "$admin_login")" == "true" ]] || die "admin без смены пароля" "$admin_login"
  admin_me="$WORK/admin-me.json"
  code="$(curl -sS --max-time 30 -o "$admin_me" -w '%{http_code}' -b "$ADMIN_JAR" -c "$ADMIN_JAR" "$BASE/api/v1/me")"
  expect "$code" 403 "GET /me admin при смене пароля" "$admin_me"
  [[ "$(jq -r '.code' "$admin_me")" == "PASSWORD_CHANGE_REQUIRED" ]] || die "кабинет admin открыт" "$admin_me"
  admin_session="$WORK/admin-session.json"
  code="$(curl -sS --max-time 30 -o "$admin_session" -w '%{http_code}' -b "$ADMIN_JAR" -c "$ADMIN_JAR" "$BASE/api/v1/auth/session")"
  expect "$code" 200 "GET /auth/session admin" "$admin_session"
  [[ "$(jq -r '.role' "$admin_session")" == "ADMIN" ]] || die "session admin без роли" "$admin_session"
  step "login admin: кабинет закрыт, session открыта"
else
  echo "skip login admin (нет ADMIN_PASSWORD)"
fi

echo "smoke ok"
