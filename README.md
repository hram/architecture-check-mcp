# Architecture Check MCP

English · [Русский](README.ru.md)

**Give your coding agent a way to verify architectural rules before review.**
A build can pass even after a domain package starts depending on infrastructure.
If your project forbids that dependency, Codex or Claude can run the check,
get the exact file, line, and reason, then fix the change and run the check again.

Your team keeps executable rules next to the code in `.architecture/`. The
server runs those rules against the current working tree, including uncommitted
changes, and returns a structured report. Projects without a checker return
`incomplete`. Your repository defines the checks and what they cover.

## Available tool

`architecture_check` runs all declared checks for the project you select.
Pass `project_path`, an absolute directory path on the host running the MCP
server. The same server can check a different project on the next call.

The report includes:

- `status`: `pass` when the declared checks pass, `fail` when they report
  error-level violations, or `incomplete` when the checks could not be completed or verified.
- `checks`: the individual checks and the files they covered.
- `findings`: rule ID, file, line, severity, explanation, and evidence for each
  finding.
- `diagnostics`: reasons why a check could not be completed.

Adding the forbidden dependency to the example project produces this excerpt
from the report:

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

Use the optional `report_filter` to see findings for selected files or lines
during review. The checker still runs all declared checks, and the project
status still reflects the full result.

```json
{
  "project_path": "/absolute/path/to/project",
  "report_filter": [
    { "path": "packages/domain/package.json", "lines": [[1, 10]] }
  ]
}
```

## Quick start

You'll need Node.js 22 or newer and an MCP client that supports stdio.

```sh
git clone https://github.com/hram/architecture-check-mcp.git
cd architecture-check-mcp
npm ci
npm test
```

Configure your MCP client to launch the server. Use an absolute path to the entry point:

```toml
[mcp_servers.architecture-check]
command = "node"
args = ["/path/to/architecture-check-mcp/src/mcp-server.js"]
```

For clients that accept an `mcpServers` JSON object:

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

Restart the MCP client and call `architecture_check`:

```json
{"project_path":"/path/to/architecture-check-mcp/examples/layered-project"}
```

The example should return `pass`. To reproduce the finding above, add
`"dependencies": { "@example/infrastructure": "*" }` to
`examples/layered-project/packages/domain/package.json` and call the tool again.

## Use it with your project

Copy [the example .architecture directory](examples/layered-project/.architecture/)
into your project, adapt its manifest and rules, and pass your checkout as
`project_path`. Or implement the same [JSON protocol](docs/protocol.md) with your own
checker. Only run the server against projects whose checker code you trust: it
executes `.architecture/cli.cjs` with your local permissions.

Start with one rule your team already looks for in code review. The example
checks the domain package's declared dependencies. Checking imports or
transitive dependencies requires a separate analyzer. In your agent's project
instructions, you can ask it to run `architecture_check` before finishing a
change and report the final status and any findings.

### Optional access scope

- `--allow-root /absolute/path` restricts checks to that directory and its descendants. Repeat it for several directories.
- `--project-manifest /path/to/projects.json` restricts checks to the exact directories in `{"projects":[{"path":"/absolute/path/to/project"}]}`.
- `--project-path-env VARIABLE` restricts checks to the exact directory in that variable when it is set. All configured restrictions apply together.

For meta-agent, add one custom stdio entry per space and pass `--project-manifest` with that space's `space.json` path and `--project-path-env PROJECT_PATH`. The same `project_path` tool argument applies to every client.

### Direct invocation

The project checker itself can also run directly. From the example project root:

```sh
printf '%s\n' '{"protocol_version":1,"request_id":"manual-1","scope":"project"}' |
  node .architecture/cli.cjs
```

It prints one JSON report. Exit codes are `0` for pass, `1` for violations,
and `2` for an incomplete check.

## License

[ISC](LICENSE).
