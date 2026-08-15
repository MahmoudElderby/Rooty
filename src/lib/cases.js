import { appendFile, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, isoNow, makeCaseId, pathExists, readJson, sha256, VALID_CLASSIFICATIONS, writeJson } from "./core.js";

const REQUIRED_EVIDENCE_FIELDS = ["evidence_id", "classification", "source_type", "source_system", "environment", "event_time_range", "retrieved_at", "query_or_locator", "observation", "limitations"];

export function validateEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") throw new Error("Evidence must be an object");
  const missing = REQUIRED_EVIDENCE_FIELDS.filter((field) => evidence[field] === undefined || evidence[field] === "");
  if (missing.length > 0) throw new Error(`Evidence ${evidence.evidence_id ?? "<unknown>"} is missing: ${missing.join(", ")}`);
  if (!/^E[0-9]+$/.test(evidence.evidence_id)) throw new Error(`Invalid evidence_id: ${evidence.evidence_id}`);
  if (!VALID_CLASSIFICATIONS.has(evidence.classification)) throw new Error(`Invalid classification: ${evidence.classification}`);
  if (!Number.isFinite(Date.parse(evidence.retrieved_at))) throw new Error(`Invalid retrieved_at for ${evidence.evidence_id}`);
  if (!String(evidence.event_time_range).includes("/")) throw new Error(`event_time_range must preserve a bounded range for ${evidence.evidence_id}`);
}

export function assessCase(snapshot) {
  const evidence = snapshot.evidence ?? [];
  for (const item of evidence) validateEvidence(item);
  const ids = new Set(evidence.map((item) => item.evidence_id));
  if (ids.size !== evidence.length) throw new Error("Evidence IDs must be unique");
  const observed = new Set(evidence.filter((item) => item.classification === "OBSERVED").map((item) => item.evidence_id));
  const evidenceById = new Map(evidence.map((item) => [item.evidence_id, item]));
  const analysis = snapshot.analysis ?? {};
  const chain = analysis.causal_chain ?? [];
  const chainEvidence = chain.map((step) => Array.isArray(step.evidence_refs) ? [...new Set(step.evidence_refs)] : []);
  const chainReferencesObserved = chainEvidence.every((refs) => refs.length > 0 && refs.every((id) => observed.has(id)));
  const chainEvidenceUse = new Map();
  for (const refs of chainEvidence) for (const id of refs) chainEvidenceUse.set(id, (chainEvidenceUse.get(id) ?? 0) + 1);
  const distinctEvidencePerStep = chainEvidence.every((refs) => refs.some((id) => chainEvidenceUse.get(id) === 1));
  const chainObservedIds = new Set(chainEvidence.flat().filter((id) => observed.has(id)));
  const observedSourceSystems = new Set([...chainObservedIds].map((id) => evidenceById.get(id)?.source_system).filter(Boolean));
  const observedSourceTypes = new Set([...chainObservedIds].map((id) => evidenceById.get(id)?.source_type).filter(Boolean));
  const independentlyCorroborated = observedSourceSystems.size >= 2 || observedSourceTypes.size >= 2;
  const reproduction = analysis.reproduction ?? {};
  const reproductionRefs = Array.isArray(reproduction.evidence_refs) ? [...new Set(reproduction.evidence_refs)] : [];
  const reproduciblyVerified = reproduction.status === "reproduced" &&
    reproductionRefs.length >= 2 &&
    reproductionRefs.every((id) => observed.has(id) && chainObservedIds.has(id));
  const corroborationSatisfied = independentlyCorroborated || reproduciblyVerified;
  const firstBadState = String(analysis.first_bad_state ?? "").trim();
  const firstBadStateEstablished = firstBadState.length > 0 && !/^(?:unknown|not established|n\/a)$/i.test(firstBadState);
  const chainComplete = chain.length >= 2 &&
    chainReferencesObserved &&
    distinctEvidencePerStep &&
    firstBadStateEstablished &&
    corroborationSatisfied;
  const competitors = analysis.competing_hypotheses ?? [];
  const alternativesTested = competitors.length > 0 && competitors.every((hypothesis) =>
    ["eliminated", "contradicted"].includes(hypothesis.status) &&
    Array.isArray(hypothesis.evidence_refs) && hypothesis.evidence_refs.length > 0 && hypothesis.evidence_refs.every((id) => observed.has(id))
  );
  const criticalGaps = (analysis.evidence_gaps ?? []).filter((gap) => gap.critical === true);
  const supportCount = chainObservedIds.size;
  let status = "INCONCLUSIVE";
  if (analysis.root_cause && chainComplete && alternativesTested && criticalGaps.length === 0) status = "CONFIRMED";
  else if (analysis.root_cause && supportCount >= 1 && analysis.best_fit === true) status = "PROBABLE";
  return {
    status,
    chain_complete: chainComplete,
    chain_references_observed: chainReferencesObserved,
    distinct_evidence_per_step: distinctEvidencePerStep,
    independently_corroborated: independentlyCorroborated,
    reproducibly_verified: reproduciblyVerified,
    corroboration_satisfied: corroborationSatisfied,
    first_bad_state_established: firstBadStateEstablished,
    alternatives_tested: alternativesTested,
    critical_gaps: criticalGaps.map((gap) => gap.description),
    observed_support_count: supportCount,
    observed_source_count: observedSourceSystems.size
  };
}

function isSameOrWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function assertCaseDirectoryOutsideProject(projectRoot, caseDir) {
  const project = await realpath(path.resolve(projectRoot));
  const target = path.resolve(caseDir);
  if (isSameOrWithin(path.resolve(projectRoot), target)) {
    throw new Error(`Case directory must be outside the investigated project: ${target}`);
  }

  let existingAncestor = target;
  while (!await pathExists(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    existingAncestor = parent;
  }
  const resolvedAncestor = await realpath(existingAncestor);
  const resolvedTarget = path.resolve(resolvedAncestor, path.relative(existingAncestor, target));
  if (isSameOrWithin(project, resolvedTarget)) {
    throw new Error(`Case directory resolves inside the investigated project: ${target}`);
  }
  return target;
}

function nextLedgerEntry(evidence, sequence, previousHash, caseId) {
  const { case_id: ignoredCaseId, sequence: ignoredSequence, previous_hash: ignoredPreviousHash, entry_hash: ignoredEntryHash, ...observation } = evidence;
  const base = {
    ...observation,
    case_id: caseId,
    sequence,
    previous_hash: previousHash
  };
  return { ...base, entry_hash: sha256(canonicalJson(base)) };
}

export async function readLedger(caseDir) {
  const ledgerFile = path.join(caseDir, "evidence.ndjson");
  const content = await readFile(ledgerFile, "utf8");
  return content.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Invalid ledger JSON at line ${index + 1}`);
    }
  });
}

export function verifyLedgerEntries(entries) {
  const seen = new Set();
  let previousHash = "GENESIS";
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    validateEvidence(entry);
    if (entry.sequence !== index + 1) throw new Error(`Ledger sequence break at ${entry.evidence_id}`);
    if (entry.previous_hash !== previousHash) throw new Error(`Ledger hash-chain break at ${entry.evidence_id}`);
    if (seen.has(entry.evidence_id)) throw new Error(`Duplicate evidence ID ${entry.evidence_id}`);
    const { entry_hash: actualHash, ...base } = entry;
    const expectedHash = sha256(canonicalJson(base));
    if (actualHash !== expectedHash) throw new Error(`Ledger entry was modified: ${entry.evidence_id}`);
    seen.add(entry.evidence_id);
    previousHash = actualHash;
  }
  return { ok: true, count: entries.length, head: previousHash };
}

export async function appendEvidence(caseDir, evidence) {
  const manifest = await readJson(path.join(caseDir, "case.json"));
  validateEvidence(evidence);
  const entries = await readLedger(caseDir);
  const verification = verifyLedgerEntries(entries);
  if (entries.some((entry) => entry.evidence_id === evidence.evidence_id)) throw new Error(`Duplicate evidence ID: ${evidence.evidence_id}`);
  const entry = nextLedgerEntry(evidence, entries.length + 1, verification.head, manifest.case_id);
  await appendFile(path.join(caseDir, "evidence.ndjson"), `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export async function runFrozenCase({ projectRoot, ticket, snapshotFile, caseDir }) {
  const snapshot = await readJson(snapshotFile);
  if (snapshot.ticket?.id !== ticket) throw new Error(`Snapshot ticket ${snapshot.ticket?.id ?? "<missing>"} does not match ${ticket}`);
  const assessment = assessCase(snapshot);
  const caseId = snapshot.case_id ?? makeCaseId();
  const requestedTarget = caseDir ?? path.join(path.dirname(projectRoot), ".rooty-cases", path.basename(projectRoot), caseId);
  const target = await assertCaseDirectoryOutsideProject(projectRoot, requestedTarget);
  if (await pathExists(target)) throw new Error(`Refusing to overwrite existing case directory: ${target}`);
  await mkdir(target, { recursive: true });
  const state = {
    schema_version: 1,
    case_id: caseId,
    created_at: isoNow(),
    project: path.basename(projectRoot),
    ticket: snapshot.ticket,
    expected_path: snapshot.expected_path ?? [],
    hypotheses: snapshot.hypotheses ?? [],
    analysis: snapshot.analysis ?? {},
    assessment,
    source_snapshot_sha256: sha256(await readFile(snapshotFile, "utf8"))
  };
  await writeJson(path.join(target, "case.json"), state);
  let previousHash = "GENESIS";
  const ledger = [];
  for (let index = 0; index < (snapshot.evidence ?? []).length; index += 1) {
    const entry = nextLedgerEntry(snapshot.evidence[index], index + 1, previousHash, caseId);
    ledger.push(entry);
    previousHash = entry.entry_hash;
  }
  await writeFile(path.join(target, "evidence.ndjson"), `${ledger.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
  verifyLedgerEntries(ledger);
  const reportFile = await writeReport(target, state, ledger);
  return { caseId, status: assessment.status, caseDir: target, reportFile };
}

function evidenceTable(entries) {
  const header = "| ID | Class | Source | Event time | Observation | Limitations |\n|---|---|---|---|---|---|\n";
  return header + entries.map((entry) =>
    `| ${escapeCell(entry.evidence_id)} | ${escapeCell(entry.classification)} | ${escapeCell(entry.source_system)} | ${escapeCell(entry.event_time_range)} | ${escapeCell(entry.observation)} | ${escapeCell(entry.limitations)} |`
  ).join("\n");
}

function escapeCell(value) {
  return String(value ?? "none").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function bullets(values, fallback = "None established.") {
  return values?.length ? values.map((value) => `- ${typeof value === "string" ? value : value.description ?? JSON.stringify(value)}`).join("\n") : fallback;
}

export function renderReport(state, entries) {
  const analysis = state.analysis;
  const status = state.assessment.status;
  const causal = (analysis.causal_chain ?? []).map((step, index) => `${index + 1}. ${step.step} (${(step.evidence_refs ?? []).join(", ") || "no evidence"})`).join("\n") || "No causal chain established.";
  const competitors = (analysis.competing_hypotheses ?? []).map((item) => `- ${item.statement}: **${item.status}** (${(item.evidence_refs ?? []).join(", ") || "no evidence"})`).join("\n") || "None tested.";
  const timeline = entries.filter((entry) => entry.classification === "OBSERVED").map((entry) => `- ${entry.event_time_range}: ${entry.observation} (${entry.evidence_id})`).join("\n") || "No independently observed timeline.";
  const expected = state.expected_path.map((step, index) => `${index + 1}. ${step}`).join("\n") || "Not mapped.";
  return `# Root-cause investigation ${state.case_id}

## 1. Investigation status

**${status}**

## 2. Reported symptom

${state.ticket.reported_symptom ?? "Not supplied."} This statement remains **REPORTED** unless corroborated below.

## 3. Confirmed scope and event timeline

${timeline}

## 4. Expected request/data flow

${expected}

## 5. Root cause, trigger, and contributing conditions

- Root cause: ${status === "INCONCLUSIVE" ? "Not established." : analysis.root_cause ?? "Not established."}
- Trigger: ${analysis.trigger ?? "Unknown."}
- First bad state: ${analysis.first_bad_state ?? "Unknown."}
- Contributing conditions: ${(analysis.contributing_conditions ?? []).join("; ") || "None established."}

## 6. Causal chain

${causal}

## 7. Evidence

${evidenceTable(entries)}

Queries and locators are retained in the append-only ledger; retrieval time, event-time coverage, environment, and limitations are recorded per entry.

## 8. Competing hypotheses

${competitors}

## 9. Evidence gaps and limitations

${bullets((analysis.evidence_gaps ?? []).map((gap) => gap.description))}

## 10. Handoff notes

${bullets(analysis.handoff_notes)}

Rooty does not propose or apply remediation. A separate owner should decide corrective work.

## 11. Proposed reusable learning card

- Root-cause class: ${status === "CONFIRMED" ? analysis.root_cause_class ?? "unclassified" : "Not eligible for approval until confirmed."}
- Useful pivots: ${(analysis.useful_pivots ?? []).join(", ") || "None recorded."}
- Review status: draft
`;
}

async function writeReport(caseDir, state, entries) {
  const reportFile = path.join(caseDir, "report.md");
  await writeFile(reportFile, renderReport(state, entries), "utf8");
  return reportFile;
}

export async function renderExistingCase(caseDir) {
  const state = await readJson(path.join(caseDir, "case.json"));
  const entries = await readLedger(caseDir);
  verifyLedgerEntries(entries);
  const reportFile = await writeReport(caseDir, state, entries);
  return { reportFile, status: state.assessment.status };
}
