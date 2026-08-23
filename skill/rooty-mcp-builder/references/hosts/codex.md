# Codex host adapter

Official references:

- https://developers.openai.com/codex/mcp
- https://developers.openai.com/codex/skills

Use the trusted project's `.codex/config.toml`. Preserve unrelated settings and existing MCP servers. If the file already exists, show a minimal merge rather than replacing it.

For SQL Server, also read the provider's [tested per-catalog pattern](../providers/data/sql-server-cursor.md). Its absolute Node + shared launcher + absolute DAB/config invocation must be repeated once per catalog.

## STDIO shape

```toml
[mcp_servers.rooty_provider]
command = "absolute-node"
args = ["C:/project/.rooty/start-mcp.cjs", "--settings", "C:/project/.rooty/config/mcp-settings.local.json", "--keys", "prod.provider.required=ROOTY_REQUIRED_SETTING", "--", "provider-command", "provider-arguments"]
enabled = true
required = true
enabled_tools = ["verified_read_tool"]
default_tools_approval_mode = "prompt"
```

Declare every required value in `settings_keys` and put the local value only in `.rooty/config/mcp-settings.local.json`. The launcher reads those keys and injects them into the child process. Use `SOURCE_KEY=CHILD_ENV_KEY` in `--keys` when the provider expects a fixed name. Do not use `env_vars` or `[mcp_servers.<name>.env]` for managed settings.

## Streamable HTTP shape

```toml
[mcp_servers.rooty_provider]
command = "absolute-node"
args = ["C:/project/.rooty/start-mcp.cjs", "--settings", "C:/project/.rooty/config/mcp-settings.local.json", "--keys", "prod.provider.url,prod.provider.token", "--url", "${prod.provider.url}", "--header", "Authorization: Bearer ${prod.provider.token}"]
enabled = true
required = true
enabled_tools = ["verified_read_tool"]
default_tools_approval_mode = "prompt"
```

The Rooty launcher bridges stdio to Streamable HTTP, so Codex does not need access to the values. Host-managed OAuth remains a separate supported flow for providers that require interactive OAuth; do not copy OAuth tokens into project files.

Verify with `codex mcp list` or `/mcp`, then compare the advertised tools with the reviewed allowlist and run the provider's harmless probe.
