#!/usr/bin/env bash
# Сквозной прогон API: demo, REST-смена до COMPLETED, билет WS и отчёт.
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
first_before="$(jq -r '.runs[0].id // empty' "$runs_before")"
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

opened="$WORK/open-rest.json"
code="$(req POST /api/v1/game-sessions "$opened" -H 'content-type: application/json' -d '{"transport":"REST"}')"
expect "$code" 200 "POST game-sessions REST" "$opened"
sid="$(jq -er '.sessionId' "$opened")"
seed_commit="$(jq -er '.seedCommit' "$opened")"
step "POST /api/v1/game-sessions REST session=$sid"

view="$WORK/view.json"
decision="$WORK/decision.json"
finished=0
for step_n in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60; do
  code="$(req GET "/api/v1/game-sessions/$sid" "$view")"
  expect "$code" 200 "GET game-sessions/$sid шаг $step_n" "$view"
  status="$(jq -r '.status' "$view")"
  view_finished="$(jq -r '.view.finished' "$view")"
  if [[ "$status" == "COMPLETED" || "$view_finished" == "true" ]]; then
    finished=1
    break
  fi
  choice="$(jq -r '.view.choices[0].id // empty' "$view")"
  seq="$(jq -r '.seq' "$view")"
  [[ -n "$choice" ]] || die "нет choice на шаге $step_n status=$status" "$view"
  payload="$(jq -nc --argjson seq "$seq" --arg choice "$choice" '{seq:$seq, choiceId:$choice}')"
  code="$(req POST "/api/v1/game-sessions/$sid/decisions" "$decision" -H 'content-type: application/json' -d "$payload")"
  expect "$code" 200 "POST decisions шаг $step_n" "$decision"
  if [[ "$(jq -r '.finished' "$decision")" == "true" || "$(jq -r '.status' "$decision")" == "COMPLETED" ]]; then
    finished=1
    break
  fi
done
[[ "$finished" == "1" ]] || die "REST-смена не дошла до COMPLETED" "$view"
step "REST-смена COMPLETED за шаги цикла"

runs_after="$WORK/runs-after.json"
code="$(req GET '/api/v1/me/runs?limit=5' "$runs_after")"
expect "$code" 200 "GET /me/runs после REST" "$runs_after"
total_after="$(jq -er '.total' "$runs_after")"
rest_run="$(jq -er '.runs[0].id' "$runs_after")"
[[ "$total_after" == "$((total_before + 1))" ]] || die "total рейсов $total_before -> $total_after" "$runs_after"
[[ "$rest_run" != "$first_before" ]] || die "новый рейс не первый" "$runs_after"
step "GET /api/v1/me/runs новый рейс первым id=$rest_run total=$total_after"

detail="$WORK/run.json"
code="$(req GET "/api/v1/me/runs/$rest_run" "$detail")"
expect "$code" 200 "GET /me/runs/$rest_run" "$detail"
dec_n="$(jq -er '.decisions | length' "$detail")"
[[ "$dec_n" -gt 0 ]] || die "разбор без decisions" "$detail"
step "GET /api/v1/me/runs/:id decisions=$dec_n"

reveal="$WORK/reveal.json"
code="$(req GET "/api/v1/game-sessions/$sid/reveal" "$reveal")"
expect "$code" 200 "GET reveal" "$reveal"
seed_hex="$(jq -er '.seed' "$reveal")"
commit_hex="$(jq -er '.commit' "$reveal")"
actual="$(printf '%s' "$seed_hex" | xxd -r -p | openssl dgst -sha256 | awk '{print $NF}')"
[[ "$actual" == "$commit_hex" && "$commit_hex" == "$seed_commit" ]] \
  || die "sha256(seed)=$actual commit=$commit_hex open=$seed_commit" "$reveal"
step "GET reveal sha256(seed)=commit"

ws="$WORK/open-ws.json"
code="$(req POST /api/v1/game-sessions "$ws" -H 'content-type: application/json' -d '{"transport":"WS"}')"
expect "$code" 200 "POST game-sessions WS" "$ws"
ws_id="$(jq -er '.sessionId' "$ws")"
ticket="$(jq -er '.ticket' "$ws")"
[[ "$ws_id" != "$sid" ]] || die "WS вернул ту же REST-сессию" "$ws"
step "POST /api/v1/game-sessions WS session=$ws_id"

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
[[ "$(jq -r '.total' "$runs_ws")" == "$((total_after + 1))" ]] || die "total после отчёта" "$runs_ws"
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
  expect "$code" 200 "GET /me admin" "$admin_me"
  step "login admin mustChangePassword=true"
else
  echo "skip login admin (нет ADMIN_PASSWORD)"
fi

echo "smoke ok"
