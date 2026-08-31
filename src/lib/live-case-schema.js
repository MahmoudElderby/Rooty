import { parseRfc3339Instant, parseRfc3339Range, VALID_CLASSIFICATIONS, VALID_OUTCOMES } from "./core.js";

export const DEFAULT_CAPTURE_POLICY = Object.freeze({
  max_capture_bytes: 1_048_576,
  max_model_visible_chars: 12_000,
  retention: "case"
});

export const LIVE_CASE_STATES = new Set(["OPEN", "EVIDENCE_COLLECTION", "ANALYSIS_SUBMITTED", "VERIFIED", "FINALIZED", "BLOCKED", "ABANDONED"]);
export const CAPTURE_GRADES = new Set(["VERIFIED", "PROVIDER_ATTESTED", "AGENT_RECORDED", "HUMAN_ATTESTED", "FIXTURE_VERIFIED"]);
const HASH = /^sha256:[a-f0-9]{64}$/;
const CASE_ID = /^INV-[A-Z0-9-]+$/;
const RECEIPT_ID = /^R[1-9][0-9]*$/;
const EVIDENCE_ID = /^E[1-9][0-9]*$/;
const FORBIDDEN_PERSISTED_KEY = /^(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|token|access_token|refresh_token|api[_-]?key|private[_-]?key|connection[_-]?string)$/i;

function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value;
}

function exactKeys(value, required, optional, name) {
  object(value, name);
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter((key) => value[key] === undefined);
  const extra = Object.keys(value).filter((key) => !allowed.has(key));
  if (missing.length || extra.length) throw new Error(`${name} fields are invalid; missing=[${missing.join(", ")}], extra=[${extra.join(", ")}]`);
}

function assertNoCredentialFields(value, name) {
  function visit(node, trail) {
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (FORBIDDEN_PERSISTED_KEY.test(key)) throw new Error(`${name} contains a forbidden credential field at ${trail}.${key}`);
      visit(child, `${trail}.${key}`);
    }
  }
  visit(value, name);
}

function string(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`);
}

function hash(value, name, { genesis = false } = {}) {
  if (!(genesis && value === "GENESIS") && !HASH.test(value)) throw new Error(`${name} must be a sha256 fingerprint`);
}

function stringArray(value, name) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error(`${name} must be a string array`);
  if (new Set(value).size !== value.length) throw new Error(`${name} must not contain duplicates`);
}

function validateCapturePolicy(policy) {
  exactKeys(policy, ["max_capture_bytes", "max_model_visible_chars", "retention"], [], "capture_policy");
  if (!Number.isInteger(policy.max_capture_bytes) || policy.max_capture_bytes < 1) throw new Error("capture_policy.max_capture_bytes must be positive");
  if (!Number.isInteger(policy.max_model_visible_chars) || policy.max_model_visible_chars < 1) throw new Error("capture_policy.max_model_visible_chars must be positive");
  if (!["case", "metadata-only", "none"].includes(policy.retention)) throw new Error("capture_policy.retention is invalid");
}

export function validateCaseHeader(header) {
  assertNoCredentialFields(header, "case header");
  exactKeys(header, ["schema_version", "case_id", "state", "created_at", "project", "ticket", "host", "environment", "providers", "doctor", "capture_policy"], ["current_analysis_revision", "blocked_reason", "abandoned_reason"], "case header");
  if (header.schema_version !== 1) throw new Error("Unsupported live case schema_version");
  if (!CASE_ID.test(header.case_id)) throw new Error("Invalid live case_id");
  if (!LIVE_CASE_STATES.has(header.state)) throw new Error("Invalid live case state");
  parseRfc3339Instant(header.created_at, "case created_at");
  exactKeys(header.project, ["name", "root_fingerprint"], [], "case project");
  string(header.project.name, "case project.name");
  hash(header.project.root_fingerprint, "case project.root_fingerprint");
  exactKeys(header.ticket, ["id", "source"], [], "case ticket");
  string(header.ticket.id, "case ticket.id");
  string(header.ticket.source, "case ticket.source");
  exactKeys(header.host, ["id", "config_generation"], [], "case host");
  string(header.host.id, "case host.id");
  hash(header.host.config_generation, "case host.config_generation");
  exactKeys(header.environment, ["id", "profile_hash"], [], "case environment");
  string(header.environment.id, "case environment.id");
  hash(header.environment.profile_hash, "case environment.profile_hash");
  if (!Array.isArray(header.providers) || !header.providers.length) throw new Error("case providers must be a non-empty array");
  const providerIds = new Set();
  for (const provider of header.providers) {
    exactKeys(provider, ["instance_id", "capability", "configuration_hash", "allowlist_hash"], [], "case provider");
    string(provider.instance_id, "case provider.instance_id");
    string(provider.capability, "case provider.capability");
    hash(provider.configuration_hash, "case provider.configuration_hash");
    hash(provider.allowlist_hash, "case provider.allowlist_hash");
    if (providerIds.has(provider.instance_id)) throw new Error(`Duplicate provider instance_id: ${provider.instance_id}`);
    providerIds.add(provider.instance_id);
  }
  exactKeys(header.doctor, ["verified_at", "verification_hash"], [], "case doctor");
  parseRfc3339Instant(header.doctor.verified_at, "case doctor.verified_at");
  hash(header.doctor.verification_hash, "case doctor.verification_hash");
  validateCapturePolicy(header.capture_policy);
  if (header.current_analysis_revision !== undefined && (!Number.isInteger(header.current_analysis_revision) || header.current_analysis_revision < 1)) throw new Error("current_analysis_revision must be positive");
  return header;
}

export function validateReceipt(receipt) {
  assertNoCredentialFields(receipt, "receipt");
  exactKeys(receipt, ["schema_version", "receipt_id", "case_id", "sequence", "capture_grade", "provider_instance_id", "capability", "environment", "tool", "request", "response", "event_time_coverage", "started_at", "completed_at", "configuration_hash", "allowlist_hash", "previous_hash", "entry_hash"], ["extract_hash"], "receipt");
  if (receipt.schema_version !== 1 || !RECEIPT_ID.test(receipt.receipt_id) || !CASE_ID.test(receipt.case_id)) throw new Error("Invalid receipt identity");
  if (!Number.isInteger(receipt.sequence) || receipt.sequence < 1) throw new Error("receipt.sequence must be positive");
  if (!CAPTURE_GRADES.has(receipt.capture_grade)) throw new Error("Invalid receipt capture_grade");
  for (const field of ["provider_instance_id", "capability", "environment", "tool"]) string(receipt[field], `receipt.${field}`);
  exactKeys(receipt.request, ["canonical_hash", "bounds"], [], "receipt request");
  hash(receipt.request.canonical_hash, "receipt request.canonical_hash");
  object(receipt.request.bounds, "receipt request.bounds");
  exactKeys(receipt.response, ["canonical_hash", "bytes_seen", "bytes_retained", "truncated", "sampled", "page", "next_receipt_id", "is_error"], [], "receipt response");
  hash(receipt.response.canonical_hash, "receipt response.canonical_hash");
  for (const field of ["bytes_seen", "bytes_retained"]) if (!Number.isInteger(receipt.response[field]) || receipt.response[field] < 0) throw new Error(`receipt response.${field} must be non-negative`);
  if (receipt.response.bytes_retained > receipt.response.bytes_seen) throw new Error("receipt response.bytes_retained exceeds bytes_seen");
  for (const field of ["truncated", "sampled", "is_error"]) if (typeof receipt.response[field] !== "boolean") throw new Error(`receipt response.${field} must be boolean`);
  if (!Number.isInteger(receipt.response.page) || receipt.response.page < 1) throw new Error("receipt response.page must be positive");
  if (receipt.response.next_receipt_id !== null && !RECEIPT_ID.test(receipt.response.next_receipt_id)) throw new Error("Invalid next_receipt_id");
  parseRfc3339Range(receipt.event_time_coverage, "receipt event_time_coverage");
  const started = parseRfc3339Instant(receipt.started_at, "receipt started_at");
  const completed = parseRfc3339Instant(receipt.completed_at, "receipt completed_at");
  if (started > completed) throw new Error("receipt started_at must not be after completed_at");
  for (const field of ["configuration_hash", "allowlist_hash", "entry_hash"]) hash(receipt[field], `receipt.${field}`);
  hash(receipt.previous_hash, "receipt.previous_hash", { genesis: true });
  if (receipt.extract_hash !== undefined) hash(receipt.extract_hash, "receipt.extract_hash");
  return receipt;
}

export function validateLiveEvidence(evidence) {
  assertNoCredentialFields(evidence, "live evidence");
  exactKeys(evidence, ["schema_version", "evidence_id", "case_id", "sequence", "classification", "source_type", "source_system", "environment", "event_time_range", "retrieved_at", "query_or_locator", "observation", "limitations", "receipt_refs", "capture_grade", "content_hash", "previous_hash", "entry_hash"], ["selector"], "live evidence");
  if (evidence.schema_version !== 1 || !EVIDENCE_ID.test(evidence.evidence_id) || !CASE_ID.test(evidence.case_id)) throw new Error("Invalid live evidence identity");
  if (!Number.isInteger(evidence.sequence) || evidence.sequence < 1) throw new Error("live evidence.sequence must be positive");
  if (!VALID_CLASSIFICATIONS.has(evidence.classification)) throw new Error("Invalid live evidence classification");
  for (const field of ["source_type", "source_system", "environment", "query_or_locator", "observation", "limitations"]) string(evidence[field], `live evidence.${field}`);
  parseRfc3339Range(evidence.event_time_range, "live evidence.event_time_range");
  parseRfc3339Instant(evidence.retrieved_at, "live evidence.retrieved_at");
  stringArray(evidence.receipt_refs, "live evidence.receipt_refs");
  if (!CAPTURE_GRADES.has(evidence.capture_grade)) throw new Error("Invalid live evidence.capture_grade");
  hash(evidence.content_hash, "live evidence.content_hash");
  hash(evidence.previous_hash, "live evidence.previous_hash", { genesis: true });
  hash(evidence.entry_hash, "live evidence.entry_hash");
  const nonProvider = ["local_source", "source_code"].includes(evidence.source_type);
  if (evidence.classification === "OBSERVED" && !nonProvider && evidence.receipt_refs.length === 0) throw new Error("OBSERVED provider evidence requires a receipt_ref");
  if (evidence.selector !== undefined) {
    exactKeys(evidence.selector, ["kind", "value"], [], "live evidence.selector");
    if (!['json-pointer', 'text-range'].includes(evidence.selector.kind)) throw new Error("Invalid live evidence selector kind");
    string(evidence.selector.value, "live evidence.selector.value");
  }
  return evidence;
}

function validateEvidenceRefs(value, name) {
  stringArray(value, name);
  if (value.some((item) => !EVIDENCE_ID.test(item))) throw new Error(`${name} contains an invalid evidence ID`);
}

export function validateAnalysisSubmission(analysis) {
  assertNoCredentialFields(analysis, "analysis");
  exactKeys(analysis, ["schema_version", "revision", "root_cause", "trigger", "first_bad_state", "contributing_conditions", "causal_chain", "competing_hypotheses", "reproduction", "evidence_gaps", "handoff_notes"], ["best_fit"], "analysis");
  if (analysis.schema_version !== 1 || !Number.isInteger(analysis.revision) || analysis.revision < 1) throw new Error("Invalid analysis revision");
  for (const field of ["root_cause", "trigger", "first_bad_state"]) if (typeof analysis[field] !== "string") throw new Error(`analysis.${field} must be a string`);
  stringArray(analysis.contributing_conditions, "analysis.contributing_conditions");
  if (!Array.isArray(analysis.causal_chain)) throw new Error("analysis.causal_chain must be an array");
  for (const step of analysis.causal_chain) {
    exactKeys(step, ["step", "evidence_refs"], [], "analysis causal step");
    string(step.step, "analysis causal step.step");
    validateEvidenceRefs(step.evidence_refs, "analysis causal step.evidence_refs");
  }
  if (!Array.isArray(analysis.competing_hypotheses)) throw new Error("analysis.competing_hypotheses must be an array");
  for (const hypothesis of analysis.competing_hypotheses) {
    exactKeys(hypothesis, ["statement", "status", "evidence_refs"], [], "competing hypothesis");
    string(hypothesis.statement, "competing hypothesis.statement");
    if (!["open", "eliminated", "contradicted"].includes(hypothesis.status)) throw new Error("Invalid competing hypothesis status");
    validateEvidenceRefs(hypothesis.evidence_refs, "competing hypothesis.evidence_refs");
  }
  exactKeys(analysis.reproduction, ["status", "evidence_refs"], [], "analysis reproduction");
  if (!["not_attempted", "failed", "reproduced"].includes(analysis.reproduction.status)) throw new Error("Invalid reproduction status");
  validateEvidenceRefs(analysis.reproduction.evidence_refs, "analysis reproduction.evidence_refs");
  if (!Array.isArray(analysis.evidence_gaps)) throw new Error("analysis.evidence_gaps must be an array");
  for (const gap of analysis.evidence_gaps) {
    exactKeys(gap, ["description", "critical"], [], "analysis evidence gap");
    string(gap.description, "analysis evidence gap.description");
    if (typeof gap.critical !== "boolean") throw new Error("analysis evidence gap.critical must be boolean");
  }
  stringArray(analysis.handoff_notes, "analysis.handoff_notes");
  if (analysis.best_fit !== undefined && typeof analysis.best_fit !== "boolean") throw new Error("analysis.best_fit must be boolean");
  return analysis;
}

export function validateVerification(verification) {
  assertNoCredentialFields(verification, "verification");
  exactKeys(verification, ["schema_version", "case_id", "verified_at", "valid", "outcome", "failures", "ledger_heads", "input_fingerprints"], [], "verification");
  if (verification.schema_version !== 1 || !CASE_ID.test(verification.case_id)) throw new Error("Invalid verification identity");
  parseRfc3339Instant(verification.verified_at, "verification.verified_at");
  if (typeof verification.valid !== "boolean" || !VALID_OUTCOMES.has(verification.outcome)) throw new Error("Invalid verification result");
  if (!Array.isArray(verification.failures)) throw new Error("verification.failures must be an array");
  for (const failure of verification.failures) string(failure, "verification failure");
  object(verification.ledger_heads, "verification.ledger_heads");
  object(verification.input_fingerprints, "verification.input_fingerprints");
  for (const [name, value] of Object.entries({ ...verification.ledger_heads, ...verification.input_fingerprints })) hash(value, `verification fingerprint ${name}`, { genesis: true });
  return verification;
}
