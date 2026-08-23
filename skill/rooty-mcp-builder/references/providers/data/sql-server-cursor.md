# Tested per-catalog SQL Server pattern for every host

This recipe was established from the Cursor and Azure SQL multi-catalog test, then adopted as the Rooty default for **Codex, Cursor, and Claude**. Do not substitute DAB multi-source configuration.

## Fixed architecture

For each live catalog, install one independently startable server:

```text
.rooty/
├── start-mcp.cjs
├── start-dab.cjs
├── config/mcp-settings.local.json
└── mcp/
    └── data/
        └── sql-server/
            ├── production/
            │   ├── orders/dab-config.json
            │   └── logger/dab-config.json
            └── preprod/
                ├── orders/dab-config.json
                └── logger/dab-config.json
```

This is the canonical environment-aware Rooty provider layout, `.rooty/mcp/<category>/<provider>/<environment>/<domain>/`, with one target folder per environment and catalog. The launcher still accepts `.rooty/mcp/data/sql-server/<domain>/dab-config.json` and the earlier `.rooty/mcp-<domain>/dab-config.json` location so an existing install keeps working; move those folders when convenient and update the environment profile and active host `--config` path in the same approved change.

Logical server IDs are stable (`sql-orders`, `sql-logger`), while active host names expose the selected target, such as `rooty-prod-sql-orders` or `rooty-preprod-sql-orders`. Only one name for each logical server may be active in a host file. Copy the packaged [launcher asset](../../../assets/start-dab.cjs) to `.rooty/start-dab.cjs` after the exact write is approved. Preserve an identical existing launcher; refuse an unrelated or modified file instead of replacing it.

The launcher makes the DAB config folder its real process CWD. Use it on every host even if a host currently supports `cwd`, because Cursor does not guarantee it and the same process contract should be portable.

## Prerequisites and discovery

1. Locate absolute paths to the host's Node runtime (`node.exe` on Windows) and DAB executable (`dab.exe` on Windows). Do not rely on `PATH`.
2. Connect with an approved metadata/read-only identity and list live catalogs using `sys.databases`.
3. In each catalog, list current objects from `INFORMATION_SCHEMA.TABLES`, then inspect columns and primary-key metadata needed by DAB.
4. Present catalog and explicit entity selections before writing files. Documentation can orient this selection but cannot supply unverified names.
5. Allocate a distinct, currently free loopback port for every catalog. Use an explicit nonzero value such as `http://127.0.0.1:55101`; never use `:0`.

## Credential contract

Schema version 2 groups SQL values by environment. Each group has one shared `sql.server`, `sql.options`, `sql.user`, and `sql.password`. Every catalog adds `sql.catalogs.<domain>.name` and a unique `sql.catalogs.<domain>.mcp_url`. For example, Orders production declares `prod.sql.server`, `prod.sql.user`, `prod.sql.password`, `prod.sql.options`, `prod.sql.catalogs.orders.name`, and `prod.sql.catalogs.orders.mcp_url`.

All paths are visible in `settings_keys` and the target's host entry. Their values exist only in the Git-ignored `.rooty/config/mcp-settings.local.json`. The outer launcher maps the paths to child environment names and maps the catalog's `mcp_url` to `ASPNETCORE_URLS`. The DAB launcher assembles `ROOTY_SQL_ORDERS_PROD` in memory from the SQL server, catalog, options, user, and password components. A production Orders DAB config still contains only `@env('ROOTY_SQL_ORDERS_PROD')`. Never create a `.env` beside the DAB config, put a literal connection string in Git, or print a resolved value. The shared user must be independently `SELECT`-only in every included catalog.

Before startup, display a table containing server name, catalog, host config path, setting key, `AVAILABLE` or `MISSING`, config path, and next action. Availability checks test only whether each JSON value exists and is non-empty.

## DAB config per catalog

Generate one self-contained `.rooty/mcp/data/sql-server/{environment}/{domain}/dab-config.json` per selected target with explicit entities only. Every entity must come from live metadata for that environment and explicitly name a table or view. For example:

```json
{
  "data-source": {
    "database-type": "mssql",
    "connection-string": "@env('ROOTY_SQL_ORDERS_PROD')"
  },
  "runtime": {
    "rest": { "enabled": false },
    "graphql": { "enabled": false },
    "mcp": {
      "enabled": true,
      "dml-tools": {
        "describe-entities": true,
        "create-record": false,
        "read-records": true,
        "update-record": false,
        "delete-record": false,
        "execute-entity": false,
        "aggregate-records": {
          "enabled": true,
          "query-timeout": 15
        }
      }
    }
  },
  "entities": {
    "Orders": {
      "source": {
        "object": "sales.Orders",
        "type": "table"
      },
      "permissions": [
        {
          "role": "rooty-reader",
          "actions": ["read"]
        }
      ]
    }
  }
}
```

Add view primary-key metadata when the current DAB schema requires it. Do not expose stored procedures, even if documentation describes them, unless a later separately reviewed Rooty design proves them side-effect-free.

## Launcher invocation

Every host entry runs the same fixed process:

```text
<absolute-node> <absolute-project>/.rooty/start-mcp.cjs --settings <absolute-project>/.rooty/config/mcp-settings.local.json --keys <env>.sql.server=ROOTY_SQL_<ENV>_SERVER,<env>.sql.user=ROOTY_SQL_<ENV>_USER,<env>.sql.password=ROOTY_SQL_<ENV>_PASSWORD,<env>.sql.options=ROOTY_SQL_<ENV>_OPTIONS,<env>.sql.catalogs.<domain>.name=ROOTY_SQL_<ENV>_CATALOG,<env>.sql.catalogs.<domain>.mcp_url=ASPNETCORE_URLS -- <absolute-node> <absolute-project>/.rooty/start-dab.cjs --dab <absolute-dab> --config <absolute-project>/.rooty/mcp/data/sql-server/<environment>/<domain>/dab-config.json --credential-env ROOTY_SQL_<DOMAIN>_<ENV> --server-env ROOTY_SQL_<ENV>_SERVER --database-env ROOTY_SQL_<ENV>_CATALOG --options-env ROOTY_SQL_<ENV>_OPTIONS --user-env ROOTY_SQL_<ENV>_USER --password-env ROOTY_SQL_<ENV>_PASSWORD
```

The launcher starts DAB directly with `shell: false`, the catalog folder as CWD, inherited standard I/O, and exactly:

```text
dab start --mcp-stdio role:rooty-reader --config <absolute-config> --LogLevel Error
```

The outer launcher reads only the target's declared JSON keys. The DAB launcher removes inherited `DAB_ENVIRONMENT` and rejects `.env`, multi-source, autoentity, mutation-enabled, missing-setting, non-explicit-port, and shell-wrapper configurations.

## Codex project entry

Merge one table per catalog into trusted-project `.codex/config.toml`:

```toml
[mcp_servers."rooty-prod-sql-orders"]
command = "C:\\Program Files\\nodejs\\node.exe"
args = ["C:\\project\\.rooty\\start-mcp.cjs", "--settings", "C:\\project\\.rooty\\config\\mcp-settings.local.json", "--keys", "prod.sql.server=ROOTY_SQL_PROD_SERVER,prod.sql.user=ROOTY_SQL_PROD_USER,prod.sql.password=ROOTY_SQL_PROD_PASSWORD,prod.sql.options=ROOTY_SQL_PROD_OPTIONS,prod.sql.catalogs.orders.name=ROOTY_SQL_PROD_CATALOG,prod.sql.catalogs.orders.mcp_url=ASPNETCORE_URLS", "--", "C:\\Program Files\\nodejs\\node.exe", "C:\\project\\.rooty\\start-dab.cjs", "--dab", "C:\\tools\\dab.exe", "--config", "C:\\project\\.rooty\\mcp\\data\\sql-server\\production\\orders\\dab-config.json", "--credential-env", "ROOTY_SQL_ORDERS_PROD", "--server-env", "ROOTY_SQL_PROD_SERVER", "--database-env", "ROOTY_SQL_PROD_CATALOG", "--options-env", "ROOTY_SQL_PROD_OPTIONS", "--user-env", "ROOTY_SQL_PROD_USER", "--password-env", "ROOTY_SQL_PROD_PASSWORD"]
enabled = true
required = false
enabled_tools = ["describe_entities", "read_records", "aggregate_records"]
default_tools_approval_mode = "prompt"
```

Do not add `cwd` or `env_vars`; the launchers own the working directory and settings. Keep each catalog `required = false` so one unavailable catalog does not prevent healthy catalog servers from loading; Rooty's capability readiness still requires every investigation-required catalog to pass.

## Cursor project entry

Merge one entry per catalog into `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "rooty-prod-sql-orders": {
      "type": "stdio",
      "command": "C:/Program Files/nodejs/node.exe",
      "args": [
        "C:/project/.rooty/start-mcp.cjs",
        "--settings",
        "C:/project/.rooty/config/mcp-settings.local.json",
        "--keys",
        "prod.sql.server=ROOTY_SQL_PROD_SERVER,prod.sql.user=ROOTY_SQL_PROD_USER,prod.sql.password=ROOTY_SQL_PROD_PASSWORD,prod.sql.options=ROOTY_SQL_PROD_OPTIONS,prod.sql.catalogs.orders.name=ROOTY_SQL_PROD_CATALOG,prod.sql.catalogs.orders.mcp_url=ASPNETCORE_URLS",
        "--",
        "C:/Program Files/nodejs/node.exe",
        "C:/project/.rooty/start-dab.cjs",
        "--dab",
        "C:/tools/dab.exe",
        "--config",
        "C:/project/.rooty/mcp/data/sql-server/production/orders/dab-config.json",
        "--credential-env",
        "ROOTY_SQL_ORDERS_PROD",
        "--server-env",
        "ROOTY_SQL_PROD_SERVER",
        "--database-env",
        "ROOTY_SQL_PROD_CATALOG",
        "--options-env",
        "ROOTY_SQL_PROD_OPTIONS",
        "--user-env",
        "ROOTY_SQL_PROD_USER",
        "--password-env",
        "ROOTY_SQL_PROD_PASSWORD"
      ]
    }
  }
}
```

Populate the local settings JSON before launching Cursor. The outer launcher fails with exact missing key names without revealing values. No Cursor environment interpolation is required.

## Claude project entry

Merge one entry per catalog into project `.mcp.json`:

```json
{
  "mcpServers": {
    "rooty-prod-sql-orders": {
      "type": "stdio",
      "command": "C:/Program Files/nodejs/node.exe",
      "args": [
        "C:/project/.rooty/start-mcp.cjs",
        "--settings",
        "C:/project/.rooty/config/mcp-settings.local.json",
        "--keys",
        "prod.sql.server=ROOTY_SQL_PROD_SERVER,prod.sql.user=ROOTY_SQL_PROD_USER,prod.sql.password=ROOTY_SQL_PROD_PASSWORD,prod.sql.options=ROOTY_SQL_PROD_OPTIONS,prod.sql.catalogs.orders.name=ROOTY_SQL_PROD_CATALOG,prod.sql.catalogs.orders.mcp_url=ASPNETCORE_URLS",
        "--",
        "C:/Program Files/nodejs/node.exe",
        "C:/project/.rooty/start-dab.cjs",
        "--dab",
        "C:/tools/dab.exe",
        "--config",
        "C:/project/.rooty/mcp/data/sql-server/production/orders/dab-config.json",
        "--credential-env",
        "ROOTY_SQL_ORDERS_PROD",
        "--server-env",
        "ROOTY_SQL_PROD_SERVER",
        "--database-env",
        "ROOTY_SQL_PROD_CATALOG",
        "--options-env",
        "ROOTY_SQL_PROD_OPTIONS",
        "--user-env",
        "ROOTY_SQL_PROD_USER",
        "--password-env",
        "ROOTY_SQL_PROD_PASSWORD"
      ]
    }
  }
}
```

Claude invokes the same settings-backed process as the other hosts; no Claude environment interpolation is required.

## Readiness per catalog

For each active `rooty-{environment}-sql-{domain}` independently:

1. Confirm every declared local JSON setting exists without displaying it.
2. Start through the active host and complete MCP initialize.
3. Require `tools/list` to advertise exactly `describe_entities`, `read_records`, and `aggregate_records`.
4. Require a non-empty `describe_entities` result matching only explicit configured entities.
5. Run one bounded, non-sensitive read with a small result limit.
6. Confirm the SQL identity is `SELECT`-only and report `READY` or one actionable unresolved state.

Do not use `dab validate` on DAB 2.0.10 as a process-health or readiness check. Host MCP initialization and the bounded tools are the health check.

## Forbidden patterns

- One DAB process for multiple catalogs, `data-source-files`, wildcard autoentities, or `dbo.%`.
- `DAB_ENVIRONMENT`, `cmd.exe`/PowerShell wrappers, or `--no-https-redirect`.
- Relative Node, DAB, launcher, or config paths.
- `ASPNETCORE_URLS=http://127.0.0.1:0`, duplicate catalog ports, or one shared `mcp_url` reused by multiple catalogs.
- Catalog/table names accepted only from architecture documentation.
- Literal credentials in Git, generated MCP JSON/TOML, command arguments, logs, or chat. The only permitted project-local secret store is the Git-ignored `.rooty/config/mcp-settings.local.json`.
- A single all-catalog readiness result that hides which catalog failed.
