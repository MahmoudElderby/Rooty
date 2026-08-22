# Asking the developer

## Ask only what evidence cannot answer

Documentation and targeted source inspection answer most setup choices. Ask the developer only when a material choice remains unresolved: provider identity, environment, access scope, catalog or index names that metadata cannot enumerate, or a conflict that changes safety.

Never ask the developer to restate a fact already confirmed in `.rooty/config/project-context.json` or already visible in current project evidence.

## Use the host's own question experience

Hosts differ, so choose the mechanism the active host actually provides:

| Host | Mechanism |
|---|---|
| Cursor | the native structured question tool (`AskQuestion`) |
| Claude | the native structured question tool (`AskUserQuestion`) |
| Codex | a plain conversational question, because no structured question tool exists |

Prefer the host's structured mechanism whenever it exists. Do not build a numbered or lettered option list in message text when the host can render real choices, and do not invent a bespoke answer format the developer has to imitate.

Verify the tool exists in the current session before relying on it. If it is unavailable for any reason, ask the same question in plain text rather than reporting a blocked setup.

## Shape of a good question

1. Present the candidates you actually found, each with the evidence that produced it, so the developer can recognize the right one.
2. Always include an option that escapes the list, such as supplying a different path, naming a provider you did not detect, or confirming that none are available. A structured question must never force a wrong answer.
3. Batch the questions that block the same step into one prompt. One prompt covering documentation entry points and an unresolved provider is better than two sequential interruptions.
4. Keep each question to one decision. Do not combine a provider choice with a credential mechanism.
5. State what the answer unblocks, so the developer understands the cost of skipping it.

## Never use a question as an approval

A structured question collects a preference. It is not an approval surface. Every file write, command, package execution, image pull, and OAuth start still requires the host's own approval experience, as described in [../../rooty-mcp-builder/references/read-only-policy.md](../../rooty-mcp-builder/references/read-only-policy.md). Do not present "apply this configuration?" as a multiple-choice question, and do not treat one answer as approval for a later runtime or credential action.

## Persisting answers

Store confirmed documentation paths with `rooty context set-docs --paths ...` and an explicit no-docs decision with `rooty context set-docs --none`. Store only safe setup checkpoints, confirmed environment IDs/aliases, selected setup coverage, initial environment, active host, and skip/cancel reason codes in `.rooty/state/setup-progress.json`. Provider answers remain conversational until they become reviewed environment profiles, host configuration, or artifacts under `.rooty/mcp/<category>/<provider>/`. Never write a question transcript, free-form answer log, inferred architecture file, extracted documentation, or credential value.
