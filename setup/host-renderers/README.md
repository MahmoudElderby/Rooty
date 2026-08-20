# Host renderers

The first-time installer does not render MCP configuration. It copies all three Rooty skills to the skill roots of the hosts it installs for, `.agents/skills/` for Cursor and Codex and `.claude/skills/` for Claude; the active setup agent then selects one host, prepares a minimal provider proposal, shows the exact target/diff, and requests native approval.

The existing dependency-free renderers in `src/lib/hosts.js` remain an advanced compatibility engine. The next renderer contract will accept a canonical validated proposal and merge `.codex/config.toml`, `.cursor/mcp.json`, or `.mcp.json` without copying credential values or replacing unrelated entries.
