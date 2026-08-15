# Jira through Atlassian Rovo MCP

Official references:

- https://support.atlassian.com/atlassian-rovo-mcp-server/docs/use-atlassian-rovo-mcp-server/
- https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-rovo-mcp-server/

Use Atlassian's cloud-hosted Rovo MCP server for Jira Cloud. Confirm the current endpoint and OAuth flow from official documentation at setup time.

Ticketing is optional for Rooty. If safe read-only access is unavailable, let the developer paste the ticket instead of weakening controls.

## Required controls

- Use OAuth through the active host and treat browser authentication as a separate approval.
- Atlassian tools act with the connected user's permissions and can create or update content. Use a dedicated identity or Jira permission scheme that cannot create, edit, transition, comment, or administer issues.
- Allow only issue/project search and read tools verified from the live advertised tool list.
- Forbid create, edit, transition, comment, attachment, worklog, and administration tools.
- Scope access to the required sites and projects where Atlassian controls permit it.

## Probe

Initialize, verify the read-only allowlist, then fetch one explicitly named non-sensitive issue or project metadata. Never use a test mutation to prove write denial.
