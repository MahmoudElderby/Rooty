# Normalized session contract

`rooty.session-event.v1` allows only sanitized fields:

- stable event reference and source hash;
- ordinal and optional timestamp;
- kind: message, tool, usage, approval request, explicit human wait, or compaction;
- optional role, normalized tool name, lifecycle, hashed call ID/signature, command executable name, duration, outcome, and bounded redacted failure excerpt;
- optional supported token, cache, context-window, and compaction values.

Metrics follow these rules:

- Wall time is the span between the earliest and latest supported timestamps.
- Human wait is the union of explicit host wait intervals and timestamped approval-to-next-user intervals.
- Agent time is wall time minus the human-wait union when both are supported.
- Tool time is an interval union, so overlapping tools are counted once.
- Repeated calls use hashed normalized signatures. Retries require a later matching attempt after a recorded failure or timeout; raw arguments are never persisted.
- Token counters use the maximum observed cumulative value, not an unsafe sum.
- Missing timestamps, lifecycle records, tokens, cache values, context window, or host telemetry are `UNAVAILABLE`; never estimate them.

The review may classify failures and timeouts from structured state or sanitized failure metadata. It must not quote prompts or raw provider payloads.
