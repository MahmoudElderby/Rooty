# CLI reference

## Global behavior

```console
rooty help
investigator help
```

Both commands invoke the same CLI. Options use `--name value` or `--name=value`. `--project` defaults to the current working directory.

Print the installed package version with the standard flags:

```console
rooty --version
rooty -V
```

The CLI writes MCP values only when explicitly copying a private settings JSON into the Git-ignored local settings file. It never prints those values. The primary journey is installation and context management; the active AI agent performs project discovery and MCP setup.

## `rooty install`

Install Rooty's project-scoped skills and context files.

```text
rooty install [--cursor] [--claude] [--codex] [--project PATH] [--docs PATH,...] [--json]
```

Bare `rooty setup` is an install alias. The command copies all three skills to the skill folders of the selected hosts, installs `.rooty/start-mcp.cjs`, writes `.rooty/state/install-manifest.json`, creates or preserves `.rooty/config/project-context.json`, initializes `.rooty/config/mcp-settings.local.json` and `.rooty/state/setup-progress.json`, and creates `.rooty/memory/{drafts,approved}`. It also merges Rooty's runtime exclusions into `.gitignore`. Reinstall preserves local setting values, migrates the two flat state files written by version 0.2.0, and safely copies legacy `.investigator/memory` cards without deleting their sources.

Provider artifact folders under `.rooty/mcp/<category>/<provider>/` are created by the setup agent on first approved write, so an unconfigured project carries no empty placeholders. Installation removes the empty `.rooty/mcp/{data,observability,ticketing,custom}` folders created by earlier versions and never touches one that holds files.

| Option | Meaning |
|---|---|
| `--cursor`, `--claude`, `--codex` | Install for these hosts; repeatable and combinable |
| `--host` | Comma-separated host list, or `all` |
| `--project` | Existing project folder; defaults to the current folder |
| `--docs` | Comma-separated confirmed documentation files/folders |
| `--json` | Emit the structured result |

### Host selection

Rooty writes skills only where the selected hosts look for them: `.agents/skills/` for Cursor and Codex, `.claude/skills/` for Claude. Without a host flag it resolves the hosts in this order.

1. The hosts recorded by the previous install, so reinstall never silently widens or narrows an existing setup.
2. Every host detected from a project marker: `.cursor/`, `.codex/`, `.claude/`, or `CLAUDE.md`.
3. All three hosts, when nothing is detected.

Narrowing the host list leaves the previously installed skill files on disk and stops tracking them; installation reports how many remain rather than deleting work you may still use. Re-running with that host reclaims any file you have not modified.

Installation is idempotent. It refuses filesystem roots, symlinked installation paths, unavailable documentation paths, unsupported host names, and modified or unowned skill-file conflicts. It does not scan project source or execute provider setup.

## `rooty context`

Display confirmed documentation paths:

```text
rooty context show [--project PATH] [--json]
```

Replace the path list:

```text
rooty context set-docs (--paths PATH,... | --none) [--project PATH] [--json]
```

`--none` records an explicit developer confirmation that no documentation entry point is available. Only the decision and path strings are persisted. Rooty does not generate a project map, index, embedding, or documentation summary.

## `rooty setup status`, `checkpoint`, `pause`, and `selections`

These commands are the deterministic persistence surface used by the setup skill:

```text
rooty setup status [--project PATH] [--json]
rooty setup checkpoint --stage STATE [--host HOST] [--status STATUS] [--project PATH] [--json]
rooty setup pause --stage STATE --reason skipped|cancelled [--next-action TEXT] [--project PATH] [--json]
rooty setup selections [--documentation STATUS] [--confirmed NAME,...] [--selected NAME,...] [--active NAME] [--host HOST] [--project PATH] [--json]
```

Setup persists only stage/status, confirmed selections, the active host, and a concise next action. It never persists prompt transcripts, credential values, discovered content, inferred architecture, or investigation conclusions. A later setup request reads this state and resumes from the recorded stage.

## `rooty settings`

Initialize placeholders, replace the local document from a private file, or inspect availability without printing values:

```text
rooty settings init [--keys KEY,...] [--project PATH] [--json]
rooty settings configure --file FILE [--project PATH] [--json]
rooty settings status [--keys KEY,...] [--project PATH] [--json]
```

The canonical file is `.rooty/config/mcp-settings.local.json` with schema `{ "schema_version": 1, "settings": { "KEY": "value" } }`. `init` preserves existing values and adds missing keys as empty strings. `configure` validates and atomically copies the whole document. `status` emits only key names and `AVAILABLE` or `MISSING`; it exits nonzero when a requested key is missing. The file is always Git-ignored and must be protected as a local secret store.

## `rooty env`

Discover environment candidates without treating them as confirmed:

```text
rooty env discover [--project PATH] [--json]
```

The bounded scan reads up to 500 small safe documentation/configuration files, skips symlinks and secret-like paths, and reports evidence paths. The setup agent must still ask the developer which candidates are real, which environments to configure, and which starts active.

Store an approved profile generated by setup, inspect current state, preview a switch, or apply it:

```text
rooty env configure --file FILE [--project PATH] [--json]
rooty env list [--project PATH] [--json]
rooty env plan NAME [--host HOST | --all-hosts] [--project PATH] [--json]
rooty env use NAME [--host HOST | --all-hosts] [--project PATH] [--json]
```

Each profile has stable logical servers and one reviewed target per environment. Applying a switch atomically removes every Rooty-managed name for the other environments and adds exactly one environment-visible name per logical server. Unrelated MCP entries are preserved. Missing required targets, provider artifacts, or declared local setting values block all writes.

The host is inferred from the existing managed configuration, then from setup state, then from a single installed host. If several configured hosts exist, Rooty requires `--host`; `--all-hosts` is always an explicit request. After applying, reload the host and run doctor so the live tool surface and bounded identity read prove the new environment.

## Advanced compatibility commands

The commands below support the frozen-snapshot pipeline and the previous deterministic connector workflow. They remain available but are not the intended first-time setup UX.

## `rooty init`

Install the canonical skill and render host configuration.

```text
rooty init --host codex|claude|cursor|all
  [--project PATH]
  [--demo]
  [--activate-connectors]
```

| Option | Meaning |
|---|---|
| `--host` | Target adapter; defaults to `all` |
| `--project` | Project receiving the skill and host files |
| `--demo` | Adds the bundled synthetic stdio MCP server |
| `--activate-connectors` | Renders every ready source-registry entry and writes the activation manifest |

Initialization always installs `.agents/skills/root-cause-investigator`. Existing target paths cause a hard failure; Rooty never merges or overwrites host configuration.

Initialization requires an explicit journey: `--demo` for the offline demo, or `--activate-connectors` after all five production source capabilities are ready. Rooty refuses an empty initialization that would produce a host with no usable evidence connectors.

## `rooty sources discover`

Scan safe project files for known evidence-provider signals.

```text
rooty sources discover [--project PATH] [--output FILE] [--json]
```

Default output is `.investigator/discovery.json` inside the project. A custom output path is resolved from the current CLI working directory. The default console output is a short candidate summary; use `--json` for the complete discovery document, including skipped-file details.

## `rooty sources configure`

Create the production source registry from discovery plus explicit input.

```text
rooty sources configure
  [--project PATH]
  [--discovery FILE]
  [--<capability>-provider ID]
  [--<capability>-mcp-url URL]
  [--<capability>-auth oauth|bearer-env|none]
  [--<capability>-oauth-token-env NAME]
  [--<capability>-bearer-token-env NAME]
```

Replace `<capability>` with `ticketing`, `documentation`, `observability`, `database`, or `deployments`.

If the default discovery file does not exist, configuration runs discovery first. The command writes `.investigator/sources.json` and prints unresolved fields.

Provider selection is mandatory when discovery has no matching signal. Supplying only an endpoint never causes Rooty to guess a provider.

## `rooty sources list`

Read one registered service/environment mapping.

```text
rooty sources list <service>
  --environment <name>
  [--project PATH]
```

Environment defaults to `production`. The value is lowercased and validated but must match a registered environment; the generated MVP registry contains `production`.

## `rooty doctor`

Validate package health, project configuration, and live investigation readiness separately.

```text
rooty doctor [--project PATH] [--host HOST] [--environment NAME] [--json] [--package-only]
```

| Option | Meaning |
|---|---|
| `--json` | Emits the full structured result |
| `--package-only` | Checks the installed kit without requiring project source/activation readiness |
| `--host` | Check one configured host when more than one is active |
| `--environment` | Require the active host state and identity probe to match this environment |

Normal human output always includes the CLI version, followed by `PACKAGE_READY`, `PROJECT_CONFIGURED`, and `INVESTIGATION_READY`. Project configuration is based on current files, not Git history or stale workspace snapshots: it checks host config presence, exact environment-profile renderings, provider artifacts, and setup state. Investigation readiness independently initializes the live data and observability MCPs, compares their advertised tools with the reviewed allowlists, rejects mutation surfaces, and performs bounded reads containing the expected environment identity. For a legacy connector project, doctor retains the strict source-registry and activation checks. Package-only mode checks only the distributed kit and marks the other two sections `NOT_CHECKED`.

## `rooty run`

Create a deterministic case from a frozen investigation snapshot.

```text
rooty run <ticket>
  --snapshot FILE
  [--project PATH]
  [--case-dir PATH]
```

The snapshot ticket ID must match `<ticket>`. If `--case-dir` is omitted, Rooty writes to a sibling path:

```text
<project-parent>/.rooty-cases/<project-name>/<case-id>/
```

The target must not already exist and must resolve outside the investigated project.

This command does not perform a live AI or MCP investigation.

## `rooty evidence add`

Append one validated observation to a persisted case ledger.

```text
rooty evidence add
  --case-dir PATH
  --file FILE
  [--project PATH]
```

The JSON file supplies the evidence fields. Rooty verifies the existing ledger, assigns the authoritative case ID, sequence, previous hash, and entry hash, and rejects duplicate evidence IDs.

Appending evidence does not rewrite `case.json` or recompute its analysis and assessment. If the new evidence changes the causal conclusion, create a newly normalized case rather than presenting the old assessment as current.

## `rooty report`

Re-render a report from a persisted case.

```text
rooty report --case-dir PATH [--project PATH]
```

Rooty verifies the evidence ledger before rendering `report.md`.

## `rooty memory propose`

Create a sanitized learning draft from a verified confirmed case.

```text
rooty memory propose --case-dir PATH [--project PATH]
```

Only a recomputed `CONFIRMED` case is accepted. Output is written under `.rooty/memory/drafts/<case-id>.json`. Schema-version 3 cards include a stable canonical concern key, scope, kind, applicability, proposed disposition, and reusable-content fingerprint. Exact duplicates and overlapping concern keys are rejected.

## `rooty memory approve`

Approve a draft after accountable human/team review.

```text
rooty memory approve
  --draft FILE
  --case-dir PATH
  --reviewed-by NAME
  [--project PATH]
```

The draft must remain under `.rooty/memory/drafts` or the legacy `.investigator/memory/drafts` fallback and match the supplied source case. Approval re-verifies all source evidence and fingerprints and writes `.rooty/memory/approved/<case-id>.json`.

## `rooty eval`

Run the deterministic replay suite.

```text
rooty eval [--cases FILE] [--json]
```

The default suite is `evals/cases/replay-cases.json`. The command exits non-zero if expected outcomes, mutation blocking, or unsupported-confirmation checks fail.

## npm scripts

From the Rooty repository:

```console
npm test         # Node test suite
npm run doctor   # Package-only doctor
npm run eval     # Default replay suite
```

## Exit behavior

- Successful commands exit with code 0.
- `doctor` and `eval` set a non-zero exit code when their result is unhealthy.
- Validation errors are printed by the executable entry point and exit non-zero.
