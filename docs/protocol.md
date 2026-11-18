# Project checker protocol v1

The server runs `node .architecture/cli.cjs` from the configured project root.
The checker reads one JSON request from stdin, writes one JSON response to
stdout, and sends logs to stderr. It may run any trusted project analysis needed
to execute the declared rules. No Git metadata or report filter is passed to it.

```json
{"protocol_version":1,"request_id":"example-request","scope":"project"}
```

The response echoes those three fields and adds:

| Field | Meaning |
| --- | --- |
| `status` | `pass`, `fail`, or `incomplete` |
| `checks` | Declared checks with unique `id`, string `version`, 64-character lowercase hex `implementation_sha256`, `status`, and `coverage.files` |
| `findings` | Findings with `rule_id`, project-relative `file` using forward slashes, one-based `line`, `severity` (`error` or `warning`), `message`, and `evidence`. Optional `end_line` is inclusive |
| `diagnostics` | Strings describing why an analysis was incomplete, or an empty array |
| `project`, `snapshot_sha256` | Optional project name and hash of scanned inputs |

A passing check must report nonempty file coverage and no error findings. A
failing check must report at least one error finding. A nonempty diagnostics
array or an incomplete check makes the entire result incomplete. Otherwise any
failing check makes the project fail. Zero checks are valid only for an
incomplete report with a diagnostic.

Exit codes must agree with report status: `0` for pass, `1` for fail, and `2`
for incomplete. The MCP returns these statuses as result data. A missing,
invalid, timed-out, or oversized project response yields `incomplete`.
The runner sets a 30-second timeout and a combined 2 MiB output limit and
forwards a minimal environment to the checker. It runs local project code
and is not a sandbox.

The server validates the full report before applying `report_filter`. The filter
uses exact relative paths with forward slashes and optional arrays of inclusive
one-based line ranges. Only the returned findings and coverage file list are
filtered; check and project statuses remain unchanged.
