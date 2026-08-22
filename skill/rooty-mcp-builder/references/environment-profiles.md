# Environment profile contract

Write reviewed switchable intent to `.rooty/config/environment-profiles.json` through:

```console
rooty env configure --file <approved-profile.json>
```

Do not edit an active host file directly. After the profile is configured, activate its initial target with `rooty env use <environment>`. The profile is team-shareable configuration; `.rooty/config/mcp-settings.local.json` contains local values and is Git-ignored. Rooty installs `.rooty/start-mcp.cjs` so every host reads the same JSON rather than inheriting machine environment variables.

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
          "settings_keys": ["ROOTY_SQL_ORDERS_PROD", "ROOTY_SQL_ORDERS_PROD_URLS"],
          "allowed_tools": ["describe_entities", "read_records", "aggregate_records"],
          "probe": {
            "tool": "read_records",
            "arguments": { "entity": "EnvironmentIdentity", "first": 1 },
            "expect_contains": "production"
          },
          "hosts": {
            "cursor": { "type": "stdio", "command": "<absolute-node>", "args": ["<absolute-project>/.rooty/start-mcp.cjs", "--settings", "<absolute-project>/.rooty/config/mcp-settings.local.json", "--keys", "ROOTY_SQL_ORDERS_PROD,ROOTY_SQL_ORDERS_PROD_URLS=ASPNETCORE_URLS", "--", "<absolute-node>", "<absolute-project>/.rooty/start-dab.cjs", "<reviewed-dab-args>"] },
            "claude": { "type": "stdio", "command": "<absolute-node>", "args": ["<absolute-project>/.rooty/start-mcp.cjs", "--settings", "<absolute-project>/.rooty/config/mcp-settings.local.json", "--keys", "ROOTY_SQL_ORDERS_PROD,ROOTY_SQL_ORDERS_PROD_URLS=ASPNETCORE_URLS", "--", "<absolute-node>", "<absolute-project>/.rooty/start-dab.cjs", "<reviewed-dab-args>"] },
            "codex": { "type": "stdio", "command": "<absolute-node>", "args": ["<absolute-project>/.rooty/start-mcp.cjs", "--settings", "<absolute-project>/.rooty/config/mcp-settings.local.json", "--keys", "ROOTY_SQL_ORDERS_PROD,ROOTY_SQL_ORDERS_PROD_URLS=ASPNETCORE_URLS", "--", "<absolute-node>", "<absolute-project>/.rooty/start-dab.cjs", "<reviewed-dab-args>"] }
          }
        },
        "preprod": {
          "name": "rooty-preprod-sql-orders",
          "artifacts": [".rooty/mcp/data/sql-server/preprod/orders/dab-config.json"],
          "settings_keys": ["ROOTY_SQL_ORDERS_PREPROD", "ROOTY_SQL_ORDERS_PREPROD_URLS"],
          "allowed_tools": ["describe_entities", "read_records", "aggregate_records"],
          "probe": {
            "tool": "read_records",
            "arguments": { "entity": "EnvironmentIdentity", "first": 1 },
            "expect_contains": "preprod"
          },
          "hosts": {
            "cursor": { "type": "stdio", "command": "<absolute-node>", "args": ["<absolute-project>/.rooty/start-mcp.cjs", "--settings", "<absolute-project>/.rooty/config/mcp-settings.local.json", "--keys", "ROOTY_SQL_ORDERS_PREPROD,ROOTY_SQL_ORDERS_PREPROD_URLS=ASPNETCORE_URLS", "--", "<absolute-node>", "<absolute-project>/.rooty/start-dab.cjs", "<reviewed-dab-args>"] },
            "claude": { "type": "stdio", "command": "<absolute-node>", "args": ["<absolute-project>/.rooty/start-mcp.cjs", "--settings", "<absolute-project>/.rooty/config/mcp-settings.local.json", "--keys", "ROOTY_SQL_ORDERS_PREPROD,ROOTY_SQL_ORDERS_PREPROD_URLS=ASPNETCORE_URLS", "--", "<absolute-node>", "<absolute-project>/.rooty/start-dab.cjs", "<reviewed-dab-args>"] },
            "codex": { "type": "stdio", "command": "<absolute-node>", "args": ["<absolute-project>/.rooty/start-mcp.cjs", "--settings", "<absolute-project>/.rooty/config/mcp-settings.local.json", "--keys", "ROOTY_SQL_ORDERS_PREPROD,ROOTY_SQL_ORDERS_PREPROD_URLS=ASPNETCORE_URLS", "--", "<absolute-node>", "<absolute-project>/.rooty/start-dab.cjs", "<reviewed-dab-args>"] }
          }
        }
      }
    }
  }
}
```

Replace every placeholder with the exact approved value. Add an independent logical server for observability and for every other source; data and observability are required for investigation readiness. A `required: false` logical server may omit a target or host rendering.

Initialize the local file with `rooty settings init --keys ROOTY_SQL_ORDERS_PROD,ROOTY_SQL_ORDERS_PROD_URLS,ROOTY_SQL_ORDERS_PREPROD,ROOTY_SQL_ORDERS_PREPROD_URLS`, then populate it from a private reviewed file using `rooty settings configure --file <private-settings.json>`. Its shape is:

```json
{
  "schema_version": 1,
  "settings": {
    "ROOTY_SQL_ORDERS_PROD": "<production read-only connection string>",
    "ROOTY_SQL_ORDERS_PROD_URLS": "http://127.0.0.1:55101",
    "ROOTY_SQL_ORDERS_PREPROD": "<preprod read-only connection string>",
    "ROOTY_SQL_ORDERS_PREPROD_URLS": "http://127.0.0.1:55102"
  }
}
```

Never commit or print this file. `rooty settings status` reports only key names and `AVAILABLE` or `MISSING`.

## Invariants

- Environment IDs and logical server IDs are stable lowercase identifiers.
- Each rendered MCP name starts with `rooty-` and visibly contains its target environment or a confirmed alias.
- The active host renders exactly one target per logical catalog or source; environment targets are never duplicated side by side.
- A rendered name is unique within its host/environment.
- Every selected required logical server has a target and host rendering for that environment.
- `artifacts` are project-relative regular files; missing or symlinked files block activation.
- `settings_keys` contains JSON keys only. Every settings-backed host entry must invoke `.rooty/start-mcp.cjs`, reference the canonical local JSON, and declare the same keys. Machine `env_vars`, host interpolation, literal credentials, authenticated URLs, private keys, and literal authorization/API-key headers are rejected.
- `allowed_tools` is the complete expected live tool surface. Doctor fails on missing or unexpected tools and rejects mutation-like tools.
- `probe` is bounded, non-sensitive, and includes `expect_contains` that proves environment identity.
- Host entries are the exact values Rooty will merge. Cursor and Claude use `mcpServers` JSON entries; Codex uses `mcp_servers` TOML entries.

Run `rooty env plan <environment>` before approval. It validates target coverage, artifacts, credentials, and host inference without writing.
