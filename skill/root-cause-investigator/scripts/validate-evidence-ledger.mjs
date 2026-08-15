#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

const file = process.argv[2];
if (!file) throw new Error("Usage: validate-evidence-ledger.mjs <evidence.ndjson>");
const entries = (await readFile(file, "utf8")).split(/\r?\n/).filter(Boolean).map(JSON.parse);
let previous = "GENESIS";
const ids = new Set();
for (let index = 0; index < entries.length; index += 1) {
  const { entry_hash: actual, ...base } = entries[index];
  const expected = createHash("sha256").update(canonical(base)).digest("hex");
  if (base.sequence !== index + 1 || base.previous_hash !== previous || actual !== expected || ids.has(base.evidence_id)) {
    throw new Error(`Invalid ledger entry at line ${index + 1}`);
  }
  ids.add(base.evidence_id);
  previous = actual;
}
process.stdout.write(`valid ledger: ${entries.length} entries; head ${previous}\n`);
