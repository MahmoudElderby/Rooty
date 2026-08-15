# Codex adapter

`investigator init --host codex` installs the canonical skill at `.agents/skills/root-cause-investigator` and creates a project-scoped `.codex/config.toml`. The generated profile uses `sandbox_mode = "read-only"` and MCP `enabled_tools` allowlists. External servers remain disabled until endpoint references and read-only identities pass `investigator doctor`.
