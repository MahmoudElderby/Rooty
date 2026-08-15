# CLI reference

## Global behavior

```console
rooty help
investigator help
```

Both commands invoke the same CLI. Options use `--name value` or `--name=value`. `--project` defaults to the current working directory.

The CLI never writes credential values. Generated configuration contains public endpoints, placeholders, and environment-variable references.

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

## `rooty sources discover`

Scan safe project files for known evidence-provider signals.

```text
rooty sources discover [--project PATH] [--output FILE]
```

Default output is `.investigator/discovery.json` inside the project. A custom output path is resolved from the current CLI working directory.

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

Validate package health and production readiness.

```text
rooty doctor [--project PATH] [--json] [--package-only]
```

| Option | Meaning |
|---|---|
| `--json` | Emits the full structured result |
| `--package-only` | Checks the installed kit without requiring project source/activation readiness |

Normal mode exits non-zero on any failed check. Package-only mode still fails unsafe package checks; only missing project registry and activation are downgraded to warnings.

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

Only a recomputed `CONFIRMED` case is accepted. Output is written under `.investigator/memory/drafts/<case-id>.json`.

## `rooty memory approve`

Approve a draft after accountable human/team review.

```text
rooty memory approve
  --draft FILE
  --case-dir PATH
  --reviewed-by NAME
  [--project PATH]
```

The draft must remain under the project's draft directory and match the supplied source case. Approval re-verifies all source evidence and fingerprints and writes `.investigator/memory/approved/<case-id>.json`.

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
