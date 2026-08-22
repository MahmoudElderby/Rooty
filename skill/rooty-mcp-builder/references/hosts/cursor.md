# Cursor host adapter

Official references:

- https://cursor.com/docs/mcp
- https://cursor.com/docs/skills

Use `.cursor/mcp.json` for project-specific providers. Preserve unrelated `mcpServers` entries and reject malformed or ambiguous JSON instead of overwriting it. Cursor's published `mcp.json` shape does not document a `cwd` field, so never rely on the process starting beside the provider config. Use absolute executable, config, and nested-config paths.

For SQL Server, also read the provider's [tested per-catalog pattern](../providers/data/sql-server-cursor.md). Use its absolute Node + shared launcher + absolute DAB/config invocation once per catalog.

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

## Streamable HTTP shape

```json
{
  "mcpServers": {
    "rooty-provider": {
      "type": "stdio",
      "command": "absolute-node",
      "args": ["C:/project/.rooty/start-mcp.cjs", "--settings", "C:/project/.rooty/config/mcp-settings.local.json", "--keys", "ROOTY_PROVIDER_URL,ROOTY_PROVIDER_TOKEN", "--url", "${ROOTY_PROVIDER_URL}", "--header", "Authorization: Bearer ${ROOTY_PROVIDER_TOKEN}"]
    }
  }
}
```

Declare every required value in `settings_keys` and put its value only in the Git-ignored `.rooty/config/mcp-settings.local.json`. Cursor sees the Rooty launcher and key names, never a value or machine-variable dependency. Use `SOURCE_KEY=CHILD_ENV_KEY` in `--keys` when a child expects a fixed name. Cursor supports host approval and enterprise MCP/tool allowlists; still require provider-side read-only access because a client allowlist is not the primary boundary.

Verify from Customize > MCP or the MCP logs. Confirm initialization, advertised tools, mutation restrictions, and the provider's harmless probe.
