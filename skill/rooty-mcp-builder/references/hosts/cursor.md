# Cursor host adapter

Official references:

- https://cursor.com/docs/mcp
- https://cursor.com/docs/skills

Use `.cursor/mcp.json` for project-specific providers. Preserve unrelated `mcpServers` entries and reject malformed or ambiguous JSON instead of overwriting it.

## STDIO shape

```json
{
  "mcpServers": {
    "rooty-provider": {
      "type": "stdio",
      "command": "provider-command",
      "args": ["provider-arguments"],
      "env": {
        "ROOTY_REQUIRED_CREDENTIAL": "${env:ROOTY_REQUIRED_CREDENTIAL}"
      }
    }
  }
}
```

## Streamable HTTP shape

```json
{
  "mcpServers": {
    "rooty-provider": {
      "url": "https://provider.example/mcp",
      "headers": {
        "Authorization": "Bearer ${env:ROOTY_PROVIDER_TOKEN}"
      }
    }
  }
}
```

Use `${env:NAME}` interpolation for credentials. Never commit literal values or point `envFile` at a committed secrets file. Cursor supports host approval and enterprise MCP/tool allowlists; still require provider-side read-only access because a client allowlist is not the primary boundary.

Verify from Customize > MCP or the MCP logs. Confirm initialization, advertised tools, mutation restrictions, and the provider's harmless probe.
