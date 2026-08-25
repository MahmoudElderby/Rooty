# Provider adapters

Map the playbook onto the active environment's observability tools or approved log files after inspecting their live schemas or record structure. Provider, tool, path, and format details are discovery inputs, not assumptions built into the method.

If more than one log source is active, inventory each relevant provider or bounded file set. Compare their storage values only when metric definitions and scopes are compatible; otherwise report them separately.

## Capability map

Translate the analysis questions to available read-only capabilities:

| Question | Required capability |
|---|---|
| Which sources exist? | List datasets, streams, tables, indices, or approved file sets and rotation families |
| What consumes storage? | Retrieve provider-defined ingest, retained, billed, primary, copy, or usage metrics with their semantics |
| Which fields are usable? | Inspect schema, mappings, field capabilities, or a body-omitted sample |
| Which identities repeat? | Group event count by an operation identity and outcome |
| Which families carry bytes? | Aggregate server-side payload or record byte lengths by family |
| How does volume change daily? | Aggregate counts and compatible byte metrics by UTC day |
| Are records duplicated? | Correlate direction, layer, time, and stable interaction identifiers |

Bound every query or parse by the verified environment, source, time range, and appropriate record or byte limits. Prefer server-side aggregations and field projections over retrieving records.

## Scoped execution

Push verified target dimensions into the provider query or file parser before grouping or measuring payload bytes. Prefer stable structured fields, labels, route metadata, or event types over free-text matching. If only text matching is available, verify its precision with a small body-omitted sample and report likely false matches or misses.

Use separate lightweight aggregations for parent count and compatible parent bytes. Do not retrieve parent records or calculate parent-wide family payload statistics merely to provide context for a scoped review.

For file-based sources, narrow by confirmed file set and time coverage first, then apply record-level target predicates while streaming. Do not use line-oriented prefilters when records may span lines or when doing so would bypass the verified parser. Record the bytes and records scanned as well as the target records matched so efficiency and coverage are visible.

## File-based logs

Treat a confirmed directory, file pattern, or rotation family as a log source. Use paths supplied by the developer or verified from current configuration and documentation. Do not recursively scan broad filesystem roots to discover logs.

Inventory before parsing:

- resolve the bounded file set and record its selection rule
- measure file count, logical file length, and allocated bytes when available without opening every record
- distinguish active files, rotated files, compressed archives, backups, and apparent copies
- record file-size and time distributions to identify skew and choose a representative parsing window
- inspect rotation and retention configuration when available; do not infer policy solely from filenames or modification times

Parse safely:

- detect structure, encoding, timestamp source, record boundaries, and multiline behavior from a small bounded sample
- stream records or bounded chunks instead of loading whole files into memory
- read compressed files as streams and never extract over or beside source files
- treat active files as changing inputs and record the observed cutoff, file size, and analysis time
- count parsed, rejected, and unclassified records; disclose incomplete parsing and its likely effect
- stop and report a capability gap for binary, proprietary, encrypted, or ambiguous formats that cannot be read safely

Use allocated size for physical disk consumption when available. Otherwise report file length as a logical-size measure, not an exact physical-byte value. Keep compressed bytes, uncompressed record bytes, payload bytes, and character counts as separate metrics. When grouping by family, measure encoded record or payload bytes without reproducing the content.

Build daily rankings from event timestamps inside parsed records. File creation, modification, archive, or rotation times are storage-management timestamps and must not be presented as event dates; use them only as an explicitly labeled proxy when no event time exists.

Check for redundant storage across active files, rotations, archives, and backups. Similar names and sizes do not prove duplication; use file identity, verified rotation behavior, or bounded content hashes when available before estimating removable bytes.

## Capability gaps

- **No comparable storage metric:** report provider figures separately. Do not select a global largest store from incompatible units or scopes.
- **No storage-byte metric:** report event counts and, when available, a clearly labeled payload-byte estimate. Do not call the estimate stored or billed bytes.
- **No server-side payload length:** use an existing provider-recorded size field if its meaning is known. Do not fetch payload bodies solely to measure their size; report the byte ranking as unavailable if no safe measure exists.
- **No daily histogram:** run bounded per-day aggregations over a representative interval and disclose the reduced coverage.
- **Full-history operations time out:** use a representative recent window, preserve successful full-window aggregations, and label all extrapolations.
- **Top-value grouping is approximate or truncated:** disclose the provider behavior and the coverage represented by the returned groups.
- **File parser coverage is incomplete:** report parsed and rejected record counts and bytes, keep unmatched data visible, and do not claim a complete family ranking.
- **Target filter is unavailable or ambiguous:** report the attempted fields and matches, then ask for one precise discriminator instead of widening to the entire store.

A missing capability is a result, not permission to invent a substitute metric or silently skip a required ranking.

## Safety

- Use read-only operations only; do not change datasets, files, rotation, lifecycle settings, dashboards, alerts, or application configuration.
- Never truncate, rename, move, decompress, re-encode, or repair source log files.
- Keep payload bodies excluded from retrieval and reports unless a separate task explicitly requires and authorizes access.
- Describe sensitive examples by shape, type, and size rather than reproducing values.
- Stop after the report. Provider-specific mutations belong to a separate implementation workflow.
