# Локальные инструменты Game

Этот файл дополняет общую справку `../../../docs/agent/tools.md` конкретными
параметрами игрового модуля.

## just

`Game/justfile` предоставляет сокращения:

- `just setup` → `npm ci --include=dev`;
- `just check` → `npm run verify`;
- `just dev` → `npm run dev`;
- `just format` → `npm run format`.

Все npm-команды остаются основным публичным интерфейсом модуля.

## Pueue

Если агент передаёт процессы Game под управление Pueue:

- project key: `vsm-moscow-game`;
- group: `codex-vsm-moscow-game`;
- label prefix: `vsm-moscow-game-`;
- parallel limit: `1`;
- временный dev-сервер останавливается перед передачей результата.
