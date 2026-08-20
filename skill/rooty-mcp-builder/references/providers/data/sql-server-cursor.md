# Tested per-catalog SQL Server pattern for every host

This recipe was established from the Cursor and Azure SQL multi-catalog test, then adopted as the Rooty default for **Codex, Cursor, and Claude**. Do not substitute DAB multi-source configuration.

## Fixed architecture

For each live catalog, install one independently startable server:

```text
.rooty/
├── start-dab.cjs
└── mcp/
    └── data/
        └── sql-server/
            ├── orders/
            │   └── dab-config.json
            └── logger/
                └── dab-config.json
```

This is the canonical Rooty provider layout, `.rooty/mcp/<category>/<provider>/`, with one folder per catalog. The launcher still accepts the earlier `.rooty/mcp-<domain>/dab-config.json` location so an existing install keeps working; move those folders when convenient and update the host `--config` path in the same approved change.

Host server names are `rooty-sql-orders` and `rooty-sql-logger`. Copy the packaged [launcher asset](../../../assets/start-dab.cjs) to `.rooty/start-dab.cjs` after the exact write is approved. Preserve an identical existing launcher; refuse an unrelated or modified file instead of replacing it.

The launcher makes the DAB config folder its real process CWD. Use it on every host even if a host currently supports `cwd`, because Cursor does not guarantee it and the same process contract should be portable.

## Prerequisites and discovery

1. Locate absolute paths to the host's Node runtime (`node.exe` on Windows) and DAB executable (`dab.exe` on Windows). Do not rely on `PATH`.
2. Connect with an approved metadata/read-only identity and list live catalogs using `sys.databases`.
3. In each catalog, list current objects from `INFORMATION_SCHEMA.TABLES`, then inspect columns and primary-key metadata needed by DAB.
4. Present catalog and explicit entity selections before writing files. Documentation can orient this selection but cannot supply unverified names.
5. Allocate a distinct, currently free loopback port for every catalog. Use an explicit nonzero value such as `http://127.0.0.1:55101`; never use `:0`.

## Credential contract

Each catalog uses one binding such as `ROOTY_SQL_ORDERS`. Its value is a connection string that selects only that catalog and authenticates as a dedicated `SELECT`-only identity.

The binding name must be visible in that catalog's host MCP entry via `--credential-env`, while the value remains in the developer's process environment or an approved host secret facility. The DAB config contains only `@env('ROOTY_SQL_ORDERS')`. Never create a `.env` beside the DAB config, put a literal connection string in Git, or print a resolved value.

Before startup, display a table containing server name, catalog, host config path, binding name, `AVAILABLE` or `MISSING`, config path, and next action. Availability checks test only whether the variable exists and is non-empty.

## DAB config per catalog

Generate one self-contained `.rooty/mcp/data/sql-server/{domain}/dab-config.json` with explicit entities only. Every entity must come from live metadata and explicitly name a table or view. For example:

```json
{
  "data-source": {
    "database-type": "mssql",
    "connection-string": "@env('ROOTY_SQL_ORDERS')"
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
<absolute-node> <absolute-project>/.rooty/start-dab.cjs --dab <absolute-dab> --config <absolute-project>/.rooty/mcp/data/sql-server/<domain>/dab-config.json --credential-env ROOTY_SQL_<DOMAIN>
```

The launcher starts DAB directly with `shell: false`, the catalog folder as CWD, inherited standard I/O, and exactly:

```text
dab start --mcp-stdio role:rooty-reader --config <absolute-config> --LogLevel Error
```

It removes inherited `DAB_ENVIRONMENT` and rejects `.env`, multi-source, autoentity, mutation-enabled, missing-credential, non-explicit-port, and shell-wrapper configurations.

## Codex project entry

Merge one table per catalog into trusted-project `.codex/config.toml`:

```toml
[mcp_servers.rooty-sql-orders]
command = "C:\\Program Files\\nodejs\\node.exe"
args = ["C:\\project\\.rooty\\start-dab.cjs", "--dab", "C:\\tools\\dab.exe", "--config", "C:\\project\\.rooty\\mcp\\data\\sql-server\\orders\\dab-config.json", "--credential-env", "ROOTY_SQL_ORDERS"]
env_vars = ["ROOTY_SQL_ORDERS"]
enabled = true
required = false
enabled_tools = ["describe_entities", "read_records", "aggregate_records"]
default_tools_approval_mode = "prompt"

[mcp_servers.rooty-sql-orders.env]
ASPNETCORE_URLS = "http://127.0.0.1:55101"
```

Do not add `cwd`; the launcher owns it. `env_vars` forwards the named credential without storing its value. Keep each catalog `required = false` so one unavailable catalog does not prevent healthy catalog servers from loading; Rooty's capability readiness still requires every investigation-required catalog to pass.

## Cursor project entry

Merge one entry per catalog into `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "rooty-sql-orders": {
      "type": "stdio",
      "command": "C:/Program Files/nodejs/node.exe",
      "args": [
        "C:/project/.rooty/start-dab.cjs",
        "--dab",
        "C:/tools/dab.exe",
        "--config",
        "C:/project/.rooty/mcp/data/sql-server/orders/dab-config.json",
        "--credential-env",
        "ROOTY_SQL_ORDERS"
      ],
      "env": {
        "ASPNETCORE_URLS": "http://127.0.0.1:55101"
      }
    }
  }
}
```

Launch Cursor from an environment where `ROOTY_SQL_ORDERS` is already set, or use a user-scoped secret facility verified for the installed Cursor version. The `--credential-env` argument makes the required binding navigable in project config and the launcher fails with its exact name when missing. Do not put `${env:...}` into committed configuration unless that installed Cursor build is first proven to resolve it; Cursor's public MCP example does not guarantee interpolation.

## Claude project entry

Merge one entry per catalog into project `.mcp.json`:

```json
{
  "mcpServers": {
    "rooty-sql-orders": {
      "type": "stdio",
      "command": "C:/Program Files/nodejs/node.exe",
      "args": [
        "C:/project/.rooty/start-dab.cjs",
        "--dab",
        "C:/tools/dab.exe",
        "--config",
        "C:/project/.rooty/mcp/data/sql-server/orders/dab-config.json",
        "--credential-env",
        "ROOTY_SQL_ORDERS"
      ],
      "env": {
        "ROOTY_SQL_ORDERS": "${ROOTY_SQL_ORDERS}",
        "ASPNETCORE_URLS": "http://127.0.0.1:55101"
      }
    }
  }
}
```

Claude fails config parsing when a required `${VAR}` has no value, which produces an actionable missing-binding result without committing a secret.

## Readiness per catalog

For each `rooty-sql-{domain}` independently:

1. Confirm the credential binding exists without reading or displaying it.
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
- `ASPNETCORE_URLS=http://127.0.0.1:0` or duplicate catalog ports.
- Catalog/table names accepted only from architecture documentation.
- Literal credentials in Git, `.rooty`, MCP JSON/TOML, command arguments, logs, or chat.
- A single all-catalog readiness result that hides which catalog failed.
