# Architecture Check MCP

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

Configure your MCP client to launch the server with the example project first.
Use absolute paths on your machine:

```toml
[mcp_servers.architecture-check]
command = "node"
args = ["/path/to/architecture-check-mcp/src/mcp-server.js", "--root", "/path/to/architecture-check-mcp/examples/layered-project"]
```

For clients that accept an `mcpServers` JSON object:

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

In meta-agent, use a custom stdio entry with
`id`, `command` and `args` in `space.json`. The `--root` argument binds one
server instance to one checkout. Use distinct instance names for multiple
projects.

Restart the MCP client and call `architecture_check` with `{}`. The example
should return `pass`. To see a finding, add
`"dependencies": { "@example/infrastructure": "*" }` to
`examples/layered-project/packages/domain/package.json` and call the tool again.

## Use it with your project

Copy [the example .architecture directory](examples/layered-project/.architecture/)
into your project, adapt its manifest and rules, and point `--root` at your
checkout. Or implement the same [JSON protocol](docs/protocol.md) with your own
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
  "report_filter": [
    { "path": "packages/domain/package.json", "lines": [[1, 10]] }
  ]
}
```

The project checker itself can also run directly. From the example project root:

```sh
printf '%s\n' '{"protocol_version":1,"request_id":"manual-1","scope":"project"}' |
  node .architecture/cli.cjs
```

It prints one JSON report. Exit codes are `0` for pass, `1` for violations,
and `2` for an incomplete check.

## License

[ISC](LICENSE).
