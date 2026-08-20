# Codex adapter

`rooty install --codex` places all Rooty skills under `.agents/skills/`, which Codex discovers at repository scope, and writes nothing for the other hosts. During setup, the MCP-builder skill proposes a minimal project `.codex/config.toml` merge with forwarded credential names, explicit read-tool allowlists, required servers, and prompt-on-use approvals. The agent shows the diff and requests approval before writing or authenticating.

`investigator init --host codex` remains available for the advanced compatibility path.
