# Getting started

Rooty's first-time journey has two steps: install the project skills, then let the active AI agent guide setup.

## Prerequisites

- Node.js 20 or newer
- Codex, Claude Code, or Cursor
- A software project folder

Provider runtimes and credentials are not prerequisites for installation. The setup agent identifies them later and explains why each is needed.

## Install inside the project

```console
npx rooty-investigator install
```

If the documentation locations are already known:

```console
npx rooty-investigator install --docs "README.md,docs,architecture"
```

Installation creates project-scoped copies of `rooty-setup`, `rooty-mcp-builder`, and `root-cause-investigator` under `.agents/skills/` and `.claude/skills/`. It also creates:

```text
.rooty/
├── config/
│   └── project-context.json
├── state/
│   └── install-manifest.json
├── memory/
│   ├── drafts/
│   └── approved/
└── mcp/
    ├── data/
    ├── observability/
    ├── ticketing/
    └── custom/
```

The manifest fingerprints Rooty-owned files so reinstall can update unchanged files without overwriting developer modifications. Project context stores only confirmed documentation paths. Draft memory is gitignored; approved sanitized cards can be shared with the team. General provider files live under `.rooty/mcp/<category>/<provider>/`. After an approved SQL setup, the tested runtime layout adds one `.rooty/mcp-<domain>/dab-config.json` per catalog and one shared `.rooty/start-dab.cjs` launcher.

Reinstalling automatically migrates the flat `.rooty/install-manifest.json` and `.rooty/project-context.json` layout created by version 0.2.0. It also copies legacy `.investigator/memory` JSON cards into `.rooty/memory` after collision checks while retaining the original files.

Installation does not scan the source tree, execute a package, pull an image, start OAuth, collect credentials, or configure MCP servers.

## Start agent-led setup

Open the project in Codex, Cursor, or Claude and ask:

```text
Set up Rooty for this project.
```

The setup skill:

1. Confirms or asks for documentation paths.
2. Reads relevant documentation as a navigation reference.
3. Checks current source/configuration only where needed.
4. Identifies mandatory data and observability providers.
5. Treats ticketing as optional.
6. Proposes exact read-only MCP configuration for the active host.
7. Requests approval for writes, execution, packages, containers, or OAuth.
8. Shows missing credential bindings and verifies harmless reads.

Documentation is never accepted as proof. Material findings are checked against current code, configuration, or runtime evidence. Rooty stores no generated project map or documentation summary.

## Check installation

```console
npx rooty-investigator context show
npx rooty-investigator doctor
```

Change confirmed documentation locations with:

```console
npx rooty-investigator context set-docs --paths "README.md,docs"
```

## Try the offline evidence pipeline

The bundled snapshot contains synthetic evidence and requires no production credentials:

```console
rooty init --host all --demo --project /path/to/sandbox-project
rooty run ROOTY-101 \
  --project /path/to/sandbox-project \
  --snapshot /path/to/Rooty/evals/mock-sources/confirmed-timeout.json \
  --case-dir /path/to/rooty-case-demo
rooty report --project /path/to/sandbox-project --case-dir /path/to/rooty-case-demo
```

This frozen-snapshot path creates deterministic evidence artifacts. It does not orchestrate live provider calls; the configured AI host performs live investigations.

Continue with [Project and MCP setup](setup.md) or [Investigating an incident](investigation.md).
