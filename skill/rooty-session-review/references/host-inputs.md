# Host input routing

## Codex

Accept one explicit local JSONL path or exact task/session ID. The adapter recognizes observed rollout JSONL records such as session metadata, response items, event messages, tool lifecycle, token counters, and compaction. Local Codex JSONL is version-sensitive and not treated as a stable public transcript API. Ignore unknown records fail-closed.

## Cursor

Accept one explicit local agent transcript, a JSON or stream-JSON export, or Markdown export. Structured Cursor CLI exports provide more timing and tool capability than Markdown. A session ID may resolve only an exact transcript filename; never select the newest transcript.

## Claude

Accept one explicit Claude JSON or stream-JSON export. Do not assume or search an undocumented local Claude history directory. Preserve supported usage and duration fields; mark absent lifecycle and timestamp values `UNAVAILABLE`.

Across all hosts, adapters normalize capability differences rather than claiming telemetry parity.

