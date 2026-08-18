import path from "node:path";
import { assessCase, assertCaseDirectoryOutsideProject, readLedger, verifyLedgerEntries } from "./cases.js";
import { canonicalJson, isoNow, pathExists, readJson, sha256, writeJson } from "./core.js";
import { ensureMemoryDirectories, listMemoryCards, memoryRoots, resolveMemoryDraft } from "./memory-store.js";

const SENSITIVE_VALUE = /(-----BEGIN [A-Z ]+PRIVATE KEY-----|\b(?:sk|ghp|xox[baprs])_[A-Za-z0-9_-]{12,}|password\s*[:=]\s*\S+)/i;
const V2_DRAFT_FIELDS = new Set([
  "schema_version", "case_id", "review_status", "services", "environments", "symptom_signature",
  "root_cause_class", "trigger_class", "useful_pivots", "query_recipes", "validated_versions",
  "evidence_refs", "source_case_status", "proposed_at", "source_case_fingerprint",
  "source_ledger_head", "source_ledger_count", "content_fingerprint"
]);
const V3_DRAFT_FIELDS = new Set([
  ...V2_DRAFT_FIELDS,
  "scope", "kind", "canonical_key", "statement", "applicability", "supersedes",
  "proposed_disposition", "learning_fingerprint"
]);
const LEARNING_SCOPES = new Set(["universal", "project", "case_only"]);
const LEARNING_KINDS = new Set(["method", "source_mapping", "query_recipe", "failure_pattern"]);
const LEARNING_DISPOSITIONS = new Set(["upstream_proposal", "project_memory", "case_notes"]);

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
  const fields = card.schema_version === 2 ? V2_DRAFT_FIELDS : card.schema_version === 3 ? V3_DRAFT_FIELDS : undefined;
  if (!fields) throw new Error("Invalid case-card schema_version");
  const extra = Object.keys(card).filter((key) => !fields.has(key));
  const missing = [...fields].filter((key) => !Object.hasOwn(card, key));
  if (extra.length || missing.length) throw new Error(`Invalid case-card schema: extra=[${extra.join(", ")}], missing=[${missing.join(", ")}]`);
  if (!/^INV-[A-Z0-9-]+$/.test(card.case_id)) throw new Error("Invalid case-card case_id");
  if (card.review_status !== "draft") throw new Error("Only draft case cards can be approved");
  for (const field of ["services", "environments", "useful_pivots", "query_recipes", "validated_versions", "evidence_refs"]) assertStringArray(card[field], field);
  if (!card.symptom_signature || typeof card.symptom_signature !== "object" || Array.isArray(card.symptom_signature)) throw new Error("Invalid case-card symptom_signature");
  for (const field of ["root_cause_class", "trigger_class", "source_case_status", "proposed_at", "source_case_fingerprint", "source_ledger_head", "content_fingerprint"]) {
    if (typeof card[field] !== "string" || !card[field]) throw new Error(`Invalid case-card schema: ${field}`);
  }
  if (!Number.isInteger(card.source_ledger_count) || card.source_ledger_count < 1) throw new Error("Invalid case-card source_ledger_count");
  if (!Number.isFinite(Date.parse(card.proposed_at))) throw new Error("Invalid case-card proposed_at");
  for (const field of ["source_case_fingerprint", "content_fingerprint", ...(card.schema_version === 3 ? ["learning_fingerprint"] : [])]) {
    if (!/^[a-f0-9]{64}$/.test(card[field])) throw new Error(`Invalid case-card ${field}`);
  }
  if (card.source_ledger_head !== "GENESIS" && !/^[a-f0-9]{64}$/.test(card.source_ledger_head)) throw new Error("Invalid case-card source_ledger_head");
  if (card.schema_version === 3) {
    if (!LEARNING_SCOPES.has(card.scope)) throw new Error("Invalid case-card scope");
    if (!LEARNING_KINDS.has(card.kind)) throw new Error("Invalid case-card kind");
    if (!/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/.test(card.canonical_key)) throw new Error("Invalid case-card canonical_key");
    if (typeof card.statement !== "string" || !card.statement.trim()) throw new Error("Invalid case-card statement");
    if (!card.applicability || typeof card.applicability !== "object" || Array.isArray(card.applicability)) throw new Error("Invalid case-card applicability");
    for (const field of ["services", "environments", "validated_versions"]) assertStringArray(card.applicability[field], `applicability.${field}`);
    assertStringArray(card.supersedes, "supersedes");
    if (!card.supersedes.every((value) => /^INV-[A-Z0-9-]+$/.test(value))) throw new Error("Invalid case-card supersedes");
    if (!LEARNING_DISPOSITIONS.has(card.proposed_disposition)) throw new Error("Invalid case-card proposed_disposition");
    if (card.scope === "project" && card.proposed_disposition !== "project_memory") throw new Error("Project memory must use project_memory disposition");
    if (card.scope === "universal" && card.proposed_disposition !== "upstream_proposal") throw new Error("Universal learning must use upstream_proposal disposition");
    if (card.scope === "case_only" && card.proposed_disposition !== "case_notes") throw new Error("Case-only learning must use case_notes disposition");
  }
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

function canonicalSegment(value, fallback) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized || fallback;
}

function learningMetadata(card) {
  const kind = "failure_pattern";
  const canonicalKey = `${kind}:${canonicalSegment(card.root_cause_class, "unclassified")}:${canonicalSegment(card.trigger_class, "unknown")}`;
  const applicability = {
    services: card.services,
    environments: card.environments,
    validated_versions: card.validated_versions
  };
  const metadata = {
    scope: "project",
    kind,
    canonical_key: canonicalKey,
    statement: `Use the recorded pivots and bounded query recipes when testing ${card.root_cause_class} triggered by ${card.trigger_class}.`,
    applicability,
    supersedes: [],
    proposed_disposition: "project_memory"
  };
  return {
    ...metadata,
    learning_fingerprint: sha256({
      ...metadata,
      applicability: Object.fromEntries(Object.entries(applicability).map(([key, values]) => [key, [...new Set(values)].sort()])),
      root_cause_class: card.root_cause_class,
      trigger_class: card.trigger_class,
      useful_pivots: [...new Set(card.useful_pivots)].sort(),
      query_recipes: [...new Set(card.query_recipes)].sort()
    })
  };
}

function memoryIdentity(card) {
  if (card.schema_version === 3) {
    return { canonicalKey: card.canonical_key, fingerprint: card.learning_fingerprint };
  }
  const metadata = learningMetadata(card);
  return { canonicalKey: metadata.canonical_key, fingerprint: metadata.learning_fingerprint };
}

async function assertNoDuplicateMemory(projectRoot, card, { kinds = ["draft", "approved"], exclude } = {}) {
  const identity = memoryIdentity(card);
  for (const kind of kinds) {
    for (const file of await listMemoryCards(projectRoot, kind)) {
      if (exclude && path.resolve(file) === path.resolve(exclude)) continue;
      const existing = await readJson(file);
      if (!existing || ![2, 3].includes(existing.schema_version)) continue;
      const existingIdentity = memoryIdentity(existing);
      if (existingIdentity.fingerprint === identity.fingerprint) {
        throw new Error(`Duplicate reusable learning already exists: ${file}`);
      }
      if (existingIdentity.canonicalKey === identity.canonicalKey) {
        throw new Error(`Overlapping reusable learning is blocked pending an explicit reviewed supersession workflow: ${file}`);
      }
    }
  }
}

function buildCard(state, entries, verification, proposedAt) {
  const analysis = state.analysis;
  const card = {
    schema_version: 3,
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
  Object.assign(card, learningMetadata(card));
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
  const roots = await ensureMemoryDirectories(projectRoot);
  await assertNoDuplicateMemory(projectRoot, card);
  const file = path.join(roots.drafts, `${state.case_id}.json`);
  if (await pathExists(file)) throw new Error(`Refusing to overwrite existing memory draft: ${file}`);
  await writeJson(file, card);
  return { file, card };
}

export async function approveMemory({ projectRoot, draftFile, reviewedBy, caseDir }) {
  if (!caseDir) throw new Error("memory approve requires the verified --case-dir source");
  await assertCaseDirectoryOutsideProject(projectRoot, caseDir);
  const roots = await ensureMemoryDirectories(projectRoot);
  const safeDraft = await resolveMemoryDraft(projectRoot, draftFile);
  const card = await readJson(safeDraft);
  validateDraftCard(card);
  const validParent = [roots.drafts, roots.legacyDrafts].some((root) => path.resolve(path.dirname(safeDraft)) === path.resolve(root));
  if (!validParent || path.basename(safeDraft) !== `${card.case_id}.json`) throw new Error("Draft filename must match its case_id");
  if (!String(reviewedBy ?? "").trim()) throw new Error("reviewed-by must identify a human or accountable team");

  const state = await readJson(path.join(caseDir, "case.json"));
  const entries = await readLedger(caseDir);
  const verification = verifyLedgerEntries(entries);
  const assessment = recomputeAssessment(state, entries);
  if (assessment.status !== "CONFIRMED") throw new Error("Only currently verified CONFIRMED investigations may enter approved memory");
  if (state.case_id !== card.case_id) throw new Error("Draft does not belong to the supplied source case");
  const expected = card.schema_version === 2
    ? { ...buildCard(state, entries, verification, card.proposed_at), schema_version: 2 }
    : buildCard(state, entries, verification, card.proposed_at);
  if (card.schema_version === 2) {
    for (const field of [...V3_DRAFT_FIELDS].filter((field) => !V2_DRAFT_FIELDS.has(field))) delete expected[field];
    expected.content_fingerprint = sha256(Object.fromEntries(Object.entries(expected).filter(([key]) => key !== "content_fingerprint")));
  }
  if (canonicalJson(card) !== canonicalJson(expected)) throw new Error("Draft fingerprint or source-case content does not match the verified case and evidence ledger");
  if (card.schema_version === 3 && card.scope !== "project") throw new Error("Only project-scoped learnings can enter local approved memory");
  await assertNoDuplicateMemory(projectRoot, card, { kinds: ["approved"] });

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
  const file = path.join(roots.approved, `${card.case_id}.json`);
  if (await pathExists(file)) throw new Error(`Refusing to overwrite approved memory: ${file}`);
  await writeJson(file, approved);
  return { file, card: approved };
}
