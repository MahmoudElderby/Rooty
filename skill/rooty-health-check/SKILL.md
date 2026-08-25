---
name: rooty-health-check
description: Manually assess the health of configured project components through bounded read-only MCP probes and optional bounded log indicators. Use for project health checks, readiness snapshots, dependency-impact review, critical component alerts, or visibility-gap assessment. Do not measure MCP servers as components, mutate systems, schedule checks, or send notifications.
---

# Rooty Health Check

Assess project components, not the MCP transports used to observe them.

Read [references/profile-workflow.md](references/profile-workflow.md) on first invocation. Read [references/health-contract.md](references/health-contract.md) before recording observations.

## Establish the project profile

1. Read only developer-confirmed documentation paths, safe source/configuration, active environment profiles, and current read-only MCP capabilities.
2. Propose a project-specific schema-version-1 profile containing environment identity, required components, dependencies, bounded read-only probes, expected results, timeouts, and optional log indicators. Never include credentials.
3. Ask the developer to confirm or revise the profile. Persist `confirmation.status: CONFIRMED` only after that answer. Do not evaluate an unconfirmed profile.
4. Treat missing cloud-resource MCP coverage as an explicit provider-neutral setup/research gap. Do not choose a cloud provider implicitly.

## Run a manual observation pass

- Verify active environment identity first.
- Invoke only the confirmed bounded read-only probes through available MCP tools.
- Record observations and evidence references; never copy raw provider payloads into the profile.
- Use `UNAVAILABLE` when access or MCP capability prevents a probe. Do not convert a visibility gap into a component failure.
- Run `rooty health evaluate --profile FILE --observations FILE --output DIR`.

Interpret the deterministic result:

- `HEALTHY`: every required project probe passes.
- `DEGRADED`: required probes pass, but bounded logs contain concerning errors or trends.
- `CRITICAL`: any configured project-component probe fails.
- `UNKNOWN`: a required probe cannot run because access or MCP capability is unavailable.

The report includes structured critical alerts and unknown visibility gaps, but does not deliver notifications. Exit codes are 0 healthy, 1 degraded/unknown, 2 critical, and 3 invalid input.

