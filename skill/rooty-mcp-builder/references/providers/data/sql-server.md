# SQL Server through Microsoft SQL MCP Server

Official references:

- https://learn.microsoft.com/azure/data-api-builder/mcp/overview
- https://learn.microsoft.com/azure/data-api-builder/mcp/stdio-transport
- https://learn.microsoft.com/azure/data-api-builder/concept/security/authorization-overview

Use Microsoft's SQL MCP Server included in Data API builder (DAB). MCP is available in DAB 1.7+, and current 2.0 documentation should be preferred for new configuration.

## Safe shape

- Use STDIO for a host-managed local process: `dab start --mcp-stdio role:rooty-reader --config <reviewed-config> --LogLevel Error`.
- Set `runtime.mcp.enabled` to `true`.
- Enable `read-records`; disable `create-record`, `update-record`, and `delete-record` globally.
- Expose only explicitly reviewed tables or views. Do not expose stored-procedure custom tools for ordinary Rooty investigation.
- Define the `rooty-reader` DAB role with only `read` permissions and field restrictions where needed.
- Use a dedicated SQL login or identity with `SELECT` only on the approved database objects. DAB permissions do not replace database permissions.
- Reference the connection string from `ROOTY_SQLSERVER_CONNECTION_STRING`; never place it literally in the host or committed DAB config.

Do not initialize or replace an existing DAB configuration automatically. Propose a minimal separate Rooty config or a reviewed merge, list every exposed entity, and obtain approval.

## Probe

Validate the DAB config, initialize the server, confirm only describe/read tools are advertised, then describe one approved entity or read at most one non-sensitive row. Return `UNAVAILABLE` if mutation tools cannot be disabled or the database identity is not read-only.
