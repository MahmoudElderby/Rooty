# Azure DevOps official MCP server

Official references:

- https://learn.microsoft.com/azure/devops/mcp-server/mcp-server-overview
- https://github.com/microsoft/azure-devops-mcp

Use Microsoft's local `@azure-devops/mcp` server for Azure DevOps Services. The official server does not support on-premises Azure DevOps Server. Research the current package version and authentication method before proposing configuration.

Ticketing is optional for Rooty. Prefer pasted work-item text when a safely constrained identity is unavailable.

## Required controls

- Load only required domains. Start with `core`, `work`, and `work-items`; do not enable repositories, pipelines, test plans, wiki, or security unless separately required.
- Use an Entra-backed account or narrowly scoped PAT with read permissions only for the target organization and projects.
- Allow only project/team/work-item query and read tools verified from the live server.
- Forbid creating/updating work items, comments, relation changes, repository writes, pipeline actions, test-plan changes, and security administration.
- Reference PAT or other credential bindings through the host config; never put the value in arguments or files.

## Probe

Initialize, list the reviewed tools, then list at most one project or fetch one explicitly named work item. Classify `REVIEW_REQUIRED` until the selected server version and its full domain tool surface are reviewed.
