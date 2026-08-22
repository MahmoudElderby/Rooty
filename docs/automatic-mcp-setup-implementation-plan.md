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

- Detect `.rooty/state/install-manifest.json` as `agent-led-v3`, with a version 0.2.0 flat-path fallback and migration.
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
- local JSON setting-key declarations without values;
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
- declare every local JSON setting key and Rooty launcher invocation in each MCP entry;
- never write credential values;
- use atomic writes and ownership metadata;
- configure only the active/requested host.

Add `rooty mcp status` to report binding names and availability without exposing values.

## Phase 4: deterministic provider recipes

Promote providers only after validation and mutation tests:

1. SQL Server live catalog/object discovery, one isolated explicit-entity DAB per catalog, shared hardened launcher, and independent STDIO probes on Codex, Cursor, and Claude.
2. Elasticsearch 8.x official Docker compatibility (`ES_VERSION=8`, `list_indices`) and Agent Builder paths.
3. Jira/Rovo read-only identity and tool allowlist contract.
4. MongoDB official read-only mode and disabled mutation groups.
5. Grafana official disable flags and viewer-role contract.
6. Azure DevOps read-only domains, identity scopes, and tool allowlist.

Custom providers always start as `REVIEW_REQUIRED`.

### SQL catalog implementation increment

Status: implemented on `codex/sql-catalog-mcp-per-ide`.

- Package `assets/start-dab.cjs` with the MCP-builder skill and copy it to `.rooty/start-dab.cjs` only after setup approval.
- Reject multi-source/autoentity DAB config, mutation tools, `.env` credential files, shell wrappers, relative paths, `DAB_ENVIRONMENT`, and implicit ports at launcher startup.
- Create `.rooty/mcp/data/sql-server/{environment}/{domain}/dab-config.json` targets and one active `rooty-{environment}-sql-{domain}` host entry per logical catalog. The launcher still accepts the earlier environmentless and `.rooty/mcp-{domain}/` locations so existing installs keep working.
- Wrap every host entry with `.rooty/start-mcp.cjs`; read declared values from `.rooty/config/mcp-settings.local.json` and inject them only into the selected child process. Map environment-specific port keys to `ASPNETCORE_URLS` with `SOURCE_KEY=ASPNETCORE_URLS`.
- Keep Elasticsearch 8.19.15 on the official Docker image with `ES_VERSION=8` and `list_indices` readiness.

### Host targeting and layout increment

- Select install hosts from `--cursor`, `--claude`, and `--codex`, then the manifest, then project markers, then all hosts; record the result under `hosts` in the install manifest.
- Write only the skill roots the selected hosts read, and report files left behind by a narrowed host list instead of deleting them.
- Stop pre-creating `.rooty/mcp` category folders, remove empty ones left by earlier versions, and route provider artifacts through `.rooty/mcp/<category>/<provider>/`.
- Route developer questions through the active host's structured question tool where one exists, with a plain-text fallback and a mandatory escape option.

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
