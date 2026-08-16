# SQL Server through Microsoft SQL MCP Server

Official references:

- https://learn.microsoft.com/azure/data-api-builder/mcp/overview
- https://learn.microsoft.com/azure/data-api-builder/mcp/stdio-transport
- https://learn.microsoft.com/azure/data-api-builder/configuration/
- https://learn.microsoft.com/azure/data-api-builder/concept/config/multi-config
- https://learn.microsoft.com/azure/data-api-builder/configuration/autoentities

Use Microsoft's SQL MCP Server included in Data API builder (DAB). MCP is available in DAB 1.7+, but multi-source autoentities and the controls below require DAB 2.0. Check the installed DAB version and current official schema before generating configuration.

## Default scope

Automatically expose every accessible, online **user database** on the confirmed SQL Server. Do not silently stop at the connection string's initial catalog. Exclude `master`, `model`, `msdb`, `tempdb`, offline/restoring databases, snapshots, and databases for which the Rooty identity has no access.

Discover catalogs with a bounded metadata query, preferably through a connection to `master` when the server permits it:

```sql
SELECT [name]
FROM sys.databases
WHERE database_id > 4
  AND state_desc = 'ONLINE'
  AND source_database_id IS NULL
  AND HAS_DBACCESS([name]) = 1
ORDER BY [name];
```

If server metadata visibility prevents enumeration, report the exact limitation and ask for the database names. Never guess them from similarly named connection strings. Show the discovered catalog list before writing configuration, including any catalog excluded by an explicit sensitivity or schema policy.

## Artifact layout

Keep generated DAB files out of the `.rooty` top level:

```text
.rooty/mcp/data/sql-server/
├── dab-config.json
└── databases/
    ├── <catalog-slug>.json
    └── <catalog-slug>.json
```

Use an absolute path for `--config` and absolute, JSON-escaped paths in `data-source-files`. A host may start DAB with the project root, home directory, or another current working directory. Set the host `cwd` to `.rooty/mcp/data/sql-server/` only when that host officially supports it; absolute paths remain mandatory.

## Credential bindings

Create one host MCP credential binding per catalog, for example `ROOTY_SQL_ORDERS` and `ROOTY_SQL_LOGGER`. Each connection string must select its catalog and use the same dedicated `SELECT`-only investigation identity unless the server requires separate identities. Normalize names to uppercase ASCII with non-alphanumeric characters replaced by `_`; resolve normalization collisions explicitly instead of overwriting a binding.

Declare every binding in the active host's MCP entry. DAB files contain only `@env('ROOTY_SQL_<CATALOG>')` references. Never put a connection-string value in `.rooty`, source-controlled files, proposals, logs, or chat.

## Multi-source DAB shape

Generate one child file per discovered catalog. The top-level file contains:

- a `data-source` using the first catalog binding as a DAB 2.0 compatibility primary;
- `data-source-files` containing absolute paths to every child file;
- the only `runtime` section, with MCP enabled;
- `describe-entities`, `read-records`, and bounded `aggregate-records` enabled;
- `create-record`, `update-record`, `delete-record`, and `execute-entity` disabled.

Each child contains:

- its own `data-source` and catalog-specific `@env(...)` binding;
- one `autoentities` definition with a globally unique key such as `dbo-all-orders`;
- an include pattern such as `dbo.%`, narrowed only by a confirmed schema/sensitivity policy;
- a globally unique entity name pattern prefixed by catalog, such as `Orders_{schema}_{object}`;
- `rooty-reader` permissions with only the `read` action;
- no `runtime` section and **no empty `entities: {}` object**.

DAB merges child dictionaries. Autoentity definition keys and generated entity names therefore must be unique across every catalog. Do not initialize or overwrite an unrelated existing DAB configuration; generate the separate Rooty tree above or propose a reviewed merge.

## Host process

Start STDIO with an absolute config path:

```text
dab start --mcp-stdio role:rooty-reader --config <absolute-parent-config> --LogLevel Error --no-https-redirect
```

For DAB 2.0.10 compatibility, declare `ASPNETCORE_URLS=http://127.0.0.1:0` as a non-secret MCP environment value and verify that the installed build accepts an ephemeral port. If it does not, allocate a dedicated loopback port outside the project's application ports. Before retrying, identify a stale DAB process by the exact Rooty config path and stop only that process after approval; never terminate every `dab` process on the machine.

Keep stdout JSON-RPC-only and direct the developer to the host MCP logs for DAB startup errors. Map generic `Connection closed` or `0 tools` results back to those logs.

## Safe rollout and readiness

Generate configuration for all discovered catalogs, but verify incrementally so metadata discovery does not exceed the host's MCP initialization window:

1. Start with the first child in the parent file and require MCP initialize, `tools/list`, and a non-empty `describe_entities` result.
2. Add the remaining generated children in bounded batches, repeating initialize and `describe_entities` after each batch.
3. Finish only when the parent references every discovered in-scope catalog and the final `describe_entities` result contains entities from each one.

Set a short SQL connection timeout in each investigation connection string. Warn that `dbo.%` over many remote or large schemas can make DAB initialization slow. If the final all-catalog configuration exceeds the host timeout, report `UNAVAILABLE` with the catalog/batch that caused it; do not claim success with only the first catalog.

Do not use `dab validate` as the readiness gate. DAB 2.0.10 can fail validation while MCP startup works, or start while entity discovery is empty. Readiness requires all of:

- MCP initialization succeeds;
- only `describe_entities`, `read_records`, and `aggregate_records` are advertised;
- `describe_entities` is non-empty and covers every discovered in-scope catalog;
- one bounded, non-sensitive read succeeds;
- the SQL identity is confirmed `SELECT`-only.

Return `UNAVAILABLE` if mutation tools cannot be disabled, a catalog credential is missing, a catalog has no described entities unexpectedly, or provider-side read-only access cannot be enforced.
