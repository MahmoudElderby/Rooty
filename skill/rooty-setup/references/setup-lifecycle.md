# Setup lifecycle

## State sequence

1. `INSTALLED`: all three Rooty skills, `.rooty/config/project-context.json`, and `.rooty/memory/{drafts,approved}` exist.
2. `DOCS_CONFIRMED`: documentation entry points are confirmed, or the developer explicitly confirms none are available.
3. `ENVIRONMENTS_CONFIRMED`: discovered environment candidates, aliases, setup coverage, and the initial active environment are confirmed by the developer.
4. `DISCOVERED`: data and observability candidates are supported by documentation or current project evidence for each selected environment.
5. `PROPOSED`: each environment connection has an official-source proposal, host path, credentials, safety controls, and identity probe.
6. `APPROVED`: the developer approved the exact external actions and file changes.
7. `CONFIGURED`: the active host configuration declares every required credential reference and contains exactly one environment-visible MCP per logical source.
8. `VERIFIED`: initialization, exact tool listing, mutation controls, and an environment identity read pass.

Do not skip directly from discovery to configuration. A proposal may be revised without repeating installation or documentation confirmation.

## SQL Server multi-catalog branch

When the data provider is SQL Server, the setup agent must read `rooty-mcp-builder/references/providers/data/sql-server-cursor.md` before proposing files. Discover catalogs and entities from each confirmed live environment, then create one stable logical `sql-{domain}` lifecycle row per catalog with a reviewed `rooty-{environment}-sql-{domain}` target. Copy the shared `.rooty/start-dab.cjs` launcher and create isolated `.rooty/mcp/data/sql-server/{environment}/{domain}/dab-config.json` files only after approval. Apply the same launcher pattern to Codex, Cursor, and Claude, activating only one environment target per logical row.

One catalog can be `READY` while another is `NEEDS_CREDENTIAL` or `UNAVAILABLE`. Data capability is ready when the reviewed catalogs needed for investigation are ready; never hide partial catalog failures behind one aggregate status.

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

Read `.rooty/state/setup-progress.json` on every re-entry. Persist explicit skip/cancel outcomes before ending the turn. Progress helps resume but never proves configuration or live readiness.
