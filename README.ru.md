# Architecture Check MCP

[English](README.md) · Русский

**Дайте агенту способ проверить архитектуру правки до ревью.** Сборка и
функциональные тесты могут пройти, даже если доменный модуль начал зависеть от
инфраструктурного. Если это запрещено правилами проекта, Codex или Claude
может запустить проверку, получить файл, строку и причину нарушения, затем
исправить правку и проверить себя повторно.

Команда хранит исполняемые правила рядом с кодом в `.architecture/`. MCP
запускает их на текущих файлах, включая незакоммиченные изменения, и возвращает
структурированный отчёт. В проекте без проверяющего скрипта результат будет
`incomplete`. Набор и область проверок определяет ваш репозиторий.

## Доступный инструмент

`architecture_check` запускает все объявленные проверки выбранного проекта.
Передайте `project_path` — абсолютный путь к проекту на машине, где запущен
MCP. Следующим вызовом тот же сервер может проверить другой проект.

Ответ содержит:

- `status` — `pass`, если объявленные проверки прошли; `fail`, если есть
  нарушения уровня `error`; `incomplete`, если проверку не удалось завершить или подтвердить.
- `checks` — список выполненных или незавершённых проверок и файлы, которые
  они покрыли.
- `findings` — нарушения с ID правила, файлом, строкой, уровнем, объяснением
  и конкретным свидетельством.
- `diagnostics` — причины незавершённой проверки, если они есть.

Например, если добавить запрещённую зависимость в проект из репозитория,
инструмент вернёт такой фрагмент отчёта:

```json
{
  "status": "fail",
  "findings": [
    {
      "rule_id": "layers/domain-independence",
      "file": "packages/domain/package.json",
      "line": 4,
      "severity": "error",
      "message": "The domain package must not depend on infrastructure",
      "evidence": "dependencies.@example/infrastructure"
    }
  ]
}
```

Необязательный `report_filter` позволяет показать только находки в выбранных
файлах или диапазонах строк. Удобно при ревью небольшой правки: проверка всё
равно выполняется в полном объёме и статус относится ко всем правилам.

```json
{
  "project_path": "/absolute/path/to/project",
  "report_filter": [
    { "path": "packages/domain/package.json", "lines": [[1, 10]] }
  ]
}
```

## Быстрый старт

Нужны Node.js 22 или новее и MCP-клиент с поддержкой stdio.

```sh
git clone https://github.com/hram/architecture-check-mcp.git
cd architecture-check-mcp
npm ci
npm test
```

Настройте запуск MCP-сервера. Замените `/path/to/architecture-check-mcp` на абсолютный путь к клону.

Для Codex:

```toml
[mcp_servers.architecture-check]
command = "node"
args = ["/path/to/architecture-check-mcp/src/mcp-server.js"]
```

Для клиентов с JSON-конфигурацией `mcpServers`:

```json
{
  "mcpServers": {
    "architecture-check": {
      "command": "node",
      "args": [
        "/path/to/architecture-check-mcp/src/mcp-server.js"
      ]
    }
  }
}
```

Откройте новую сессию MCP-клиента и вызовите `architecture_check`:

```json
{"project_path":"/path/to/architecture-check-mcp/examples/layered-project"}
```

Пример вернёт `pass`. Чтобы воспроизвести отчёт выше, добавьте
`"dependencies": { "@example/infrastructure": "*" }` в
`examples/layered-project/packages/domain/package.json` и вызовите инструмент ещё раз.

## Подключение своего проекта

Скопируйте [пример `.architecture/`](examples/layered-project/.architecture/) в корень проекта, адаптируйте манифест и правила, затем передайте корень проекта в `project_path`. Вместо примера можно использовать собственный проверяющий скрипт с тем же [JSON-протоколом](docs/protocol.md). Запускайте сервер только для проектов, чьему коду доверяете: `.architecture/cli.cjs` выполняется с вашими локальными правами.

Начните с одного правила, которое команда уже проверяет на ревью. Например,
демонстрационное правило проверяет объявленные зависимости доменного пакета.
Для проверки импортов или транзитивных зависимостей нужен отдельный анализатор.
В инструкциях агента можно попросить вызывать `architecture_check` перед
завершением правки и указывать итоговый статус вместе с обнаруженными нарушениями.

## Ограничение доступа

- `--allow-root /absolute/path` разрешает проверять проекты в заданном каталоге и его подкаталогах. Параметр можно повторять.
- `--project-manifest /path/to/projects.json` разрешает точные пути из файла формата `{"projects":[{"path":"/absolute/path/to/project"}]}`.
- `--project-path-env VARIABLE` ограничивает проверку точным путём из этой переменной, если она задана. Все настроенные ограничения действуют одновременно.

В meta-agent настройте одну запись custom stdio на пространство. Передайте путь к его `space.json` через `--project-manifest` и укажите `--project-path-env PROJECT_PATH`. Аргумент инструмента `project_path` остаётся одинаковым для всех клиентов.

## Прямой запуск проверки

Из корня проверяемого проекта можно вызвать `.architecture/cli.cjs` напрямую:

```sh
printf '%s\n' '{"protocol_version":1,"request_id":"manual-1","scope":"project"}' |
  node .architecture/cli.cjs
```

Скрипт выводит один JSON-отчёт. Коды выхода: `0` — проверки прошли, `1` — есть нарушения, `2` — проверка неполная.

## Лицензия

[ISC](LICENSE).
