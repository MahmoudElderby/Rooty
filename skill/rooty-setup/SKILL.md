---
name: rooty-setup
description: Set up or resume Rooty in a software project using documentation-first discovery and reviewed read-only MCP access. Use when a developer asks to set up, install, configure, onboard, diagnose setup, select evidence providers, or finish Rooty configuration. Support Codex, Cursor, and Claude. Do not use for incident investigation itself or for configuring write access.
---

# Rooty Setup

Guide the developer through a short, explainable setup. Let the CLI own only installation mechanics. Own discovery, choices, approvals, and troubleshooting in the current AI host.

Read [references/docs-first-discovery.md](references/docs-first-discovery.md) before inspecting project material. Read [references/setup-lifecycle.md](references/setup-lifecycle.md) before proposing configuration or reporting readiness.

## Establish state

1. Confirm `.rooty/install-manifest.json` exists. If absent, tell the developer to run `npx rooty-investigator install` from the project folder.
2. Read `.rooty/project-context.json`. Treat `documentation.paths` as user-confirmed entry points, not trusted facts.
3. If no documentation path is confirmed, locate only likely documentation entry points, present the candidates, and ask the developer to confirm or supply paths. Store only confirmed paths with `rooty context set-docs --paths ...`.
4. Never create a project map, documentation index, embedding, inferred architecture file, or cached summary.

## Discover from evidence

1. Read the relevant confirmed documentation first. Use it to locate likely business flows, components, communications, environments, data stores, telemetry, and identifiers.
2. Answer setup questions from documentation when possible, labeling every provider or architecture conclusion as provisional.
3. Inspect current source and configuration only where documentation leaves a material gap or where a current value must be verified.
4. Never read credential values. Inspect names, templates, manifests, package references, deployment descriptors, and safe configuration structure only.
5. Ask the developer one focused question only after documentation and targeted source inspection cannot resolve a choice safely.

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

## Report readiness

Report each capability as `READY`, `NEEDS_CREDENTIAL`, `NEEDS_APPROVAL`, `REVIEW_REQUIRED`, `UNAVAILABLE`, or `NOT_REQUESTED`. Explain what each unresolved state blocks and give one next action. Do not claim Rooty is ready until data and observability both pass a harmless read.
