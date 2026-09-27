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

## Knip

Для advisory-аудита dead code и зависимостей:

```powershell
npm run audit:dead-code
```

Скрипт намеренно не входит в `verify` и использует `--no-exit-code`: на текущем этапе он показывает как реальные находки, так и зависимости, уже добавленные для ближайшей интеграции (`ws`, `zod`, `heap-js`).

Wrapper задаёт `KNIP_DISABLE_RAW_TRANSFER=1`, потому что raw-transfer парсер Knip/OXC резервирует очень большой ArrayBuffer и непрактичен в ограниченной агентной Linux-среде. Это не влияет на семантику самого аудита.
