# Cursor host adapter

Official references:

- https://cursor.com/docs/mcp
- https://cursor.com/docs/skills

Use `.cursor/mcp.json` for project-specific providers. Preserve unrelated `mcpServers` entries and reject malformed or ambiguous JSON instead of overwriting it. Cursor's published `mcp.json` shape does not document a `cwd` field, so never rely on the process starting beside the provider config. Use absolute executable, config, and nested-config paths.

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

Use only credential behavior verified in the installed Cursor version. Cursor's public example passes values through `env`; it does not establish `${env:NAME}` interpolation. If the host cannot resolve a secret reference safely, mark `NEEDS_CREDENTIAL` and guide the developer to Cursor's host-managed or user-scoped credential configuration instead of committing a secret. Cursor supports host approval and enterprise MCP/tool allowlists; still require provider-side read-only access because a client allowlist is not the primary boundary.

Verify from Customize > MCP or the MCP logs. Confirm initialization, advertised tools, mutation restrictions, and the provider's harmless probe.
