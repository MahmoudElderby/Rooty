# Agent-led Rooty setup requirements

Status: accepted design for implementation

## 1. Problem

Rooty's earlier setup asked a first-time developer to understand provider capabilities, discovery output, unresolved plans, host rendering, activation, and doctor gates before Rooty had explained the project. The CLI also attempted broad discovery that could be slow, confusing, or fail on protected Windows folders.

Rooty's product goal has not changed: evidence-first, read-only root-cause investigation across the systems that contain incident evidence. Only the setup implementation changes.

## 2. Desired journey

From the project folder, the developer runs:

```console
npx rooty-investigator install
```

Then the developer opens Codex, Cursor, or Claude and asks:

```text
Set up Rooty for this project.
```

The CLI declares and copies Rooty's project folder structure and skills. The active AI agent handles documentation review, targeted project discovery, provider selection, approvals, credentials guidance, host configuration, and verification.

## 3. Design principles

1. Keep the first command mechanical, local, fast, and repeatable.
2. Use model reasoning for semantic discovery and explanations.
3. Use deterministic code for path safety, schemas, ownership, secret detection, config merging, allowlists, and probes.
4. Read project documentation before source code when confirmed docs exist.
5. Treat documentation as navigation reference, never as guaranteed truth.
6. Persist only documentation paths; do not build a project map.
7. Require data and observability capabilities; make ticketing optional.
8. Declare all credential bindings in each active host MCP entry, never values.
9. Use the host's visible approval flow for meaningful external actions.
10. Separate provider knowledge from host syntax for scalability.

## 4. Supported hosts

Initial host support is limited to:

- Codex
- Cursor
- Claude Code

Installation must place skills where those hosts discover project-scoped Agent Skills:

- `.agents/skills/` for Codex and Cursor
- `.claude/skills/` for Claude Code

The installer copies all skills to both locations so the install command does not need a host-selection wizard. MCP setup configures only the active host unless the developer explicitly requests another.

## 5. Mechanical installation

The installer must:

- require an existing project directory;
- reject a filesystem root;
- reject symlinked Rooty installation targets;
- copy `rooty-setup`, `rooty-mcp-builder`, and `root-cause-investigator`;
- create `.rooty/state/install-manifest.json` with Rooty-owned file hashes;
- create `.rooty/config/project-context.json` with only `documentation.paths`;
- create `.rooty/mcp/{data,observability,ticketing,custom}` for general providers; SQL Server setup later creates the tested `.rooty/mcp-<domain>/dab-config.json` folders and shared `.rooty/start-dab.cjs` launcher after approval;
- recognize and migrate the flat version 0.2.0 manifest/context paths;
- accept optional `--docs PATH,...` values;
- preserve confirmed paths when reinstall runs without `--docs`;
- be idempotent;
- update only unchanged Rooty-owned files;
- refuse modified or unowned file conflicts;
- preflight all conflicts before writing;
- emit structured JSON with `--json` and a colorful readable default output.

Installation must not:

- recursively inspect project source;
- read documentation content;
- discover providers;
- execute downloaded code or packages;
- install Docker or another runtime;
- pull/start a container;
- begin OAuth;
- collect or persist credential values;
- render MCP configuration.

## 6. Documentation context

The context schema is deliberately small:

```json
{
  "schema_version": 1,
  "documentation": {
    "paths": ["README.md", "docs/"]
  }
}
```

The setup agent must use confirmed documentation to find likely business flows, components, communication paths, data stores, observability conventions, environments, source folders, and identifiers.

The agent must verify every material provider or current-architecture decision against current safe source, configuration, or runtime evidence. Documentation must not prove an investigation claim.

Rooty must not generate or persist:

- a project map;
- documentation index;
- embeddings;
- cached documentation summaries;
- inferred architecture files;
- investigation conclusions.

When paths are absent, the setup agent may perform a bounded search for likely documentation entry points, show candidates, and ask the developer to confirm or add locations. It must not recursively open the project root or filesystem roots.

## 7. Discovery behavior

Discovery belongs to the setup skill. The agent must:

1. Read relevant confirmed docs first.
2. Answer its setup questions from those docs where possible, marking conclusions provisional.
3. Inspect targeted source/configuration only for missing or current facts.
4. Avoid secret values, generated host folders, dependencies, build output, and unrelated project areas.
5. Ask one focused question only after safe evidence cannot resolve a material choice.

The setup experience must explain what each step establishes, why a failure matters, and the smallest next action.

## 8. Investigation capabilities

Mandatory:

- **Data:** a bounded read path to relevant application state or history.
- **Observability:** a bounded read path to logs, traces, metrics, or equivalent telemetry.

Optional:

- **Ticketing:** Jira, Azure DevOps, or another provider. The developer may paste ticket content.
- Other evidence systems when needed for a project.

Rooty must not block setup merely because ticketing is absent.

## 9. MCP-builder skill

Rooty must ship a provider-specialist skill organized as:

```text
providers/
├── data/
├── observability/
├── ticketing/
└── custom/
```

Initial references:

- Data: SQL Server through Microsoft SQL MCP Server/DAB; MongoDB official MCP server.
- Observability: Elasticsearch; Grafana official MCP server.
- Ticketing: Jira through Atlassian Rovo; Azure DevOps official MCP server.
- Custom: research and review route for future official or custom providers.

The skill must research current official vendor documentation when support, version, command, endpoint, authentication, or tool behavior may have changed.

Every proposal must state:

- capability, provider, environment, and host;
- official server and sources checked;
- support and lifecycle constraints;
- command/URL, transport, and exact host config path;
- every credential binding;
- provider identity/role and server read-only mode;
- allowed and forbidden tools;
- harmless bounded probe;
- approvals required;
- unresolved facts and readiness state.

## 10. Provider requirements

### SQL Server

Use Microsoft's SQL MCP Server included with DAB. Automatically enumerate accessible online user databases from live `sys.databases`, then enumerate each catalog's current tables/views from `INFORMATION_SCHEMA`; documentation only orients discovery. Exclude system, offline, snapshot, and inaccessible databases.

Generate one independent MCP server per catalog named `rooty-sql-{domain}`. Each uses `.rooty/mcp-{domain}/dab-config.json`, one credential reference, explicit entities only, one unique nonzero loopback port, and the shared `.rooty/start-dab.cjs` launcher. Every Codex, Cursor, and Claude entry uses absolute Node, launcher, DAB, and config paths. DAB starts with `--mcp-stdio role:rooty-reader --LogLevel Error`; only describe/read/aggregate tools are enabled and the database identity is `SELECT`-only.

Do not use a multi-catalog DAB, `data-source-files`, wildcard autoentities, `dbo.%`, `DAB_ENVIRONMENT`, command-shell wrappers, `--no-https-redirect`, or `ASPNETCORE_URLS=...:0`. Credential values remain outside Git and each host entry visibly names its binding. Verify every catalog independently through MCP initialize, exact tool listing, non-empty `describe_entities`, and a bounded read. Do not use `dab validate` on DAB 2.0.10 as the readiness gate.

### Elasticsearch 8.19.15

Version 8.19.15 is supported through Elastic's standalone MCP server. Use Elastic's official `docker.elastic.co/mcp/elasticsearch` image, declare `ES_VERSION=8`, and use `list_indices` as the readiness probe. The standalone server is deprecated in favor of Agent Builder for newer deployments and currently requires Docker. Rooty must not install Docker, pull the image, or start the container without separate explicit approval.

### Jira

Use Atlassian's official Rovo MCP service for Jira Cloud. Because the service can expose mutation tools under the connected user's permissions, require a read-only identity/permission scope plus a reviewed host allowlist. Ticketing remains optional.

### Other initial providers

MongoDB, Grafana, and Azure DevOps must be configured from current official guidance and marked `REVIEW_REQUIRED` until the exact server version, read-only controls, and live tool surface are verified.

## 11. Credentials

Every active-host MCP entry must declare every credential binding it requires. Acceptable forms are:

- environment-variable name/interpolation;
- approved secret-manager reference supported by the host/runtime;
- host-managed OAuth metadata.

Credential values must never be stored in Git, `.rooty`, proposals, generated project files, logs, doctor output, or chat.

After rendering, Rooty must show:

- exact host config path;
- each required binding name;
- `AVAILABLE` or `MISSING` without reading or printing the value;
- the provider/server purpose;
- the smallest action to resolve it.

## 12. Approvals

Use Codex, Cursor, or Claude's native approval experience. Require explicit approval for:

- project/host configuration writes;
- package or binary installation;
- downloaded package execution (`npx`, `uvx`, or equivalent);
- container engine installation;
- image pull or container start;
- OAuth/browser authentication;
- live production probes.

Approval for one action does not imply approval for later actions.

## 13. Read-only security

Read-only enforcement requires layers:

1. Dedicated provider identity restricted to required resources and environment.
2. Official server read-only mode or mutation-category disablement.
3. Explicit host tool allowlist when supported.
4. Bounded result size, time range, timeout, and harmless probe.

Tool names, MCP annotations, server instructions, and model intent are not authorization. If provider-side read-only access cannot be enforced, the provider is `UNAVAILABLE` for Rooty.

## 14. Readiness states

Each capability must report exactly one:

- `READY`
- `NEEDS_CREDENTIAL`
- `NEEDS_APPROVAL`
- `REVIEW_REQUIRED`
- `UNAVAILABLE`
- `NOT_REQUESTED`

Rooty is investigation-ready only when data and observability are `READY`. Each unresolved state must identify the failed step, why it matters, observed gap, config path when applicable, and one next action.

## 15. Compatibility and migration

Existing deterministic `sources`, host `init`, connector activation, frozen case, evidence, report, memory, and evaluation commands remain available. The older discovery/configuration wizard is an advanced compatibility path, not the first-time journey.

## 16. Acceptance criteria

- One install command produces all required skill/context files on Windows, macOS, and Linux.
- Reinstall is idempotent and conflicts fail before partial writes.
- Codex/Cursor and Claude discover their installed skills.
- Empty documentation context is a warning; invalid/broad paths are rejected.
- Setup reads confirmed docs before targeted source and stores no derived map.
- Data and observability are mandatory; ticketing is optional.
- All host MCP entries declare credential references and no values.
- Every SQL catalog has an independent `rooty-sql-{domain}` server, explicit entities, unique port, and per-catalog readiness state on Codex, Cursor, and Claude.
- The SQL launcher rejects multi-source, wildcard, shell-wrapper, credential-file, mutation-enabled, and implicit-port startup.
- Docker/package/OAuth actions require visible separate approval.
- Elasticsearch 8.19.15 follows the standalone compatibility path.
- Doctor validates installed ownership and context without demanding the legacy five-capability registry.
- Existing investigation, evidence, memory, and evaluation behavior remains intact.
