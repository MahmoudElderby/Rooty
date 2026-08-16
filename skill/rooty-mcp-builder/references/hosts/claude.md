# Claude host adapter

Official references:

- https://code.claude.com/docs/en/mcp
- https://code.claude.com/docs/en/skills

Use project-scoped `.mcp.json` for team-visible MCP configuration. Preserve unrelated `mcpServers` entries. Do not place personal credentials in the file.

For SQL Server, also read the provider's [tested per-catalog pattern](../providers/data/sql-server-cursor.md). Use its absolute Node + shared launcher + absolute DAB/config invocation once per catalog, even though Claude provides a project-root environment variable.

## STDIO shape

```json
{
  "mcpServers": {
    "rooty-provider": {
      "type": "stdio",
      "command": "provider-command",
      "args": ["provider-arguments"],
      "env": {
        "ROOTY_REQUIRED_CREDENTIAL": "${ROOTY_REQUIRED_CREDENTIAL}"
      }
    }
  }
}
```

## HTTP shape

Use the current official Claude MCP format or `claude mcp add --transport http --scope project ...`. Keep authentication values in environment interpolation or host-managed OAuth. Show the resulting `.mcp.json` diff before applying it.

Use `claude mcp list`, `claude mcp get <name>`, or `/mcp` to verify status. Claude asks for MCP tool approval, but provider-side access and server tool restrictions must still enforce read-only behavior.
