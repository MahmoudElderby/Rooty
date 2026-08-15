# Claude Code adapter

`rooty install` places all three Rooty skills under `.claude/skills/`. During setup, the MCP-builder skill proposes a minimal project `.mcp.json` merge in the active Claude session and requests approval before writing, executing a provider runtime, or starting OAuth. Credential references appear in the MCP entry; values remain outside the repository.

`investigator init --host claude` and the deterministic read-only hook remain available for the advanced compatibility path. Provider credentials must still enforce read-only access below the model.
