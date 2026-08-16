---
name: rooty-mcp-builder
description: Research, propose, configure, and verify a provider-specific read-only MCP connection for Rooty on Codex, Cursor, or Claude. Use when Rooty setup needs SQL Server, MongoDB, Elasticsearch, Grafana, Jira, Azure DevOps, or a custom data, observability, or ticketing provider; when host MCP configuration or credential bindings are missing; or when an MCP server fails validation. Do not use to grant write access or run an incident investigation.
---

# Rooty MCP Builder

Build one reviewed provider-to-host connection at a time. Separate provider behavior from host syntax.

Read [references/read-only-policy.md](references/read-only-policy.md) for every connection. Read [references/provider-research.md](references/provider-research.md) when official setup or current behavior is not already verified. Then read exactly one host reference and one provider reference from the routing lists below.

## Route by host

- Codex: [references/hosts/codex.md](references/hosts/codex.md)
- Cursor: [references/hosts/cursor.md](references/hosts/cursor.md)
- Claude: [references/hosts/claude.md](references/hosts/claude.md)

## Route by provider

- Data: [SQL Server](references/providers/data/sql-server.md) (which requires the tested per-catalog reference), [MongoDB](references/providers/data/mongodb.md)
- Observability: [Elasticsearch](references/providers/observability/elasticsearch.md), [Grafana](references/providers/observability/grafana.md)
- Ticketing: [Jira](references/providers/ticketing/jira.md), [Azure DevOps](references/providers/ticketing/azure-devops.md)
- Any other provider: [custom provider](references/providers/custom/custom-provider.md)

## Build the proposal

Produce a proposal before any mutation. Include:

- capability, provider, target environment, and active host;
- official server identity and documentation URLs checked;
- support status and any version or deployment constraints;
- transport, command or URL, exact host config path, and merge scope;
- generated artifact paths under `.rooty/mcp/<category>/<provider>/`; SQL Server is the tested exception and uses `.rooty/mcp-<domain>/dab-config.json` plus `.rooty/start-dab.cjs`;
- every credential binding name and where its value must be supplied;
- provider-side read-only identity or role and server-side read-only controls;
- explicit allowed and forbidden tool categories;
- one harmless initialization/read probe;
- commands, package executions, image pulls, OAuth, or file writes requiring approval;
- unresolved facts and readiness state.

Never place a credential value in the proposal. Never represent an unofficial or unverified server as a standard recipe.

## Configure only after approval

1. Show the exact proposed diff or host-native add command.
2. Request approval using the active host's approval experience.
3. Preserve unrelated host configuration and refuse an ambiguous merge.
4. Declare every credential reference inside the MCP entry, using the host's environment interpolation, forwarded-variable, secret-manager, or OAuth mechanism.
5. Do not install Docker, pull an image, run a package, or begin OAuth without separate approval.

## Verify

1. Confirm each credential name resolves without printing its value.
2. Initialize the MCP server and list its tools.
3. Compare the advertised tools with the allowed and forbidden sets. Block or disable mutation tools; do not rely on names or annotations alone.
4. Run one bounded, non-sensitive read probe.
5. Report `READY`, `NEEDS_CREDENTIAL`, `NEEDS_APPROVAL`, `REVIEW_REQUIRED`, or `UNAVAILABLE`, plus the exact config path and next action.

Stop if provider-side read-only access cannot be enforced. A host allowlist is defense in depth, not the primary security boundary.
