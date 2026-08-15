import path from "node:path";
import { assessCase, assertCaseDirectoryOutsideProject, readLedger, verifyLedgerEntries } from "./cases.js";
import { canonicalJson, ensureInside, isoNow, pathExists, readJson, sha256, writeJson } from "./core.js";

const SENSITIVE_VALUE = /(-----BEGIN [A-Z ]+PRIVATE KEY-----|\b(?:sk|ghp|xox[baprs])_[A-Za-z0-9_-]{12,}|password\s*[:=]\s*\S+)/i;
const DRAFT_FIELDS = new Set([
  "schema_version", "case_id", "review_status", "services", "environments", "symptom_signature",
  "root_cause_class", "trigger_class", "useful_pivots", "query_recipes", "validated_versions",
  "evidence_refs", "source_case_status", "proposed_at", "source_case_fingerprint",
  "source_ledger_head", "source_ledger_count", "content_fingerprint"
]);

function assertSanitized(card) {
  const serialized = JSON.stringify(card);
  if (SENSITIVE_VALUE.test(serialized)) throw new Error("Potential secret detected; memory promotion refused");
  const forbidden = ["raw_logs", "payload", "customer_email", "access_token", "api_key", "password"];
  const found = [];
  function visit(value, trail) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (forbidden.includes(key.toLowerCase())) found.push(`${trail}.${key}`);
      visit(child, `${trail}.${key}`);
    }
  }
  visit(card, "card");
  if (found.length > 0) throw new Error(`Restricted memory fields: ${found.join(", ")}`);
}

function assertStringArray(value, name) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(`Invalid case-card schema: ${name} must be a string array`);
}

function validateDraftCard(card) {
  if (!card || typeof card !== "object" || Array.isArray(card)) throw new Error("Invalid case-card schema: card must be an object");
  const extra = Object.keys(card).filter((key) => !DRAFT_FIELDS.has(key));
  const missing = [...DRAFT_FIELDS].filter((key) => !Object.hasOwn(card, key));
  if (extra.length || missing.length) throw new Error(`Invalid case-card schema: extra=[${extra.join(", ")}], missing=[${missing.join(", ")}]`);
  if (card.schema_version !== 2) throw new Error("Invalid case-card schema_version");
  if (!/^INV-[A-Z0-9-]+$/.test(card.case_id)) throw new Error("Invalid case-card case_id");
  if (card.review_status !== "draft") throw new Error("Only draft case cards can be approved");
  for (const field of ["services", "environments", "useful_pivots", "query_recipes", "validated_versions", "evidence_refs"]) assertStringArray(card[field], field);
  if (!card.symptom_signature || typeof card.symptom_signature !== "object" || Array.isArray(card.symptom_signature)) throw new Error("Invalid case-card symptom_signature");
  for (const field of ["root_cause_class", "trigger_class", "source_case_status", "proposed_at", "source_case_fingerprint", "source_ledger_head", "content_fingerprint"]) {
    if (typeof card[field] !== "string" || !card[field]) throw new Error(`Invalid case-card schema: ${field}`);
  }
  if (!Number.isInteger(card.source_ledger_count) || card.source_ledger_count < 1) throw new Error("Invalid case-card source_ledger_count");
  if (!Number.isFinite(Date.parse(card.proposed_at))) throw new Error("Invalid case-card proposed_at");
  for (const field of ["source_case_fingerprint", "content_fingerprint"]) {
    if (!/^[a-f0-9]{64}$/.test(card[field])) throw new Error(`Invalid case-card ${field}`);
  }
  if (card.source_ledger_head !== "GENESIS" && !/^[a-f0-9]{64}$/.test(card.source_ledger_head)) throw new Error("Invalid case-card source_ledger_head");
  assertSanitized(card);
}

function recomputeAssessment(state, entries) {
  const assessment = assessCase({ analysis: state.analysis, evidence: entries });
  if (canonicalJson(assessment) !== canonicalJson(state.assessment)) throw new Error("Source case assessment does not match its verified evidence ledger");
  return assessment;
}

function sourceCaseFingerprint(state, verification) {
  return sha256({
    schema_version: state.schema_version,
    case_id: state.case_id,
    project: state.project,
    ticket: state.ticket,
    expected_path: state.expected_path,
    hypotheses: state.hypotheses,
    analysis: state.analysis,
    assessment: state.assessment,
    source_snapshot_sha256: state.source_snapshot_sha256,
    ledger_head: verification.head,
    ledger_count: verification.count
  });
}

function buildCard(state, entries, verification, proposedAt) {
  const analysis = state.analysis;
  const card = {
    schema_version: 2,
    case_id: state.case_id,
    review_status: "draft",
    services: analysis.services ?? [state.project],
    environments: [...new Set(entries.map((entry) => entry.environment))],
    symptom_signature: analysis.symptom_signature ?? {},
    root_cause_class: state.assessment.status === "CONFIRMED" ? analysis.root_cause_class ?? "unclassified" : "unconfirmed",
    trigger_class: analysis.trigger_class ?? "unknown",
    useful_pivots: analysis.useful_pivots ?? [],
    query_recipes: analysis.query_recipes ?? [],
    validated_versions: analysis.validated_versions ?? [],
    evidence_refs: entries.filter((entry) => entry.classification === "OBSERVED").map((entry) => entry.evidence_id),
    source_case_status: state.assessment.status,
    proposed_at: proposedAt,
    source_case_fingerprint: sourceCaseFingerprint(state, verification),
    source_ledger_head: verification.head,
    source_ledger_count: verification.count
  };
  card.content_fingerprint = sha256(card);
  return card;
}

export async function proposeMemory({ projectRoot, caseDir }) {
  await assertCaseDirectoryOutsideProject(projectRoot, caseDir);
  const state = await readJson(path.join(caseDir, "case.json"));
  const entries = await readLedger(caseDir);
  const verification = verifyLedgerEntries(entries);
  const assessment = recomputeAssessment(state, entries);
  if (assessment.status !== "CONFIRMED") throw new Error("Only currently verified CONFIRMED investigations may propose reusable memory");
  const card = buildCard(state, entries, verification, isoNow());
  validateDraftCard(card);
  const file = path.join(projectRoot, ".investigator/memory/drafts", `${state.case_id}.json`);
  if (await pathExists(file)) throw new Error(`Refusing to overwrite existing memory draft: ${file}`);
  await writeJson(file, card);
  return { file, card };
}

export async function approveMemory({ projectRoot, draftFile, reviewedBy, caseDir }) {
  if (!caseDir) throw new Error("memory approve requires the verified --case-dir source");
  await assertCaseDirectoryOutsideProject(projectRoot, caseDir);
  const draftRoot = path.join(projectRoot, ".investigator/memory/drafts");
  const safeDraft = ensureInside(draftRoot, draftFile);
  const card = await readJson(safeDraft);
  validateDraftCard(card);
  if (path.resolve(safeDraft) !== path.resolve(draftRoot, `${card.case_id}.json`)) throw new Error("Draft filename must match its case_id");
  if (!String(reviewedBy ?? "").trim()) throw new Error("reviewed-by must identify a human or accountable team");

  const state = await readJson(path.join(caseDir, "case.json"));
  const entries = await readLedger(caseDir);
  const verification = verifyLedgerEntries(entries);
  const assessment = recomputeAssessment(state, entries);
  if (assessment.status !== "CONFIRMED") throw new Error("Only currently verified CONFIRMED investigations may enter approved memory");
  if (state.case_id !== card.case_id) throw new Error("Draft does not belong to the supplied source case");
  const expected = buildCard(state, entries, verification, card.proposed_at);
  if (canonicalJson(card) !== canonicalJson(expected)) throw new Error("Draft fingerprint or source-case content does not match the verified case and evidence ledger");

  const reviewedAt = new Date();
  const expiresAt = new Date(reviewedAt.getTime() + 180 * 24 * 3_600_000);
  const approved = {
    ...card,
    review_status: "approved",
    reviewed_by: reviewedBy.trim(),
    reviewed_at: reviewedAt.toISOString(),
    expires_at: expiresAt.toISOString()
  };
  assertSanitized(approved);
  const file = path.join(projectRoot, ".investigator/memory/approved", `${card.case_id}.json`);
  if (await pathExists(file)) throw new Error(`Refusing to overwrite approved memory: ${file}`);
  await writeJson(file, approved);
  return { file, card: approved };
}
