#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const [modelFile, outputFile] = process.argv.slice(2);
if (!modelFile || !outputFile) throw new Error("Usage: render-report.mjs <report-model.json> <report.md>");
const model = JSON.parse(await readFile(modelFile, "utf8"));
if (!["CONFIRMED", "PROBABLE", "INCONCLUSIVE"].includes(model.status)) throw new Error("Invalid investigation status");
const required = ["reported_symptom", "timeline", "expected_flow", "causal_chain", "evidence", "competing_hypotheses", "gaps", "handoff"];
const missing = required.filter((key) => model[key] === undefined);
if (missing.length) throw new Error(`Missing report fields: ${missing.join(", ")}`);
if (model.status === "INCONCLUSIVE" && model.root_cause) throw new Error("INCONCLUSIVE reports must not claim a root cause");
const section = (title, value) => `## ${title}\n\n${Array.isArray(value) ? value.map((item) => `- ${typeof item === "string" ? item : JSON.stringify(item)}`).join("\n") || "None." : value || "None."}`;
const report = [`# Root-cause investigation ${model.case_id}`, section("1. Investigation status", `**${model.status}**`), section("2. Reported symptom", model.reported_symptom), section("3. Confirmed scope and event timeline", model.timeline), section("4. Expected request/data flow", model.expected_flow), section("5. Root cause, trigger, and contributing conditions", model.root_cause ?? "Not established."), section("6. Causal chain", model.causal_chain), section("7. Evidence", model.evidence), section("8. Competing hypotheses", model.competing_hypotheses), section("9. Evidence gaps and limitations", model.gaps), section("10. Handoff notes", model.handoff), section("11. Proposed reusable learning card", model.learning_card ?? "Draft not proposed.")].join("\n\n");
await writeFile(outputFile, `${report}\n`, "utf8");
