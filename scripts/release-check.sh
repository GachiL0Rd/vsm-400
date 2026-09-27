#!/usr/bin/env bash
# Релизные проверки из docs/agent/workflow.md перед переносом main в release:
# чистая установка, полный verify каждого модуля (включает production-сборку
# и smoke Game Server), проверка продового compose и отсутствие секретов в Git.
# Backend verify требует локальные Postgres и Valkey (Backend/docker-compose.yml).
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "working tree is not clean" >&2
  exit 1
fi

for module in Game Backend Frontend; do
  echo "== $module: clean install + verify"
  (
    cd "$module"
    rm -rf node_modules
    npm ci --include=dev
    npm run verify
  )
done

echo "== deploy: compose config"
(
  cd deploy
  DOMAIN=example.test POSTGRES_PASSWORD=x JWT_ACCESS_SECRET=x GAME_TICKET_SECRET=x \
    GAME_SERVER_TOKEN=x SEED_ENC_KEY=x EXT_ID_PEPPER=x \
    docker compose config --quiet
)

echo "== git: no secrets or local env files tracked"
if git ls-files | grep -E '(^|/)\.env$|(^|/)\.env\.[^e]' ; then
  echo "tracked env files found" >&2
  exit 1
fi

echo "release checks passed"
