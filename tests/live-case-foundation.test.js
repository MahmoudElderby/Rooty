import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { appendLedgerEntry, atomicWriteCaseJson, CASE_LOCK_FILE, readNdjson, withCaseLock, writeContentAddressedExtract } from "../src/lib/case-store.js";
import { validateEvidence } from "../src/lib/cases.js";
import { canonicalJson, fingerprint, parseRfc3339Instant, parseRfc3339Range, sha256 } from "../src/lib/core.js";
import { DEFAULT_CAPTURE_POLICY, validateAnalysisSubmission, validateCaseHeader, validateLiveEvidence, validateReceipt, validateVerification } from "../src/lib/live-case-schema.js";

async function caseDirectory() {
  return mkdtemp(path.join(os.tmpdir(), "rooty-live-case-"));
}

function verifyTestLedger(entries) {
  let previous = "GENESIS";
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    assert.equal(entry.sequence, index + 1);
    assert.equal(entry.previous_hash, previous);
    const { entry_hash, ...base } = entry;
    assert.equal(entry_hash, sha256(canonicalJson(base)));
    previous = entry_hash;
  }
  return { count: entries.length, head: previous };
}

test("strict RFC 3339 parsing rejects local, invalid, inverted, and unbounded evidence times", () => {
  assert.equal(parseRfc3339Instant("2026-08-30T20:10:00+02:00"), Date.parse("2026-08-30T20:10:00+02:00"));
  assert.deepEqual(parseRfc3339Range("2026-08-30T18:10:00Z/2026-08-30T18:10:00Z").from, "2026-08-30T18:10:00Z");
  assert.throws(() => parseRfc3339Instant("2026-08-30T20:10:00"), /explicit offset/);
  assert.throws(() => parseRfc3339Instant("2026-02-30T20:10:00Z"), /calendar instant/);
  assert.throws(() => parseRfc3339Range("2026-08-30T20:11:00Z/2026-08-30T20:10:00Z"), /must not be after/);
  assert.throws(() => parseRfc3339Range("2026-08-30T20:10:00Z/"), /two bounded/);
  assert.throws(() => validateEvidence({
    evidence_id: "E1", classification: "OBSERVED", source_type: "log", source_system: "test", environment: "test",
    event_time_range: "2026-08-30T20:10:00/2026-08-30T20:11:00Z", retrieved_at: "2026-08-30T20:12:00Z",
    query_or_locator: "bounded", observation: "test", limitations: "none"
  }), /explicit offset/);
});

test("case store serializes concurrent ledger appends and flushes an intact chain", async () => {
  const caseDir = await caseDirectory();
  const append = (label) => appendLedgerEntry(caseDir, "events.ndjson", ({ entries, verification }) => {
    const base = { sequence: entries.length + 1, previous_hash: verification.head, label };
    return { ...base, entry_hash: sha256(canonicalJson(base)) };
  }, verifyTestLedger, { timeoutMs: 5_000 });
  await Promise.all(Array.from({ length: 20 }, (_, index) => append(`event-${index}`)));
  const entries = await readNdjson(path.join(caseDir, "events.ndjson"));
  assert.equal(entries.length, 20);
  assert.equal(new Set(entries.map((entry) => entry.label)).size, 20);
  assert.equal(verifyTestLedger(entries).count, 20);
  await assert.rejects(readFile(path.join(caseDir, CASE_LOCK_FILE), "utf8"), { code: "ENOENT" });
});

test("case lock recovers only a sufficiently old lock owned by a dead process", async () => {
  const caseDir = await caseDirectory();
  const lockFile = path.join(caseDir, CASE_LOCK_FILE);
  await writeFile(lockFile, `${JSON.stringify({ pid: 2_147_483_647, created_at: "2000-01-01T00:00:00Z", nonce: "stale" })}\n`);
  const result = await withCaseLock(caseDir, () => "recovered", { timeoutMs: 100, staleAfterMs: 1 });
  assert.equal(result, "recovered");
  await writeFile(lockFile, `${JSON.stringify({ pid: process.pid, created_at: "2000-01-01T00:00:00Z", nonce: "live" })}\n`);
  await assert.rejects(withCaseLock(caseDir, () => "unsafe", { timeoutMs: 30, staleAfterMs: 1, retryMs: 5 }), /locked by PID/);
});

test("atomic case documents leave no temporary files", async () => {
  const caseDir = await caseDirectory();
  const file = path.join(caseDir, "case.json");
  await atomicWriteCaseJson(file, { schema_version: 1, state: "OPEN" });
  await atomicWriteCaseJson(file, { schema_version: 1, state: "VERIFIED" });
  assert.equal(JSON.parse(await readFile(file, "utf8")).state, "VERIFIED");
  assert.deepEqual((await readdir(caseDir)).filter((name) => name.endsWith(".tmp")), []);
});

test("content-addressed extracts preserve bytes and deduplicate by hash", async () => {
  const caseDir = await caseDirectory();
  const bytes = Buffer.from([0, 255, 1, 2, 3]);
  const first = await writeContentAddressedExtract(caseDir, bytes);
  const second = await writeContentAddressedExtract(caseDir, bytes);
  assert.equal(first.file, second.file);
  assert.equal(first.content_hash, `sha256:${sha256(bytes)}`);
  assert.deepEqual(await readFile(first.file), bytes);
});

test("live runtime schemas accept the contract and reject caller-supplied security fields", () => {
  const H = fingerprint("foundation-test");
  const caseHeader = {
    schema_version: 1, case_id: "INV-20260830-ABC123", state: "OPEN", created_at: "2026-08-30T18:00:00Z",
    project: { name: "Rooty", root_fingerprint: H }, ticket: { id: "ROOTY-123", source: "jira" },
    host: { id: "codex", config_generation: H }, environment: { id: "production", profile_hash: H },
    providers: [{ instance_id: "rooty-production-observability", capability: "observability", configuration_hash: H, allowlist_hash: H }],
    doctor: { verified_at: "2026-08-30T17:59:00Z", verification_hash: H }, capture_policy: { ...DEFAULT_CAPTURE_POLICY }
  };
  assert.equal(validateCaseHeader(caseHeader), caseHeader);
  assert.throws(() => validateCaseHeader({ ...caseHeader, authorization: "secret" }), /forbidden credential field/);

  const receipt = {
    schema_version: 1, receipt_id: "R1", case_id: caseHeader.case_id, sequence: 1, capture_grade: "AGENT_RECORDED",
    provider_instance_id: "rooty-production-observability", capability: "observability", environment: "production", tool: "logs_search",
    request: { canonical_hash: H, bounds: { from: "2026-08-30T18:00:00Z", to: "2026-08-30T18:05:00Z", limit: 100 } },
    response: { canonical_hash: H, bytes_seen: 10, bytes_retained: 10, truncated: false, sampled: false, page: 1, next_receipt_id: null, is_error: false },
    event_time_coverage: "2026-08-30T18:00:00Z/2026-08-30T18:05:00Z", started_at: "2026-08-30T18:06:00Z", completed_at: "2026-08-30T18:06:01Z",
    configuration_hash: H, allowlist_hash: H, previous_hash: "GENESIS", entry_hash: H
  };
  assert.equal(validateReceipt(receipt), receipt);
  assert.throws(() => validateReceipt({ ...receipt, capture_grade: "VERIFIED", bearer_token: "forged" }), /extra=\[bearer_token\]/);
  assert.throws(() => validateReceipt({ ...receipt, request: { ...receipt.request, bounds: { ...receipt.request.bounds, authorization: "Bearer secret" } } }), /forbidden credential field/);

  const evidence = {
    schema_version: 1, evidence_id: "E1", case_id: caseHeader.case_id, sequence: 1, classification: "OBSERVED", source_type: "logs", source_system: "observability", environment: "production",
    event_time_range: receipt.event_time_coverage, retrieved_at: receipt.completed_at, query_or_locator: "bounded logs", observation: "Timeouts began after a deploy.", limitations: "none",
    receipt_refs: ["R1"], selector: { kind: "json-pointer", value: "/result/content/0" }, capture_grade: "AGENT_RECORDED", content_hash: H, previous_hash: "GENESIS", entry_hash: H
  };
  assert.equal(validateLiveEvidence(evidence), evidence);
  assert.throws(() => validateLiveEvidence({ ...evidence, receipt_refs: [] }), /requires a receipt_ref/);

  const analysis = {
    schema_version: 1, revision: 1, root_cause: "Timeout configuration", trigger: "Deploy", first_bad_state: "New timeout loaded", contributing_conditions: [],
    causal_chain: [{ step: "Deploy loaded the new value", evidence_refs: ["E1"] }], competing_hypotheses: [{ statement: "Database outage", status: "eliminated", evidence_refs: ["E1"] }],
    reproduction: { status: "not_attempted", evidence_refs: [] }, evidence_gaps: [], handoff_notes: []
  };
  assert.equal(validateAnalysisSubmission(analysis), analysis);
  assert.throws(() => validateAnalysisSubmission({ ...analysis, status: "CONFIRMED" }), /extra=\[status\]/);

  const verification = { schema_version: 1, case_id: caseHeader.case_id, verified_at: "2026-08-30T18:10:00Z", valid: true, outcome: "PROBABLE", failures: [], ledger_heads: { receipts: H, evidence: H }, input_fingerprints: { analysis: H } };
  assert.equal(validateVerification(verification), verification);
  assert.throws(() => validateVerification({ ...verification, outcome: "CERTAIN" }), /Invalid verification result/);
});
