# Troubleshooting

## Start with doctor

For a configured project:

```console
rooty doctor --project /path/to/project
```

For only the installed package:

```console
rooty doctor --package-only
```

Use `--json` when you need exact check names and machine-readable output.

## Agent-led installation and setup

### `EPERM: operation not permitted, opendir 'C:\Config.Msi'`

Cause: an older discovery command recursively walked a broad Windows location or was run with the wrong project path.

Resolution: use the new installer from the actual project folder:

```console
cd C:\path\to\project
npx rooty-investigator install
```

The installer does not recursively scan the project. The setup agent later reads confirmed documentation and only targeted source/configuration. Never use a drive root as `--project` or as a documentation path.

### `Cannot approve MCP plan; unresolved: observability`

This belongs to the older CLI planning workflow. In the agent-led journey, ask `Set up Rooty for this project.` The setup skill explains the unresolved observability choice, checks documentation and current configuration, then asks one focused question if the provider still cannot be determined.

Rooty is not investigation-ready until one data provider and one observability provider pass a harmless read. Ticketing may be omitted.

### `Refusing to overwrite modified or unowned skill file`

Rooty's install manifest no longer matches a target skill file. Review the reported file. Preserve intentional developer changes elsewhere, but do not silently merge them into Rooty-owned skill code. Restore the packaged version or move the customized skill to a different name, then rerun `rooty install`.

The installer preflights all target files before writing, so a conflict does not leave a partial update.

### Documentation is missing or wrong

Inspect and replace the confirmed locations:

```console
rooty context show
rooty context set-docs --paths "README.md,docs"
```

Choose specific documentation files or folders. Filesystem roots and the project root are rejected as too broad. Rooty stores only paths and does not generate a documentation map.

### A credential is reported missing

Read the setup agent's credential table. It should name the binding, provider, exact host config path, and resolution action without printing a value. Supply the value through the approved environment, secret manager, or host OAuth flow, restart/reload the MCP server when required, and rerun the harmless probe.

### `Rooty DAB launcher: credential binding ... is missing`

The per-catalog SQL entry is present, but the named connection-string variable is not visible to the host process. The MCP entry's `--credential-env` argument is the binding to configure. For Codex, forward it with `env_vars`; for Claude, use `${VAR}` interpolation; for Cursor, start the IDE from an environment containing the variable or use a user-scoped secret facility verified for that Cursor version. Restart the host after setting it. Never put the connection string into committed MCP JSON/TOML or `dab-config.json`.

### A per-catalog SQL MCP closes or advertises zero tools

Open that server's host MCP log and use the launcher message to correct only the named catalog. Confirm:

- absolute Node, `.rooty/start-dab.cjs`, DAB, and `.rooty/mcp-<domain>/dab-config.json` paths;
- a unique explicit `ASPNETCORE_URLS=http://127.0.0.1:<port>` value, not port zero;
- explicit live-metadata entities and the `rooty-reader` read permission;
- no `.env`, `data-source-files`, autoentities, `DAB_ENVIRONMENT`, shell wrapper, or mutation-enabled tool;
- DAB starts through MCP initialize with `describe_entities`, `read_records`, and `aggregate_records`.

Do not add `--no-https-redirect` or use `dab validate` on 2.0.10 as a health workaround. Each `rooty-sql-{domain}` is independent, so leave healthy catalog entries running while fixing the failed one.

## Advanced source discovery and configuration

### `Unresolved capabilities`

Cause: discovery did not identify a provider, or configuration is missing an endpoint/auth choice.

Resolution:

1. Inspect `.investigator/discovery.json`.
2. Confirm the real provider with the owning team.
3. Rerun `sources configure` with explicit `--<capability>-provider`, `--<capability>-mcp-url`, and `--<capability>-auth`.
4. Review `.investigator/sources.json` until every capability is `ready-for-host-rendering`.

### `recipe-missing`

Cause: the selected provider ID has no matching recipe for that capability.

Resolution: choose a supported provider or add a tested connector recipe and doctor probe. An endpoint alone is insufficient.

### `MCP URL must use HTTPS or loopback HTTP`

Cause: a remote `http://` endpoint was supplied.

Resolution: expose the connector through HTTPS. Plain HTTP is accepted only on loopback.

### `MCP URL must not embed credentials`

Cause: the URL contains a username/password or credential-like query parameter.

Resolution: remove the credential from the URL and use OAuth or a bearer environment-variable reference.

### Discovery skipped a file

Discovery intentionally skips secret-named paths, oversized files, unsupported types, symlinks, and structured configuration with apparent credential values. Move only non-sensitive provider documentation into a safe project Markdown file, or configure the provider explicitly. Never weaken discovery to scan live secrets.

## Advanced host initialization

### Initialization created a folder named `true`

Rooty 0.1.0 accepted `--project` without a following path and converted the boolean flag into the literal directory name `true`. Upgrade to 0.1.1 or newer; missing option values are then rejected before any files are created.

If the accidental `true` directory contains only Rooty-generated `.agents`, host configuration, and Rooty ignore entries, it may be removed after inspection. Never delete it without first confirming that it contains no user files.

Correct demo usage from inside the target project is:

```console
rooty init --host codex --demo --project .
```

For production, complete discovery and configuration first, then use `--activate-connectors`.

### `Refusing to overwrite existing host paths`

Cause: one or more generated targets already exist.

Resolution: inspect the listed paths. Back up and manually merge any existing host configuration. Rooty does not have a force or merge mode.

### Connectors activated as `demo only / none`

Cause: `--activate-connectors` was omitted or no source entry was ready.

Resolution: complete source configuration, then initialize in a clean target with `--activate-connectors`. If host files already exist, merge them manually rather than deleting unknown user configuration.

### `Choose a setup mode` or `Source registry is not ready`

Rooty prevents an empty host installation. Choose one supported journey:

- Offline evaluation: `rooty init --host <host> --demo --project <path>`
- Production: discover, configure every required source, then run `rooty init --host <host> --project <path> --activate-connectors`

### The AI host does not see Rooty

Check:

- `rooty install` completed in the project the host opened.
- All three skills exist under `.agents/skills/` for Codex/Cursor or `.claude/skills/` for Claude.
- Codex/Cursor started within the repository path that contains `.agents/skills/`.
- The host-specific MCP configuration exists after the setup proposal was approved.
- The host was restarted or reloaded after configuration.
- Strict doctor passes from the environment that launches the host.

## Authentication

### `OAuth access-token environment variable is unavailable`

Cause: the variable named in the activation manifest is not visible to the doctor process.

Resolution:

1. Read the variable name from `.investigator/activated-connectors.json`.
2. Obtain a valid access token through the provider-approved OAuth flow.
3. Set it in the same shell or process environment that launches Rooty and the AI host.
4. Rerun doctor.

PowerShell:

```powershell
$env:ROOTY_ATLASSIAN_MCP_OAUTH_TOKEN = "..."
rooty doctor --project C:\path\to\project
```

POSIX shell:

```console
export ROOTY_ATLASSIAN_MCP_OAUTH_TOKEN="..."
rooty doctor --project /path/to/project
```

Rooty does not open a browser, exchange an authorization code, persist a token, or refresh it.

### `Bearer credential environment variable is unavailable`

Set the exact variable referenced by `bearer_token_env_var`. If the name is wrong, rerun source configuration and regenerate/merge host configuration.

## MCP doctor failures

### `initialize` failure

Common causes:

- Endpoint is unreachable
- DNS, proxy, firewall, or TLS trust is incorrect
- Token is expired or scoped incorrectly
- URL does not point to an MCP HTTP endpoint
- Server does not support the negotiated MCP lifecycle

Test network and authorization outside the model, then rerun doctor. Do not replace HTTPS with insecure remote HTTP.

### `tools-list` failure

Cause: initialization succeeded but `tools/list` failed, returned a protocol error, or omitted an allowlisted tool.

Resolution: compare the provider server's tool names with the Rooty recipe and activation manifest. Update the recipe only after verifying that the replacement tools are read-only.

### `read-probe` failure

Cause: the configured harmless probe is missing, unauthorized, malformed for that server, or returned a tool error.

Resolution: run the same bounded read through the connector's supported client, verify the identity has the intended read scope, and correct the recipe/probe with tests.

A failed read probe is a real readiness failure. Do not bypass it merely because initialization passed.

## Case and evidence errors

### `Case directory must be outside the investigated project`

Cause: case artifacts would be created under the source tree.

Resolution: choose a sibling or separate evidence directory:

```console
rooty run ROOTY-101 \
  --project /work/payments \
  --snapshot /work/Rooty/evals/mock-sources/confirmed-timeout.json \
  --case-dir /work/rooty-cases/payments-demo
```

### `Refusing to overwrite existing case directory`

Cause: Rooty protects existing case evidence.

Resolution: choose a new directory. Do not delete or reuse evidence without following your incident-data retention process.

### `Ledger ... break` or `Ledger entry was modified`

Cause: an entry was edited, removed, reordered, duplicated, or corrupted.

Resolution: preserve the affected ledger for audit, recover the original from trusted case storage if available, and append corrections only to an intact ledger. Do not recalculate hashes to hide a modification.

### Evidence field validation fails

Ensure the JSON includes:

`evidence_id`, `classification`, `source_type`, `source_system`, `environment`, `event_time_range`, `retrieved_at`, `query_or_locator`, `observation`, and `limitations`.

Evidence IDs use `E<number>`; retrieval time is ISO date-time; event time is a bounded `start/end` range.

## Memory errors

### `Only currently verified CONFIRMED investigations...`

Cause: the recomputed stopping rule is `PROBABLE` or `INCONCLUSIVE`, or the stored assessment no longer matches evidence.

Resolution: do not promote the card. Obtain the named missing current-case evidence or leave the case ineligible.

### `Draft fingerprint or source-case content does not match`

Cause: the draft, source case, or ledger changed after proposal.

Resolution: review the change. If the case is still valid, create a new governed case/draft flow; do not manually alter fingerprints.

### `Potential secret detected` or `Restricted memory fields`

Cause: the draft contains a credential pattern or a forbidden raw/sensitive field.

Resolution: remove sensitive incident content at the source and retain only generalized classes, pivots, and safe query patterns. Do not weaken the sanitizer.

## Package and evaluation

### `npm test` fails on the packaging assertion

Run:

```console
npm pack --dry-run --json
```

Confirm `docs/` is present and that `rooty-how-it-works.gif`, `media/`, and `tools/` are absent from the tarball. Those are GitHub-only assets: the GIF is referenced by its absolute GitHub URL, `media/` holds the rendered walkthrough videos, and `tools/video/` holds the generator that produces both.

### A video test asks you to re-run `tools/video/capture.mjs`

CLI output that the explainer video puts on screen has changed, so the committed capture is stale. Regenerate it and the assets:

```console
node tools/video/generate.mjs
```

See [`tools/video/README.md`](../tools/video/README.md) for the requirements and the individual stages.

### Package-only doctor reports a missing `.gitignore` inside the npm installation

Upgrade to `rooty-investigator@0.1.1` or newer. Version `0.1.0` incorrectly read the repository-only `.gitignore`; newer versions validate the packaged `setup/gitignore-template.txt`.

### Evaluation reports unsupported confirmations

A captured input produced `CONFIRMED` without satisfying the stopping rule. Inspect the case's causal links, distinct observed support, first bad state, alternative elimination, critical gaps, and corroboration/reproduction evidence. Fix the input or assessment logic; never relax the expected outcome to conceal missing proof.
