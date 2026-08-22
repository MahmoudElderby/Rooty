# Development

## Validate the repository

```console
npm test
npm run doctor
npm run eval
npm pack --dry-run
```

The test script uses Node's directory discovery so it works on Windows without shell glob expansion.

## Test the install journey locally

Pack the current worktree, then run the tarball from a temporary sandbox project. Do not test by installing into the Rooty repository itself because installed project skills would overlap packaged source during review.

Verify:

- three skills exist under the skill root of every selected host, and under no other;
- `--cursor`, `--claude`, and `--codex` each write only that host's skill root, and a flagless install reuses the manifest hosts before falling back to marker detection;
- `.rooty/state/install-manifest.json` fingerprints every installed file and records the selected hosts;
- `.rooty/config/project-context.json` stores only documentation paths;
- `.rooty/memory/{drafts,approved}` exists and draft cards are excluded from Git;
- `.rooty/mcp/` does not exist until a provider artifact is written, and a pre-existing empty category folder is removed;
- the packaged MCP-builder skill contains `assets/start-dab.cjs`; approved SQL setup later copies it once and creates `.rooty/mcp/data/sql-server/<environment>/<domain>/` folders;
- a simulated version 0.2.0 flat layout migrates without losing documentation paths;
- a second install changes no skill files;
- a locally modified owned file blocks reinstall before any write;
- doctor reports empty documentation as a warning, not a failed install.

## Skill validation

Run the official skill validator against:

```text
skill/rooty-setup
skill/rooty-mcp-builder
skill/root-cause-investigator
```

Keep each `SKILL.md` focused. Put host and provider variants in direct reference files so the active agent loads only the selected host and provider.

## Provider contribution

Add provider guidance under the matching capability category. Include vendor-owned official sources, deployment/version limits, credentials, provider-side read-only enforcement, forbidden tools, and a harmless bounded probe.

A reference is not automatically a deterministic recipe. Promotion requires a canonical proposal schema, validator coverage, safe host rendering tests, mutation tests, and a lifecycle owner.

For SQL Server, test both launchers' argument/path validation, JSON-key-to-child-variable mapping, a host process whose CWD is unrelated, missing setting names, explicit unique ports, `.env` refusal, and rejection of multi-source, autoentity, mutation-enabled, or shell-wrapper configurations. Test each catalog's `describe_entities` and bounded-read readiness independently on Codex, Cursor, and Claude.
