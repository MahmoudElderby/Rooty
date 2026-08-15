import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assessCase, appendEvidence, readLedger, renderExistingCase, runFrozenCase, verifyLedgerEntries } from "../src/lib/cases.js";
import { runDoctor } from "../src/lib/doctor.js";
import { runEvaluation } from "../src/lib/evaluate.js";
import { initializeHosts } from "../src/lib/hosts.js";
import { callReadTool, TOOLS } from "../src/lib/mcp.js";
import { approveMemory, proposeMemory } from "../src/lib/memory.js";
import { materializeReplayCase } from "../src/lib/replay.js";
import { configureSources, discoverSources, listSources } from "../src/lib/sources.js";
import { readJson } from "../src/lib/core.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = path.join(ROOT, "evals/mock-sources/confirmed-timeout.json");

async function tempDirectory(name) {
  return mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

test("all 15 replay cases meet their stopping-rule outcomes", async () => {
  const suite = await readJson(path.join(ROOT, "evals/cases/replay-cases.json"));
  assert.equal(suite.cases.length, 15);
  for (const item of suite.cases) {
    const input = materializeReplayCase(item);
    assert.equal(assessCase(input).status, item.expected.status, item.id);
  }
  const result = await runEvaluation({ casesFile: path.join(ROOT, "evals/cases/replay-cases.json") });
  assert.equal(result.ok, true);
  assert.equal(result.passed, 15);
  assert.equal(result.unsupported_confirmations, 0);
  assert.equal(result.mutations_blocked, result.mutation_attempts);
});

test("vertical slice creates a hash-chained ledger, report, and reviewed memory", async () => {
  const projectRoot = await tempDirectory("rooty-project");
  const caseDir = path.join(await tempDirectory("rooty-cases"), "demo");
  const result = await runFrozenCase({ projectRoot, ticket: "ROOTY-101", snapshotFile: SNAPSHOT, caseDir });
  assert.equal(result.status, "CONFIRMED");
  const entries = await readLedger(caseDir);
  assert.equal(verifyLedgerEntries(entries).count, 5);
  const report = await readFile(result.reportFile, "utf8");
  assert.match(report, /\*\*CONFIRMED\*\*/);
  assert.match(report, /## 8\. Competing hypotheses/);
  assert.doesNotMatch(report, /## Remediation plan/);

  const extra = {
    evidence_id: "E6",
    classification: "UNKNOWN",
    source_type: "retention-check",
    source_system: "datadog-prod-snapshot",
    environment: "production",
    event_time_range: "2026-08-14T11:00:00Z/2026-08-14T11:10:00Z",
    retrieved_at: "2026-08-15T12:25:00Z",
    query_or_locator: "retention=30d",
    observation: "No additional provider-body evidence is retained.",
    limitations: "Body was redacted at collection time."
  };
  const appended = await appendEvidence(caseDir, extra);
  assert.equal(appended.sequence, 6);
  assert.equal(verifyLedgerEntries(await readLedger(caseDir)).count, 6);
  await renderExistingCase(caseDir);

  const draft = await proposeMemory({ projectRoot, caseDir });
  assert.equal(draft.card.review_status, "draft");
  const approved = await approveMemory({ projectRoot, draftFile: draft.file, reviewedBy: "team-payments" });
  assert.equal(approved.card.review_status, "approved");
  assert.equal(approved.card.source_case_status, "CONFIRMED");
  assert.equal(Object.hasOwn(approved.card, "raw_logs"), false);
  const unsafeDraft = { ...draft.card, symptom_signature: { customer_email: "person@example.test" } };
  const unsafeFile = path.join(projectRoot, "unsafe-draft.json");
  await writeFile(unsafeFile, `${JSON.stringify(unsafeDraft)}\n`, "utf8");
  await assert.rejects(() => approveMemory({ projectRoot, draftFile: unsafeFile, reviewedBy: "team-payments" }), /Restricted memory fields/);
});

test("tampering with an evidence ledger is detected", async () => {
  const projectRoot = await tempDirectory("rooty-project");
  const caseDir = path.join(await tempDirectory("rooty-cases"), "tamper");
  await runFrozenCase({ projectRoot, ticket: "ROOTY-101", snapshotFile: SNAPSHOT, caseDir });
  const entries = await readLedger(caseDir);
  entries[1].observation = "rewritten observation";
  assert.throws(() => verifyLedgerEntries(entries), /modified/);
});

test("discovery configures only credential references and host adapters refuse overwrite", async () => {
  const projectRoot = await tempDirectory("rooty-discovery");
  await writeFile(path.join(projectRoot, "README.md"), "Jira and Confluence. Datadog via DD_API_KEY. PostgreSQL DATABASE_URL. ArgoCD deployments.\n", "utf8");
  const discovery = await discoverSources({ packageRoot: ROOT, projectRoot });
  assert.ok(discovery.detections.some((item) => item.provider === "datadog"));
  const configured = await configureSources({
    packageRoot: ROOT,
    projectRoot,
    endpoints: {
      ticketing: "https://mcp.example.test/atlassian",
      observability: "https://mcp.example.test/observability",
      database: "https://mcp.example.test/database",
      deployments: "https://mcp.example.test/deployments"
    },
    auth: { observability: "oauth", database: "oauth", deployments: "oauth" }
  });
  assert.deepEqual(configured.unresolved, []);
  const serialized = JSON.stringify(configured.registry);
  assert.match(serialized, /DD_API_KEY/);
  assert.doesNotMatch(serialized, /sk-[A-Za-z0-9]/);
  const listed = await listSources({ projectRoot, service: path.basename(projectRoot), environment: "production" });
  assert.equal(listed.capabilities.database.required_access, "read-only");

  await assert.rejects(() => configureSources({ packageRoot: ROOT, projectRoot, endpoints: { ticketing: "https://user:password@mcp.example.test/" } }), /must not embed credentials/);
  const initialized = await initializeHosts({ packageRoot: ROOT, projectRoot, host: "all", demo: true, activateConnectors: true });
  assert.ok(initialized.files.length >= 7);
  const codex = await readFile(path.join(projectRoot, ".codex/config.toml"), "utf8");
  assert.match(codex, /sandbox_mode = "read-only"/);
  assert.match(codex, /enabled_tools/);
  assert.match(codex, /enabled = false/);
  const claude = await readJson(path.join(projectRoot, ".claude/settings.json"));
  assert.ok(claude.permissions.deny.includes("Edit"));
  assert.ok(claude.hooks.PreToolUse);
  const claudeMcp = await readJson(path.join(projectRoot, ".mcp.json"));
  assert.equal(claudeMcp.mcpServers.rooty_observability.type, "http");
  assert.equal(Object.hasOwn(claudeMcp.mcpServers.rooty_observability, "disabled"), false);
  const cursor = await readJson(path.join(projectRoot, ".cursor/mcp.json"));
  assert.ok(cursor.mcpServers.rooty_demo);
  const hookFile = path.join(projectRoot, ".claude/hooks/rooty-readonly.mjs");
  const blocked = await runProcessWithInput(process.execPath, [hookFile], JSON.stringify({ tool_name: "Edit", tool_input: {} }));
  assert.match(blocked, /"permissionDecision":"deny"/);
  const allowed = await runProcessWithInput(process.execPath, [hookFile], JSON.stringify({ tool_name: "mcp__rooty_demo__logs_search", tool_input: {} }));
  assert.equal(allowed, "");
  await assert.rejects(() => initializeHosts({ packageRoot: ROOT, projectRoot, host: "codex", demo: true }), /overwrite existing host paths/);
});

test("read-only MCP tools enforce case IDs, bounded windows, and SELECT-only SQL", async () => {
  assert.equal(TOOLS.length, 6);
  assert.ok(TOOLS.every((tool) => tool.annotations.readOnlyHint && !tool.annotations.destructiveHint));
  const ticket = await callReadTool("ticket_get", { case_id: "INV-TEST-001", ticket_id: "ROOTY-101" });
  assert.equal(ticket.data.id, "ROOTY-101");
  await assert.rejects(() => callReadTool("logs_search", { case_id: "INV-TEST-001", from: "2026-08-01T00:00:00Z", to: "2026-08-03T00:00:00Z", query: "*" }), /at most 24 hours/);
  await assert.rejects(() => callReadTool("db_query_readonly", { case_id: "INV-TEST-001", sql: "DELETE FROM payments" }), /Only a single SELECT/);
  await assert.rejects(() => callReadTool("db_query_readonly", { case_id: "INV-TEST-001", sql: "SELECT 1; DROP TABLE payments" }), /Multiple SQL|Mutation-capable/);
  await assert.rejects(() => callReadTool("deployments_rollback", { case_id: "INV-TEST-001" }), /Unknown or mutation-capable/);
});

test("bundled stdio MCP server initializes and lists only read tools", async () => {
  const response = await rpcOnce({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
  assert.equal(response.result.tools.length, 6);
  assert.ok(response.result.tools.every((tool) => tool.annotations.readOnlyHint));
});

test("doctor verifies package health and starts the bundled connector", async () => {
  const result = await runDoctor({ packageRoot: ROOT, projectRoot: ROOT });
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  assert.equal(result.checks.find((check) => check.name === "mcp-startup").status, "PASS");
  assert.equal(result.checks.find((check) => check.name === "replay-suite").status, "PASS");
});

test("skill ledger validator accepts generated ledger", async () => {
  const projectRoot = await tempDirectory("rooty-project");
  const caseDir = path.join(await tempDirectory("rooty-cases"), "script");
  await runFrozenCase({ projectRoot, ticket: "ROOTY-101", snapshotFile: SNAPSHOT, caseDir });
  const output = await runProcess(process.execPath, [path.join(ROOT, "skill/root-cause-investigator/scripts/validate-evidence-ledger.mjs"), path.join(caseDir, "evidence.ndjson")]);
  assert.match(output, /valid ledger: 5 entries/);
});

function rpcOnce(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, "src/mock-mcp-server.js")], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let buffer = "";
    let stderr = "";
    const timer = setTimeout(() => finish(new Error("MCP response timeout")), 3000);
    function finish(error, value) {
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve(value);
    }
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", finish);
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      try { finish(undefined, JSON.parse(buffer.slice(0, newline))); }
      catch (error) { finish(new Error(`${error.message}: ${stderr}`)); }
    });
    child.stdin.write(`${JSON.stringify(request)}\n`);
  });
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `exit ${code}`)));
  });
}

function runProcessWithInput(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `exit ${code}`)));
    child.stdin.end(input);
  });
}
