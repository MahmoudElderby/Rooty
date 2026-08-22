# Custom provider

Use this route for any provider without a Rooty reference.

1. Follow `references/provider-research.md` and identify an official vendor-maintained MCP server. If only a community server exists, state that clearly and require explicit risk acceptance.
2. Classify the provider as data, observability, ticketing, or another optional capability.
3. Inventory every tool and its side effects from official documentation and a live `tools/list` response.
4. Establish provider-side read-only identity and resource scope. If this is impossible, return `UNAVAILABLE` for Rooty.
5. Determine a server-side read-only mode or tool-category restriction. Add a host allowlist as defense in depth.
6. Define all local JSON setting keys, a bounded harmless probe, installation/runtime requirements, and rollback instructions.
7. Mark the proposal `REVIEW_REQUIRED` and obtain approval before installing, executing, authenticating, or writing host configuration.

Do not add the provider to Rooty's standard catalog based on one successful setup. Promotion requires a versioned recipe, deterministic validation, mutation tests, host rendering tests, and maintained official sources.
