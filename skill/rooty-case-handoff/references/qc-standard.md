# QC drafting standard

Apply these ISTQB and ISO/IEC/IEEE 29119-aligned principles:

- Clarity: one observable action per numbered step; remove ambiguous words such as "works" or "correctly."
- Repeatability: state environment, version, preconditions, sanitized data, deterministic identifiers, timing bounds, and cleanup.
- Expected results: every step has a concrete visible or machine-observable result and expected telemetry when telemetry exists.
- Traceability: connect requirements, risks, steps, and expected results to the source ticket and RCA evidence IDs.
- Risk priority: identify user, operational, data, security, performance, and cost risks without inventing severity.
- Independence: keep the case neutral and reviewable by a tester who did not perform the RCA.
- Safe state: use non-production or approved test-safe data; do not include credentials or personal information.

The case is a design artifact only. `DRAFT` means independent review is outstanding. `NOT_RUN` means no reproduction claim may be made from this artifact.

