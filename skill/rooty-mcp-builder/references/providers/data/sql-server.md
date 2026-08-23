# SQL Server through Microsoft SQL MCP Server

Official references:

- https://learn.microsoft.com/azure/data-api-builder/mcp/overview
- https://learn.microsoft.com/azure/data-api-builder/mcp/stdio-transport
- https://learn.microsoft.com/azure/data-api-builder/configuration/
- https://learn.microsoft.com/azure/data-api-builder/configuration/entities
- https://learn.microsoft.com/azure/data-api-builder/concept/config/env-function

Use Microsoft's SQL MCP Server included in Data API builder (DAB). Rooty's read-only tool controls require DAB 2.0 or later. Check the installed DAB version and the current official schema before generating configuration.

For every Codex, Cursor, or Claude setup, read and follow the tested [one-MCP-per-catalog pattern](sql-server-cursor.md). The filename records where the production failure was first reproduced; the pattern is mandatory for all three hosts.

## Discover live scope

Documentation may identify the likely Azure SQL server and business domains, but it does not prove current catalog or table names. Enumerate accessible online user catalogs from the live server:

```sql
SELECT [name]
FROM sys.databases
WHERE database_id > 4
  AND state_desc = 'ONLINE'
  AND source_database_id IS NULL
  AND HAS_DBACCESS([name]) = 1
ORDER BY [name];
```

Exclude `master`, `model`, `msdb`, `tempdb`, offline/restoring databases, snapshots, and inaccessible catalogs. If metadata visibility blocks enumeration, report the limitation and ask for the catalog names; do not infer them from architecture documentation.

For each discovered catalog, query `INFORMATION_SCHEMA.TABLES` and related column/key metadata through the approved read-only identity. Generate explicit entities only for reviewed tables or views. Never use a wildcard, `dbo.%`, `autoentities`, or architecture-only object names.

## Per-catalog result

Each catalog is one stable logical MCP server with an active target named `rooty-{environment}-sql-{domain}`. Exactly one target per logical catalog is rendered in a host file. Each target has:

- `.rooty/mcp/data/sql-server/{environment}/{domain}/dab-config.json` containing one `mssql` data source and explicit entities verified in that environment;
- one schema-version-2 environment group with shared `sql.server`, `sql.options`, `sql.user`, and `sql.password` values, plus a per-domain `sql.catalogs.<domain>.name`;
- only `describe_entities`, `read_records`, and bounded `aggregate_records` tools;
- a dedicated `rooty-reader` database identity with `SELECT` only;
- one unique per-domain `sql.catalogs.<domain>.mcp_url`, mapped to the explicit loopback `ASPNETCORE_URLS` port;
- an absolute Node executable, DAB executable, launcher path, and config path.

Normalize domains to lowercase ASCII kebab case and bindings to uppercase ASCII underscore form. Resolve normalization collisions visibly; never overwrite a catalog entry.

The shared environment identity must be `SELECT`-only in every included catalog. If one shared identity cannot be restricted that way, stop and use separate reviewed identities rather than weakening the database boundary.

## Independent readiness

Verify each catalog independently with MCP initialize, `tools/list`, non-empty `describe_entities`, and one bounded non-sensitive read. Do not use `dab validate` as the readiness gate for DAB 2.0.10. One unavailable catalog must not hide or disable catalogs that are ready; report a readiness row and next action for each server.
