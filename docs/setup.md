# Project and MCP setup

Rooty uses a mechanical installer followed by agent-led setup. The CLI establishes owned files and deterministic checks; the active Codex, Cursor, or Claude agent performs semantic discovery and guides approvals.

## Setup journey

| State | Agent action | Developer sees |
|---|---|---|
| Installed | Confirm manifest and three skills | Installed locations and next prompt |
| Docs confirmed | Confirm documentation entry points | Paths stored in `.rooty/config/project-context.json` |
| Discovered | Read docs first, then targeted current source/config | Evidence for data and observability candidates |
| Proposed | Build one provider/host MCP proposal | Config path, command/URL, credentials, controls, probe |
| Approved | Request host-native approval | Exact writes and external actions |
| Configured | Merge active-host MCP entry | Every credential binding declared in host config |
| Verified | Initialize, list tools, enforce read-only, harmless read | `READY` or an actionable unresolved state |

## 1. Install project skills

Run from the project folder:

```console
npx rooty-investigator install
```

Rooty writes the same three skills to `.agents/skills/` for Codex and Cursor and to `.claude/skills/` for Claude. Reinstallation is idempotent and refuses to overwrite modified or unowned skill files.

## 2. Confirm documentation locations

Provide known locations during install or later:

```console
npx rooty-investigator install --docs "README.md,docs"
npx rooty-investigator context set-docs --paths "README.md,docs"
```

When no location is stored, the setup agent performs a bounded search for likely entry points such as `README*`, `docs/`, `architecture/`, and ADR folders, then asks the developer to confirm them. External local documentation folders are allowed when explicitly supplied.

Only paths are stored. Rooty does not create a map, index, embedding, cached summary, or inferred architecture.

## 3. Discover providers

The setup agent reads the relevant confirmed documents first. Documentation helps find likely components, communication paths, database technology, telemetry, index patterns, identifiers, and source folders. It remains provisional.

The agent inspects current safe project files only to verify material choices or fill gaps. It never recursively scans a filesystem root and never reads credential values. If a choice remains ambiguous, it asks one focused question.

Required capabilities:

- **Data:** at least one provider usable for bounded state/history reads.
- **Observability:** at least one provider usable for bounded logs, traces, or metrics evidence.

Ticketing is optional because the developer can paste ticket content.

## 4. Review the MCP proposal

The `rooty-mcp-builder` skill prepares one proposal per provider and active host. Every proposal includes:

- official provider server and documentation checked;
- supported versions and deployment constraints;
- STDIO or Streamable HTTP transport;
- exact host config file and minimal merge;
- every credential environment-variable, secret-manager, or OAuth binding;
- provider-side least privilege and server read-only mode;
- allowed and forbidden tools;
- a bounded harmless probe;
- required file writes, commands, packages, containers, or OAuth approvals.

No configuration or external action occurs before the proposal is visible and approved.

## 5. Configure the active host

| Host | Skill path | Project MCP path |
|---|---|---|
| Codex | `.agents/skills/` | `.codex/config.toml` |
| Cursor | `.agents/skills/` | `.cursor/mcp.json` |
| Claude | `.claude/skills/` | `.mcp.json` |

The agent configures only the host where setup is running unless the developer requests more. Existing unrelated host configuration is preserved; ambiguous or malformed configuration blocks the merge.

Every MCP entry must declare all required credential references. Values stay in the environment, approved secret manager, or host-managed OAuth. After rendering, the agent reports each missing binding, its config path, its purpose, and the smallest resolution action.

## 6. Verify safely

Verification checks:

1. Credential names resolve without revealing values.
2. The MCP server initializes.
3. The live advertised tool list matches the reviewed allowlist.
4. Mutation and administration tools are absent, disabled, or blocked.
5. A bounded non-sensitive read succeeds.

Rooty is ready only when data and observability both pass. Ticketing may remain `NOT_REQUESTED`.

## Provider organization

```text
providers/
├── data/
│   ├── sql-server
│   └── mongodb
├── observability/
│   ├── elasticsearch
│   └── grafana
├── ticketing/
│   ├── jira
│   └── azure-devops
└── custom/
```

SQL Server uses Microsoft's SQL MCP Server through DAB. Elasticsearch 8.19.15 uses Elastic's standalone compatibility server, which currently requires Docker; Rooty asks separately before installing Docker or pulling an image. MongoDB, Grafana, Azure DevOps, and custom providers require review of current official documentation and the live tool surface.

For SQL Server, Rooty enumerates every accessible online user database, excludes system/inaccessible catalogs, and generates one DAB child plus one host credential binding per catalog under `.rooty/mcp/data/sql-server/`. The parent uses absolute child paths, unique autoentity keys and catalog-prefixed entity names. Readiness is MCP initialize plus a non-empty `describe_entities` result covering every catalog; `dab validate` alone is not a readiness check.

## Advanced compatibility commands

The earlier `sources discover`, `sources configure`, and `init --activate-connectors` commands remain available for existing workflows and deterministic connector experiments. They are not the intended first-time journey.
