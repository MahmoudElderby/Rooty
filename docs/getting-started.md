# Getting started

This guide takes Rooty from installation to a first offline investigation, then points to production setup.

## Prerequisites

- Node.js 20 or newer
- An empty sandbox project for the demo
- Codex, Claude Code, Cursor, or another skill-aware AI host for live investigations

Rooty has no runtime npm dependencies.

## Install the CLI

```console
npm install --global rooty-investigator
rooty help
```

The package installs both `rooty` and the compatibility alias `investigator`.

## Run the offline vertical slice

The bundled snapshot and MCP server contain synthetic ticket, documentation, log, trace, database-history, and deployment evidence. No external service or credential is used.

```console
rooty init --host all --demo --project /path/to/sandbox-project
rooty run ROOTY-101 \
  --project /path/to/sandbox-project \
  --snapshot /path/to/Rooty/evals/mock-sources/confirmed-timeout.json \
  --case-dir /path/to/rooty-case-demo
rooty report \
  --project /path/to/sandbox-project \
  --case-dir /path/to/rooty-case-demo
```

The case directory contains:

```text
rooty-case-demo/
├── case.json          # Normalized case state and computed assessment
├── evidence.ndjson    # Append-only, hash-chained evidence ledger
└── report.md          # Deterministic investigation report
```

Case data must live outside the investigated project. Rooty rejects both direct and symlink-resolved paths inside the project before creating files.

## Verify the kit

```console
rooty doctor --package-only
rooty eval
```

Package-only doctor checks the installed skill, connector recipes, bundled MCP server, replay suite, evidence location policy, and Git exclusions. It does not claim that a production project is ready.

## Understand the two MVP paths

Rooty currently has two related execution paths:

1. **Live host-driven investigation.** The configured AI host loads Rooty's skill and directly queries activated MCP connectors. Findings are returned in the host conversation.
2. **Frozen-snapshot artifact pipeline.** `rooty run --snapshot ...` creates deterministic case files, evidence ledgers, reports, and inputs for the reviewed-memory workflow.

Automatic capture of a live host conversation into the persisted case pipeline is not implemented in this MVP. Do not describe `rooty run` as a live provider orchestrator.

## Connect a real project

Continue with [Project and connector setup](setup.md). The production journey is:

```text
discover → validate → configure → provide credentials → initialize host → doctor → investigate
```

For the investigation method itself, read [Investigating an incident](investigation.md).
