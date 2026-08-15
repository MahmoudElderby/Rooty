# Agent-led setup implementation plan

This plan implements the accepted requirements in incremental, testable phases. The Rooty investigation model, GIF, evidence standard, and outcome flow remain unchanged.

## Architecture decisions

- Keep `rooty install` mechanical and model-free.
- Install portable Agent Skills for setup, MCP building, and investigation.
- Persist documentation paths only.
- Let the active host agent perform documentation-first semantic discovery.
- Keep provider knowledge independent from Codex/Cursor/Claude rendering.
- Keep fragile path, ownership, secret, merge, allowlist, and probe controls deterministic.
- Use native host approvals instead of a second custom confirmation UI.

## Phase 1: recovery and first-time journey

Status: implemented on `codex/agent-led-setup-redesign`.

### Installer

- Add `src/lib/installer.js`.
- Copy three skills to `.agents/skills/` and `.claude/skills/`.
- Add ownership hashes and safe idempotent updates.
- Reject filesystem roots, symlinked targets, unavailable/broad docs, and modified/unowned conflicts.
- Add `rooty install`, `rooty setup`, `rooty context show`, and `rooty context set-docs`.
- Add readable colored output and `--json` results.

### Setup model and doctor

- Detect `.rooty/install-manifest.json` as `agent-led-v3`.
- Validate installed skill hashes and project context.
- Keep missing documentation as a warning.
- Preserve legacy source-registry/activation doctor behavior for legacy projects.
- Validate all three packaged skills in package doctor.

### Skills

- Add `rooty-setup` with documentation-first, no-map discovery.
- Add `rooty-mcp-builder` with provider research, proposal, approval, credential, and verification behavior.
- Add Codex, Cursor, and Claude host references.
- Add data, observability, ticketing, and custom provider references.
- Update the investigator to use confirmed docs only as orientation.

### Documentation and tests

- Update setup, getting started, architecture, CLI, security, troubleshooting, and development docs.
- Preserve README product story, GIF, and investigation flow.
- Add installer/idempotence/context/conflict/symlink tests.
- Keep evaluation and frozen case behavior unchanged.

## Phase 2: canonical agent-to-engine contract

Status: next.

Define a versioned provider proposal schema containing:

- capability/provider/host/environment identity;
- official-source provenance and support status;
- transport, command/URL, and runtime requirements;
- host config target and expected ownership;
- credential binding declarations without values;
- provider/server/host read-only controls;
- allowed/forbidden tools;
- harmless probe;
- explicit approval actions;
- `REVIEW_REQUIRED` rationale.

Add `rooty mcp validate --proposal FILE` to deterministically reject:

- embedded credentials;
- unsafe/broad paths;
- untrusted transport or endpoint forms;
- missing provider-side read-only controls;
- mutation/admin/export/arbitrary-execute tools;
- missing bounded probe;
- unsupported host fields;
- proposals that claim standard support without a trusted recipe.

## Phase 3: host rendering

Implement minimal, ownership-aware merges for:

- `.codex/config.toml`;
- `.cursor/mcp.json`;
- `.mcp.json` for Claude.

Requirements:

- preserve unrelated configuration;
- refuse malformed or ambiguous files;
- emit a preview before writing;
- declare every credential reference in each MCP entry;
- never write credential values;
- use atomic writes and ownership metadata;
- configure only the active/requested host.

Add `rooty mcp status` to report binding names and availability without exposing values.

## Phase 4: deterministic provider recipes

Promote providers only after validation and mutation tests:

1. SQL Server/DAB read-only entity configuration and STDIO probe.
2. Elasticsearch standalone 8.x/9.x compatibility and Agent Builder paths.
3. Jira/Rovo read-only identity and tool allowlist contract.
4. MongoDB official read-only mode and disabled mutation groups.
5. Grafana official disable flags and viewer-role contract.
6. Azure DevOps read-only domains, identity scopes, and tool allowlist.

Custom providers always start as `REVIEW_REQUIRED`.

## Phase 5: verification and UX hardening

- Initialize MCP and record negotiated protocol.
- Compare live advertised tools to reviewed allowlist/denylist.
- Fail closed on new or missing tools.
- Execute one provider-specific bounded harmless read.
- Produce consistent readiness states and actionable failure text.
- Verify color behavior, `NO_COLOR`, JSON output, and non-interactive execution.
- Add Windows protected-folder, junction, path-casing, and package-tarball tests.

## Verification matrix

| Area | Required checks |
|---|---|
| Installer | clean install, reinstall, upgrade, conflict preflight, root/symlink refusal |
| Context | internal/external docs, dedupe, broad/missing refusal, no derived fields |
| Skills | official validator, trigger prompts, progressive reference loading |
| Hosts | minimal merge, malformed conflict, credential interpolation, unrelated preservation |
| Providers | read-only identity, server controls, live tool diff, harmless bounded probe |
| Security | secret fixtures, mutation attempts, prompt injection, approval boundaries |
| Regression | unit suite, package doctor, 15-case eval, npm dry-run package, clean tarball install |

## Completion gates

Phase 1 is complete when the one-command install and installed skills are safe and documented. It does not claim automatic deterministic rendering for every provider.

The full enhancement is complete when a setup agent can submit a canonical proposal, the engine validates and previews it, the user approves native host actions, the renderer safely merges the active host, and data plus observability pass bounded harmless probes without any credential value entering project state.
