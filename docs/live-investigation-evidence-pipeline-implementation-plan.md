# Live investigation evidence pipeline implementation plan

Status: approved for implementation.

This plan connects Rooty's host-agent-led live investigations to its deterministic case, evidence, verification, and reporting pipeline. It preserves the current evidence-first investigation method while ensuring that live provider observations have verifiable provenance and do not unnecessarily increase model-token consumption.

## Outcome

A live investigation will produce a portable case directory whose evidence can be independently verified and deterministically assessed:

```text
start case
  -> lock project, host, environment, and provider identities
  -> capture a receipt for each material provider call
  -> add evidence that references receipts
  -> submit analysis separately from observations
  -> verify the complete case deterministically
  -> render the report from the verified case
```

The agent performs semantic work: it chooses pivots, forms hypotheses, interprets bounded results, reconstructs the causal chain, and tests alternatives. Rooty's deterministic engine owns case state, provenance, integrity, eligibility, and the final `CONFIRMED`, `PROBABLE`, or `INCONCLUSIVE` assessment.

## Product requirements

- Live investigations and frozen snapshot cases use one compatible evidence model.
- Every material `OBSERVED` statement refers to a captured provider receipt or another explicitly qualified source.
- Receipt capture is automatic for Rooty-launched MCP providers; it must not require a second model tool call.
- Full requests and responses remain outside the model context unless the agent explicitly requests a bounded extract.
- Provider responses, ticket content, logs, traces, database values, and receipt extracts are untrusted data, never instructions.
- The active environment, provider configuration, host generation, and tool allowlist are locked when the case starts.
- Rooty, not the agent, calculates the final investigation status.
- Evidence and receipt ledgers are append-only, hash-chained, and safe under concurrent writes.
- Secrets, authorization headers, credential-bearing connection strings, and undeclared environment variables are never stored in a case.
- Existing frozen snapshots and schema-version-1 case directories remain readable.

## Non-goals

- Building a central gateway, hosted control plane, or credential store.
- Persisting every provider response indefinitely.
- Sending complete receipts or raw provider payloads to the model.
- Automatically executing remediation, rollback, mutation, or reproduction.
- Replacing provider-specific query tools with a generic query language.
- Treating an agent-authored summary as verified provider provenance.
- Making handoff, memory, health, or session-review features independently reassess an unverified case.

## Architecture decisions

### 1. Use a case-local capture context

`rooty case start` creates the case directory outside the investigated project and returns a short-lived capture-context file. Rooty's installed launcher receives the path through a dedicated Rooty control variable or an explicit launcher argument. The provider child process must not receive the control value.

The context identifies:

- case ID and case directory;
- investigated project fingerprint;
- selected host and host-config generation;
- environment ID and environment-profile hash;
- provider instance IDs and reviewed configuration hashes;
- allowed tool names and allowlist hash;
- most recent successful doctor verification;
- capture policy and schema version.

Changing the active environment or rendered MCP configuration invalidates the context. The investigation must then stop, or the user must start a new case. A case cannot silently span environments or provider generations.

### 2. Separate receipts, evidence, and analysis

These artifacts answer different questions:

| Artifact | Purpose | Authoritative producer |
|---|---|---|
| Receipt | Proves which provider/tool invocation occurred and what bounded payload was returned | Rooty launcher or an explicitly graded fallback recorder |
| Evidence | States a concise observation and cites the receipt or qualified source that supports it | Agent through Rooty's validated CLI |
| Analysis | Connects observations into hypotheses, alternatives, first bad state, and a causal chain | Agent through Rooty's validated CLI |
| Verification | Recomputes integrity, provenance, environment consistency, and stopping rules | Rooty deterministic engine |
| Report | Presents the verified result without changing it | Rooty deterministic renderer |

Analysis never upgrades the capture grade of evidence. Report rendering never trusts a status supplied by the agent.

### 3. Grade capture strength explicitly

Each receipt has one capture grade:

- `VERIFIED`: Rooty's launcher observed the complete request/response boundary and verified the configured provider identity.
- `PROVIDER_ATTESTED`: a provider supplies a signed or independently verifiable receipt accepted by a trusted Rooty recipe.
- `AGENT_RECORDED`: the agent submitted request/response metadata after a call that Rooty did not observe.
- `HUMAN_ATTESTED`: a developer supplied an observation or attachment reference.
- `FIXTURE_VERIFIED`: a frozen, hash-pinned evaluation or demonstration snapshot.

Only `VERIFIED`, accepted `PROVIDER_ATTESTED`, and `FIXTURE_VERIFIED` receipts can support `OBSERVED` evidence eligible for `CONFIRMED`. `AGENT_RECORDED` and `HUMAN_ATTESTED` remain useful for `REPORTED`, hypothesis generation, and `PROBABLE` outcomes, but cannot independently confirm a causal link.

### 4. Keep capture token-efficient

Receipt creation is runtime bookkeeping and must occur without another model turn or tool call. The launcher returns only a compact capture envelope alongside the normal provider result:

```json
{
  "rooty_receipt_id": "R17",
  "capture_grade": "VERIFIED",
  "provider": "rooty-production-observability",
  "tool": "logs_search",
  "event_time_coverage": "2026-08-14T11:00:00Z/2026-08-14T11:10:00Z",
  "result": "<normal bounded provider result>"
}
```

The full receipt metadata and any permitted response cache stay on disk. Evidence shown to the model defaults to a compact view containing IDs, classifications, one-line observations, event-time ranges, source identity, and limitations.

Two separate limits are required:

- `max_capture_bytes`: maximum response bytes retained outside model context;
- `max_model_visible_chars`: maximum extract returned or displayed to the agent.

Pagination must create linked receipts rather than one unbounded aggregate. Repeated listing and status commands use compact output by default, with explicit `--verbose` or `--json` access for diagnostics.

## Case state model

The persisted state machine is:

```text
OPEN
  -> EVIDENCE_COLLECTION
  -> ANALYSIS_SUBMITTED
  -> VERIFIED
  -> FINALIZED

OPEN | EVIDENCE_COLLECTION | ANALYSIS_SUBMITTED
  -> ABANDONED

Any active state
  -> BLOCKED when deterministic readiness or integrity checks fail
```

Rules:

- `OPEN` is created only after project, case-path, environment, and provider preflight succeeds.
- The first receipt or evidence entry advances the case to `EVIDENCE_COLLECTION`.
- `analysis submit` writes a new immutable analysis revision and advances to `ANALYSIS_SUBMITTED`.
- `case verify` recomputes all ledgers and assessment; success advances to `VERIFIED` even when the outcome is `PROBABLE` or `INCONCLUSIVE`.
- `case finalize` writes the deterministic report and advances to `FINALIZED`.
- New evidence after analysis invalidates the submitted verification and requires a new analysis revision.
- `BLOCKED` records a reason; it does not erase evidence or imply investigation failure.
- `ABANDONED` is explicit and irreversible, but the case remains verifiable as an incomplete record.

## Persisted case layout

```text
<case-dir>/
├── case.json
├── events.ndjson
├── receipts.ndjson
├── evidence.ndjson
├── hypotheses.json
├── analysis.json
├── verification.json
├── report.md
├── extracts/
└── .rooty-case.lock
```

- `case.json` contains stable identity, locked configuration fingerprints, current state, and revision pointers.
- `events.ndjson` records state transitions and invalidations.
- `receipts.ndjson` is the append-only hash chain for provider calls.
- `evidence.ndjson` remains the append-only observation hash chain.
- `hypotheses.json` stores current working hypotheses and may change during collection; it is not evidence.
- `analysis.json` contains immutable numbered submissions or a document containing immutable revisions.
- `verification.json` contains the engine-calculated result, validation failures, ledger heads, and exact input fingerprints.
- `extracts/` contains optional bounded, redacted response fragments addressed by content hash.
- `.rooty-case.lock` provides single-writer coordination and contains no evidence.

Case directories remain outside the investigated source tree. Runtime capture paths are excluded from version control.

## Schemas

All new documents start at schema version 1. JSON Schemas are published under `skill/root-cause-investigator/references/schemas/`, but the runtime validator remains the executable source of truth and is tested against those schemas.

### Case header

Required fields:

```json
{
  "schema_version": 1,
  "case_id": "INV-20260828-ABC123",
  "state": "OPEN",
  "created_at": "2026-08-28T10:00:00Z",
  "project": {
    "name": "Rooty",
    "root_fingerprint": "sha256:..."
  },
  "ticket": {
    "id": "ROOTY-123",
    "source": "jira"
  },
  "host": {
    "id": "codex",
    "config_generation": "sha256:..."
  },
  "environment": {
    "id": "production",
    "profile_hash": "sha256:..."
  },
  "providers": [
    {
      "instance_id": "rooty-production-observability",
      "capability": "observability",
      "configuration_hash": "sha256:...",
      "allowlist_hash": "sha256:..."
    }
  ],
  "doctor": {
    "verified_at": "2026-08-28T09:58:00Z",
    "verification_hash": "sha256:..."
  },
  "capture_policy": {
    "max_capture_bytes": 1048576,
    "max_model_visible_chars": 12000,
    "retention": "case"
  }
}
```

The exact default limits must be established by tests and documented. The example values are design inputs, not final defaults.

### Provider receipt

Required fields:

```json
{
  "schema_version": 1,
  "receipt_id": "R17",
  "case_id": "INV-20260828-ABC123",
  "capture_grade": "VERIFIED",
  "provider_instance_id": "rooty-production-observability",
  "capability": "observability",
  "environment": "production",
  "tool": "logs_search",
  "request": {
    "canonical_hash": "sha256:...",
    "bounds": {
      "from": "2026-08-14T11:00:00Z",
      "to": "2026-08-14T11:10:00Z",
      "limit": 100
    }
  },
  "response": {
    "canonical_hash": "sha256:...",
    "bytes_seen": 48321,
    "bytes_retained": 48321,
    "truncated": false,
    "sampled": false,
    "page": 1,
    "next_receipt_id": null,
    "is_error": false
  },
  "event_time_coverage": "2026-08-14T11:00:00Z/2026-08-14T11:10:00Z",
  "started_at": "2026-08-28T10:04:01Z",
  "completed_at": "2026-08-28T10:04:02Z",
  "configuration_hash": "sha256:...",
  "allowlist_hash": "sha256:...",
  "previous_hash": "sha256:...",
  "entry_hash": "sha256:..."
}
```

Request metadata must retain the useful query or locator after secret-field redaction. The canonical hash is calculated before any display truncation. The stored response can be omitted by policy while its hash, byte count, and limitations remain recorded.

### Evidence entry extension

Keep the current required observation fields and add:

```json
{
  "receipt_refs": ["R17"],
  "selector": {
    "kind": "json-pointer",
    "value": "/result/content/0"
  },
  "capture_grade": "VERIFIED",
  "content_hash": "sha256:..."
}
```

Rules:

- `OBSERVED` requires at least one eligible `receipt_ref`, except for an explicitly defined non-provider source class such as a local source-code locator with a content hash.
- Every receipt must exist, have an intact chain, match the case and locked environment, and predate the evidence entry.
- The evidence `capture_grade` is calculated as the weakest referenced grade; callers cannot set or upgrade it.
- The selector must resolve inside the retained payload or a content-addressed extract when validation depends on exact content.
- Missing, truncated, sampled, expired, or redacted content is reflected in `limitations` and may create a critical gap.
- Cross-case and cross-environment references are rejected.

### Analysis submission

The agent submits semantic conclusions separately:

```json
{
  "schema_version": 1,
  "revision": 1,
  "root_cause": "...",
  "trigger": "...",
  "first_bad_state": "...",
  "contributing_conditions": [],
  "causal_chain": [
    {
      "step": "...",
      "evidence_refs": ["E4"]
    }
  ],
  "competing_hypotheses": [
    {
      "statement": "...",
      "status": "eliminated",
      "evidence_refs": ["E7"]
    }
  ],
  "reproduction": {
    "status": "not_attempted",
    "evidence_refs": []
  },
  "evidence_gaps": [],
  "handoff_notes": []
}
```

The submitted document contains no caller-supplied final status.

## CLI contract

### Start and inspect a case

```console
rooty case start \
  --ticket ROOTY-123 \
  --environment production \
  --host codex \
  --project /path/to/project \
  --case-dir /safe/rooty-cases/ROOTY-123

rooty case status --case-dir /safe/rooty-cases/ROOTY-123
rooty case status --case-dir /safe/rooty-cases/ROOTY-123 --json
```

`case start` performs a current doctor check or accepts only a recent, matching verification artifact. It never activates, changes, or repairs providers implicitly.

### Record fallback receipts

```console
rooty receipt add \
  --case-dir /safe/rooty-cases/ROOTY-123 \
  --file agent-recorded-receipt.json

rooty receipt list --case-dir /safe/rooty-cases/ROOTY-123
rooty receipt show R17 --case-dir /safe/rooty-cases/ROOTY-123
```

Manual recording always receives `AGENT_RECORDED` unless a trusted provider-attestation validator upgrades it. The default list/show output is compact.

### Add evidence and analysis

```console
rooty evidence add \
  --case-dir /safe/rooty-cases/ROOTY-123 \
  --file evidence-E4.json

rooty evidence list --case-dir /safe/rooty-cases/ROOTY-123

rooty analysis submit \
  --case-dir /safe/rooty-cases/ROOTY-123 \
  --file analysis.json
```

`evidence add` resolves receipt references and calculates provenance fields. `evidence list` shows compact one-line entries unless `--json` is requested.

### Verify and finalize

```console
rooty case verify --case-dir /safe/rooty-cases/ROOTY-123
rooty case finalize --case-dir /safe/rooty-cases/ROOTY-123
rooty report --case-dir /safe/rooty-cases/ROOTY-123
rooty case abandon --case-dir /safe/rooty-cases/ROOTY-123 --reason "incident superseded"
```

`case verify` writes `verification.json`; `case finalize` requires a current verification whose input hashes still match. The existing `report` command remains as a compatibility alias that verifies before rendering.

## Deterministic verification rules

Rooty verifies all of the following before calculating an outcome:

### Integrity and identity

- Case, event, receipt, and evidence documents satisfy their runtime schemas.
- Receipt and evidence sequence numbers and hash chains are intact.
- Analysis revision and verification fingerprints match the current ledger heads.
- Receipt IDs and evidence IDs are unique.
- Referenced receipts and evidence exist and predate their consumers.
- All provider receipts match the locked case, environment, configuration, and allowlist hashes.
- The host configuration generation and environment profile did not change during the case.
- The readiness verification is successful, matching, and within the configured freshness window.

### Evidence semantics

- Times are valid RFC 3339 instants or bounded intervals with start not after end.
- Retrieval time is not silently substituted for event time.
- Pagination, sampling, truncation, redaction, retention gaps, and errors are represented.
- An `OBSERVED` provider claim has an eligible capture grade and a resolvable receipt relationship.
- One response duplicated into several evidence entries does not count as independent corroboration.
- Independent corroboration requires distinct provider channels, independently collected source types, or a defined reproduction; two labels for the same backend do not qualify.
- Contradictory eligible evidence remains visible and blocks `CONFIRMED` until addressed.

### `CONFIRMED` stopping rule

`CONFIRMED` requires:

- a non-empty root cause and first bad state;
- every material causal step supported by eligible `OBSERVED` evidence;
- distinct support for each causal step, with shared receipts counted once;
- independent corroboration or a qualifying reproduction;
- every competing material hypothesis tested and eliminated or contradicted by eligible evidence;
- no unresolved critical gaps;
- no unexplained conflicting evidence;
- unchanged locked environment and provider identities;
- complete required response content, or a determination that truncation/sampling cannot affect the conclusion.

If a root cause is the best supported explanation but any confirmation condition is missing, the maximum outcome is `PROBABLE`. Without enough support to name a best-fit cause, the outcome is `INCONCLUSIVE`.

## Launcher capture design

### STDIO providers

Extend `.rooty/start-mcp.cjs` into a transparent JSON-RPC relay when a valid capture context is present:

1. Parse framed MCP messages without changing IDs, ordering, or payload semantics.
2. Track `tools/call` requests until the matching response or transport failure.
3. Confirm that the tool is in the locked allowlist.
4. Redact declared secret fields before hashing or storage according to the canonical policy.
5. Enforce response-size and model-visible limits.
6. Append one receipt atomically.
7. Add the compact receipt metadata to the returned result in a protocol-compatible form defined and tested per supported MCP version.
8. Forward the result without otherwise changing provider content.

Initialization, notifications, `tools/list`, and doctor probes may create operational audit events, but they do not become case evidence receipts unless explicitly requested by the investigation.

### HTTP providers

For HTTP MCP, the launcher performs the same correlation and receipt behavior while also enforcing:

- HTTPS for non-loopback resolved endpoints;
- explicit connect, headers, body, and total timeouts;
- response byte limits;
- bounded redirect policy with scheme and host revalidation;
- no credentials in URLs;
- redaction of authorization and declared secret headers;
- protocol/session-header validation.

This remains a narrow project-local launcher, not a general gateway.

### Failure behavior

- Provider success plus receipt-write failure returns a visible capture failure; it must not silently present the result as verified evidence.
- Provider timeout, malformed response, transport exit, and explicit MCP error each create a receipt with `is_error: true` when enough identity is available.
- A result that exceeds the retention limit is marked truncated and includes byte counts and a full-stream hash only if it can be computed safely while streaming.
- A stale or mismatched capture context prevents verified capture and tells the agent to re-run case readiness.
- Receipt writing never blocks indefinitely; lock acquisition has a bounded timeout and actionable error.

## Concurrency and atomicity

The current read-verify-append sequence is vulnerable to concurrent writers. Introduce a reusable case-store module with:

- an exclusive, bounded single-writer lock per case;
- owner PID, creation time, and nonce in the lock record;
- stale-lock recovery only after process-liveness and age checks;
- verify-under-lock before append;
- append plus flush behavior appropriate to the platform;
- atomic temporary-file plus rename for replaceable JSON documents;
- deterministic conflict errors rather than silent retries that could duplicate calls;
- Windows path-casing, junction, and process-liveness tests.

The same store must be used by receipts, evidence, events, analysis submissions, verification, finalization, and compatibility snapshot import.

## Secret and data handling

- Launch provider children with a minimal allowlisted environment assembled from runtime essentials plus explicitly declared provider bindings. Do not inherit the complete `process.env`.
- Strip Rooty capture-control values before spawning provider children.
- Redact secrets before persistence and before error messages are constructed.
- Maintain a schema-aware redaction list for authorization fields, tokens, passwords, connection strings, cookies, and provider-declared secret paths.
- Hash only the canonical redacted representation used for evidence verification; do not retain a secret-derived raw hash that could aid offline guessing.
- Default response retention to the minimum needed for selector verification. Provider recipes may declare stricter retention or no-body storage.
- Never include raw retained bodies in normal CLI output, reports, approved memory, handoff proposals, or session reviews.
- Clearly document case-directory sensitivity and leave deletion to the user's incident-data retention process.

## Implementation phases

### Phase 0: prerequisites and executable contracts

Deliverables:

- Define runtime validators for case header, receipt, evidence extension, analysis, and verification.
- Correct evidence time validation to parse both bounds as RFC 3339 instants and reject inverted or unbounded ranges.
- Introduce canonical provider instance, configuration, allowlist, environment-profile, and host-generation fingerprints.
- Add typed identity verification artifacts from `rooty doctor`; stop relying on response-string containment for new live cases.
- Isolate provider child environments and add HTTP transport bounds needed by verified capture.
- Specify model-visible and capture byte defaults through fixtures and tests.

Exit gate: a case can lock a typed, recently verified environment/provider identity without inspecting or persisting a credential value.

### Phase 1: live case MVP with graded manual receipts

Deliverables:

- Add `src/lib/case-store.js` for locking, atomic state writes, and append-only ledgers.
- Refactor `src/lib/cases.js` to use the case store without breaking frozen cases.
- Add `case start`, `case status`, `case abandon`, and compact JSON output.
- Add receipt ledger validation and `receipt add/list/show`.
- Extend `evidence add/list` with receipt relationships and calculated grades.
- Add `analysis submit`, case invalidation, and immutable revisions.
- Add `case verify` and `case finalize`.
- Update the investigator skill to start/resume a case and use the calculated outcome.

MVP limitation: unobserved live provider calls are `AGENT_RECORDED`, so they can support organization and a `PROBABLE` result but cannot alone produce `CONFIRMED`.

Exit gate: a complete live investigation can be persisted, resumed, verified, and reported with honest provenance grading.

### Phase 2: automatic verified launcher receipts

Deliverables:

- Add capture-context creation, expiration, and invalidation.
- Implement STDIO JSON-RPC request/response correlation in the launcher.
- Implement bounded HTTP MCP capture with strict endpoint policy.
- Append verified receipts without an extra model call.
- Return compact receipt IDs in a protocol-compatible result envelope.
- Support paging links, errors, partial results, truncation, and bounded extracts.
- Add `receipt show --extract` with explicit bounded display.

Exit gate: every material call through a supported Rooty launcher automatically produces an integrity-checked `VERIFIED` receipt, and capture failure is never silent.

### Phase 3: stronger assessment and downstream governance

Deliverables:

- Replace caller-trusted evidence labels with provenance-derived eligibility in `assessCase`.
- Count corroboration by independent receipt/provider lineage, not only source strings.
- Detect contradictions, reused receipts, invalid temporal relationships, and material truncation.
- Make report, memory proposal, and case handoff consume only current `verification.json` plus matching ledger heads.
- Prevent supplied `rca.status` or stale `case.json.assessment` from bypassing verification.
- Migrate schema-version-1 frozen cases to `FIXTURE_VERIFIED` compatibility receipts in memory, or handle them through an explicit compatibility verifier without rewriting their files.

Exit gate: no downstream feature can treat a case as confirmed unless deterministic verification currently proves it.

### Phase 4: real live-investigation evaluation

Deliverables:

- Build scripted fake MCP providers for success, timeout, pagination, truncation, malformed data, injection text, and identity mismatch.
- Run the installed investigator skill through representative host-agent sessions where supported.
- Grade tool selection, receipt coverage, evidence relationships, analysis quality, and final stopping rule.
- Measure total model-visible characters and tool calls against an uncaptured baseline.
- Retain deterministic fixture tests as unit coverage, but label them separately from agent evaluations.

Exit gate: the live workflow meets safety, correctness, and token-efficiency thresholds in repeatable end-to-end evaluation.

## Expected code changes

| Area | Planned change |
|---|---|
| `src/lib/case-store.js` | New lock, atomic document, ledger append, and content-addressed extract primitives |
| `src/lib/cases.js` | Live lifecycle, strict validation, provenance-aware assessment, compatibility import |
| `src/lib/receipts.js` | New receipt schema, redaction, hashing, listing, and verification |
| `src/lib/analysis.js` | New immutable submission validation and revision handling |
| `src/lib/doctor.js` | Typed identity artifact with freshness and configuration fingerprints |
| `src/lib/environments.js` | Stable environment/profile and host-generation fingerprints |
| `src/cli.js` | New case, receipt, evidence-list, and analysis commands |
| `skill/rooty-mcp-builder/assets/start-mcp.cjs` | Minimal environment, STDIO/HTTP relay, automatic capture, limits, and failure behavior |
| `src/lib/installer.js` | Install updated launcher and required ignored runtime paths safely |
| `skill/root-cause-investigator/SKILL.md` | Live case workflow and no-self-confirmation rule |
| `skill/root-cause-investigator/references/` | Case, receipt, evidence, and analysis contracts plus compact-use guidance |
| `src/lib/memory.js` | Require current case verification for promotion |
| `skill/rooty-case-handoff/` | Require current verified case input rather than caller-supplied status |
| `docs/` | CLI, architecture, evidence, security, troubleshooting, and migration documentation |
| `tests/` and `evals/` | Unit, integration, adversarial, compatibility, concurrency, and token-efficiency coverage |

Names may be consolidated during implementation if cohesion is clearer, but the responsibility boundaries must remain.

## Test matrix

### Unit tests

- Every schema accepts valid minimal and complete documents and rejects unknown security-sensitive fields.
- Time intervals reject invalid timestamps, missing bounds, inverted ranges, and ambiguous local time.
- Receipt hashes are stable across object-key order and never include secret values.
- Evidence grade is derived from receipts and cannot be upgraded by input.
- Assessment does not count the same receipt twice as independent support.
- Configuration and allowlist fingerprints change only when their canonical inputs change.
- Compact list output respects model-visible limits.

### Integration tests

- Start, collect, submit, verify, finalize, and resume a live case.
- STDIO calls create correlated receipts without altering JSON-RPC semantics.
- HTTP calls enforce TLS, redirects, timeouts, response limits, and session headers.
- Pagination creates linked receipts and preserves aggregate limitations.
- Receipt-write failure is visible to the caller.
- Evidence appended after analysis invalidates verification and requires resubmission.
- Report, memory, and handoff reject stale or missing verification.
- Frozen schema-version-1 cases continue to render and evaluate consistently.

### Adversarial tests

- Provider content attempts to instruct the agent or forge a receipt ID.
- Request, response, header, error, and environment values contain credential canaries.
- An agent submits a fabricated `VERIFIED` receipt or `CONFIRMED` status.
- Receipt points to another case, provider, configuration generation, or environment.
- Provider tool changes after case start.
- Response is truncated exactly at multibyte and JSON boundaries.
- Concurrent receipt/evidence writers race for the same sequence.
- Lock file is stale, live, malformed, junction-addressed, or path-case aliased on Windows.
- Ledger line is edited, deleted, reordered, duplicated, or appended without the lock.

### Token-efficiency tests

- Automatic capture adds no extra model tool call per provider observation.
- Compact receipt metadata stays below its defined character budget.
- `receipt list`, `evidence list`, and `case status` are compact by default.
- Raw retained responses never appear in standard status, verification, report, memory, or handoff output.
- A representative investigation uses no more model-visible provider content than the same bounded provider calls without capture, excluding the small receipt envelope.
- A repeated/resumed investigation demonstrates reduced restatement by using receipt and evidence IDs.

### Packaging and regression tests

- `npm test` passes on supported platforms.
- Package doctor is ready.
- Existing 15-case deterministic replay remains green and is clearly labeled as fixture evaluation.
- `npm pack --dry-run` includes the updated skills, schemas, launcher, and documentation, and excludes runtime cases and extracts.
- Clean tarball install produces the same launcher as the package source.

## Observability of Rooty itself

Rooty may record operational counters without provider content:

- calls captured, failed, truncated, sampled, or rejected;
- receipt and evidence append latency;
- lock contention and stale-lock recovery;
- compact versus retained byte counts;
- verification failures by rule;
- model-visible character estimates for Rooty-generated context.

Telemetry is local and opt-in unless a later product decision explicitly changes that policy. No credentials, queries, response bodies, ticket contents, or case conclusions are emitted.

## Migration and compatibility

- Keep `rooty run <ticket> --snapshot` working.
- Keep `rooty evidence add` working for schema-version-1 frozen cases under existing rules.
- Treat old frozen observations as `FIXTURE_VERIFIED` only inside the compatibility path; do not relabel arbitrary historical live evidence.
- `rooty report` detects the case schema and selects the appropriate verifier.
- New cases use the live schema and never store the calculated assessment as an unquestioned source of truth.
- Do not rewrite existing ledgers in place. Any explicit migration writes a new case directory and records source hashes.
- Installer upgrades preserve locally modified/unowned launcher files by failing safely and explaining the required repair.

## Documentation updates

Update these documents when the corresponding behavior ships:

- `docs/getting-started.md`: start the first live case.
- `docs/investigation.md`: revised skill workflow and state transitions.
- `docs/evidence-and-reporting.md`: receipts, capture grades, selectors, and stopping rules.
- `docs/architecture.md`: capture boundary and deterministic verification.
- `docs/security.md`: child-environment isolation, redaction, retention, and HTTP limits.
- `docs/cli-reference.md`: all new commands and exit codes.
- `docs/troubleshooting.md`: stale contexts, lock conflicts, truncation, capture failure, and invalid verification.
- `docs/development.md`: fixtures, fake providers, schema synchronization, and token-efficiency tests.

## Release strategy

- Ship Phase 1 behind an explicit live-case workflow without claiming verified capture.
- Mark `AGENT_RECORDED` prominently in CLI and reports.
- Enable verified capture only for provider/transport combinations that pass the complete integration and adversarial suite.
- Fail closed to a lower capture grade when a transport cannot be observed; never silently label it verified.
- Add a format version and feature capability list to `rooty --version --json` before third-party integrations depend on the contract.
- Document any supported-host differences and do not claim parity until each host path is tested.

## Completion gates

The feature is complete only when:

- a live case can be started, resumed, verified, finalized, and independently inspected;
- every material supported-provider call automatically creates a verifiable receipt without an extra model call;
- evidence cannot claim stronger provenance than its receipts;
- environment, provider, host generation, and tool allowlist remain locked;
- concurrent writes cannot corrupt or fork a ledger;
- invalid time ranges, fabricated grades, cross-case references, stale verification, contradictions, and tampering fail deterministically;
- no secret canary appears in cases, logs, reports, CLI errors, memory, handoffs, or child environments outside declared bindings;
- `CONFIRMED` cannot be supplied or bypassed by agent-authored fields;
- the compact workflow meets the defined token-efficiency budget;
- compatibility, unit, integration, adversarial, packaging, and live-agent evaluation gates pass.

## Recommended implementation order

1. Case store, schemas, strict time validation, typed fingerprints, and secret-safe provider spawning.
2. Live case lifecycle with graded manual receipts and deterministic verification.
3. Automatic STDIO capture, followed by bounded HTTP capture.
4. Provenance-aware confirmation rules and downstream enforcement.
5. Real agent evaluation and measured token-efficiency validation.

Do not begin downstream handoff or memory integration until current-case verification is authoritative. Do not enable `VERIFIED` capture for a provider merely because a receipt file exists; the transport boundary and provider identity must both be proven.
