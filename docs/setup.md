# Project and connector setup

Rooty has no gateway in the MVP. The selected AI host connects directly to one MCP endpoint per configured capability. The same endpoint may satisfy more than one capability, such as Atlassian for ticketing and documentation.

## Setup journey

| User action | What Rooty does | Output |
|---|---|---|
| Install the npm package | Installs the dependency-free CLI and bundled assets | `rooty` and `investigator` commands |
| Discover sources | Scans bounded, non-secret project text for provider signals | `.investigator/discovery.json` |
| Validate detections | A human confirms inferred provider mappings and identifies gaps | Reviewed discovery |
| Configure sources | Validates providers, HTTPS endpoints, auth modes, credential references, tool allowlists, and doctor probes | `.investigator/sources.json` |
| Provide credentials | The user exposes tokens to the host process through environment variables | No credential file |
| Initialize a host | Copies the canonical skill and renders host-specific read-only configuration | Host files and optional activation manifest |
| Run doctor | Negotiates MCP, lists tools, checks allowlists, and performs bounded read probes | PASS/WARN/FAIL readiness report |

## 1. Discover sources

Run discovery from any location by explicitly naming the target project:

```console
rooty sources discover --project /path/to/project
```

Discovery scans up to 10,000 files of at most 1 MB each. It skips:

- `.git`, `node_modules`, build output, virtual environments, and existing Rooty runtime state
- Symlinks
- Secret-named paths such as `.env`, `secrets.*`, credentials, token, key, or vault files
- Structured configuration that appears to contain non-placeholder credential values
- Unsupported or binary file types

Detections are repository-derived signals, not verified truth. They are recorded as `INFERRED` with the files that triggered the match.

Current discovery rules recognize:

| Capability | Provider signals |
|---|---|
| Ticketing | Jira and Atlassian |
| Documentation | Confluence and Atlassian |
| Observability | Datadog, Grafana/Loki/Tempo/Prometheus, Sentry |
| Database | PostgreSQL, MySQL |
| Deployments | Argo CD, Kubernetes, Helm |

If discovery finds nothing, explicitly select a provider during configuration. That mapping is recorded as `USER_CONFIGURED`.

## 2. Configure all required capabilities

The production-readiness gate expects five capabilities:

- `ticketing`
- `documentation`
- `observability`
- `database`
- `deployments`

Each capability uses the same option pattern:

```text
--<capability>-provider PROVIDER
--<capability>-mcp-url URL
--<capability>-auth oauth|bearer-env|none
--<capability>-oauth-token-env VARIABLE
--<capability>-bearer-token-env VARIABLE
```

Example:

```console
rooty sources configure --project /path/to/project \
  --ticketing-provider atlassian \
  --ticketing-mcp-url https://mcp.example.internal/atlassian \
  --ticketing-auth oauth \
  --documentation-provider atlassian \
  --documentation-mcp-url https://mcp.example.internal/atlassian \
  --documentation-auth oauth \
  --observability-provider datadog \
  --observability-mcp-url https://mcp.example.internal/observability \
  --observability-auth bearer-env \
  --observability-bearer-token-env ROOTY_DATADOG_TOKEN \
  --database-provider postgres \
  --database-mcp-url https://mcp.example.internal/postgres \
  --database-auth bearer-env \
  --database-bearer-token-env ROOTY_POSTGRES_TOKEN \
  --deployments-provider argocd \
  --deployments-mcp-url https://mcp.example.internal/argocd \
  --deployments-auth oauth
```

Rooty accepts remote HTTPS endpoints and loopback HTTP endpoints. It rejects embedded URL credentials and credential-like query parameters.

### Supported recipes

| Provider ID | Capabilities | Allowed tools from the recipe |
|---|---|---|
| `atlassian` | Ticketing, documentation | Issue and page get/search tools |
| `datadog` | Observability | Logs, traces, metrics reads |
| `grafana` | Observability | Logs, traces, metrics reads |
| `sentry` | Observability | Event and issue reads |
| `postgres` | Database | Schema read and read-only query |
| `mysql` | Database | Schema read and read-only query |
| `argocd` | Deployments | Application and revision reads |
| `kubernetes` | Deployments | Deployment and event reads |
| `rooty-snapshot` | All demo capabilities | Six bundled synthetic read tools |

A recipe is configuration metadata. It does not install the provider's MCP server, create an account, or convert a write-capable identity into a read-only identity.

## 3. Configure authentication

### OAuth

Rooty does not run an interactive OAuth browser flow. It generates an environment-variable reference such as:

```text
ROOTY_ATLASSIAN_MCP_OAUTH_TOKEN
```

Override the name when needed:

```console
rooty sources configure ... \
  --ticketing-auth oauth \
  --ticketing-oauth-token-env COMPANY_ATLASSIAN_ACCESS_TOKEN
```

Obtain the access token through the provider-approved flow and expose it to the AI host process.

### Bearer environment reference

Bearer mode requires an explicit variable name:

```console
rooty sources configure ... \
  --database-auth bearer-env \
  --database-bearer-token-env ROOTY_DATABASE_READ_TOKEN
```

### No authentication

`--<capability>-auth none` is allowed only for `localhost`, `127.0.0.1`, or `::1`. It is intended for controlled local connectors such as the demo.

Rooty configuration contains variable names, never values. Keep values in the process environment, OS credential storage, or an approved secret manager.

## 4. Review the source registry

Inspect:

```text
/path/to/project/.investigator/sources.json
```

Every production capability should have:

- The expected provider
- `status: "ready-for-host-rendering"`
- The correct direct MCP endpoint
- The intended auth mode and credential environment-variable name
- A bounded `allowed_tools` list
- A harmless `doctor_probe`
- A mapping status of `INFERRED` or `USER_CONFIGURED`

List one environment through the CLI:

```console
rooty sources list my-service --environment production --project /path/to/project
```

The service name defaults to the project directory name. Environment input is lowercased and validated, but it must match a registered environment; the generated MVP registry contains `production`.

## 5. Initialize a host

```console
rooty init --host codex --project /path/to/project --activate-connectors
```

Generated files:

| Host | Files |
|---|---|
| All hosts | `.agents/skills/root-cause-investigator/` |
| Codex | `.codex/config.toml` |
| Claude Code | `.claude/skills/root-cause-investigator/`, `.mcp.json`, `.claude/settings.json`, read-only hook and allowlist |
| Cursor | `.cursor/mcp.json`, `.cursor/rules/root-cause-investigator.mdc` |
| Activated project | `.investigator/activated-connectors.json` |
| Project safety | Creates `.gitignore` when absent or appends missing Rooty runtime exclusions |

Use `--host all` to render every included adapter. Use `--demo` to add the bundled local synthetic connector.

Rooty deliberately refuses to overwrite any existing host target. Back up and merge existing host configuration, then rerun initialization only when the target paths are clear.

Initialization preserves existing `.gitignore` content and appends only missing Rooty runtime paths. Strict doctor validates those project exclusions; package-only doctor validates the shipped template instead.

## 6. Run the readiness gate

```console
rooty doctor --project /path/to/project
```

Strict doctor fails when a required capability is unresolved or unactivated, a credential variable is missing, an endpoint is unreachable or unauthorized, MCP initialization fails, an allowed tool is absent or unsafe, or a harmless read probe fails.

Use JSON for automation:

```console
rooty doctor --project /path/to/project --json
```

Use `--package-only` only when checking the installed kit itself. Missing project sources and activation become warnings in that mode.

## Adding an unsupported provider

A provider needs:

1. A direct MCP server that implements the required read behavior.
2. A new recipe in `setup/connector-recipes/catalog.json` with capability, auth metadata, explicit read allowlist, and bounded doctor probe.
3. Optional safe detection rules in `setup/discovery-rules/rules.json`.
4. Tests for configuration, rendered host output, doctor negotiation, allowlist enforcement, and read probes.

Never add mutation-capable tools to a Rooty recipe.
