# Automatic MCP setup implementation plan

## Status and source of truth

This is the phased engineering plan for [Automatic MCP setup requirements](automatic-mcp-setup-requirements.md). The requirements document is normative when this plan and the requirements differ.

The feature is not implemented yet. Existing commands and files must continue to follow the current [CLI reference](cli-reference.md) until a phase is completed, tested, and documented.

## Current implementation gaps

| Area | Current behavior | Required target |
|---|---|---|
| Discovery | Regex matches collapse into `capability:provider` | Structured, plural resource instances with service roots and exact signals |
| File coverage | Does not scan `.cs`, `.csproj`, or `.sln`; skips every `packages` directory | SQL Server and monorepo-aware safe scanning |
| Capability model | One source per each of five mandatory capabilities | Database and observability mandatory; ticketing optional; plural bindings |
| Recipes | Static HTTP endpoint metadata | Runtime-aware recipes with transports, version variants, generators, commands, tools, and probes |
| SQL Server | Unsupported | Generated multi-database DAB stdio runtime |
| Elasticsearch | Unsupported | Version-selected official standalone or Agent Builder MCP |
| Host rendering | Production connectors assume HTTP; existing files cause hard failure | Canonical stdio/HTTP model and idempotent structured merge |
| Credentials | Environment references exist but no consolidated setup view | Canonical requirement manifest and navigable missing-input UI |
| Doctor | Production connector checks use HTTP | Shared stdio and streamable-HTTP clients plus generated-runtime validation |
| AI assistance | CLI does not call a model | Keep CLI model-free; define optional host-produced suggestion contract |
| CLI output | Plain text | Semantic TTY color with deterministic plain and JSON output |

## Compatibility strategy

1. Existing schema-version-1 discovery and source-registry readers remain available during migration.
2. Existing manual connector recipes are not silently reinterpreted as automatically managed resources.
3. The new auto-setup path supports only SQL Server, Elasticsearch, and optional Jira.
4. The demo and frozen-snapshot workflows remain unchanged.
5. Strict readiness for a version-2 auto-managed project uses database and observability coverage, not the old five-capability rule.
6. Existing version-1 projects continue to use the old readiness rule until explicitly migrated.
7. Migration never overwrites host files or activation state without a reviewed version-2 plan.

This allows implementation to land incrementally without breaking the current package between phases.

## Target code organization

```text
src/lib/
|-- discovery/
|   |-- walk.js
|   |-- sensitive-files.js
|   |-- service-roots.js
|   `-- detectors/
|       |-- mssql.js
|       |-- elasticsearch.js
|       `-- jira.js
|-- resource-inventory.js
|-- resource-plan.js
|-- approval.js
|-- credentials.js
|-- generators/
|   `-- dab.js
|-- host-renderers/
|   |-- canonical.js
|   |-- codex.js
|   |-- claude.js
|   `-- cursor.js
|-- host-merge/
|   |-- toml.js
|   `-- json.js
|-- mcp-clients/
|   |-- stdio.js
|   `-- streamable-http.js
|-- doctor/
|   |-- plan.js
|   |-- runtimes.js
|   |-- credentials.js
|   |-- hosts.js
|   `-- connectors.js
|-- terminal.js
`-- sources.js                 # compatibility facade during migration

setup/
|-- resource-recipes/
|   `-- catalog.json
|-- schemas/
|   |-- resource-inventory.schema.json
|   |-- ai-discovery-suggestions.schema.json
|   |-- mcp-plan.schema.json
|   `-- credential-requirements.schema.json
`-- discovery-rules/           # compatibility fallback only
```

Modules should remain small enough that provider detection, runtime generation, host rendering, and protocol validation can be tested independently.

## Work phases

### Phase 0: Establish a reliable baseline

Before feature work:

- Make the Node test script cross-platform; the current glob does not expand on Windows.
- Ensure child-process tests can distinguish product failures from restricted execution environments.
- Add fixtures for Windows and POSIX paths.
- Record current version-1 CLI, registry, host, and doctor snapshots.

Exit criteria:

- `npm test`, package doctor, and evaluation have documented expected behavior on Windows, macOS, and Linux CI.
- Existing version-1 behavior is protected by tests before migration begins.

### Phase 1: Schemas and compatibility facade

Implement:

- Resource inventory schema version 2.
- MCP plan schema version 1.
- Credential-requirements schema version 1.
- AI-suggestion schema version 1.
- Stable resource ID generation.
- Canonical serialization and SHA-256 approval digests.
- Version-1 readers and explicit project-mode detection.

Do not render or activate new connectors in this phase.

Exit criteria:

- Schema fixtures cover valid, invalid, secret-bearing, traversal, and stale-approval cases.
- Unchanged input produces byte-stable canonical content and stable IDs.
- Existing version-1 projects still load without migration.

### Phase 2: Deterministic resource discovery

Refactor the current walker and add structured detectors.

#### Walker work

- Add the required file types.
- Stop globally excluding `packages`.
- Separate directory walking from content parsing.
- Preserve the existing file-count and size bounds.
- Preserve symlink and secret exclusions.
- Add project-relative, normalized evidence paths.

#### Service-root work

- Detect .NET solutions and projects.
- Detect npm workspaces and package roots.
- Detect Docker Compose services.
- Use deployment and infrastructure modules as supporting ownership evidence.

#### Provider detectors

- SQL Server resource candidates and connection-name references.
- Elasticsearch candidates, version hints, and observability-use evidence.
- Jira references as an optional provider candidate.

Regular expressions remain bounded fallbacks after structured parsing, not the primary model.

Exit criteria:

- Discovery acceptance tests in the requirements document pass.
- Two same-provider resources remain distinct.
- No discovery artifact contains a raw credential or connection string.

### Phase 3: Planning, review, and credential requirements

Implement:

- Capability bindings.
- Version-aware recipe selection.
- `approved`, `excluded`, and `unresolved` decisions.
- Plan state transitions and approval digest.
- Credential requirement derivation.
- Interactive review UI and non-interactive JSON input/output.
- Mandatory database/observability coverage rule.

The existing `sources configure` command should delegate to the new planner for version-2 projects. `rooty setup` can be added as a guided wrapper after the underlying commands are stable.

Exit criteria:

- No plan can become approved while a mandatory capability is unresolved.
- Missing Jira does not block approval.
- Any material plan edit invalidates approval.
- Credential status never exposes values.

### Phase 4: SQL Server DAB vertical slice

Implement the first end-to-end connector:

- `mssql-dab` resource recipe.
- Compatibility grouping that never crosses environments.
- Root DAB configuration and per-database child files.
- Stable, globally unique entity prefixes.
- Reviewed autoentity include/exclude patterns.
- Environment-only connection references.
- Read-only entity permissions.
- Explicit per-tool runtime controls.
- Exact stdio command with `--mcp-stdio`.
- DAB installation and version preflight.
- DAB config validation.

Use fixture databases or a controlled test server for integration tests. Mutation tests must demonstrate that both Rooty's tool surface and the test database identity reject writes.

Exit criteria:

- All DAB acceptance tests pass.
- Codex can initialize the generated server in a fixture project before the other host renderers are added.
- Generated output contains no REST/GraphQL exposure or mutation tools.

### Phase 5: Elasticsearch 8.19.15 vertical slice

Prioritize the deployed target version:

- `elastic-standalone` recipe with `supported-deprecated` status.
- Docker preflight.
- Explicit image-pull consent and non-interactive behavior.
- Official container stdio definition.
- `ES_URL` and `ES_API_KEY` references.
- Five-tool read allowlist.
- Harmless index-list or bounded-search probe.
- Deprecation and future-upgrade message.

Do not add Docker installation automation.

Exit criteria:

- A fixture representing Elasticsearch 8.19.15 selects the standalone recipe.
- Missing Docker and unavailable image errors are actionable.
- Doctor can initialize the container, list tools, and complete the probe.
- A verified 8.19.15 setup without Jira produces `READY_WITH_WARNINGS`.

### Phase 6: Canonical host rendering and safe merge

Implement the canonical server model and render it to:

- Codex `.codex/config.toml`
- Claude Code `.mcp.json` and Rooty enforcement files
- Cursor `.cursor/mcp.json` and Rooty rule

Merge requirements:

- Parse before editing.
- Track Rooty-owned entry names and canonical fingerprints.
- Preserve unrelated entries and settings.
- Render to a sibling temporary file.
- Validate the complete result.
- Replace atomically only after validation.
- Never use a force flag to overwrite an unowned conflict.

Credential references must follow the supported syntax of each detected host version. Add renderer contract tests from the canonical plan rather than maintaining unrelated hand-written fixtures.

Exit criteria:

- All three hosts represent equivalent MCP servers and tool allowlists.
- Repeated generation is byte-stable when inputs have not changed.
- Failed merges preserve original files byte-for-byte.

### Phase 7: Doctor v2 and guided CLI

Refactor doctor behind shared MCP client interfaces and add:

- Plan and approval validation.
- Runtime checks.
- DAB validation.
- Docker/image checks.
- Credential availability checks.
- Stdio MCP lifecycle.
- Streamable-HTTP MCP lifecycle.
- Host-to-plan equivalence checks.
- Exact tool allowlist and harmless probe checks.
- `READY`, `READY_WITH_WARNINGS`, and `BLOCKED` summary.

Add terminal behavior:

- Semantic colors.
- `NO_COLOR` and `--no-color`.
- Stable JSON without ANSI.
- Credential status and config navigation.
- One next action at the end of each interactive result.

Exit criteria:

- Doctor acceptance tests pass for every readiness state.
- Redirected and JSON output contain no ANSI bytes.
- Errors and debug output cannot reveal credential material.

### Phase 8: Elastic Agent Builder and optional Jira

After the mandatory 8.19.15 path is stable:

- Add `elastic-agent-builder` for 9.2+ and Serverless.
- Support Kibana spaces and approved authentication references.
- Fail closed when a safe read-only tool allowlist cannot be established.
- Add optional Atlassian Rovo MCP.
- Render host-managed OAuth flows and host-specific login guidance.
- Pin and test the vendor tool catalog used by the Jira recipe.

Exit criteria:

- Version selection is deterministic and tested at 9.1/9.2 boundaries.
- Unknown Elastic versions remain unresolved.
- Missing Jira is a warning.
- Approved Jira with broken authentication is reported as an activated optional-connector failure without changing database/observability evidence.

### Phase 9: Optional AI-assisted review contract

Implement only after deterministic discovery is stable:

- Generate a bounded review request from ambiguous inventory entries.
- Document how the Rooty skill asks the active host model to review it.
- Validate host-produced suggestions against the schema.
- Recheck every cited path and supported-provider claim.
- Merge accepted suggestions as `AI_SUGGESTED`, not `DETECTED`.
- Require the same human approval as other inferred mappings.

The CLI remains model-free. No OpenAI, Anthropic, or other model SDK becomes a runtime dependency.

Exit criteria:

- Prompt-injection fixtures cannot alter recipes, commands, tools, or scope.
- Invalid, unsupported, uncited, secret-bearing, and out-of-root suggestions are rejected.
- The complete setup remains usable with AI review disabled.

## Test structure

```text
tests/
|-- discovery/
|-- planning/
|-- generators/
|-- host-renderers/
|-- doctor/
|-- security/
|-- fixtures/
|   |-- dotnet-multiservice/
|   |-- node-monorepo/
|   |-- elastic-8.19/
|   |-- elastic-9.2/
|   `-- host-config-conflicts/
`-- mvp.test.js                # compatibility coverage while tests split
```

Tests should prefer frozen protocol fixtures for deterministic coverage and add a smaller opt-in integration suite for real DAB, Docker, and provider negotiation.

CI test classes:

1. Pure unit and schema tests: always run.
2. Filesystem and renderer integration: Windows, macOS, and Linux.
3. DAB integration: run where the pinned DAB runtime is installed.
4. Docker Elastic integration: run where Docker and the approved image are available.
5. Live vendor smoke tests: opt-in, credentialed, read-only, and never required for ordinary contributor tests.

## Documentation changes by phase

Do not update user-facing setup claims before the corresponding behavior ships.

When the feature is complete, update:

- `README.md`: new production journey and supported scope.
- `docs/getting-started.md`: guided setup example.
- `docs/setup.md`: resource discovery, review, generated runtimes, credentials, and host flows.
- `docs/architecture.md`: resource inventory, canonical plan, generators, and MCP clients.
- `docs/security.md`: Docker/runtime supply chain, approval digest, and generated-command boundary.
- `docs/cli-reference.md`: new commands, options, states, and color behavior.
- `docs/troubleshooting.md`: DAB, Docker, Elastic 8.19, OAuth, merging, and credential visibility.
- Host adapter READMEs: exact generated configuration and limitations.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| False resource detection | Structured evidence, confidence, unresolved state, human approval |
| Secret capture | Skip policy, value rejection, schema validation, redaction tests |
| Repository prompt injection | Deterministic baseline, schema-constrained AI suggestions, no executable input from project text |
| DAB mutation exposure | Explicit runtime disablement, read permissions, host allowlist, read-only database identity, negative tests |
| Elastic standalone deprecation | Visible warning, pinned compatibility recipe, Agent Builder migration path |
| Docker supply chain | Official image only, explicit pull consent, tested reference/digest policy |
| Host config damage | Ownership tracking, structured merge, atomic replacement, conflict failure |
| Vendor tool drift | Recipe versioning, doctor tool comparison, compatibility warning/failure |
| Cross-platform command behavior | Path/escaping utilities and Windows/macOS/Linux CI |
| AI nondeterminism | AI optional, suggestions classified separately, human approval required |

## Definition of done

The automatic MCP setup enhancement is done when:

- Every normative acceptance criterion in the requirements document has an automated test or an explicitly documented manual verification.
- SQL Server and Elasticsearch 8.19.15 complete the end-to-end journey on Codex, Claude Code, and Cursor.
- Database and observability are the only mandatory connector capabilities for version-2 projects.
- Jira is optional and pasted-ticket intake is documented.
- No generated or displayed artifact contains credential values.
- Rooty activates no mutation-capable tool.
- Strict doctor reports the correct readiness state from the same environment that launches the selected host.
- Current version-1 projects, demo, evaluation, evidence, report, and memory workflows remain functional.
- User-facing documentation is updated only after implementation and verification.
