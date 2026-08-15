# Automatic MCP setup requirements

## Status

**Approved implementation requirements; not yet implemented.**

This document defines the first production scope for automatic evidence-resource discovery, MCP planning, generated runtime assets, and host configuration. It supersedes broader design ideas only for this implementation slice. The current CLI behavior remains documented in [Project and connector setup](setup.md) until this work ships.

Normative terms such as **MUST**, **MUST NOT**, **SHOULD**, and **MAY** describe implementation requirements.

## Outcome

A developer can point Rooty at a project, review automatically detected SQL Server and Elasticsearch resources, provide credential references, generate read-only MCP configuration for Codex, Claude Code, or Cursor, and verify the result with doctor.

The target journey remains:

```text
install -> discover -> review -> configure -> initialize host -> doctor -> investigate
```

Rooty MUST keep discovery and activation separate. Detection never grants access to a resource.

## MVP scope

### Supported hosts

- Codex
- Claude Code
- Cursor

### Supported evidence providers

| Capability | Requirement | Supported provider and runtime |
|---|---|---|
| `database` | Mandatory | Microsoft SQL Server through Microsoft's SQL MCP Server in Data API Builder (DAB) |
| `observability` | Mandatory | Elasticsearch 8.x or 9.0-9.1 through Elastic's standalone MCP server; Elasticsearch 9.2+ or Serverless through Elastic Agent Builder MCP |
| `ticketing` | Optional | Jira Cloud through Atlassian Rovo MCP |

Documentation and deployment context MAY be read from the investigated project through the host's read-only filesystem access. They do not require MCP connectors in this release.

When Jira is absent, the user MAY paste the ticket or incident report into the host conversation. Pasted incident content is `REPORTED` evidence, not an observed fact.

### Production-readiness rule

Strict doctor reports the project as ready only when:

1. At least one approved SQL Server resource is generated and verified.
2. One approved Elasticsearch observability resource is generated and verified.
3. One supported host configuration matches the approved MCP plan.
4. Every required credential reference is available to the process that will launch the host.
5. Read-only MCP initialization, tool discovery, and harmless probes succeed.

Missing Jira configuration produces a warning, never a failure.

### Non-goals

The first implementation does not:

- Support PostgreSQL, MySQL, Datadog, Grafana, Sentry, or other providers.
- Install Docker or other system software.
- Add a Rooty gateway or credential store.
- Let the Rooty CLI call an AI model directly.
- Activate write-capable tools, even with user approval.
- Capture live host investigations into the frozen-snapshot artifact pipeline.
- Add a generic runtime or generator plug-in API before the SQL Server and Elasticsearch slice is complete.

## User journey

### 1. Install and preflight

The user installs Rooty and selects a project and host. Preflight MUST report:

- Node.js compatibility.
- Whether the selected host is supported.
- Whether the DAB CLI is present when SQL Server is approved.
- Whether Docker is present when the Elastic standalone MCP is required.
- Whether required host files already exist.

Rooty MUST NOT install Docker. If Docker is missing, the CLI stops with platform-appropriate guidance.

Rooty MUST NOT pull a container image without interactive approval or an explicit non-interactive flag. A failed Elastic image pull MUST explain common entitlement, registry, proxy, and authentication causes without exposing credentials.

### 2. Discover

```console
rooty sources discover --project /path/to/project
```

Discovery MUST scan safe project documentation, source code, structured configuration, and deployment manifests. It produces a plural resource inventory and supporting evidence.

The scanner MUST:

- Work without model access or network access.
- Prefer structured detectors over repository-wide regular expressions.
- Record project-relative evidence paths and the matched signal.
- Identify service roots using solution, workspace, project, module, and deployment manifests.
- Distinguish multiple resource instances of the same provider.
- Avoid symlinks and paths outside the project.
- Skip real `.env` files, secret stores, private keys, credential-named paths, and structured files containing apparent credential values.
- Retain only credential variable names and placeholders, never discovered values.
- Bound file count, file size, and parsing work.
- Report every skipped file category and limit reached.

The initial supported file set MUST include at least:

- `.md`, `.mdx`, and `.txt`
- `.json`, `.jsonc`, `.yaml`, `.yml`, `.toml`, `.xml`, and `.properties`
- `.cs`, `.csproj`, `.sln`, `.props`, `.targets`, and `.config`
- `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, and `.cjs`
- Dockerfiles and Docker Compose files
- Terraform, Kubernetes, and Helm files used to establish resource identity or version hints

A directory named `packages` MUST NOT be skipped globally because it is a common monorepo service root. Generated-package caches must be identified using bounded contextual rules instead of the directory name alone.

### 3. Optional AI-assisted review

After deterministic discovery, the configured AI host MAY review ambiguous candidates. The model is a semantic reviewer, not the discovery system of record.

AI review is suitable for questions such as:

- Whether an Elasticsearch cluster is used for observability or application search.
- Whether two connection names refer to the same physical resource.
- Which service owns a resource found in shared configuration.
- Whether documentation changes the interpretation of a source-code signal.

AI suggestions MUST:

- Use a versioned JSON schema.
- Cite project-relative evidence files.
- Be marked `AI_SUGGESTED`.
- Contain no credential values or raw connection strings.
- Pass the same path, secret, provider, and schema validation as CLI detections.
- Require explicit human approval before generation.

Repository content used during AI review is untrusted data. It cannot alter supported providers, tool allowlists, approval rules, or security invariants.

### 4. Review and configure

The user reviews every detected resource and chooses one state:

- `approved`
- `excluded` with a reason
- `unresolved`

The review MUST show:

- Resource ID, kind, provider, service root, and environment.
- Confidence and classification.
- Exact evidence paths and signals.
- Proposed MCP recipe and transport.
- Proposed grouping.
- Schemas, tables, indices, or patterns proposed for exposure.
- Required credential variable names.
- Allowed tools and harmless doctor probe.
- Deprecation, version, licensing, and prerequisite warnings.

Generation MUST stop if either mandatory capability is unresolved.

Approval MUST produce a digest covering the inventory, plan, exposure rules, tool allowlist, runtime command, and credential references. Changing approved content invalidates approval and requires review again.

### 5. Initialize the host

```console
rooty init --host codex --project /path/to/project --activate-connectors
```

The same flow supports `claude` and `cursor`. Host rendering MUST be idempotent and use safe structured merging. A second run updates only Rooty-owned entries and preserves unrelated servers and user settings.

Writes MUST be atomic. A failed render MUST leave the original host file unchanged. Rooty MUST show a readable conflict when an existing entry uses a Rooty-owned name but does not match Rooty's ownership metadata.

### 6. Configure missing credentials

Generated host configuration MUST contain credential references, not values. Rooty MUST also write a credential-requirements artifact containing names and status metadata only.

The CLI MUST present a navigable setup summary with:

- The selected host and absolute host-config path.
- Each connector and its required credential names.
- `available`, `missing`, `host-auth-required`, or `optional` status.
- Commands or host actions needed to resolve each missing item.
- Actions to open the config, show setup commands, start supported OAuth login, and recheck.

Credential status output MUST never display a value, prefix, suffix, length, hash, or other identifying material.

### 7. Doctor

```console
rooty doctor --project /path/to/project
```

Doctor validates static configuration, required runtimes, credentials, transports, tools, and harmless reads. Optional Jira failures are warnings unless Jira was explicitly approved and activated, in which case a broken Jira connector is a readiness failure for that approved plan.

## Resource and plan model

### Resource inventory

The implementation MUST introduce resources as physical instances, separate from logical capabilities.

```json
{
  "schema_version": 2,
  "resources": [
    {
      "id": "orders-db",
      "kind": "database",
      "provider": "mssql",
      "service": "orders-api",
      "service_root": "services/orders",
      "environment": "production",
      "confidence": "high",
      "classification": "DETECTED",
      "credential_references": ["ORDERS_DB_CONNECTION"],
      "evidence": [
        {
          "path": "services/orders/Orders.csproj",
          "signal": "Microsoft.EntityFrameworkCore.SqlServer"
        },
        {
          "path": "services/orders/Program.cs",
          "signal": "UseSqlServer"
        }
      ]
    }
  ],
  "capability_bindings": {
    "database": ["orders-db"],
    "observability": []
  }
}
```

Resource IDs MUST be stable for the same provider, service root, logical connection name, and environment. IDs MUST NOT include credentials, connection strings, user-specific absolute paths, or machine identifiers.

### MCP plan

The canonical plan separates provider/runtime decisions from host rendering.

```json
{
  "schema_version": 1,
  "state": "approved",
  "approved_digest": "sha256:<digest>",
  "servers": [
    {
      "id": "rooty-databases",
      "capabilities": ["database"],
      "recipe": "mssql-dab",
      "transport": "stdio",
      "resources": ["orders-db"],
      "command": "dab",
      "args": [
        "start",
        "--mcp-stdio",
        "role:rooty-reader",
        "--config",
        ".investigator/generated/dab/dab-config.json",
        "--LogLevel",
        "Error"
      ],
      "credential_references": ["ORDERS_DB_CONNECTION"],
      "allowed_tools": [
        "describe_entities",
        "read_records",
        "aggregate_records"
      ]
    }
  ]
}
```

Plan states are:

```text
proposed -> approved -> generated -> verified
```

Invalid approval, generation, or doctor results MUST move readiness to `blocked`; they MUST NOT silently reuse a stale verified state.

### Credential requirements

`.investigator/credential-requirements.json` contains names only:

```json
{
  "schema_version": 1,
  "requirements": [
    {
      "name": "ES_API_KEY",
      "connector": "rooty-elastic",
      "required": true,
      "secret": true,
      "resolution": "environment"
    },
    {
      "name": "ROOTY_JIRA_OAUTH",
      "connector": "rooty-jira",
      "required": false,
      "secret": true,
      "resolution": "host-oauth"
    }
  ]
}
```

This artifact MUST pass the same embedded-secret scanner as all other Rooty configuration.

## Provider requirements

### SQL Server through DAB

#### Detection

Structured SQL Server detectors SHOULD use:

- `Microsoft.EntityFrameworkCore.SqlServer`
- `Microsoft.Data.SqlClient`
- `UseSqlServer`
- Named connection-string keys and placeholders
- SQL Server container images
- SQL Server deployment and infrastructure configuration

Package detection alone establishes a provider candidate, not a physical database instance. A resource instance requires a logical connection name, deployment mapping, explicit user input, or equivalent bounded evidence.

#### Generated runtime

Rooty MUST keep the approved multi-database DAB design:

```text
.investigator/generated/dab/
|-- dab-config.json
|-- databases/
|   |-- orders.json
|   `-- inventory.json
`-- mcp-runtime.json
```

Compatible approved SQL Server resources MAY be grouped into one DAB process. Grouping MUST NOT cross environments. The review screen MUST show the complete group before approval.

The top-level config uses `data-source-files`. Entity names across child files MUST be globally unique and use a stable resource prefix. Cross-child relationships MUST NOT be generated.

Connection strings MUST use environment references such as `@env('ORDERS_DB_CONNECTION')`; raw values are forbidden.

The generated runtime MUST:

- Enable MCP.
- Disable REST and GraphQL unless DAB requires an internal setting that cannot be disabled; any exception must be documented and verified unreachable.
- Enable only `describe_entities`, `read_records`, and `aggregate_records`.
- Explicitly disable create, update, delete, and execute tools.
- Exclude stored procedures from custom MCP tools.
- Grant only read entity permissions to `rooty-reader`.
- Use reviewed include/exclude patterns.
- Apply bounded pagination and query timeouts.

The stdio command MUST include `--mcp-stdio` and SHOULD use `--LogLevel Error` to protect JSON-over-stdio from non-protocol output.

Doctor MUST run DAB config validation, initialize stdio MCP, compare the advertised tools with the allowlist, and execute a bounded harmless read. A production database identity MUST be independently read-only; DAB configuration is not the authorization boundary.

### Elasticsearch

#### Detection and version selection

Elasticsearch detectors SHOULD use:

- `Elastic.Clients.Elasticsearch`
- `@elastic/elasticsearch`
- Elasticsearch and Kibana container images
- `ELASTICSEARCH_URL`, `KIBANA_URL`, and equivalent placeholders
- Deployment manifests and explicit version declarations
- Documentation that identifies a cluster as a log or observability store

An Elasticsearch client dependency does not prove the `observability` capability. Application-search usage remains unresolved until stronger evidence or human approval exists.

Recipe selection is:

| Deployment | Recipe | Status |
|---|---|---|
| Elasticsearch 8.x, including 8.19.15 | `elastic-standalone` | `supported-deprecated` |
| Elasticsearch 9.0-9.1 | `elastic-standalone` | `supported-deprecated` |
| Elasticsearch 9.2+ | `elastic-agent-builder` | `supported` |
| Elasticsearch Serverless | `elastic-agent-builder` | `supported` |
| Unknown | none | `unresolved` |

Client-library versions are hints only. An exact deployment version from a manifest, harmless version probe, or user confirmation takes precedence.

#### Elastic standalone

The standalone recipe uses Elastic's official container and supports stdio for Codex, Claude Code, and Cursor. Rooty MUST check Docker availability and official-image availability before generation or doctor.

The allowed tool set is:

- `list_indices`
- `get_mappings`
- `search`
- `esql`
- `get_shards`

Credentials are `ES_URL` plus either a read-only `ES_API_KEY` or an explicitly reviewed alternative supported by the official server. The API key MUST be restricted to approved observability indices. `ES_SSL_SKIP_VERIFY` MUST NOT be generated for production.

The CLI MUST show a deprecation warning but MAY report the connector ready when all verification passes. The warning recommends migration to Agent Builder after upgrading to 9.2+.

#### Elastic Agent Builder

The endpoint is based on the approved Kibana URL and supports the default space and custom spaces. Authentication uses a least-privilege API key or supported OAuth flow.

Rooty MUST activate only reviewed read/search tools. The presence of write-capable built-in, custom, or workflow tools in the usable host allowlist is a failure.

### Jira Cloud through Atlassian Rovo MCP

Jira is optional and uses Atlassian's official Rovo MCP endpoint. Rooty MUST NOT require Jira when the user chooses pasted incident intake.

The Rovo server can expose read and write tools. Rooty MUST:

- Activate only reviewed Jira read/search tools.
- Require least-privilege permission groups or credentials.
- Exclude create, update, transition, comment, and administrative tools.
- Treat a changed vendor tool catalog as a compatibility event requiring recipe review.
- Use host-managed OAuth where supported rather than persisting tokens.

## Host rendering requirements

### Canonical rule

Every host renderer consumes the same approved MCP plan. Equivalent connectors MUST have the same resource bindings, runtime arguments, credential references, and allowlisted tools across hosts.

Generated files contain credential references only.

### Codex

Rooty renders project-scoped `.codex/config.toml` with:

- `sandbox_mode = "read-only"`
- Project MCP server tables
- `command`, `args`, and `env_vars` for stdio servers
- `url` plus supported authentication references for remote servers
- `enabled_tools`
- `required = true` for mandatory connectors

The renderer MUST follow the current [official Codex MCP configuration](https://developers.openai.com/codex/mcp) and MUST be covered by syntax and snapshot tests.

### Claude Code

Rooty renders project `.mcp.json` plus the existing Rooty read-only hook and tool allowlist. Environment references use Claude-supported expansion rather than literal secrets. Project MCP approval remains a user-controlled host action.

### Cursor

Rooty renders `.cursor/mcp.json` and the Rooty investigation rule. Environment references use the Cursor-supported syntax for the detected version. Doctor MUST warn when the installed Cursor version cannot safely resolve the required reference form.

Because host rules are not provider authorization, Cursor production readiness still requires least-privilege database and Elastic identities.

## CLI experience

### Guided setup

The existing commands remain supported. A guided command MAY orchestrate them without weakening review:

```console
rooty setup --host codex --project .
```

Guided setup MUST stop at every decision that changes resource exposure, pulls an image, starts OAuth, or resolves ambiguity.

### Credential and config navigation

The CLI MUST support equivalent behavior for:

```console
rooty credentials status --project .
rooty config path --host codex --project .
rooty config open --host codex --project .
```

`config open` MUST print the path when no interactive editor is available. It MUST NOT choose or install an editor.

For Jira OAuth, the CLI shows the appropriate host action, for example a Codex MCP login command, Claude's MCP menu/login command, or Cursor's MCP connection UI.

### Color and machine output

Interactive text output uses color sparingly:

- Green: detected, available, approved, verified, pass
- Yellow: ambiguous, optional, deprecated, warning
- Red: unsafe, missing mandatory input, blocked, fail
- Cyan: planned action, path, and next command
- Dim: supporting evidence and implementation detail

Color MUST:

- Be enabled only for a compatible TTY.
- Respect `NO_COLOR` and `--no-color`.
- Never appear in `--json`, redirected output, logs, or persisted artifacts.
- Not be the only indicator of state; every state also has text or a symbol.

Every interactive command ends with readiness plus one concrete next action.

## Security invariants

These requirements cannot be overridden by a recipe, AI suggestion, or user approval:

1. Rooty never writes or invokes mutation-capable evidence tools.
2. Rooty never persists credential values in discovery, plans, generated host files, logs, JSON output, or errors.
3. Provider identities remain the real authorization boundary and must be read-only.
4. Discovery never scans known secret sources to improve confidence.
5. Generated commands come from trusted recipes; project text cannot provide executable commands, package names, image names, or arbitrary arguments.
6. Resource IDs and file paths are validated against traversal, symlink escape, command injection, JSON injection, and TOML injection.
7. Activation requires an approved plan digest.
8. Host allowlists name individual read tools; activating an entire server tool catalog is forbidden.
9. Doctor probes are bounded, harmless, and included in the allowlist.
10. Optional AI review cannot activate resources or expand scope.

## Doctor and readiness output

Doctor adds checks for:

- Inventory and plan schema validation.
- Approval digest and plan freshness.
- Mandatory capability bindings.
- Runtime/package prerequisites.
- Docker and official Elastic image availability when applicable.
- DAB config validation.
- Generated-file existence and schema validation.
- Credential-name presence without value disclosure.
- Host render equivalence with the canonical plan.
- Stdio and streamable-HTTP MCP initialization.
- Exact allowed-tool availability.
- Absence of mutation tools from Rooty's activated host allowlist.
- Harmless read probes.
- Optional connector state.

Top-level readiness values are:

- `READY`
- `READY_WITH_WARNINGS`
- `BLOCKED`

Elastic standalone deprecation and missing optional Jira normally yield `READY_WITH_WARNINGS`. Missing database or observability coverage yields `BLOCKED`.

## Generated artifacts

```text
.investigator/
|-- discovery.json
|-- resource-inventory.json
|-- mcp-plan.json
|-- credential-requirements.json
|-- generated/
|   `-- dab/
|       |-- dab-config.json
|       |-- databases/
|       `-- mcp-runtime.json
`-- activated-connectors.json
```

Runtime and machine-specific artifacts are ignored by Git by default. A future commit-safe export is outside this implementation. Host files remain free of secret values and follow the selected host's project-config policy.

## Acceptance criteria

The implementation is complete only when automated tests prove all of the following:

### Discovery

- Two SQL Server databases in different service folders become two resources.
- SQL signals in `.cs`, `.csproj`, configuration, documentation, and Docker files are detected.
- A JavaScript monorepo `packages/` directory is scanned.
- Elasticsearch 8.19.15 selects `elastic-standalone` with a deprecation warning.
- Elasticsearch 9.2+ selects `elastic-agent-builder`.
- An application-search Elasticsearch dependency is not automatically bound to observability.
- Equal or conflicting evidence remains unresolved.
- Secret-named, credential-bearing, oversized, binary, symlinked, and out-of-root files are skipped safely.

### Planning and approval

- Stable IDs survive repeated discovery with unchanged inputs.
- Changing approved exposure, commands, tools, or credentials invalidates approval.
- AI suggestions without valid in-project evidence are rejected.
- Excluded resources retain the user's reason.
- Database and observability are mandatory; Jira is optional.

### DAB

- Compatible SQL Server resources generate one multi-database DAB process.
- The command includes `--mcp-stdio` in the correct position.
- Generated entity names are stable and globally unique.
- Raw connection strings never appear in generated artifacts.
- REST, GraphQL, create, update, delete, and execute capabilities are disabled.
- Only the three approved read tools are activated.
- DAB validation, initialization, tool listing, and a harmless probe succeed in the integration fixture.

### Elastic

- Missing Docker blocks the 8.19.15 path with actionable guidance.
- Image pull requires explicit consent.
- The standalone configuration forwards only credential references.
- The five approved standalone tools resolve.
- Unknown versions block recipe selection.
- Agent Builder custom or write tools are never added to the Rooty allowlist.

### Hosts and credentials

- Codex, Claude Code, and Cursor renders are equivalent to the canonical plan.
- A second run is idempotent and preserves unrelated user configuration.
- A failed merge leaves the original file byte-for-byte unchanged.
- Missing credentials are named but never valued or partially revealed.
- Jira OAuth status gives a host-specific next action.
- Existing Rooty-owned entry conflicts produce a readable error.

### CLI and security

- TTY output uses semantic colors and remains readable without color.
- `NO_COLOR`, `--no-color`, redirection, and `--json` contain no ANSI sequences.
- JSON output remains stable and machine-readable.
- Resource names cannot inject commands, paths, TOML, or JSON.
- Generated recipes cannot include mutation tools.
- Doctor reports `READY_WITH_WARNINGS` for a verified Elastic 8.19.15 setup without Jira.
- Doctor reports `BLOCKED` when database or observability is missing.

## Authoritative external references

- [Microsoft SQL MCP Server overview](https://learn.microsoft.com/en-us/azure/data-api-builder/mcp/overview)
- [Microsoft DAB stdio transport](https://learn.microsoft.com/en-us/azure/data-api-builder/mcp/stdio-transport)
- [Microsoft DAB configuration schema](https://learn.microsoft.com/en-us/azure/data-api-builder/configuration/)
- [Elastic standalone MCP server](https://github.com/elastic/mcp-server-elasticsearch)
- [Elastic Agent Builder MCP](https://www.elastic.co/docs/explore-analyze/ai-features/agent-builder/mcp-server)
- [Atlassian Rovo MCP setup](https://developer.atlassian.com/cloud/rovo-mcp/guides/getting-started/)
- [Atlassian Rovo supported tools](https://developer.atlassian.com/cloud/rovo-mcp/guides/supported-tools/)
- [Official Codex MCP configuration](https://developers.openai.com/codex/mcp)
- [Claude Code MCP configuration](https://code.claude.com/docs/en/mcp)
- [Cursor MCP configuration](https://docs.cursor.com/context/model-context-protocol)
