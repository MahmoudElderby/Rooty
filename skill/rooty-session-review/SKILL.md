---
name: rooty-session-review
description: Analyze one explicitly selected Codex, Cursor, or Claude session export for timing, tool usage, retries, failures, approvals, context pressure, and evidence-backed Rooty improvements while persisting only sanitized metadata. Use for communication-log review, agent-session performance analysis, or workflow-friction analysis. Do not scan all sessions, inspect an implicit latest session, or preserve prompts and raw tool output.
---

# Rooty Session Review

Measure one selected investigation session and produce a sanitized local review plus a separate improvement draft.

Read [references/session-contract.md](references/session-contract.md) for the normalized event and metric rules. Read [references/host-inputs.md](references/host-inputs.md) before selecting an adapter.

## Review one explicit target

1. Require `--host` and exactly one explicit `--session-id` or `--input`. Never infer "latest" and never analyze all history.
2. Prefer an explicit export file. Codex and Cursor session-ID lookup may resolve exact local filenames only; Claude requires an explicit structured export because Rooty does not assume a stable local storage path.
3. Run:

   `rooty session review --host codex|cursor|claude (--session-id ID | --input FILE) --project <project> [--output DIR]`

4. Review `session-review.json/md` and `improvement-draft.json`. Host telemetry that is absent must remain `UNAVAILABLE`.
5. Keep improvement drafts in `.rooty/improvements/drafts`; never move them into incident memory. A `memory_candidate` classification is only a proposal for later governance.

## Preserve the privacy boundary

The deterministic adapter excludes system and developer instructions, full prompts, raw tool output, credentials, personal identifiers, and unrelated task content. Persist only event references, hashes, metrics, normalized tool names, and bounded redacted failure excerpts. Do not bypass sanitization to improve narrative detail.

Classify supported proposals as `cli`, `skill`, `workflow`, `documentation`, `integration`, `evaluation`, `host_limitation`, or `memory_candidate`. Every proposal stays `DRAFT` and cites normalized event references.

