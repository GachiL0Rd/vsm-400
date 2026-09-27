# VSM Moscow

Многомодульный проект обучающего симулятора проводника высокоскоростного
поезда. Сейчас в репозитории реализован модуль `Game/`, объединяющий Browser
Game Client и authoritative Game Server. Platform Server остаётся внешней
сервисной границей.

## Карта репозитория

| Путь | Содержимое |
| --- | --- |
| `Game/` | Browser client и Game Server; запуск описан в `Game/README.md` |
| `Game/docs/` | Нормативные требования, рабочие guide и архив только модуля Game |
| `docs/` | Кросс-проектный workflow, исследования и архив; карта — в `docs/README.md` |

Начните с [`docs/README.md`](docs/README.md), затем выберите модуль через
[`AGENTS.md`](AGENTS.md). Для работы с Game продолжайте с
[`Game/docs/README.md`](Game/docs/README.md) и
[`Game/docs/user/README.md`](Game/docs/user/README.md). Правила участия
описаны в [`CONTRIBUTING.md`](CONTRIBUTING.md).

Каждый модуль самостоятельно определяет зависимости, команды и локальный
tooling. Корень связывает модули документацией и CI, но не подменяет их систему
сборки.
