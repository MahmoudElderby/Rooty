# Cursor adapter

`rooty install` places all Rooty skills under `.agents/skills/`, which Cursor discovers at project scope. During setup, the MCP-builder skill proposes a minimal `.cursor/mcp.json` merge using `${env:NAME}` credential interpolation and requests approval before writing or running a provider server.

The existing Cursor rule and `investigator init --host cursor` remain available for the advanced compatibility path. Provider-side read-only access remains mandatory.
