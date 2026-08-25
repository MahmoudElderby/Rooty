# Project health profile workflow

Discovery is a proposal, not confirmation.

1. Lock one active environment and identify it with a non-secret stable label.
2. From confirmed documentation and current source/configuration, list user-facing services, jobs, queues, databases, search clusters, caches, and required external dependencies that belong to the project.
3. Exclude MCP servers: they are transports. A transport failure may make a probe `UNAVAILABLE`; it is not itself a project-component failure.
4. Give every component a stable ID and explicit dependency IDs.
5. Define one or more read-only probes with stable IDs, expected outcomes, and timeouts no greater than 120 seconds. Prefer harmless identity, readiness, bounded count, or bounded query probes.
6. Define optional log indicators with a bounded time range, query, and concerning condition.
7. Identify cloud visibility needs without selecting a provider or connector.
8. Show the complete profile to the developer and require explicit confirmation before adding `confirmation.status: CONFIRMED`.

Reconfirm the profile whenever component ownership, environment identity, dependencies, or probe semantics materially change.

