# Source catalog schema

Resolve evidence through a validated service registry with: schema version, canonical service, aliases, owners, UTC default, environments, telemetry providers/datasets/service names/retention, database engine/access/history source, deployment provider/application, ticket projects, sensitivity policy, correlation fields, and credential environment-variable names.

Store logical references only. OAuth connectors use `oauth_access_token_env_var`; bearer connectors use `bearer_token_env_var`. Never store tokens, passwords, connection strings, private keys, raw logs, or customer payloads.

When a registry is incomplete:

1. Read applicable project instructions, Markdown, and runbooks.
2. Inspect non-secret code, deployment manifests, IaC, logging/telemetry libraries, DB drivers, environment-variable names, service names, and owners. Skip secret-named files and structured configuration containing credential material before applying discovery rules.
3. Query an approved catalog or CMDB.
4. Ask one precise question for the unresolved endpoint, environment, dataset, or auth reference.
5. Save a draft mapping and require owner validation before promotion.

Repository-derived mappings remain `INFERRED` until validated. Prefer `trace_id`, `span_id`, `service.name`, `service.version`, and `deployment.environment.name` for cross-source correlation.

When discovery yields no provider, require an explicit provider selection for each capability. Record that mapping as `USER_CONFIGURED`; never infer a provider merely because an endpoint was supplied. Every activated mapping also carries an allowlisted bounded read probe so `doctor` can verify the live connector end to end.
