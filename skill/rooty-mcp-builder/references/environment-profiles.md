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
          "settings_keys": ["prod.sql.server", "prod.sql.user", "prod.sql.password", "prod.sql.options", "prod.sql.catalogs.orders.name", "prod.sql.catalogs.orders.mcp_url"],
          "allowed_tools": ["describe_entities", "read_records", "aggregate_records"],
          "probe": {
            "tool": "read_records",
            "arguments": { "entity": "EnvironmentIdentity", "first": 1 },
            "expect_contains": "production"
          },
          "hosts": {
            "cursor": { "type": "stdio", "command": "<absolute-node>", "args": ["<absolute-project>/.rooty/start-mcp.cjs", "--settings", "<absolute-project>/.rooty/config/mcp-settings.local.json", "--keys", "prod.sql.server=ROOTY_SQL_PROD_SERVER,prod.sql.user=ROOTY_SQL_PROD_USER,prod.sql.password=ROOTY_SQL_PROD_PASSWORD,prod.sql.options=ROOTY_SQL_PROD_OPTIONS,prod.sql.catalogs.orders.name=ROOTY_SQL_PROD_CATALOG,prod.sql.catalogs.orders.mcp_url=ASPNETCORE_URLS", "--", "<absolute-node>", "<absolute-project>/.rooty/start-dab.cjs", "<grouped-sql-dab-args>"] },
            "claude": { "type": "stdio", "command": "<absolute-node>", "args": ["<absolute-project>/.rooty/start-mcp.cjs", "--settings", "<absolute-project>/.rooty/config/mcp-settings.local.json", "--keys", "prod.sql.server=ROOTY_SQL_PROD_SERVER,prod.sql.user=ROOTY_SQL_PROD_USER,prod.sql.password=ROOTY_SQL_PROD_PASSWORD,prod.sql.options=ROOTY_SQL_PROD_OPTIONS,prod.sql.catalogs.orders.name=ROOTY_SQL_PROD_CATALOG,prod.sql.catalogs.orders.mcp_url=ASPNETCORE_URLS", "--", "<absolute-node>", "<absolute-project>/.rooty/start-dab.cjs", "<grouped-sql-dab-args>"] },
            "codex": { "type": "stdio", "command": "<absolute-node>", "args": ["<absolute-project>/.rooty/start-mcp.cjs", "--settings", "<absolute-project>/.rooty/config/mcp-settings.local.json", "--keys", "prod.sql.server=ROOTY_SQL_PROD_SERVER,prod.sql.user=ROOTY_SQL_PROD_USER,prod.sql.password=ROOTY_SQL_PROD_PASSWORD,prod.sql.options=ROOTY_SQL_PROD_OPTIONS,prod.sql.catalogs.orders.name=ROOTY_SQL_PROD_CATALOG,prod.sql.catalogs.orders.mcp_url=ASPNETCORE_URLS", "--", "<absolute-node>", "<absolute-project>/.rooty/start-dab.cjs", "<grouped-sql-dab-args>"] }
          }
        },
        "preprod": {
          "name": "rooty-preprod-sql-orders",
          "artifacts": [".rooty/mcp/data/sql-server/preprod/orders/dab-config.json"],
          "settings_keys": ["preprod.sql.server", "preprod.sql.user", "preprod.sql.password", "preprod.sql.options", "preprod.sql.catalogs.orders.name", "preprod.sql.catalogs.orders.mcp_url"],
          "allowed_tools": ["describe_entities", "read_records", "aggregate_records"],
          "probe": {
            "tool": "read_records",
            "arguments": { "entity": "EnvironmentIdentity", "first": 1 },
            "expect_contains": "preprod"
          },
          "hosts": {
            "cursor": { "type": "stdio", "command": "<absolute-node>", "args": ["<absolute-project>/.rooty/start-mcp.cjs", "--settings", "<absolute-project>/.rooty/config/mcp-settings.local.json", "--keys", "preprod.sql.server=ROOTY_SQL_PREPROD_SERVER,preprod.sql.user=ROOTY_SQL_PREPROD_USER,preprod.sql.password=ROOTY_SQL_PREPROD_PASSWORD,preprod.sql.options=ROOTY_SQL_PREPROD_OPTIONS,preprod.sql.catalogs.orders.name=ROOTY_SQL_PREPROD_CATALOG,preprod.sql.catalogs.orders.mcp_url=ASPNETCORE_URLS", "--", "<absolute-node>", "<absolute-project>/.rooty/start-dab.cjs", "<grouped-sql-dab-args>"] },
            "claude": { "type": "stdio", "command": "<absolute-node>", "args": ["<absolute-project>/.rooty/start-mcp.cjs", "--settings", "<absolute-project>/.rooty/config/mcp-settings.local.json", "--keys", "preprod.sql.server=ROOTY_SQL_PREPROD_SERVER,preprod.sql.user=ROOTY_SQL_PREPROD_USER,preprod.sql.password=ROOTY_SQL_PREPROD_PASSWORD,preprod.sql.options=ROOTY_SQL_PREPROD_OPTIONS,preprod.sql.catalogs.orders.name=ROOTY_SQL_PREPROD_CATALOG,preprod.sql.catalogs.orders.mcp_url=ASPNETCORE_URLS", "--", "<absolute-node>", "<absolute-project>/.rooty/start-dab.cjs", "<grouped-sql-dab-args>"] },
            "codex": { "type": "stdio", "command": "<absolute-node>", "args": ["<absolute-project>/.rooty/start-mcp.cjs", "--settings", "<absolute-project>/.rooty/config/mcp-settings.local.json", "--keys", "preprod.sql.server=ROOTY_SQL_PREPROD_SERVER,preprod.sql.user=ROOTY_SQL_PREPROD_USER,preprod.sql.password=ROOTY_SQL_PREPROD_PASSWORD,preprod.sql.options=ROOTY_SQL_PREPROD_OPTIONS,preprod.sql.catalogs.orders.name=ROOTY_SQL_PREPROD_CATALOG,preprod.sql.catalogs.orders.mcp_url=ASPNETCORE_URLS", "--", "<absolute-node>", "<absolute-project>/.rooty/start-dab.cjs", "<grouped-sql-dab-args>"] }
          }
        }
      }
    }
  }
}
```

Replace every placeholder with the exact approved value. Add an independent logical server for observability and for every other source; data and observability are required for investigation readiness. A `required: false` logical server may omit a target or host rendering.

`<grouped-sql-dab-args>` means the reviewed DAB executable and config arguments followed by `--credential-env ROOTY_SQL_<DOMAIN>_<ENV> --server-env ROOTY_SQL_<ENV>_SERVER --database-env ROOTY_SQL_<ENV>_CATALOG --options-env ROOTY_SQL_<ENV>_OPTIONS --user-env ROOTY_SQL_<ENV>_USER --password-env ROOTY_SQL_<ENV>_PASSWORD`.

Initialize the local file with the nested paths declared by every target, then populate it from a private reviewed file using `rooty settings configure --file <private-settings.json>`. Its required SQL shape is:

```json
{
  "schema_version": 2,
  "settings": {
    "prod": {
      "sql": {
        "server": "sql-ecm-prd-san-1.database.windows.net",
        "user": "<shared production read-only user>",
        "password": "<shared production read-only password>",
        "options": "TrustServerCertificate=True;Trusted_Connection=False;Encrypt=True;MultipleActiveResultSets=true",
        "catalogs": {
          "orders": {
            "name": "StoreCloud_Orders",
            "mcp_url": "http://127.0.0.1:55101"
          }
        }
      },
      "elasticsearch": {
        "url": "https://els-ecm-prd-san-1-dfe614.es.southafricanorth.azure.elastic-cloud.com",
        "username": "elastic",
        "password": "<ELASTICSEARCH_PASSWORD>"
      }
    },
    "preprod": {
      "sql": {
        "server": "<shared preprod SQL server endpoint>",
        "user": "<shared preprod read-only user>",
        "password": "<shared preprod read-only password>",
        "options": "TrustServerCertificate=True;Trusted_Connection=False;Encrypt=True;MultipleActiveResultSets=true",
        "catalogs": {
          "orders": {
            "name": "<preprod Orders catalog>",
            "mcp_url": "http://127.0.0.1:55102"
          }
        }
      }
    }
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
- `settings_keys` contains JSON keys or dot-separated nested paths only. Every settings-backed host entry must invoke `.rooty/start-mcp.cjs`, reference the canonical local JSON, and declare the same paths. Machine `env_vars`, host interpolation, literal credentials, authenticated URLs, private keys, and literal authorization/API-key headers are rejected.
- SQL uses one environment group. `server`, `options`, `user`, and `password` are shared within that group; every catalog keeps a `name` and a unique loopback `mcp_url`. Reusing one `mcp_url` for multiple catalogs is forbidden.
- `allowed_tools` is the complete expected live tool surface. Doctor fails on missing or unexpected tools and rejects mutation-like tools.
- `probe` is bounded, non-sensitive, and includes `expect_contains` that proves environment identity.
- Host entries are the exact values Rooty will merge. Cursor and Claude use `mcpServers` JSON entries; Codex uses `mcp_servers` TOML entries.

Run `rooty env plan <environment>` before approval. It validates target coverage, artifacts, credentials, and host inference without writing.
