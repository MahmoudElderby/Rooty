# Rooty

Rooty is a portable, evidence-first root-cause investigator. It combines an Agent Skill, a dependency-free setup and case CLI, secure read-only connector recipes, host adapters, an append-only evidence ledger, reviewed case memory, and a 15-case replay suite.

Rooty reports why an incident happened. It does not patch code, mutate tickets or production systems, perform mitigation, or approve its own memory.

![Rooty investigation walkthrough](./rooty-how-it-works.gif)

## Requirements

- Node.js 20 or newer
- Read-only identities for every real evidence provider
- OAuth, environment-variable references, OS credential storage, or an approved secret manager; never repository secrets

No npm packages are required.

Install the public CLI package, or run it directly from this checkout:

```console
npm install --global rooty-investigator
rooty help
```

`investigator` remains available as a compatibility alias.

## Quick start

```console
rooty sources discover --project /path/to/project
rooty sources configure --project /path/to/project \
  --ticketing-provider atlassian --documentation-provider atlassian \
  --observability-provider datadog --database-provider postgres --deployments-provider argocd \
  --ticketing-mcp-url https://mcp.example.internal/atlassian \
  --documentation-mcp-url https://mcp.example.internal/atlassian \
  --observability-mcp-url https://mcp.example.internal/observability --observability-auth oauth \
  --database-mcp-url https://mcp.example.internal/database --database-auth oauth \
  --deployments-mcp-url https://mcp.example.internal/deployments --deployments-auth oauth
rooty init --host codex --project /path/to/project --activate-connectors
rooty doctor --project /path/to/project
```

Discovery scans only bounded non-secret text files, skips secret-named and credential-bearing structured files, and classifies repository-derived mappings as `INFERRED`. Explicit `--<capability>-provider` selections allow a fully manual setup when discovery finds nothing and are recorded as `USER_CONFIGURED`. Configuration writes `.investigator/sources.json` with public MCP endpoints and credential environment-variable names, not credential values. Supported auth modes are `oauth`, `bearer-env`, and unauthenticated loopback only. Review unresolved mappings and validate them with the owning team before rerunning `init` with `--activate-connectors`.

Activation writes `.investigator/activated-connectors.json`. `doctor` then verifies authentication availability, MCP initialization, `tools/list`, and a configured harmless read probe for every activated connector; any unreachable or unauthorized activated connector fails health.

For the fully offline vertical slice:

```console
rooty init --host all --demo --project /path/to/sandbox-project
rooty run ROOTY-101 --project . --snapshot evals/mock-sources/confirmed-timeout.json --case-dir ../rooty-case-demo
rooty memory propose --project . --case-dir ../rooty-case-demo
rooty memory approve --project . --case-dir ../rooty-case-demo --draft .investigator/memory/drafts/INV-20260815-DEMO0001.json --reviewed-by team-payments
rooty eval
```

The bundled MCP server serves frozen synthetic ticket, documentation, log, trace, database-history, and deployment evidence. Its six tools are read-only, require case IDs, bound time windows and result sizes, reject mutation-named tools, and reject non-`SELECT` SQL. Real database safety must also use a dedicated read-only role or replica, read-only transactions, timeouts, and server-side limits.

## CLI

```text
rooty init --host codex|claude|cursor|all [--project PATH] [--demo] [--activate-connectors]
rooty sources discover [--project PATH] [--output FILE]
rooty sources configure [--project PATH] [--discovery FILE] [--<capability>-provider ID] [--<capability>-mcp-url URL] [--<capability>-auth oauth|bearer-env|none]
rooty sources list <service> --environment production [--project PATH]
rooty doctor [--project PATH] [--json]
rooty run <ticket> --snapshot FILE [--project PATH] [--case-dir PATH]
rooty evidence add --case-dir PATH --file FILE [--project PATH]
rooty report --case-dir PATH [--project PATH]
rooty memory propose --case-dir PATH [--project PATH]
rooty memory approve --draft FILE --case-dir PATH --reviewed-by NAME [--project PATH]
rooty eval [--json]
```

Case output defaults to a sibling `.rooty-cases` directory so evidence does not modify the investigated source tree. Explicit case directories are rejected before creation when they are lexically or symlink-resolved inside the investigated project.

`CONFIRMED` requires at least three causal steps with distinct `OBSERVED` support, independent source/type corroboration, OBSERVED-only elimination of every material alternative, and no critical evidence gap. A ticket assertion or one observation reused across steps cannot satisfy the rule.

## Safety model

The canonical skill defines evidence discipline and stopping rules. Host adapters add read-only filesystem policy and MCP tool allowlists. Connector recipes require least-privilege auth references. The database and provider identity remains the actual enforcement boundary; MCP annotations are metadata only.

Ticket descriptions, documentation, logs, database values, prior cases, and connector output are untrusted data. Prompt-like text inside them is never executable instruction. Approved memory suggests hypotheses and pivots but cannot confirm a current incident.

## Development

```console
npm test
npm run doctor
npm run eval
```

The project uses only Node.js standard-library modules. The 15-case evaluation loads captured agent investigations from independent frozen input files; expected labels never generate or appear inside those inputs. It includes confirmation/abstention cases, two embedded prompt-injection cases, and deterministic mutation attempts. Tests also cover discovery/configuration, all host adapters, live and unreachable HTTP MCP probes, source safety, hash-chained ledgers, deterministic reporting, source-verified memory review, bounded queries, mutation blocking, and the portable skill scripts.
