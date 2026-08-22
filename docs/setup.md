# Project and MCP setup

Rooty uses a mechanical installer followed by agent-led setup. The CLI establishes owned files and deterministic checks; the active Codex, Cursor, or Claude agent performs semantic discovery and guides approvals.

## Setup journey

| State | Agent action | Developer sees |
|---|---|---|
| Installed | Confirm manifest and three skills | Installed locations and next prompt |
| Docs confirmed | Confirm documentation entry points | Paths stored in `.rooty/config/project-context.json` |
| Environments confirmed | Detect candidates, then confirm aliases, selected targets, and initial active environment | Confirmed choices; discovery remains provisional |
| Discovered | Read docs first, then targeted current source/config | Evidence for data and observability candidates |
| Proposed | Build one provider/host MCP proposal | Config path, command/URL, credentials, controls, probe |
| Approved | Request host-native approval | Exact writes and external actions |
| Configured | Merge active-host MCP entry | Every settings key declared in host config |
| Verified | Initialize, list tools, enforce read-only, harmless read | `READY` or an actionable unresolved state |

## 1. Install project skills

Run from the project folder:

```console
npx rooty-investigator install --cursor
```

Rooty writes the same three skills to the skill folder each selected host reads: `.agents/skills/` for Codex and Cursor, `.claude/skills/` for Claude. Name hosts with `--cursor`, `--claude`, or `--codex`; without a flag Rooty reuses the previous install's hosts, otherwise every host it detects, otherwise all three. It creates `.rooty/memory/{drafts,approved}` and protects drafts through `.gitignore`. Reinstallation is idempotent, refuses to overwrite modified or unowned skill files, and copies non-conflicting legacy memory without deleting the source.

Rooty does not install always-on host methodology rules. The canonical investigator skill owns universal behavior; reviewed project learning remains separate under `.rooty/memory`.

## 2. Confirm documentation locations

Provide known locations during install or later:

```console
npx rooty-investigator install --docs "README.md,docs"
npx rooty-investigator context set-docs --paths "README.md,docs"
```

When no location is stored, the setup agent performs a bounded search for likely entry points such as `README*`, `docs/`, `architecture/`, and ADR folders, then asks the developer to confirm them through the host's own structured question tool where one exists. External local documentation folders are allowed when explicitly supplied.

Only paths are stored. Rooty does not create a map, index, embedding, cached summary, or inferred architecture.

## 3. Discover providers

Before provider discovery, the setup agent runs bounded environment discovery and asks the developer to confirm the result. It confirms environment aliases (for example, `prod` means `production`), which environments should receive complete targets, and which one starts active. A filename or documentation mention is evidence for a candidate, never permission to configure it.

The setup agent then reads the relevant confirmed documents first. Documentation helps find likely components, communication paths, database technology, telemetry, index patterns, identifiers, and source folders. It remains provisional.

The agent inspects current safe project files only to verify material choices or fill gaps. It never recursively scans a filesystem root and never reads credential values.

If a choice remains ambiguous, the agent asks. It uses the active host's structured question mechanism when one exists (`AskQuestion` in Cursor, `AskUserQuestion` in Claude) and plain conversation in Codex, always offering an option that escapes the candidate list. A question collects a preference and is never an approval: writes, commands, packages, images, and OAuth still require the host's approval experience.

Required capabilities:

- **Data:** at least one provider usable for bounded state/history reads.
- **Observability:** at least one provider usable for bounded logs, traces, or metrics evidence.

Ticketing is optional because the developer can paste ticket content.

## 4. Review the MCP proposal

The `rooty-mcp-builder` skill prepares one logical server proposal per provider and active host, with a reviewed target for every selected environment. Every proposal includes:

- official provider server and documentation checked;
- supported versions and deployment constraints;
- STDIO or Streamable HTTP transport;
- exact host config file and minimal merge;
- every local JSON setting key or host-managed OAuth requirement;
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

The agent configures only the host where setup is running unless the developer requests more. Existing unrelated host configuration is preserved; ambiguous or malformed configuration blocks the merge. Each logical source has only one active rendering, and the rendered name visibly includes the environment, such as `rooty-prod-sql-orders` or `rooty-preprod-sql-orders`.

Every MCP entry must invoke `.rooty/start-mcp.cjs` and declare all required local JSON keys. Values stay only in the Git-ignored `.rooty/config/mcp-settings.local.json`; host-managed OAuth remains separate where required. After rendering, the agent reports each missing key, its config path, its purpose, and the smallest resolution action.

## 6. Verify safely

Verification checks:

1. Declared local settings resolve without revealing values.
2. The MCP server initializes.
3. The live advertised tool list matches the reviewed allowlist.
4. Mutation and administration tools are absent, disabled, or blocked.
5. A bounded non-sensitive read succeeds and contains an expected environment identity.

Rooty is ready only when data and observability both pass. Ticketing may remain `NOT_REQUESTED`.

## Switch environments

Preview and apply a switch with the host inferred from current project setup:

```console
npx rooty-investigator env plan preprod
npx rooty-investigator env use preprod
```

`env plan` shows the current environment, removed names, added names, config files, missing artifacts, and missing local settings without writing. `env use` revalidates that plan and atomically updates Rooty's entries and local active state. If any selected host cannot be completed, none are changed. Unrelated servers survive the merge.

You normally do not pass `--host`: Rooty infers the only configured host, the active setup host, or the only installed host. If multiple configured hosts exist, choose one with `--host cursor` or explicitly switch all configured hosts with `--all-hosts`.

The installed agent supports the equivalent request in conversation:

```text
Switch Rooty to preprod.
```

It calls the same deterministic plan, shows that the environment-visible MCP names will change, asks for approval, applies `env use`, and requests a host reload. It then runs `rooty doctor --environment preprod`. During an active investigation, Rooty starts a new environment context unless the developer explicitly requested a cross-environment comparison.

For example, after switching Orders from production to preprod, Cursor contains one Orders entry—not both:

```json
{
  "mcpServers": {
    "unrelated-team-tool": { "url": "https://example.internal/mcp" },
    "rooty-preprod-sql-orders": {
      "type": "stdio",
      "command": "C:/Program Files/nodejs/node.exe",
      "args": [
        "C:/project/.rooty/start-mcp.cjs",
        "--settings", "C:/project/.rooty/config/mcp-settings.local.json",
        "--keys", "ROOTY_SQL_ORDERS_PREPROD,ROOTY_SQL_ORDERS_PREPROD_URLS=ASPNETCORE_URLS",
        "--", "C:/Program Files/nodejs/node.exe",
        "C:/project/.rooty/start-dab.cjs",
        "--dab", "C:/tools/dab.exe",
        "--config", "C:/project/.rooty/mcp/data/sql-server/preprod/orders/dab-config.json",
        "--credential-env", "ROOTY_SQL_ORDERS_PREPROD"
      ]
    }
  }
}
```

Claude uses the same settings-backed `mcpServers` entry in `.mcp.json`. Codex renders the selected target in TOML with the same arguments:

```toml
[mcp_servers."rooty-preprod-sql-orders"]
type = "stdio"
command = "C:/Program Files/nodejs/node.exe"
args = ["C:/project/.rooty/start-mcp.cjs", "--settings", "C:/project/.rooty/config/mcp-settings.local.json", "--keys", "ROOTY_SQL_ORDERS_PREPROD,ROOTY_SQL_ORDERS_PREPROD_URLS=ASPNETCORE_URLS", "--", "C:/Program Files/nodejs/node.exe", "C:/project/.rooty/start-dab.cjs", "--dab", "C:/tools/dab.exe", "--config", "C:/project/.rooty/mcp/data/sql-server/preprod/orders/dab-config.json", "--credential-env", "ROOTY_SQL_ORDERS_PREPROD"]
```

The production target remains in `.rooty/config/environment-profiles.json` as reviewed switchable intent, but `rooty-prod-sql-orders` is removed from the active host file. This preserves a single Orders MCP while making the current environment visible to the developer.

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

SQL Server uses Microsoft's SQL MCP Server through DAB. Elasticsearch 8.19.15 uses Elastic's official standalone Docker image with `ES_VERSION=8` and the `list_indices` readiness probe; Rooty asks separately before installing Docker, pulling the image, or starting a container. MongoDB, Grafana, Azure DevOps, and custom providers require review of current official documentation and the live tool surface.

For SQL Server, Rooty enumerates live catalogs and `INFORMATION_SCHEMA` objects, then creates one logical Orders/Logger/etc. MCP per catalog with a target named `rooty-{environment}-sql-{domain}`. Each target has an isolated `.rooty/mcp/data/sql-server/{environment}/{domain}/dab-config.json` with explicit entities, named local JSON setting keys, a unique nonzero loopback port, and absolute paths through `.rooty/start-mcp.cjs` and `.rooty/start-dab.cjs`. The same pattern applies to Codex, Cursor, and Claude. Readiness is independent MCP initialization, exact read-only tools, non-empty entity description, and a bounded environment-identity read per catalog; `dab validate` on 2.0.10 is not a readiness check.

## Advanced compatibility commands

The earlier `sources discover`, `sources configure`, and `init --activate-connectors` commands remain available for existing workflows and deterministic connector experiments. They are not the intended first-time journey.
