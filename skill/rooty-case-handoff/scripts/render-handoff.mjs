#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ACTION_TYPES = new Set([
  "corrective",
  "preventive",
  "detection",
  "observability",
  "testing",
  "documentation",
  "operational",
  "performance",
  "cost"
]);
const ISSUE_TYPES = new Set(["Bug", "Task", "Story"]);
const SELECTIONS = new Set(["SELECTED", "EXCLUDED", "COMBINED"]);

function requiredString(value, location) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${location} must be a non-empty string`);
}

function requiredArray(value, location) {
  if (!Array.isArray(value) || !value.length) throw new Error(`${location} must be a non-empty array`);
}

function stringArray(value, location, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${location} must be ${allowEmpty ? "an" : "a non-empty"} array of strings`);
  }
}

function expectedIssueType(action) {
  if (action.release_kind === "defect_correction") return "Bug";
  if (action.release_kind === "new_user_behavior") return "Story";
  return "Task";
}

function rejectMutationCalls(value, trail = "bundle") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const location = `${trail}.${key}`;
    if (/(?:^|_)(?:secret|password|passwd|token|api_?key|private_?key)$/i.test(key) && typeof child === "string" && child.trim()) throw new Error(`Credential values are forbidden at ${location}`);
    if (/^(?:tool_call|mutation_call|jira_mutation|publish_command)$/i.test(key)) throw new Error(`Jira mutation instructions are forbidden at ${location}`);
    if (typeof child === "string" && /^(?:create|update|edit|transition|delete)[_-](?:issue|ticket)$/i.test(child)) {
      throw new Error(`Jira mutation tool names are forbidden at ${location}`);
    }
    if (typeof child === "string" && /(?:\bBearer\s+[A-Za-z0-9._~+/=-]+|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|[A-Za-z]:\\Users\\[^\\\s]+|\/(?:Users|home)\/[^/\s]+)/i.test(child)) throw new Error(`Unsanitized personal or credential data is forbidden at ${location}`);
    rejectMutationCalls(child, location);
  }
}

export function validateHandoffBundle(bundle) {
  if (bundle?.schema_version !== 1) throw new Error("Handoff schema_version must be 1");
  if (bundle?.rca?.status !== "CONFIRMED") throw new Error("Full case handoff requires RCA status CONFIRMED");
  requiredString(bundle.case_id, "case_id");
  requiredString(bundle.source_ticket?.id, "source_ticket.id");
  for (const key of ["symptom", "impact", "root_cause", "first_bad_state"]) requiredString(bundle.rca?.[key], `rca.${key}`);
  requiredArray(bundle.rca?.timeline, "rca.timeline");
  requiredArray(bundle.rca?.causal_chain, "rca.causal_chain");
  for (const [index, link] of bundle.rca.causal_chain.entries()) {
    requiredString(link?.statement, `rca.causal_chain[${index}].statement`);
    stringArray(link?.evidence_refs, `rca.causal_chain[${index}].evidence_refs`);
  }
  stringArray(bundle.rca?.evidence_links, "rca.evidence_links");
  stringArray(bundle.rca?.limitations, "rca.limitations", { allowEmpty: true });

  const qc = bundle.qc_case;
  if (qc?.review_state !== "DRAFT" || qc?.execution_state !== "NOT_RUN") throw new Error("QC case must remain DRAFT and NOT_RUN");
  for (const key of ["id", "title", "purpose"]) requiredString(qc?.[key], `qc_case.${key}`);
  for (const key of ["actors", "business_flow", "requirements", "preconditions", "environment_constraints", "version_constraints", "sanitized_test_data", "negative_variants", "boundary_variants", "cleanup_requirements", "risks", "traceability"]) {
    stringArray(qc?.[key], `qc_case.${key}`, { allowEmpty: ["negative_variants", "boundary_variants", "cleanup_requirements"].includes(key) });
  }
  stringArray(qc?.scope?.included, "qc_case.scope.included");
  stringArray(qc?.scope?.excluded, "qc_case.scope.excluded");
  requiredArray(qc?.steps, "qc_case.steps");
  for (const [index, step] of qc.steps.entries()) {
    if (step?.number !== index + 1) throw new Error(`qc_case.steps[${index}].number must be ${index + 1}`);
    requiredString(step.action, `qc_case.steps[${index}].action`);
    requiredString(step.expected_result, `qc_case.steps[${index}].expected_result`);
    stringArray(step.expected_telemetry, `qc_case.steps[${index}].expected_telemetry`, { allowEmpty: true });
    stringArray(step.evidence_refs, `qc_case.steps[${index}].evidence_refs`);
  }

  const update = bundle.jira_ticket_update;
  for (const key of ["symptom", "impact", "root_cause", "first_bad_state", "test_case_link"]) requiredString(update?.[key], `jira_ticket_update.${key}`);
  requiredArray(update?.timeline, "jira_ticket_update.timeline");
  requiredArray(update?.causal_chain, "jira_ticket_update.causal_chain");
  stringArray(update?.evidence_links, "jira_ticket_update.evidence_links");
  stringArray(update?.limitations, "jira_ticket_update.limitations", { allowEmpty: true });
  stringArray(update?.selected_action_ids, "jira_ticket_update.selected_action_ids", { allowEmpty: true });

  if (!Array.isArray(bundle.jira_actions)) throw new Error("jira_actions must be an array");
  const ids = new Set();
  for (const [index, action] of bundle.jira_actions.entries()) {
    const base = `jira_actions[${index}]`;
    requiredString(action?.id, `${base}.id`);
    if (ids.has(action.id)) throw new Error(`Duplicate Jira action id: ${action.id}`);
    ids.add(action.id);
    if (!ACTION_TYPES.has(action.category)) throw new Error(`${base}.category is invalid`);
    if (!ISSUE_TYPES.has(action.issue_type)) throw new Error(`${base}.issue_type is invalid`);
    if (!SELECTIONS.has(action.selection)) throw new Error(`${base}.selection is invalid`);
    if (action.issue_type !== expectedIssueType(action)) throw new Error(`${base}.issue_type must be ${expectedIssueType(action)} for ${action.release_kind}`);
    for (const key of ["title", "rationale", "scope", "owner_component", "priority_rationale", "validation", "rollout_considerations", "source_ticket_link"]) requiredString(action?.[key], `${base}.${key}`);
    for (const key of ["evidence_refs", "dependencies", "risks", "acceptance_criteria"]) stringArray(action?.[key], `${base}.${key}`, { allowEmpty: key === "dependencies" });
    if (action.selection === "COMBINED") requiredString(action.combined_into, `${base}.combined_into`);
  }
  for (const action of bundle.jira_actions.filter((item) => item.selection === "COMBINED")) {
    if (!ids.has(action.combined_into) || action.combined_into === action.id) throw new Error(`Combined action ${action.id} must reference another action`);
  }
  const selected = bundle.jira_actions.filter((action) => action.selection === "SELECTED").map((action) => action.id).sort();
  const declared = [...update.selected_action_ids].sort();
  if (JSON.stringify(selected) !== JSON.stringify(declared)) throw new Error("jira_ticket_update.selected_action_ids must exactly match SELECTED actions");
  rejectMutationCalls(bundle);
  return bundle;
}

function bullets(values) {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : "- None.";
}

function renderQc(qc, sourceTicket, caseId) {
  const steps = qc.steps.map((step) => `| ${step.number} | ${step.action} | ${step.expected_result} | ${step.expected_telemetry.join("; ") || "None specified"} |`).join("\n");
  return `# ${qc.title}\n\n- QC case: ${qc.id}\n- Source ticket: ${sourceTicket.id}\n- RCA case: ${caseId}\n- Review state: **${qc.review_state}**\n- Execution state: **${qc.execution_state}**\n\n## Purpose\n\n${qc.purpose}\n\n## Actors\n\n${bullets(qc.actors)}\n\n## Business flow\n\n${bullets(qc.business_flow)}\n\n## Requirements\n\n${bullets(qc.requirements)}\n\n## Scope\n\nIncluded:\n${bullets(qc.scope.included)}\n\nExcluded:\n${bullets(qc.scope.excluded)}\n\n## Preconditions\n\n${bullets(qc.preconditions)}\n\n## Environment and version constraints\n\n${bullets([...qc.environment_constraints, ...qc.version_constraints])}\n\n## Sanitized test data\n\n${bullets(qc.sanitized_test_data)}\n\n## Steps\n\n| # | Action | Expected result | Expected telemetry |\n|---:|---|---|---|\n${steps}\n\n## Negative variants\n\n${bullets(qc.negative_variants)}\n\n## Boundary variants\n\n${bullets(qc.boundary_variants)}\n\n## Cleanup\n\n${bullets(qc.cleanup_requirements)}\n\n## Risks\n\n${bullets(qc.risks)}\n\n## Traceability\n\n${bullets(qc.traceability)}\n`;
}

function renderUpdate(update, sourceTicket) {
  return `# Proposed RCA update for ${sourceTicket.id}\n\nThis is a local proposal. It has not been published to Jira.\n\n## Symptom and impact\n\n${update.symptom}\n\n${update.impact}\n\n## Timeline\n\n${update.timeline.map((item) => `- ${typeof item === "string" ? item : `${item.time}: ${item.event}`}`).join("\n")}\n\n## Confirmed root cause\n\n${update.root_cause}\n\nFirst bad state: ${update.first_bad_state}\n\n## Causal chain\n\n${update.causal_chain.map((item, index) => `${index + 1}. ${typeof item === "string" ? item : item.statement}`).join("\n")}\n\n## Evidence\n\n${bullets(update.evidence_links)}\n\n## Limitations\n\n${bullets(update.limitations)}\n\n## QC case\n\n${update.test_case_link}\n\n## Selected actions\n\n${bullets(update.selected_action_ids)}\n`;
}

function renderActions(actions, sourceTicket) {
  const body = actions.map((action) => `## ${action.id}: ${action.title}\n\n- Selection: ${action.selection}${action.combined_into ? ` into ${action.combined_into}` : ""}\n- Issue type: ${action.issue_type}\n- Category: ${action.category}\n- Owner/component: ${action.owner_component}\n- Source ticket: ${action.source_ticket_link || sourceTicket.id}\n\nRationale: ${action.rationale}\n\nScope: ${action.scope}\n\nPriority: ${action.priority_rationale}\n\nEvidence:\n${bullets(action.evidence_refs)}\n\nDependencies:\n${bullets(action.dependencies)}\n\nRisks:\n${bullets(action.risks)}\n\nAcceptance criteria:\n${bullets(action.acceptance_criteria)}\n\nValidation: ${action.validation}\n\nRollout: ${action.rollout_considerations}`).join("\n\n");
  return `# Proposed Jira actions for ${sourceTicket.id}\n\nThese are local drafts. No Jira mutation was performed. Selection and combination decisions are explicit below.\n\n${body || "No action drafts were selected."}\n`;
}

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function atomicWrite(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  await writeFile(temporary, content, "utf8");
  await rename(temporary, file);
}

export async function renderHandoffBundle(bundle, outputDir) {
  validateHandoffBundle(bundle);
  const target = path.resolve(outputDir);
  const project = path.resolve(process.cwd());
  const safeProjectOutput = path.join(project, ".rooty", "handoffs", "drafts");
  if (isInside(project, target) && !isInside(safeProjectOutput, target)) {
    throw new Error("Handoff output inside the project must be under Git-ignored .rooty/handoffs/drafts; otherwise choose a directory outside the project");
  }
  const qc = { schema_version: 1, case_id: bundle.case_id, source_ticket: bundle.source_ticket, rca_status: "CONFIRMED", ...bundle.qc_case };
  const update = { schema_version: 1, proposal_state: "DRAFT", source_ticket: bundle.source_ticket, rca_status: "CONFIRMED", ...bundle.jira_ticket_update };
  const actions = { schema_version: 1, proposal_state: "DRAFT", source_ticket: bundle.source_ticket, actions: bundle.jira_actions };
  const files = {
    qc_json: path.join(target, "qc-case.json"),
    qc_markdown: path.join(target, "qc-case.md"),
    jira_update_json: path.join(target, "jira-ticket-update.json"),
    jira_update_markdown: path.join(target, "jira-ticket-update.md"),
    jira_actions_json: path.join(target, "jira-actions.json"),
    jira_actions_markdown: path.join(target, "jira-actions.md")
  };
  await atomicWrite(files.qc_json, `${JSON.stringify(qc, null, 2)}\n`);
  await atomicWrite(files.qc_markdown, renderQc(qc, bundle.source_ticket, bundle.case_id));
  await atomicWrite(files.jira_update_json, `${JSON.stringify(update, null, 2)}\n`);
  await atomicWrite(files.jira_update_markdown, renderUpdate(update, bundle.source_ticket));
  await atomicWrite(files.jira_actions_json, `${JSON.stringify(actions, null, 2)}\n`);
  await atomicWrite(files.jira_actions_markdown, renderActions(bundle.jira_actions, bundle.source_ticket));
  return files;
}

async function main(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--") || !argv[index + 1]) throw new Error("Usage: render-handoff.mjs --input FILE --output DIR");
    options[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  if (!options.input || !options.output) throw new Error("Usage: render-handoff.mjs --input FILE --output DIR");
  const bundle = JSON.parse(await readFile(path.resolve(options.input), "utf8"));
  const files = await renderHandoffBundle(bundle, options.output);
  process.stdout.write(`${JSON.stringify(files, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
