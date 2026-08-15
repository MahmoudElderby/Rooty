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

- three skills exist under both host skill roots;
- `.rooty/install-manifest.json` fingerprints every installed file;
- `.rooty/project-context.json` stores only documentation paths;
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
