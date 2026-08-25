# Analysis playbook

Ask the live observability tools provider-neutral questions. Adapt them with [provider-adapters.md](provider-adapters.md). Count leaders and byte leaders frequently differ, so complete all three rankings unless a capability gap is explicit.

## 0. Lock the scope

Translate the request into a scope before expensive work:

| Dimension | Record |
|---|---|
| Environment | Verified active environment |
| Source | Provider dataset or bounded file set |
| Target | Named component, operation, event, response, logger, or family when supplied |
| Layer | Direction or emitting layer when it distinguishes records |
| Time | Requested or justified bounded range |

Use store-wide mode only when the question concerns the whole store. When a target is named, push its verified filters into every aggregation and parser.

For a target-scoped review, measure the parent source only with lightweight compatible totals needed to calculate target share. Keep identity expansion, normalization, payload statistics, daily overlays, and source tracing inside the target. If multiple targets are named, apply equivalent windows and metrics to each.

Report filters, unmatched target terms, and scope coverage. Do not silently widen a target-scoped request because a broad query is easier to express.

## 1. Identify relevant log sources

Identify provider datasets or bounded file sets from observed schema and contents rather than names alone. In target-scoped mode, inspect only enough source metadata to locate and validate the target filters. A source suitable for call-family analysis normally exposes an operation identity, event time, outcome, and payload or record-size signal.

Inventory other material log categories as well. A smaller error or audit source is still a useful negative finding when another source dominates storage.

For every storage metric, record its meaning and scope, including whether it represents logical ingest, billable ingest, payload bytes, physical file bytes, compressed storage, primary storage, archives, or copies. Compare sources directly only when these meanings are compatible.

## 2. Measure the footprint

Record:

| Measure | Purpose |
|---|---|
| Event count | Identify high-frequency families and pipeline load |
| Provider or file storage metrics | Establish retained, billed, or physical volume using the metric's exact semantics |
| Copy, replica, or archive overhead | Separate source data from redundant storage |
| Observed time coverage | Detect incomplete boundaries, gaps, or recent resets |
| Configured retention, when visible | Distinguish policy from observed data age |
| Daily events and bytes | Separate frequency growth from payload growth |
| Raw identity cardinality | Detect high-cardinality identity fields |
| Partition or shard distribution | Detect concentration and routing imbalance |

Do not infer configured retention from the oldest and newest event alone. Do not describe payload-length estimates as actual stored or billed bytes.

## 3. Rank repeated calls

Group by the raw operation identity and retrieve enough leading values to expose meaningful coverage and fragmentation. Record approximation, truncation, or sampling behavior of the provider's grouping operation.

Normalize identities with [identity-normalization.md](identity-normalization.md), re-rank the resulting families, and retain the raw-to-normalized mapping. Keep behavior-changing dimensions separate even when presenting a higher-level parent family.

Segment material families by outcome. High-volume successful events often support different cuts from failures, retries, or rejected requests.

Investigate possible duplicate capture across layers or directions. Similar names or timestamps are signals, not proof that two records represent the same interaction; use correlation evidence when estimating removable duplication.

## 4. Rank payload size

For each family, calculate payload-byte sum, average, and maximum when the provider supports server-side byte measurement. Distinguish byte length from character count, and identify the fields included in the calculation.

Pair payload rankings with provider or physical file storage metrics when possible. Payload bytes explain body-driven opportunities but do not include every storage overhead and may not equal compressed, retained, billable, or on-disk bytes.

Use a bounded window that represents the relevant traffic cycle when full-history computation is impractical. Extrapolate only when the observed family mix is sufficiently stable, and state the window, method, assumptions, and uncertainty.

Look for both cumulative and tail risk:

- high total bytes from frequent moderate records
- high average size from consistently large records
- high maximum size from rare, potentially unbounded records

If the available tools cannot reliably detect low-frequency large records, state that limitation rather than claiming the ranking is complete.

## 5. Rank daily growth

Aggregate event counts and byte metrics by UTC calendar day across the usable coverage window. Overlay at least the leading count family and leading byte family.

Report:

- highest and lowest complete days
- count growth versus byte growth
- whether leading-family shares are stable or changing
- partial boundary days, missing intervals, and known telemetry gaps

Exclude partial days and unexplained gaps from baseline averages, peaks, and floors unless they are explicitly labeled.

## 6. Classify reduction levers

Assign each material family a primary lever based on evidence:

| Lever | Signal | Candidate reduction |
|---|---|---|
| Large successful payloads | High byte contribution with routine successful outcomes | Omit or cap bodies, retain structured metadata, or exclude the operation |
| High-frequency routine events | High count with small records and low diagnostic value | Exclude, sample, aggregate, or lower verbosity |
| Identity fragmentation | Many raw identities collapse into a small number of verified operations | Emit stable operation identities and move variable dimensions into structured fields |
| Duplicate capture | Correlated records describe the same interaction at multiple layers or directions | Retain the most useful representation or reduce detail on the others |
| Rare large records | Low frequency with extreme payload or record size | Cap size and avoid storing bulk or binary content |
| Storage-policy overhead | Retention, copies, tiering, or partitioning dominates avoidable storage | Adjust lifecycle, copy, tier, or routing policy in a later authorized task |

Rank cuts by expected byte reduction, evidence confidence, operational risk, and implementation effort. State overlaps and dependencies so projected savings are not added twice.

## 7. Trace leading families in source

For the leading byte and count families:

1. Find the component that emits the record.
2. Trace its callers and execution trigger, including synchronous, asynchronous, and scheduled paths when present.
3. Determine whether work is batched or repeated per item, and verify this from source or runtime evidence rather than volume alone.
4. Determine whether the recorded response is bounded or grows with the number or size of returned items.
5. Map duplicate logging layers and the configuration controls already available.

Report the verified source chain from trigger to downstream interaction and log sink. Keep uncertain links labeled as hypotheses.

## 8. Stop after reporting

Deliver ranked evidence and recommended cuts only. Any logging, retention, or application change requires a separate implementation task with its own authorization and verification.
