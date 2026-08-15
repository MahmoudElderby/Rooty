# MongoDB official MCP server

Official references:

- https://www.mongodb.com/docs/mcp-server/
- https://www.mongodb.com/docs/mcp-server/configuration/enable-or-disable-features/
- https://www.mongodb.com/docs/mcp-server/security-best-practices/

Use the official `mongodb-mcp-server` package. Treat the version and package command as `REVIEW_REQUIRED` until checked against the current official documentation.

## Required controls

- Enable `--readOnly` or `MDB_MCP_READ_ONLY=true`; write operations are allowed by default without this control.
- Disable `create`, `update`, and `delete` tool groups. Disable `atlas` unless Atlas administration metadata is explicitly needed and separately reviewed.
- Use a dedicated MongoDB user with read access only to the required databases and collections.
- Reference `MDB_MCP_CONNECTION_STRING` through the host config. Connection strings can contain credentials and must never be committed.
- Consider `MDB_MCP_INDEX_CHECK=true` for production investigation to reject collection scans, after confirming required queries have suitable indexes.
- Keep server-side JavaScript disabled. Do not enable export-to-file tools or writable export directories.

## Probe

Use dry-run first to inspect effective settings and enabled tools. Then initialize, list databases or collections, inspect schema metadata, or run a bounded `find` returning at most one non-sensitive document. Fail readiness if read-only mode is absent even when the host prompts for tool approval.
