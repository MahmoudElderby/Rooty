# Rooty

Rooty is a portable, evidence-first root-cause investigator. It combines an Agent Skill, a dependency-free setup and case CLI, secure read-only connector recipes, host adapters, an append-only evidence ledger, reviewed case memory, and a 15-case replay suite.

Rooty reports why an incident happened. It does not patch code, mutate tickets or production systems, perform mitigation, or approve its own memory.

## Requirements

- Node.js 20 or newer
- Read-only identities for every real evidence provider
- OAuth, environment-variable references, OS credential storage, or an approved secret manager; never repository secrets

No npm packages are required.

## Quick start

```console
node bin/investigator.js sources discover --project /path/to/project
node bin/investigator.js sources configure --project /path/to/project \
  --ticketing-mcp-url https://mcp.example.internal/atlassian \
  --observability-mcp-url https://mcp.example.internal/observability --observability-auth oauth \
  --database-mcp-url https://mcp.example.internal/database --database-auth oauth \
  --deployments-mcp-url https://mcp.example.internal/deployments --deployments-auth oauth
node bin/investigator.js init --host codex --project /path/to/project
node bin/investigator.js doctor --project /path/to/project
```

Discovery scans only bounded non-secret text files and classifies repository-derived mappings as `INFERRED`. Configuration writes `.investigator/sources.json` with public MCP endpoints and credential environment-variable names, not credential values. Supported auth modes are `oauth`, `bearer-env`, and unauthenticated loopback only. Review unresolved mappings and validate them with the owning team before rerunning `init` with `--activate-connectors`.

For the fully offline vertical slice:

```console
node bin/investigator.js init --host all --demo --project /path/to/sandbox-project
node bin/investigator.js run ROOTY-101 --project . --snapshot evals/mock-sources/confirmed-timeout.json --case-dir ../rooty-case-demo
node bin/investigator.js memory propose --project . --case-dir ../rooty-case-demo
node bin/investigator.js eval
```

The bundled MCP server serves frozen synthetic ticket, documentation, log, trace, database-history, and deployment evidence. Its six tools are read-only, require case IDs, bound time windows and result sizes, reject mutation-named tools, and reject non-`SELECT` SQL. Real database safety must also use a dedicated read-only role or replica, read-only transactions, timeouts, and server-side limits.

## CLI

```text
investigator init --host codex|claude|cursor|all [--project PATH] [--demo] [--activate-connectors]
investigator sources discover [--project PATH] [--output FILE]
investigator sources configure [--project PATH] [--discovery FILE] [--<capability>-mcp-url URL] [--<capability>-auth oauth|bearer-env|none]
investigator sources list <service> --environment production [--project PATH]
investigator doctor [--project PATH] [--json]
investigator run <ticket> --snapshot FILE [--case-dir PATH]
investigator evidence add --case-dir PATH --file FILE
investigator report --case-dir PATH
investigator memory propose --case-dir PATH [--project PATH]
investigator memory approve --draft FILE --reviewed-by NAME [--project PATH]
investigator eval [--json]
```

Case output defaults to a sibling `.rooty-cases` directory so evidence does not modify the investigated source tree. Explicit case directories must likewise be outside production source when an investigator host is running read-only.

## Safety model

The canonical skill defines evidence discipline and stopping rules. Host adapters add read-only filesystem policy and MCP tool allowlists. Connector recipes require least-privilege auth references. The database and provider identity remains the actual enforcement boundary; MCP annotations are metadata only.

Ticket descriptions, documentation, logs, database values, prior cases, and connector output are untrusted data. Prompt-like text inside them is never executable instruction. Approved memory suggests hypotheses and pivots but cannot confirm a current incident.

## Development

```console
npm test
npm run doctor
npm run eval
```

The project uses only Node.js standard-library modules. Tests cover discovery/configuration, all host adapters, source safety, hash-chained ledgers, deterministic reporting, memory review, the stdio MCP server, bounded queries, mutation blocking, the portable skill scripts, and all replay cases.
