# Identity normalization

Normalization turns volatile raw identities into stable operation families without erasing differences that affect behavior or storage. Derive every rule from the current project's routes, schemas, source, and live evidence; do not carry discovered project rules back into this skill.

## Build a canonical identity

1. Prefer an explicit stable operation key from instrumentation, routing metadata, protocol metadata, or source definitions over a rendered URL or free-text message.
2. Preserve dimensions that materially change behavior, payload size, or diagnostic value. These may include operation or method, direction, version, execution mode, or verified semantic options.
3. Identify volatile components from route templates, schemas, source definitions, or repeated observed structure. Do not assume that a value is an identifier merely because it resembles one.
4. Remove or bucket a variable component only after verifying that doing so does not merge behaviorally distinct operations.
5. Treat request parameters by meaning. Preserve or classify parameters that change result cardinality, response shape, or execution behavior; remove only values verified to be presentation, localization, tracking, or other identity noise.
6. Keep transport direction visible. Related inbound, outbound, gateway, and downstream records may share a parent family, but retain their direction or layer as a subdimension.

## Preserve auditability

Retain a raw-to-canonical mapping with counts and bytes for each member. A normalized ranking without this mapping cannot be reviewed for accidental collisions or unsupported merges.

When multiple raw identities are presented as one parent family:

- show important subdimensions separately
- do not treat similarly named records as duplicate interactions without correlation evidence
- avoid double-counting projected savings across parent and child groups

## Validate the rules

Before relying on a normalized ranking:

1. Inspect representative members of every material family without exposing payload bodies or sensitive identifiers.
2. Check for collisions where distinct source operations were merged.
3. Check for fragmentation where one source operation remains split by volatile values.
4. Compare raw and normalized count and byte coverage.
5. Record uncertain mappings and their effect on the ranking.

Normalization rules belong to the current review's notes or report. The reusable skill retains only this method.
