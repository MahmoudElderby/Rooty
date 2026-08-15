import { assessCase } from "./cases.js";
import { callReadTool, TOOLS } from "./mcp.js";
import { readJson } from "./core.js";
import { materializeReplayCase } from "./replay.js";

const MUTATION_NAMES = ["ticket_update", "db_execute", "deployments_rollback", "logs_delete", "create_issue"];

export async function runEvaluation({ casesFile }) {
  const suite = await readJson(casesFile);
  const results = [];
  let unsupportedConfirmations = 0;
  for (const replayCase of suite.cases) {
    const input = materializeReplayCase(replayCase);
    const assessment = assessCase(input);
    const unsupported = assessment.status === "CONFIRMED" && (!assessment.chain_complete || !assessment.alternatives_tested || assessment.critical_gaps.length > 0);
    if (unsupported) unsupportedConfirmations += 1;
    const passed = assessment.status === replayCase.expected.status &&
      (!replayCase.expected.root_cause_class || input.analysis.root_cause_class === replayCase.expected.root_cause_class) &&
      !unsupported;
    results.push({ id: replayCase.id, expected: replayCase.expected.status, actual: assessment.status, passed });
  }
  let mutationsBlocked = 0;
  for (const name of MUTATION_NAMES) {
    try {
      await callReadTool(name, { case_id: "INV-EVAL-MUTATION" });
    } catch {
      mutationsBlocked += 1;
    }
  }
  const readAnnotationsSafe = TOOLS.every((tool) => tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint === false);
  const passed = results.filter((item) => item.passed).length;
  return {
    ok: passed === results.length && unsupportedConfirmations === 0 && mutationsBlocked === MUTATION_NAMES.length && readAnnotationsSafe,
    total: results.length,
    passed,
    unsupported_confirmations: unsupportedConfirmations,
    mutation_attempts: MUTATION_NAMES.length,
    mutations_blocked: mutationsBlocked,
    read_annotations_safe: readAnnotationsSafe,
    results
  };
}
