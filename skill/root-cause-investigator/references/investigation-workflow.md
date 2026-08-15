# Investigation workflow

## Preflight

Establish a case ID, source registry, environment boundary, external identity, and evidence ledger. Refuse if the requested operation requires mutation. State access and retention gaps early.

## Intake and path map

Extract actors, tenants, entities, event time/timezone, environment, expected/observed behavior, frequency, scope, request/correlation/trace/session IDs, and relevant change windows. Map only the relevant entry point, services, queues, downstream calls, persistence, and response mapping. State the invariant at each boundary.

## Hypothesis ledger

Record an ID, statement, status, predictions, and bounded tests. Status is one of `untested`, `supported`, `contradicted`, `eliminated`, or `confirmed`. Do not use "confirmed" until the final stopping rule passes.

## Evidence acquisition

Start with the narrowest exact pivot. Expand the time window deliberately and never beyond connector limits without separate authorization. Prefer independently corroborating sources. For databases, label current state, incident-time history/audit/CDC, or derived state.

## First bad state and falsification

Walk boundaries in order and compare expected versus observed values. Identify the earliest verified divergence, then show propagation. Test the strongest alternative and whether the suspected condition occurs in successful requests. Verify incident-time version, deployment, configuration, and feature flags.

## Stopping rule

- `CONFIRMED`: every material causal link has distinct `OBSERVED` support; one observation cannot stand in for multiple links; the first bad state and propagation are shown; every eliminated material alternative is supported by `OBSERVED` evidence; evidence is reproducible or independently corroborated across source systems or source types; no critical proof is missing.
- `PROBABLE`: one explanation best fits observed evidence, but explicitly named critical corroboration is missing.
- `INCONCLUSIVE`: evidence is unavailable, expired, sampled, contradictory, or insufficient to prefer a causal explanation.

When confirmation relies on reproduction instead of independent source/type corroboration, record `analysis.reproduction.status` as `reproduced` and cite at least two distinct `OBSERVED` evidence IDs in `analysis.reproduction.evidence_refs`. A claimed reproduction without those current-case observations does not satisfy the stopping rule.

Do not report numeric confidence. State proven, inferred, missing, and what evidence would change the outcome.
