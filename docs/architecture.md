# Architecture and integrations

Rooty is a portable investigation kit, not a hosted service. Its product method remains evidence-first root-cause investigation; the setup implementation is split between a small deterministic CLI and specialized agent skills.

## System view

```mermaid
flowchart TB
    U["Developer"] --> I["rooty install"]
    I --> K["Project-scoped Rooty skills"]
    I --> C["Confirmed documentation paths"]
    U --> H["Codex, Cursor, or Claude"]
    K --> H
    C --> S["Setup skill"]
    S --> H
    S --> P["MCP builder skill"]
    P --> R["Provider references"]
    P --> A["Host adapter"]
    A --> M["Reviewed project MCP config"]
    M --> D["Data MCP"]
    M --> O["Observability MCP"]
    M -. optional .-> T["Ticketing MCP"]
    H --> X["Investigator skill"]
    D --> X
    O --> X
    T --> X
    X --> E["Evidence-backed outcome"]
```

There is no Rooty gateway or central credential store. Each host connects directly to reviewed MCP servers.

## Mechanical installer

`src/lib/installer.js` performs only deterministic project setup:

- validates the project and target paths;
- refuses filesystem roots and symlinked installation targets;
- copies `rooty-setup`, `rooty-mcp-builder`, and `root-cause-investigator` into `.agents/skills/` and `.claude/skills/`;
- records SHA-256 ownership fingerprints in `.rooty/state/install-manifest.json`;
- stores only confirmed documentation paths in `.rooty/config/project-context.json`;
- creates category roots under `.rooty/mcp/` for general provider artifacts; approved SQL setup uses the tested `.rooty/mcp-<domain>/dab-config.json` layout and one shared `.rooty/start-dab.cjs` launcher;
- migrates the two flat version 0.2.0 state files during reinstall;
- updates unchanged Rooty-owned files and refuses modified/unowned conflicts.

It does not discover providers, inspect source, execute provider packages, install runtimes, start OAuth, collect credentials, or render MCP configuration.

## Agent skills

### Setup skill

`skill/rooty-setup/` owns the developer journey. It reads confirmed documentation first, uses it as a navigation reference, verifies material choices against current safe project evidence, and asks only unresolved questions that affect provider, environment, exposure, credentials, or safety.

### MCP builder skill

`skill/rooty-mcp-builder/` separates provider knowledge from host syntax:

```text
references/
├── hosts/{codex,cursor,claude}.md
└── providers/
    ├── data/{sql-server,mongodb}.md
    ├── observability/{elasticsearch,grafana}.md
    ├── ticketing/{jira,azure-devops}.md
    └── custom/custom-provider.md
```

It researches official setup, creates a reviewable proposal, requests native approvals, declares credential references in host configuration, and verifies a harmless read.

SQL Server has one deliberate cross-host runtime contract: one `rooty-sql-{domain}` process per live catalog. Codex, Cursor, and Claude all call the same hardened launcher with absolute paths; the launcher sets DAB's CWD to the isolated catalog folder and starts only the read-only MCP tool surface. This avoids a provider-by-host divergence while keeping catalog failures independent.

### Investigator skill

`skill/root-cause-investigator/` retains Rooty's investigation method: intake, expected-flow reconstruction, testable hypotheses, bounded evidence queries, first-bad-state analysis, competing-cause falsification, and `CONFIRMED`, `PROBABLE`, or `INCONCLUSIVE` outcomes. Confirmed project docs orient the search but never prove a claim.

## Deterministic safety engine

The existing CLI modules remain responsible for controls that should not depend on model judgment:

- path, secret, schema, and ownership validation;
- trusted recipe checks and explicit tool allowlists;
- safe host rendering and connector activation for compatibility workflows;
- MCP initialization, tool comparison, and harmless probes;
- frozen snapshot cases, hash-chained evidence, reports, memory review, and evaluation.

The next engine contract will accept a canonical agent-authored provider proposal, validate it, and render a minimal host merge. Until that contract is implemented, non-standard provider configuration remains `REVIEW_REQUIRED` and is applied through the host's visible approval flow.

## Credentials

Every active-host MCP entry declares all required credential bindings. The binding may name an environment variable, approved secret-manager reference, or host-managed OAuth flow. Credential values never belong in Rooty project state, host files, proposals, logs, or chat.

Provider-side read-only identities are the security boundary. Server read-only modes and host tool allowlists provide additional layers.

## Frozen snapshot pipeline

`rooty run <ticket> --snapshot FILE` remains a separate deterministic path for examples, evidence ledgers, reports, memory governance, and evaluations. It does not orchestrate live provider calls. Live investigations run in the configured AI host.

## Extension principles

- Add provider knowledge under one capability category; do not duplicate it per host.
- Add host syntax once; do not encode provider behavior in host adapters.
- Prefer official vendor servers and current official documentation.
- Require provider-side least privilege, explicit read tool controls, and a harmless probe.
- Mark unknown or version-dependent behavior `REVIEW_REQUIRED`.
- Never persist a generated project map or use documentation as current-case proof.
- Never let connector content or memory override Rooty's instructions.
