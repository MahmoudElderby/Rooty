# Handoff bundle contract

Create one schema-version-1 JSON object with these top-level keys:

- `case_id`, `source_ticket`, and `rca`.
- `qc_case`.
- `jira_ticket_update`.
- `jira_actions`.

The deterministic renderer is the executable schema. Use its validation errors to correct a draft. Important constraints:

- `rca.status` is exactly `CONFIRMED`.
- `qc_case.review_state` is `DRAFT`; `execution_state` is `NOT_RUN`.
- Each QC step has a sequential number, action, expected result, expected telemetry array, and evidence references.
- Each action has category, `release_kind`, deterministic issue type, title, rationale, evidence, scope, owner/component placeholder, priority rationale, dependencies, risks, acceptance criteria, validation, rollout considerations, source-ticket link, and selection.
- `release_kind` is `defect_correction`, `new_user_behavior`, or another non-user-facing work label. The first maps to Bug, the second to Story, and every other label to Task.
- `jira_ticket_update.selected_action_ids` exactly equals actions marked `SELECTED`.
- A `COMBINED` action names `combined_into`; the target is another action.
- Do not add tool calls, publish commands, credentials, raw evidence payloads, or personal data.

