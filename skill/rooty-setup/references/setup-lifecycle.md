# Setup lifecycle

## State sequence

1. `INSTALLED`: all three Rooty skills and `.rooty/project-context.json` exist.
2. `DOCS_CONFIRMED`: documentation entry points are confirmed, or the developer explicitly confirms none are available.
3. `DISCOVERED`: data and observability candidates are supported by documentation or current project evidence.
4. `PROPOSED`: each connection has an official-source proposal, host path, credentials, safety controls, and probe.
5. `APPROVED`: the developer approved the exact external actions and file changes.
6. `CONFIGURED`: the active host configuration declares every required credential reference.
7. `VERIFIED`: initialization, tool listing, mutation controls, and a harmless read pass.

Do not skip directly from discovery to configuration. A proposal may be revised without repeating installation or documentation confirmation.

## Failure response

For every failure, report:

- **Step:** the lifecycle state that did not complete.
- **Why it matters:** the investigation capability unavailable as a result.
- **Observed:** the exact missing fact or failed check, without secret values.
- **Next action:** the smallest developer or agent action that resolves it.

Examples:

- `NEEDS_CREDENTIAL`: `ES_API_KEY` is not available to the host process; set it through the approved secret mechanism and restart the MCP server.
- `NEEDS_APPROVAL`: Docker is required by the reviewed Elastic 8.x recipe; no image has been pulled.
- `REVIEW_REQUIRED`: the provider has no Rooty-verified recipe; review official docs, tool surface, and read-only enforcement before writing host config.
- `UNAVAILABLE`: the server initialized but did not advertise the required bounded read tool.

## Re-entry

Resume from the first incomplete state. Re-read relevant official provider documentation when a server version, host format, endpoint type, or authentication model could have changed. Never ask the developer to repeat facts already confirmed in current project context unless evidence now conflicts.
