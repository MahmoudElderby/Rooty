# Claude Code adapter

`investigator init --host claude` copies the canonical skill to `.claude/skills`, renders schema-compatible `.mcp.json`, denies edit/write/shell tools, and installs a deterministic `PreToolUse` allowlist hook. Provider credentials must still enforce read-only access below the model.
