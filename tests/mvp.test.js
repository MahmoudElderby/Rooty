import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assessCase, appendEvidence, readLedger, renderExistingCase, runFrozenCase, verifyLedgerEntries } from "../src/lib/cases.js";
import { runDoctor } from "../src/lib/doctor.js";
import { runEvaluation } from "../src/lib/evaluate.js";
import { initializeHosts } from "../src/lib/hosts.js";
import { callReadTool, TOOLS } from "../src/lib/mcp.js";
import { approveMemory, proposeMemory } from "../src/lib/memory.js";
import { configureSources, discoverSources, listSources } from "../src/lib/sources.js";
import { pathExists, readJson, writeJson } from "../src/lib/core.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = path.join(ROOT, "evals/mock-sources/confirmed-timeout.json");
const EVALS = path.join(ROOT, "evals/cases/replay-cases.json");

async function tempDirectory(name) {
  return mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

test("all 15 evaluations use independent captured inputs and meet their stopping rules", async () => {
  const suite = await readJson(EVALS);
  assert.equal(suite.cases.length, 15);
  assert.ok(suite.cases.every((item) => item.input_file && !item.scenario));
  for (const item of suite.cases) {
    const input = await readJson(path.join(path.dirname(EVALS), item.input_file));
    assert.equal(Object.hasOwn(input, "expected"), false);
    assert.equal(Object.hasOwn(input, "scenario"), false);
    assert.equal(input.fixture_metadata.kind, "captured-agent-investigation");
  }
  assert.equal(await pathExists(path.join(ROOT, "src/lib/replay.js")), false);
  const result = await runEvaluation({ casesFile: EVALS });
  assert.equal(result.ok, true, JSON.stringify(result.results));
  assert.equal(result.passed, 15);
  assert.equal(result.unsupported_confirmations, 0);
  assert.equal(result.mutations_blocked, result.mutation_attempts);
  assert.equal(result.prompt_injection_passed, result.prompt_injection_cases);
  assert.ok(result.prompt_injection_cases >= 2);
});

test("one observation reused across causal steps and REPORTED alternative evidence cannot confirm", async () => {
  const strong = await readJson(path.join(ROOT, "evals/cases/inputs/EVAL-001.json"));
  const weak = structuredClone(strong);
  weak.evidence = weak.evidence.filter((item) => ["E1", "E2"].includes(item.evidence_id));
  weak.analysis.causal_chain = [
    { step: "trigger", evidence_refs: ["E2"] },
    { step: "first bad state", evidence_refs: ["E2"] },
    { step: "symptom", evidence_refs: ["E2"] }
  ];
  weak.analysis.competing_hypotheses = [{ statement: "ticket-only alternative", status: "eliminated", evidence_refs: ["E1"] }];
  weak.analysis.best_fit = true;
  const assessment = assessCase(weak);
  assert.notEqual(assessment.status, "CONFIRMED");
  assert.equal(assessment.distinct_evidence_per_step, false);
  assert.equal(assessment.alternatives_tested, false);
});

test("vertical slice creates a hash-chained ledger, deterministic report, and source-verified memory", async () => {
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
  assert.equal(draft.card.schema_version, 2);
  assert.equal(draft.card.source_ledger_count, 6);
  assert.match(draft.card.source_case_fingerprint, /^[a-f0-9]{64}$/);
  const approved = await approveMemory({ projectRoot, draftFile: draft.file, reviewedBy: "team-payments", caseDir });
  assert.equal(approved.card.review_status, "approved");
  assert.equal(approved.card.source_case_status, "CONFIRMED");
  assert.equal(Object.hasOwn(approved.card, "raw_logs"), false);
});

test("fabricated or detached memory drafts cannot be approved", async () => {
  const sourceProject = await tempDirectory("rooty-source-project");
  const caseDir = path.join(await tempDirectory("rooty-source-cases"), "verified");
  await runFrozenCase({ projectRoot: sourceProject, ticket: "ROOTY-101", snapshotFile: SNAPSHOT, caseDir });
  const sourceDraft = await proposeMemory({ projectRoot: sourceProject, caseDir });

  const fakeProject = await tempDirectory("rooty-fake-project");
  const fake = {
    ...sourceDraft.card,
    case_id: "INV-FAKE-CONFIRMED",
    root_cause_class: "fabricated-cause",
    content_fingerprint: "a".repeat(64)
  };
  const fakeFile = path.join(fakeProject, ".investigator/memory/drafts/INV-FAKE-CONFIRMED.json");
  await writeJson(fakeFile, fake);
  await assert.rejects(
    () => approveMemory({ projectRoot: fakeProject, draftFile: fakeFile, reviewedBy: "attacker", caseDir }),
    /does not belong|fingerprint/
  );

  const detached = path.join(fakeProject, "detached.json");
  await writeJson(detached, sourceDraft.card);
  await assert.rejects(
    () => approveMemory({ projectRoot: fakeProject, draftFile: detached, reviewedBy: "reviewer", caseDir }),
    /outside project/
  );

  const missingCase = path.join(fakeProject, ".investigator/memory/drafts/INV-MISSING.json");
  await writeJson(missingCase, { case_id: "INV-MISSING", review_status: "draft", source_case_status: "CONFIRMED" });
  await assert.rejects(
    () => approveMemory({ projectRoot: fakeProject, draftFile: missingCase, reviewedBy: "reviewer", caseDir }),
    /Invalid case-card schema/
  );
});

test("case output inside the investigated project is rejected before creating files", async () => {
  const projectRoot = await tempDirectory("rooty-readonly-project");
  const forbidden = path.join(projectRoot, ".investigator", "cases", "bad");
  await assert.rejects(
    () => runFrozenCase({ projectRoot, ticket: "ROOTY-101", snapshotFile: SNAPSHOT, caseDir: forbidden }),
    /outside the investigated project/
  );
  assert.equal(await pathExists(forbidden), false);
});

test("tampering with an evidence ledger is detected", async () => {
  const projectRoot = await tempDirectory("rooty-project");
  const caseDir = path.join(await tempDirectory("rooty-cases"), "tamper");
  await runFrozenCase({ projectRoot, ticket: "ROOTY-101", snapshotFile: SNAPSHOT, caseDir });
  const entries = await readLedger(caseDir);
  entries[1].observation = "rewritten observation";
  assert.throws(() => verifyLedgerEntries(entries), /modified/);
});

test("manual providers configure every capability when discovery finds nothing", async () => {
  const projectRoot = await tempDirectory("rooty-empty-discovery");
  const configured = await configureSources({
    packageRoot: ROOT,
    projectRoot,
    providers: {
      ticketing: "atlassian",
      documentation: "atlassian",
      observability: "datadog",
      database: "postgres",
      deployments: "argocd"
    },
    endpoints: {
      ticketing: "https://mcp.example.test/atlassian",
      documentation: "https://mcp.example.test/atlassian",
      observability: "https://mcp.example.test/observability",
      database: "https://mcp.example.test/database",
      deployments: "https://mcp.example.test/deployments"
    },
    auth: { ticketing: "oauth", documentation: "oauth", observability: "oauth", database: "oauth", deployments: "oauth" }
  });
  assert.deepEqual(configured.unresolved, []);
  for (const source of Object.values(configured.registry.environments.production.capabilities)) {
    assert.equal(source.status, "ready-for-host-rendering");
    assert.equal(source.mapping_status, "USER_CONFIGURED");
    assert.ok(source.doctor_probe?.tool);
  }
});

test("discovery skips secret-named and credential-bearing structured files", async () => {
  const projectRoot = await tempDirectory("rooty-secret-discovery");
  await writeFile(path.join(projectRoot, "secrets.yaml"), "provider: Datadog\napi_key: live-secret-value\n", "utf8");
  await writeFile(path.join(projectRoot, "secrets.production.yaml"), "provider: Datadog\ntoken: another-live-value\n", "utf8");
  await writeFile(path.join(projectRoot, "config.json"), '{"provider":"Datadog","password":"real-password"}\n', "utf8");
  await writeFile(path.join(projectRoot, "README.md"), "No provider is selected here.\n", "utf8");
  const discovery = await discoverSources({ packageRoot: ROOT, projectRoot });
  assert.equal(discovery.detections.some((item) => item.provider === "datadog"), false);
  assert.ok(discovery.warnings.some((warning) => warning.includes("secrets.yaml")));
  assert.ok(discovery.warnings.some((warning) => warning.includes("secrets.production.yaml")));
  assert.ok(discovery.warnings.some((warning) => warning.includes("config.json")));
});

test("discovery, host rendering, and activation preserve read-only controls", async () => {
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
  assert.ok(initialized.files.length >= 8);
  const codex = await readFile(path.join(projectRoot, ".codex/config.toml"), "utf8");
  assert.match(codex, /sandbox_mode = "read-only"/);
  assert.match(codex, /enabled_tools/);
  assert.match(codex, /enabled = true/);
  assert.match(codex, /required = true/);
  assert.doesNotMatch(codex, /enabled = false/);
  const activation = await readJson(path.join(projectRoot, ".investigator/activated-connectors.json"));
  assert.equal(activation.connectors.length, 5);
  assert.ok(activation.connectors.every((entry) => entry.doctor_probe?.tool));
  const claude = await readJson(path.join(projectRoot, ".claude/settings.json"));
  assert.ok(claude.permissions.deny.includes("Edit"));
  assert.ok(claude.hooks.PreToolUse);
  const claudeMcp = await readJson(path.join(projectRoot, ".mcp.json"));
  assert.equal(claudeMcp.mcpServers.rooty_observability.type, "http");
  const cursor = await readJson(path.join(projectRoot, ".cursor/mcp.json"));
  assert.ok(cursor.mcpServers.rooty_demo);
  const hookFile = path.join(projectRoot, ".claude/hooks/rooty-readonly.mjs");
  const blocked = await runProcessWithInput(process.execPath, [hookFile], JSON.stringify({ tool_name: "Edit", tool_input: {} }));
  assert.match(blocked, /"permissionDecision":"deny"/);
  const allowed = await runProcessWithInput(process.execPath, [hookFile], JSON.stringify({ tool_name: "mcp__rooty_demo__logs_search", tool_input: {} }));
  assert.equal(allowed, "");
  await assert.rejects(() => initializeHosts({ packageRoot: ROOT, projectRoot, host: "codex", demo: true }), /overwrite existing host paths/);
});

test("mock MCP runtime enforces its advertised schemas and read-only semantics", async () => {
  assert.equal(TOOLS.length, 6);
  assert.ok(TOOLS.every((tool) => tool.annotations.readOnlyHint && !tool.annotations.destructiveHint));
  const ticket = await callReadTool("ticket_get", { case_id: "INV-TEST-001", ticket_id: "ROOTY-101" });
  assert.equal(ticket.data.id, "ROOTY-101");
  await assert.rejects(() => callReadTool("logs_search", { case_id: "INV-TEST-001", from: "2026-08-01T00:00:00Z", to: "2026-08-01T01:00:00Z" }), /query is required/);
  await assert.rejects(() => callReadTool("db_query_readonly", { case_id: "INV-TEST-001", sql: "SELECT 1", row_limit: 5000 }), /row_limit must be at most 500/);
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

test("doctor fails every unreachable activated connector", async () => {
  const projectRoot = await tempDirectory("rooty-doctor-unreachable");
  const capabilities = ["ticketing", "documentation", "observability", "database", "deployments"];
  await writeJson(path.join(projectRoot, ".investigator/activated-connectors.json"), {
    schema_version: 1,
    connectors: capabilities.map((capability) => ({
      name: `rooty_${capability}`,
      capability,
      provider: "unreachable-test",
      endpoint: `https://unreachable.invalid/${capability}`,
      auth: "oauth",
      allowed_tools: ["safe_read"],
      doctor_probe: { tool: "safe_read", arguments: { limit: 1 } }
    }))
  });
  const result = await runDoctor({ packageRoot: ROOT, projectRoot, connectorTimeoutMs: 200 });
  assert.equal(result.ok, false);
  for (const capability of capabilities) {
    assert.equal(result.checks.find((check) => check.name === `rooty_${capability}-initialize`)?.status, "FAIL");
  }
});

test("doctor verifies auth, initialize, tool listing, and a harmless read for an activated connector", async () => {
  const fake = await startFakeHttpMcp();
  try {
    const projectRoot = await tempDirectory("rooty-doctor-live");
    await writeJson(path.join(projectRoot, ".investigator/activated-connectors.json"), {
      schema_version: 1,
      connectors: [{
        name: "rooty_test",
        capability: "observability",
        provider: "test",
        endpoint: fake.endpoint,
        auth: "none",
        allowed_tools: ["safe_read"],
        doctor_probe: { tool: "safe_read", arguments: { limit: 1 } }
      }]
    });
    const result = await runDoctor({ packageRoot: ROOT, projectRoot, connectorTimeoutMs: 1000 });
    assert.equal(result.ok, true, JSON.stringify(result.checks));
    for (const phase of ["authentication", "initialize", "tools-list", "read-probe"]) {
      assert.equal(result.checks.find((check) => check.name === `rooty_test-${phase}`)?.status, "PASS");
    }
    assert.deepEqual(fake.methods, ["initialize", "notifications/initialized", "tools/list", "tools/call"]);
  } finally {
    fake.server.close();
    await once(fake.server, "close");
  }
});

test("doctor verifies package health and starts the bundled connector", async () => {
  const result = await runDoctor({ packageRoot: ROOT, projectRoot: ROOT });
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  assert.equal(result.checks.find((check) => check.name === "mcp-startup").status, "PASS");
  assert.equal(result.checks.find((check) => check.name === "replay-suite").status, "PASS");
});

test("package is publishable under rooty, retains the alias, and includes the GIF", async () => {
  const manifest = await readJson(path.join(ROOT, "package.json"));
  assert.notEqual(manifest.private, true);
  assert.equal(manifest.bin.rooty, "./bin/investigator.js");
  assert.equal(manifest.bin.investigator, "./bin/investigator.js");
  assert.ok(manifest.files.includes("rooty-how-it-works.gif"));
  const gif = await readFile(path.join(ROOT, "rooty-how-it-works.gif"));
  assert.match(gif.subarray(0, 6).toString("ascii"), /^GIF8[79]a$/);
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

async function startFakeHttpMcp() {
  const methods = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk.toString();
    const message = JSON.parse(body);
    methods.push(message.method);
    if (message.method === "notifications/initialized") {
      response.writeHead(202).end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.setHeader("mcp-session-id", "rooty-test-session");
    if (message.method === "initialize") {
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } } }));
    } else if (message.method === "tools/list") {
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "safe_read", inputSchema: { type: "object" }, annotations: { readOnlyHint: true, destructiveHint: false } }] } }));
    } else if (message.method === "tools/call") {
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { isError: false, content: [{ type: "text", text: "ok" }] } }));
    } else {
      response.writeHead(404).end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return { server, methods, endpoint: `http://127.0.0.1:${address.port}/mcp` };
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
