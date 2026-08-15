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

## Source discovery and configuration

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

## Host initialization

### `Refusing to overwrite existing host paths`

Cause: one or more generated targets already exist.

Resolution: inspect the listed paths. Back up and manually merge any existing host configuration. Rooty does not have a force or merge mode.

### Connectors activated as `demo only / none`

Cause: `--activate-connectors` was omitted or no source entry was ready.

Resolution: complete source configuration, then initialize in a clean target with `--activate-connectors`. If host files already exist, merge them manually rather than deleting unknown user configuration.

### The AI host does not see Rooty

Check:

- The project was initialized for the correct host.
- The host opened the same project directory passed to `--project`.
- The canonical skill exists under `.agents/skills/root-cause-investigator`.
- The host-specific skill/rule and MCP files exist.
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

Confirm `docs/` is present and `rooty-how-it-works.gif` is absent from the tarball. The GIF remains in Git and the README uses its absolute GitHub URL.

### Evaluation reports unsupported confirmations

A captured input produced `CONFIRMED` without satisfying the stopping rule. Inspect the case's causal links, distinct observed support, first bad state, alternative elimination, critical gaps, and corroboration/reproduction evidence. Fix the input or assessment logic; never relax the expected outcome to conceal missing proof.

