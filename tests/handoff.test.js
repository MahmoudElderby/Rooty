import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderHandoffBundle, validateHandoffBundle } from "../skill/rooty-case-handoff/scripts/render-handoff.mjs";

function bundle() {
  return {
    schema_version: 1,
    case_id: "INV-20260825-ROOTY",
    source_ticket: { id: "ROOTY-101", url: "https://jira.example/browse/ROOTY-101" },
    rca: {
      status: "CONFIRMED",
      symptom: "Setup exceeded its expected duration.",
      impact: "Developer onboarding was delayed.",
      timeline: ["03:33 setup started", "04:05 setup ended"],
      root_cause: "Repeated process startup dominated active execution time.",
      first_bad_state: "The first no-op CLI process incurred package startup latency.",
      causal_chain: [{ statement: "Repeated process launches added latency.", evidence_refs: ["EV-1", "EV-2"] }],
      evidence_links: ["case:evidence#EV-1", "case:evidence#EV-2"],
      limitations: ["Host CPU telemetry was unavailable."]
    },
    qc_case: {
      id: "QC-ROOTY-101-001",
      title: "Measure repeated Rooty command startup",
      purpose: "Verify bounded setup commands do not accumulate excessive startup delay.",
      actors: ["Developer", "Rooty CLI"],
      business_flow: ["Install Rooty", "Run setup metadata commands"],
      requirements: ["Informational commands complete within the agreed threshold."],
      scope: { included: ["CLI process startup"], excluded: ["SQL network reachability"] },
      preconditions: ["Use an isolated test project."],
      environment_constraints: ["Non-production workstation"],
      version_constraints: ["Node.js 20 or later"],
      sanitized_test_data: ["Synthetic project named rooty-qc"],
      steps: [{ number: 1, action: "Run the help command five times.", expected_result: "All five commands return successfully within the approved aggregate threshold.", expected_telemetry: ["Capture elapsed milliseconds per process."], evidence_refs: ["EV-1"] }],
      negative_variants: ["Package cache is initially empty."],
      boundary_variants: ["Run one command and twenty commands."],
      cleanup_requirements: ["Remove the isolated test project."],
      risks: ["Cold package download can confound startup measurement."],
      traceability: ["ROOTY-101", "EV-1", "EV-2"],
      review_state: "DRAFT",
      execution_state: "NOT_RUN"
    },
    jira_ticket_update: {
      symptom: "Setup exceeded its expected duration.", impact: "Developer onboarding was delayed.",
      timeline: ["03:33 setup started", "04:05 setup ended"],
      root_cause: "Repeated process startup dominated active execution time.", first_bad_state: "First no-op command startup.",
      causal_chain: ["Repeated launches accumulated startup latency."], evidence_links: ["case:evidence#EV-1"], limitations: [],
      test_case_link: "qc-case.md", selected_action_ids: ["ACT-1"]
    },
    jira_actions: [{
      id: "ACT-1", category: "corrective", release_kind: "defect_correction", issue_type: "Bug", selection: "SELECTED",
      title: "Reduce Rooty process startup latency", rationale: "Measured startup dominates active setup time.", evidence_refs: ["EV-1", "EV-2"],
      scope: "CLI bootstrap and package resolution", owner_component: "TBD / CLI", priority_rationale: "High repeated user delay.", dependencies: [],
      risks: ["Packaging changes may alter distribution behavior."], acceptance_criteria: ["Median warm help startup meets the approved threshold."],
      validation: "Run QC-ROOTY-101-001 after independent review.", rollout_considerations: "Measure cold and warm starts separately.", source_ticket_link: "ROOTY-101"
    }]
  };
}

test("confirmed RCA renders a complete local QC and Jira proposal package", async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), "rooty-handoff-"));
  const files = await renderHandoffBundle(bundle(), output);
  assert.deepEqual(Object.keys(files).sort(), ["jira_actions_json", "jira_actions_markdown", "jira_update_json", "jira_update_markdown", "qc_json", "qc_markdown"]);
  const qc = JSON.parse(await readFile(files.qc_json, "utf8"));
  assert.equal(qc.review_state, "DRAFT");
  assert.equal(qc.execution_state, "NOT_RUN");
  assert.equal(qc.steps[0].expected_result.includes("threshold"), true);
  const actions = await readFile(files.jira_actions_json, "utf8");
  assert.doesNotMatch(actions, /create_issue|update_issue|mutation_call/i);
});

test("handoff rejects unsupported RCA certainty, unsafe Jira calls, and issue-type drift", () => {
  const probable = bundle();
  probable.rca.status = "PROBABLE";
  assert.throws(() => validateHandoffBundle(probable), /requires RCA status CONFIRMED/);
  const unsafe = bundle();
  unsafe.jira_actions[0].tool_call = "create_issue";
  assert.throws(() => validateHandoffBundle(unsafe), /mutation instructions/);
  const wrongType = bundle();
  wrongType.jira_actions[0].issue_type = "Story";
  assert.throws(() => validateHandoffBundle(wrongType), /must be Bug/);
});

