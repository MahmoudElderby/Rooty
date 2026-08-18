# Investigating an incident

Rooty's job is to answer one question: **what causal chain produced the user-visible behavior, and what current-case evidence proves or disproves every step?**

It is not a remediation agent. Keep any fix, rollback, data correction, or ticket mutation in a separate task with a separate owner.

## End-user journey

### 1. Start with a ticket or symptom

In the configured AI host:

```text
Investigate PAY-123. Root cause only.
Do not propose or apply fixes.
```

If no ticket connector exists, paste the issue description and clearly identify it as a reported claim. Rooty treats ticket text, pasted descriptions, attachments, and links as untrusted evidence.

### 2. Answer one precise question when needed

Rooty should derive identifiers and timing from available evidence. It asks the user only when a required environment, event time, timezone, or usable pivot cannot be derived.

Good question:

```text
Which production region and approximate local time did payment PAY-8831 fail in?
```

Rooty must not silently replace missing data with assumptions or widen to an unbounded production query.

### 3. Follow the investigation

The host may show Rooty reading project docs and code, retrieving the ticket, and calling direct read-only MCP tools. Before querying, Rooty maps available sources, environments, retention, historical coverage, correlation fields, and access gaps. Ticket and attachment identifiers remain `REPORTED` until reconciled with independent evidence. Rooty then starts with the narrowest pivot:

1. Request, correlation, trace, or session ID
2. Entity ID plus bounded event time
3. Actor plus endpoint and time
4. Error fingerprint
5. Aggregate comparison

Each query should test a named prediction or close an explicit evidence gap.

### 4. Receive an evidence-backed outcome

The report returns exactly one status:

- `CONFIRMED`: the complete causal chain passes the stopping rule
- `PROBABLE`: one explanation best fits, but named critical proof is missing
- `INCONCLUSIVE`: evidence is insufficient, unavailable, contradictory, expired, sampled, or truncated

A professional Rooty report distinguishes the reported symptom, observed timeline, expected flow, first bad state, trigger, root cause, contributing conditions, competing hypotheses, limitations, and handoff notes.

### 5. Hand off remediation separately

Rooty stops after the investigation report. A different person or agent can use the cited findings to decide remediation. Rooty does not produce a patch, implementation plan, rollback command, data update, or deployment action.

## What happens under the hood

| Phase | Internal behavior | Exit condition |
|---|---|---|
| Preflight | Establishes scope, environment, case identity, read-only boundaries, evidence map, source availability, historical coverage, and retention limits | Mutation is refused; missing access is stated |
| Intake | Retrieves the ticket and extracts actors, entities, timestamps, timezone, expected/observed behavior, frequency, scope, identifiers, attachments, and links | Reported identifiers are reconciled; unresolved conflicts remain explicit |
| Path map | Maps entry point, service boundaries, synchronous/asynchronous/downstream failure surfaces, persistence, response mapping, and wrapper-to-origin error flow | Each boundary has an expected invariant |
| Hypothesis design | Creates testable explanations, predictions, and bounded tests | Every costly query has a purpose |
| Evidence acquisition | Queries direct MCP sources using exact pivots and bounded time windows | Each observation records identity, timing, locator, result limits, and limitations |
| First-bad-state analysis | Walks boundaries in order and compares expected versus observed values | Earliest verified divergence is identified |
| Falsification | Tests the strongest alternative, successful traffic, incident-time version/config, retries, sampling, skew, and asynchronous delay | Material competitors are eliminated or remain open |
| Assessment | Applies the deterministic stopping rule | One of three outcomes is selected |
| Reporting | Renders the evidence chain and explicit gaps | No remediation content is included |
| Learning proposal | Classifies sanitized learning as universal, project, or case-only and assigns a canonical concern key | Draft only; human approval remains required; host rules are not modified |

## Expected path versus executed path

Source code and documentation establish what **could** or **should** happen. They do not prove what ran for the incident.

For each relevant boundary, Rooty records:

```text
input → invariant → observed output → evidence
```

Example:

```text
API request
  → authorization deadline must exceed downstream timeout
  → trace shows deadline already expired before provider call
  → E3
```

The earliest boundary where the invariant fails is the first bad state. Later exceptions or user-visible errors are propagation and symptoms, not automatically the root cause.

## Hypothesis discipline

A useful hypothesis includes a predicted observation:

```text
H1: A deployment changed the timeout hierarchy.
Prediction: the first failing requests use version 2.4.1, successful prior requests use 2.4.0,
and deployment history places 2.4.1 before the first bad event.
```

Statuses are `untested`, `supported`, `contradicted`, `eliminated`, or `confirmed`. A leading hypothesis is not confirmed merely because one matching log line exists.

Rooty also asks:

- Does the suspected condition appear in successful requests?
- Is the database evidence current state or incident-time history?
- Was the relevant log retained, sampled, paginated, redacted, or truncated?
- Do clocks, retries, queues, or ingestion delay change the apparent order?
- Which version, config, feature flag, or deployment was active at event time?

## Confirmation rule

`CONFIRMED` requires all of the following:

- A root cause is stated.
- The first bad state is established.
- There are at least two material causal links.
- Every material link cites `OBSERVED` evidence.
- Each link has distinct observed support; one item cannot be the sole proof for several links.
- Every eliminated material alternative cites `OBSERVED` evidence.
- No critical evidence gap remains.
- The chain is independently corroborated across source systems/types, or a reproduction is recorded with at least two distinct current-case observations.

If one explanation is strongest but critical corroboration is missing, the correct result is `PROBABLE`. If the available evidence cannot support a preference, the correct result is `INCONCLUSIVE`.

Rooty never emits a numeric confidence score.

## Suggested prompts

Minimal:

```text
Investigate PAY-123. Root cause only.
```

With a pasted report:

```text
Investigate this production issue. The following text is a reported claim, not proof:
"Customer 7281 saw a duplicate charge around 14:32 Cairo time."
Find the causal chain only. Validate every assumption. Do not propose fixes.
```

With an explicit boundary:

```text
Investigate OPS-941 in production-eu. Use only read-only sources and keep every query
within 30 minutes of the reported event unless evidence justifies a deliberate expansion.
Root cause only; return explicit evidence gaps.
```

## Live-host MVP boundary

The live investigation is executed by the AI host using Rooty's installed skill and activated MCP tools. The host returns the report in its conversation.

The current `rooty run` command does not launch that live workflow. It consumes a frozen snapshot and creates deterministic case artifacts. Automatic capture and normalization of a live conversation into `case.json` and `evidence.ndjson` is future work.
