# Codex host adapter

Official references:

- https://developers.openai.com/codex/mcp
- https://developers.openai.com/codex/skills

Use the trusted project's `.codex/config.toml`. Preserve unrelated settings and existing MCP servers. If the file already exists, show a minimal merge rather than replacing it.

## STDIO shape

```toml
[mcp_servers.rooty_provider]
command = "provider-command"
args = ["provider-arguments"]
env_vars = ["ROOTY_REQUIRED_CREDENTIAL"]
enabled = true
required = true
enabled_tools = ["verified_read_tool"]
default_tools_approval_mode = "prompt"
```

Use `env_vars` to forward credential names already present in the Codex process environment. Use `[mcp_servers.<name>.env]` only for non-secret constants. Never put a secret value in `env`.

## Streamable HTTP shape

```toml
[mcp_servers.rooty_provider]
url = "https://provider.example/mcp"
bearer_token_env_var = "ROOTY_PROVIDER_TOKEN"
enabled = true
required = true
enabled_tools = ["verified_read_tool"]
default_tools_approval_mode = "prompt"
```

Use `auth = "oauth"` and `codex mcp login <name>` when the official server uses OAuth. Treat login as a separate approval action. Prefer `env_http_headers` when a nonstandard header must resolve from an environment variable.

Verify with `codex mcp list` or `/mcp`, then compare the advertised tools with the reviewed allowlist and run the provider's harmless probe.
