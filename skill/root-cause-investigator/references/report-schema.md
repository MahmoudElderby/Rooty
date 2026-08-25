# Report schema

Write these sections in order:

1. Investigation status: exactly `CONFIRMED`, `PROBABLE`, or `INCONCLUSIVE`.
2. Reported symptom: distinguish ticket claims from corroborated scope.
3. Confirmed scope and event timeline: UTC plus original timezone where relevant.
4. Expected request/data flow: compact boundary map and invariants.
5. Root cause, trigger, first bad state, and contributing conditions.
6. Causal chain: ordered links, each citing evidence IDs.
7. Evidence table: classification, source, environment, event time, retrieval time, query/locator/permalink, observation, and limitation.
8. Competing hypotheses: tests and why each was eliminated or remains open.
9. Evidence gaps and access, retention, sampling, redaction, or historical-state limitations.
10. Handoff notes for a separate remediation owner.
11. Proposed reusable learning card marked `draft`, with `scope`, `kind`, `canonical_key`, reusable statement, applicability, evidence references, and proposed disposition. Use `universal -> upstream_proposal`, `project -> project_memory`, or `case_only -> case_notes`. Do not name a host rule file.
12. For ticket-based `CONFIRMED` only, a one-line optional handoff prompt asking whether to invoke `$rooty-case-handoff`. Omit this prompt for `PROBABLE` and `INCONCLUSIVE`.

Omit fix instructions, patches, implementation plans, migration commands, or other remediation. For `INCONCLUSIVE`, do not name a root cause. For `PROBABLE`, name the exact missing proof.
