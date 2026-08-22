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
      "command": "absolute-node",
      "args": ["C:/project/.rooty/start-mcp.cjs", "--settings", "C:/project/.rooty/config/mcp-settings.local.json", "--keys", "ROOTY_REQUIRED_SETTING", "--", "provider-command", "provider-arguments"]
    }
  }
}
```

## HTTP shape

Render HTTP providers through the same launcher, using `--url "${ROOTY_PROVIDER_URL}"` and `--header "Authorization: Bearer ${ROOTY_PROVIDER_TOKEN}"`; the launcher bridges stdio to Streamable HTTP. Declare both keys in `settings_keys` and `--keys`. Values exist only in `.rooty/config/mcp-settings.local.json`. Host-managed OAuth remains a separate supported flow when a provider requires interactive OAuth. Show the resulting `.mcp.json` diff before applying it.

Use `claude mcp list`, `claude mcp get <name>`, or `/mcp` to verify status. Claude asks for MCP tool approval, but provider-side access and server tool restrictions must still enforce read-only behavior.
