# Environment profile contract

Write reviewed switchable intent to `.rooty/config/environment-profiles.json` through:

```console
rooty env configure --file <approved-profile.json>
```

Do not edit an active host file directly. After the profile is configured, activate its initial target with `rooty env use <environment>`. The profile is team-shareable configuration; `.rooty/state/active-environments.json` is local, gitignored host state.

## Schema

```json
{
  "schema_version": 1,
  "environments": {
    "production": { "classification": "production", "aliases": ["prod"] },
    "preprod": { "classification": "non-production", "aliases": ["pre-production"] }
  },
  "logical_servers": {
    "sql-orders": {
      "capability": "data",
      "required": true,
      "targets": {
        "production": {
          "name": "rooty-prod-sql-orders",
          "artifacts": [".rooty/mcp/data/sql-server/production/orders/dab-config.json"],
          "credential_envs": ["ROOTY_SQL_ORDERS_PROD"],
          "allowed_tools": ["describe_entities", "read_records", "aggregate_records"],
          "probe": {
            "tool": "read_records",
            "arguments": { "entity": "EnvironmentIdentity", "first": 1 },
            "expect_contains": "production"
          },
          "hosts": {
            "cursor": { "type": "stdio", "command": "<absolute-node>", "args": ["<reviewed-args>"], "env": { "ASPNETCORE_URLS": "http://127.0.0.1:55101" } },
            "claude": { "type": "stdio", "command": "<absolute-node>", "args": ["<reviewed-args>"], "env": { "ROOTY_SQL_ORDERS_PROD": "${ROOTY_SQL_ORDERS_PROD}", "ASPNETCORE_URLS": "http://127.0.0.1:55101" } },
            "codex": { "type": "stdio", "command": "<absolute-node>", "args": ["<reviewed-args>"], "env_vars": ["ROOTY_SQL_ORDERS_PROD"], "env": { "ASPNETCORE_URLS": "http://127.0.0.1:55101" } }
          }
        },
        "preprod": {
          "name": "rooty-preprod-sql-orders",
          "artifacts": [".rooty/mcp/data/sql-server/preprod/orders/dab-config.json"],
          "credential_envs": ["ROOTY_SQL_ORDERS_PREPROD"],
          "allowed_tools": ["describe_entities", "read_records", "aggregate_records"],
          "probe": {
            "tool": "read_records",
            "arguments": { "entity": "EnvironmentIdentity", "first": 1 },
            "expect_contains": "preprod"
          },
          "hosts": {
            "cursor": { "type": "stdio", "command": "<absolute-node>", "args": ["<reviewed-args>"], "env": { "ASPNETCORE_URLS": "http://127.0.0.1:55111" } },
            "claude": { "type": "stdio", "command": "<absolute-node>", "args": ["<reviewed-args>"], "env": { "ROOTY_SQL_ORDERS_PREPROD": "${ROOTY_SQL_ORDERS_PREPROD}", "ASPNETCORE_URLS": "http://127.0.0.1:55111" } },
            "codex": { "type": "stdio", "command": "<absolute-node>", "args": ["<reviewed-args>"], "env_vars": ["ROOTY_SQL_ORDERS_PREPROD"], "env": { "ASPNETCORE_URLS": "http://127.0.0.1:55111" } }
          }
        }
      }
    }
  }
}
```

Replace every placeholder with the exact approved value. Add an independent logical server for observability and for every other source; data and observability are required for investigation readiness. A `required: false` logical server may omit a target or host rendering.

## Invariants

- Environment IDs and logical server IDs are stable lowercase identifiers.
- Each rendered MCP name starts with `rooty-` and visibly contains its target environment or a confirmed alias.
- The active host renders exactly one target per logical catalog or source; environment targets are never duplicated side by side.
- A rendered name is unique within its host/environment.
- Every selected required logical server has a target and host rendering for that environment.
- `artifacts` are project-relative regular files; missing or symlinked files block activation.
- `credential_envs` contains binding names only. Literal credentials, authenticated URLs, private keys, and literal authorization/API-key headers are rejected.
- `allowed_tools` is the complete expected live tool surface. Doctor fails on missing or unexpected tools and rejects mutation-like tools.
- `probe` is bounded, non-sensitive, and includes `expect_contains` that proves environment identity.
- Host entries are the exact values Rooty will merge. Cursor and Claude use `mcpServers` JSON entries; Codex uses `mcp_servers` TOML entries.

Run `rooty env plan <environment>` before approval. It validates target coverage, artifacts, credentials, and host inference without writing.
