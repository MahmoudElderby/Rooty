# Getting started

Rooty's first-time journey has two steps: install the project skills, then let the active AI agent guide setup.

## Prerequisites

- Node.js 20 or newer
- Codex, Claude Code, or Cursor
- A software project folder

Provider runtimes and credentials are not prerequisites for installation. The setup agent identifies them later and explains why each is needed.

## Install inside the project

```console
npx rooty-investigator install --cursor
```

Use `--cursor`, `--claude`, or `--codex` to name the hosts you actually work in; combine them for more than one. Without a flag, Rooty reuses the hosts recorded by the previous install, otherwise every host it detects from a `.cursor/`, `.codex/`, `.claude/`, or `CLAUDE.md` marker, otherwise all three.

If the documentation locations are already known:

```console
npx rooty-investigator install --docs "README.md,docs,architecture"
```

Installation creates project-scoped copies of `rooty-setup`, `rooty-mcp-builder`, and `root-cause-investigator` under `.agents/skills/` for Cursor and Codex, `.claude/skills/` for Claude. It also creates:

```text
.rooty/
├── start-mcp.cjs
├── config/
│   ├── project-context.json
│   ├── environment-profiles.json   # created after environment targets are approved
│   └── mcp-settings.local.json     # local, Git-ignored MCP values
├── state/
│   ├── install-manifest.json
│   ├── setup-progress.json
│   └── active-environments.json
└── memory/
    ├── drafts/
    └── approved/
```

The manifest fingerprints Rooty-owned files so reinstall can update unchanged files without overwriting developer modifications, and records the selected hosts so reinstall neither widens nor narrows the install by accident. Project context stores only the documentation decision and confirmed paths. Setup progress and the active host environment are local, gitignored state; skipped or cancelled setup resumes at the saved stage without storing prompt transcripts, credentials, or inferred architecture. Draft memory is gitignored; approved sanitized cards can be shared with the team.

Provider files live under `.rooty/mcp/<category>/<provider>/`, created by the setup agent on first approved write. Rooty installs `.rooty/start-mcp.cjs`; every settings-backed MCP entry invokes it with declared key names, and the launcher reads their values from `.rooty/config/mcp-settings.local.json`. Environment-specific SQL targets additionally use one shared `.rooty/start-dab.cjs` launcher.

Reinstalling automatically migrates the flat `.rooty/install-manifest.json` and `.rooty/project-context.json` layout created by version 0.2.0, and removes the empty `.rooty/mcp` category folders that earlier versions created up front. It also copies legacy `.investigator/memory` JSON cards into `.rooty/memory` after collision checks while retaining the original files.

Installation does not scan the source tree, execute a package, pull an image, start OAuth, collect credentials, or configure MCP servers. It creates the local settings file with an empty `settings` object so installed versus configured state is explicit.

## Start agent-led setup

Open the project in Codex, Cursor, or Claude and ask:

```text
Set up Rooty for this project.
```

The setup skill:

1. Confirms or asks for documentation paths, using the host's own structured question experience where one exists.
2. Detects environment candidates from bounded safe project evidence, then asks which are real, which to configure, and which should start active.
3. Reads relevant documentation as a navigation reference.
4. Checks current source/configuration only where needed.
5. Identifies mandatory data and observability providers; ticketing remains optional.
6. Proposes one logical MCP source with reviewed targets for each selected environment.
7. Requests approval for writes, execution, packages, containers, or OAuth.
8. Activates exactly one environment target per logical source, shows missing local setting keys, and verifies harmless environment-identity reads.

Documentation is never accepted as proof. Material findings are checked against current code, configuration, or runtime evidence. Rooty stores no generated project map or documentation summary.

## Check installation

```console
npx rooty-investigator context show
npx rooty-investigator doctor
```

Change confirmed documentation locations with:

```console
npx rooty-investigator context set-docs --paths knowledge
```

Populate settings without exposing values in shell arguments:

```console
npx rooty-investigator settings init --keys prod.provider.url,prod.provider.token
npx rooty-investigator settings configure --file C:/private/rooty-settings.json
npx rooty-investigator settings status
```

The private source and `.rooty/config/mcp-settings.local.json` use schema version 2 with settings grouped by environment. Existing flat schema-version-1 files remain compatible. Neither should be committed; status output contains setting paths only.

Rooty recommends `knowledge/` when that folder exists; otherwise confirm the actual project entry points such as `README.md,docs`. To explicitly confirm there is no documentation entry point, use `context set-docs --none`. Inspect resumable setup with `setup status`.

After setup, switch the inferred active host with:

```console
npx rooty-investigator env plan preprod
npx rooty-investigator env use preprod
```

Or ask the agent: `Switch Rooty to preprod.`

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
