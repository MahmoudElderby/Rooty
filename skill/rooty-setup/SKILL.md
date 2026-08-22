---
name: rooty-setup
description: Set up, resume, or switch Rooty environments in a software project using documentation-first discovery and reviewed read-only MCP access. Use when a developer asks to set up, install, configure, onboard, diagnose setup, select evidence providers, finish Rooty configuration, show the active environment, or switch between production, preprod, staging, or another environment. Support Codex, Cursor, and Claude. Do not use for incident investigation itself or for configuring write access.
---

# Rooty Setup

Guide the developer through a short, explainable setup. Let the CLI own only installation mechanics. Own discovery, choices, approvals, and troubleshooting in the current AI host.

Read [references/docs-first-discovery.md](references/docs-first-discovery.md) before inspecting project material. Read [references/asking-questions.md](references/asking-questions.md) before asking the developer anything. Read [references/setup-lifecycle.md](references/setup-lifecycle.md) before proposing configuration or reporting readiness. Before persisting environment targets, read the MCP builder's [environment profile contract](../rooty-mcp-builder/references/environment-profiles.md).

## Establish state

1. Confirm `.rooty/state/install-manifest.json` exists. Accept `.rooty/install-manifest.json` only as a legacy layout and tell the developer that the next `rooty install` migrates it. If neither exists, tell the developer to run `npx rooty-investigator install` from the project folder.
2. Read `.rooty/config/project-context.json`, falling back to the legacy `.rooty/project-context.json`. Treat `documentation.paths` as user-confirmed entry points, not trusted facts.
3. Confirm `.rooty/memory/{drafts,approved}` exists. Re-run `rooty install` to create the canonical layout and copy any legacy `.investigator/memory` cards without deleting them.
4. Read `.rooty/state/setup-progress.json`. Resume from its first incomplete stage. When a developer skips or cancels a setup question, immediately persist the outcome with `rooty setup pause --stage <STATE> --reason skipped|cancelled --next-action <ACTION>`.
5. If no documentation decision is confirmed, locate only likely documentation entry points, then ask the developer to confirm or supply paths through the host's structured question tool when it exists. Store confirmed paths with `rooty context set-docs --paths ...`; store an explicit no-docs decision with `rooty context set-docs --none`.
6. Never create a project map, documentation index, embedding, inferred architecture file, or cached summary.

## Discover and confirm environments

1. Run `rooty env discover --json`. Treat every result as `UNCONFIRMED`.
2. Review only the safe evidence paths behind candidates. Environment names may come from documentation, deployment descriptors, infrastructure, CI/CD stages, non-secret configuration templates, telemetry structure, existing MCP entries, and credential binding names. Never read credential values.
3. Ask which candidates are real environments, which names are aliases, which environments to configure, and which one to activate initially. Do not infer that `prod`, `preprod`, `stage`, or `qa` is currently active.
4. Prefer configuring every confirmed environment needed for investigation when the developer approves it; readiness remains independent per environment.
5. Persist confirmed/selected environment IDs and the active host with `rooty setup selections`, then checkpoint `ENVIRONMENTS_CONFIRMED`.

## Discover from evidence

1. Read the relevant confirmed documentation first. Use it to locate likely business flows, components, communications, environments, data stores, telemetry, and identifiers.
2. Answer setup questions from documentation when possible, labeling every provider or architecture conclusion as provisional.
3. Inspect current source and configuration only where documentation leaves a material gap or where a current value must be verified.
4. Never read credential values. Inspect names, templates, manifests, package references, deployment descriptors, and safe configuration structure only.
5. Ask the developer only after documentation and targeted source inspection cannot resolve a choice safely. Use the host's structured question tool, offer an option that escapes the candidate list, and batch the questions that block the same step into one prompt.

## Establish investigation capabilities

- Require at least one usable **data** provider and one usable **observability** provider.
- Treat **ticketing** as optional because the developer can paste a ticket into the conversation.
- Do not require documentation, deployment, or source-control MCP servers merely because those systems are mentioned.
- Invoke `$rooty-mcp-builder` for each proposed provider and the active host.

## Apply with approval

1. Show the provider, official server, transport, exact host config path, credential binding names, read-only controls, allowed tools, harmless probe, and any runtime installation before changing anything.
2. Request host-native approval for every file write, command, package execution, image pull, or OAuth flow.
3. Configure only the active host unless the developer explicitly asks for additional hosts.
4. Put credential **references** in that host's MCP entry. Never put credential values in project files or chat.
5. After configuration, display every unresolved credential binding with its host config path and the smallest action that resolves it.
6. Verify server initialization, tool discovery, absence or blocking of mutation tools, and one bounded harmless read.
7. Do not create always-on host investigation rules. Universal methodology belongs in the installed `root-cause-investigator` skill; reviewed project learning belongs in `.rooty/memory`.

## Switch environments

When the developer asks conversationally to switch, change, use, or return to an environment:

1. Run `rooty env plan <environment> --json`; normally omit `--host` because Rooty infers the one configured host. If multiple configured hosts make the target ambiguous, ask once or use `--all-hosts` only when explicitly requested.
2. Show every environment-visible MCP rename and connection change. There must be exactly one rendered MCP per logical source: for example, replace `rooty-prod-sql-orders` with `rooty-preprod-sql-orders`; never keep both.
3. Request approval, then run `rooty env use <environment>` rather than editing host configuration directly.
4. Reload or reconnect the host MCP servers. Treat `APPLIED_PENDING_RELOAD` as not investigation-ready.
5. Run `rooty doctor --environment <environment>`. Do not report success until data and observability pass identity-specific bounded reads.
6. If an investigation is already active, require a new environment-specific investigation context or an explicit cross-environment comparison before switching.

## Report readiness

Report each environment/capability as `READY`, `NEEDS_CREDENTIAL`, `NEEDS_APPROVAL`, `REVIEW_REQUIRED`, `UNAVAILABLE`, or `NOT_REQUESTED`. Explain what each unresolved state blocks and give one next action. Do not claim an environment is ready until its data and observability connections both pass identity-specific harmless reads.
