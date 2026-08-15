import path from "node:path";
import { readLedger } from "./cases.js";
import { isoNow, readJson, sha256, writeJson } from "./core.js";

const SENSITIVE_VALUE = /(-----BEGIN [A-Z ]+PRIVATE KEY-----|\b(?:sk|ghp|xox[baprs])_[A-Za-z0-9_-]{12,}|password\s*[:=]\s*\S+)/i;

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

export async function proposeMemory({ projectRoot, caseDir }) {
  const state = await readJson(path.join(caseDir, "case.json"));
  const entries = await readLedger(caseDir);
  const analysis = state.analysis;
  const card = {
    schema_version: 1,
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
    proposed_at: isoNow(),
    content_fingerprint: sha256({ root_cause_class: analysis.root_cause_class, symptom_signature: analysis.symptom_signature ?? {} })
  };
  assertSanitized(card);
  const file = path.join(projectRoot, ".investigator/memory/drafts", `${state.case_id}.json`);
  await writeJson(file, card);
  return { file, card };
}

export async function approveMemory({ projectRoot, draftFile, reviewedBy }) {
  const card = await readJson(draftFile);
  if (card.review_status !== "draft") throw new Error("Only draft case cards can be approved");
  if (card.source_case_status !== "CONFIRMED") throw new Error("Only CONFIRMED investigations may enter approved memory");
  if (!reviewedBy.trim()) throw new Error("reviewed-by must identify a human or accountable team");
  const reviewedAt = new Date();
  const expiresAt = new Date(reviewedAt.getTime() + 180 * 24 * 3_600_000);
  const approved = {
    ...card,
    review_status: "approved",
    reviewed_by: reviewedBy,
    reviewed_at: reviewedAt.toISOString(),
    expires_at: expiresAt.toISOString()
  };
  assertSanitized(approved);
  const file = path.join(projectRoot, ".investigator/memory/approved", `${card.case_id}.json`);
  await writeJson(file, approved);
  return { file, card: approved };
}
