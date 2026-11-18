# Architecture Check MCP

English · [Русский](README.ru.md)

A local stdio MCP server that runs the architecture rules defined by your
project. It works with MCP clients such as Codex and Claude and requires Node.js
22 or newer. Each project owns its rules and can use its preferred analysis
libraries or build tools.

## Quick start

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

The same server can check another project on the next call. The example
should return `pass`. To see a finding, add
`"dependencies": { "@example/infrastructure": "*" }` to
`examples/layered-project/packages/domain/package.json` and call the tool again.

## Use it with your project

Copy [the example .architecture directory](examples/layered-project/.architecture/)
into your project, adapt its manifest and rules, and pass your checkout as
`project_path`. Or implement the same [JSON protocol](docs/protocol.md) with your own
checker. Only run the server against projects whose checker code you trust: it
executes `.architecture/cli.cjs` with your local permissions.

The checker runs against the working tree, including uncommitted files.
Each rule reports what it covered. The example checks
the domain package's declared dependencies; it does not inspect JavaScript
imports or transitive dependencies.

You can optionally narrow the returned findings to selected files or lines.
This leaves the overall status and check statuses unchanged:

```json
{
  "project_path": "/absolute/path/to/project",
  "report_filter": [
    { "path": "packages/domain/package.json", "lines": [[1, 10]] }
  ]
}
```

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
