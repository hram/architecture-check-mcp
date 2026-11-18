# Architecture Check MCP

[English](README.md) · Русский

Локальный MCP-сервер, который запускает архитектурные проверки, заданные в самом проекте. Подходит для Codex, Claude и других клиентов с поддержкой MCP через stdio. Требуется Node.js 22 или новее.

## Быстрый старт

```sh
git clone https://github.com/hram/architecture-check-mcp.git
cd architecture-check-mcp
npm ci
npm test
```

Для первого запуска передайте серверу путь к проекту из примера. Замените `/path/to/architecture-check-mcp` на абсолютный путь к клону.

Для Codex:

```toml
[mcp_servers.architecture-check]
command = "node"
args = ["/path/to/architecture-check-mcp/src/mcp-server.js", "--root", "/path/to/architecture-check-mcp/examples/layered-project"]
```

Для клиентов с JSON-конфигурацией `mcpServers`:

```json
{
  "mcpServers": {
    "architecture-check": {
      "command": "node",
      "args": [
        "/path/to/architecture-check-mcp/src/mcp-server.js",
        "--root",
        "/path/to/architecture-check-mcp/examples/layered-project"
      ]
    }
  }
}
```

В meta-agent добавьте в `space.json` запись custom stdio с полями `id`, `command` и `args`. Параметр `--root` привязывает экземпляр сервера к одному проекту. Для нескольких проектов задайте разные имена экземпляров.

Откройте новую сессию MCP-клиента и вызовите `architecture_check` с `{}`. Пример должен вернуть `pass`. Чтобы увидеть нарушение, добавьте `"dependencies": { "@example/infrastructure": "*" }` в `examples/layered-project/packages/domain/package.json` и вызовите инструмент ещё раз.

## Подключение своего проекта

Скопируйте [пример `.architecture/`](examples/layered-project/.architecture/) в корень проекта, адаптируйте манифест и правила, затем передайте корень проекта в `--root`. Вместо примера можно использовать собственный проверяющий скрипт с тем же [JSON-протоколом](docs/protocol.md). Запускайте сервер только для проектов, чьему коду доверяете: `.architecture/cli.cjs` выполняется с вашими локальными правами.

Проверки работают с текущим состоянием проекта, включая незакоммиченные файлы. Каждое правило указывает, что именно оно проверило. Например, правило из репозитория проверяет объявленные зависимости доменного пакета. Импорты JavaScript и транзитивные зависимости оно не анализирует.

`report_filter` ограничивает список находок по файлам и диапазонам строк. Статусы проекта и правил по-прежнему относятся к полной проверке.

```json
{
  "report_filter": [
    { "path": "packages/domain/package.json", "lines": [[1, 10]] }
  ]
}
```

## Прямой запуск проверки

Из корня проверяемого проекта можно вызвать `.architecture/cli.cjs` напрямую:

```sh
printf '%s\n' '{"protocol_version":1,"request_id":"manual-1","scope":"project"}' |
  node .architecture/cli.cjs
```

Скрипт выводит один JSON-отчёт. Коды выхода: `0` — проверки прошли, `1` — есть нарушения, `2` — проверка неполная.

## Лицензия

[ISC](LICENSE).
