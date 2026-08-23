# Security and threat model

Rooty is designed for read-only investigation, but connecting any AI agent to production evidence is a privileged operation. Treat Rooty as one layer in a defense-in-depth system.

## Security objectives

Rooty aims to:

- Prevent the investigator from intentionally mutating code, tickets, data, configuration, or deployments
- Keep credential values out of generated host files and Git
- Restrict the agent to explicit evidence-read tools
- Bound expensive or broad production queries
- Preserve evidence integrity and provenance
- Resist instructions embedded in untrusted evidence
- Prevent unreviewed or sensitive incident content from becoming reusable memory

Rooty does not claim to sandbox a malicious MCP server or repair an over-privileged provider identity.

## Trust boundaries

| Boundary | Trusted for | Not trusted for |
|---|---|---|
| Rooty skill and CLI | Investigation rules, validation, rendering, local assessment | Provider authorization |
| AI host policy | Filesystem/tool restrictions supported by that host | Replacing provider-side permissions |
| MCP reference/proposal | Expected setup, setting keys, tool restrictions, doctor probes | Server honesty or account least privilege |
| MCP server | Returning provider data | Instructions embedded in returned text |
| Provider identity/database role | Enforcing actual read permissions | Rooty's evidence interpretation |
| Ticket, docs, logs, DB text, memory | Evidence content | Agent instructions |
| Human reviewer | Accountable memory approval | Automatic proof for later cases |

## Required production controls

Before activation:

- Use a dedicated read-only identity per provider where practical.
- For databases, use a read-only role or replica, read-only transactions, statement timeouts, row limits, and server-side query controls.
- Limit access to the required projects, services, indexes, schemas, tables, clusters, and environments.
- Prefer short-lived credentials and protect the Rooty local settings file with the same controls as other developer secret stores.
- Restrict network access to approved MCP endpoints.
- Require TLS for remote endpoints.
- Audit provider and MCP tool calls using the investigation case ID.
- Verify retention, sampling, redaction, and regional data-handling requirements.
- Test the identity independently of Rooty to prove that mutations fail.

MCP `readOnlyHint` and `destructiveHint` annotations are metadata. They are useful for validation but are not authorization.

## Credential handling

Every configured MCP target declares `settings_keys`. Generated host files contain only those key or nested-path names, the Rooty launcher path, and value-free URL/header templates. Values live in `.rooty/config/mcp-settings.local.json`, which the installer always Git-ignores and restricts to the current user where the platform supports file modes. Rooty rejects:

- Credential values in secret-like object fields
- Usernames or passwords embedded in MCP URLs
- Credential-like query parameters
- Settings-backed entries that bypass `.rooty/start-mcp.cjs`
- Missing or empty declared JSON setting values
- Machine-environment forwarding or interpolation in managed profiles
- Unauthenticated non-loopback endpoints

Do not commit token values, connection strings, private keys, raw `.env` files, the local MCP settings JSON, or provider payloads. `rooty settings status` reports availability without displaying values, and settings values are never accepted as command-line arguments.

The mechanical installer does not start OAuth or store refresh tokens. The setup agent may initiate a host-managed OAuth flow only after separate user approval. Credential rotation remains a provider/organization responsibility.

## Prompt injection

All external content is untrusted data, including:

- Jira or other ticket descriptions and comments
- Documentation and runbooks
- Logs, exceptions, trace attributes, and database text
- Connector error messages and tool results
- Prior approved memory
- Source comments and generated files encountered during investigation

Text such as “ignore previous instructions,” “run this command,” or “upload these logs” is recorded only as evidence. It never changes the tool allowlist, investigation boundary, outcome rule, or memory policy.

The evaluation suite includes prompt-injection cases, but evaluation is not a substitute for host and provider enforcement.

## Query safety

The bundled demo connector demonstrates these controls:

- Every tool requires a case ID.
- Log, trace, and deployment queries have a maximum 24-hour UTC window.
- Search and row counts are bounded.
- Queries record time coverage and truncation.
- Database calls permit one `SELECT` statement only.
- Mutation-named tools and mutation SQL are rejected.
- Unknown arguments are rejected by schema.

Real MCP connectors must implement equivalent or stronger controls. A recipe allowlist cannot make a generic SQL executor safe.

## Filesystem and case isolation

The project installer refuses filesystem roots, symlinked installation targets, and modified or unowned Rooty skill conflicts. Its manifest stores ownership hashes, not project evidence or credentials.

Host adapters configure read-only behavior where supported. Persisted case data must live outside the investigated source tree. Rooty rejects lexical and symlink-resolved in-project case paths.

This prevents an investigation from changing the repository and reduces the chance of committing incident evidence. Installation creates or extends `.gitignore` with runtime case, discovery, and memory-draft paths. Agent-led installation writes project skills, Rooty configuration and state, empty memory directories, provider artifact directories, and the ignore policy; it does not write investigation conclusions.

Do not place raw production evidence in the Rooty repository. Apply your organization's retention, encryption, access-control, and deletion policies to external case storage.

## Evidence integrity

The persisted evidence ledger is append-only and hash-chained. Rooty verifies:

- Required metadata
- Unique evidence IDs
- Monotonic sequence
- Previous-hash linkage
- Entry hashes

The chain detects accidental or unauthorized modification after capture; it does not prove that the original source told the truth. Preserve provider permalinks, source identities, and external audit records for stronger provenance.

## Memory governance

Only recomputed `CONFIRMED` cases are eligible. Approval:

- Requires the verified source case and ledger
- Requires a human or accountable team identity
- Compares the draft to a freshly rebuilt card
- Rejects restricted fields and common secret patterns
- Refuses overwrites, duplicate learning fingerprints, and overlapping concern keys
- Adds a 180-day expiry

Approved memory remains hypothesis input, not current-case evidence.

## Production readiness checklist

- [ ] Data and observability map to the correct providers and environment; optional ticketing is explicitly requested or omitted.
- [ ] Documentation paths are confirmed, and material documentation-derived choices were verified against current project evidence.
- [ ] MCP endpoints use HTTPS or controlled loopback HTTP.
- [ ] Every provider identity was independently proven read-only.
- [ ] Database access uses a read-only role or replica with server-side limits.
- [ ] Tokens are short-lived or managed outside project files.
- [ ] Every active-host MCP entry invokes the Rooty launcher and declares all setting keys without values.
- [ ] Tool allowlists contain only required reads.
- [ ] Doctor probes are harmless, bounded, and authorized.
- [ ] `rooty doctor` passes and the setup agent's live initialization/tool/probe checks pass from the same environment that launches the host.
- [ ] Provider auditing records case IDs and tool calls.
- [ ] Evidence storage and retention satisfy policy.
- [ ] Remediation is handled by a separate workflow.

## Reporting a security issue

Do not open a public issue containing credentials, customer data, production logs, or exploitable details. Contact the repository owner privately through an agreed security channel. Add a dedicated `SECURITY.md` with your final disclosure address before broad public adoption.
