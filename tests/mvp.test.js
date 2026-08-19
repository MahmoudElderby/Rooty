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
import { pathExists, readJson, sha256, writeJson } from "../src/lib/core.js";
import { main } from "../src/cli.js";

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

test("explicitly reproduced observed behavior can confirm without a second source system", async () => {
  const captured = await readJson(path.join(ROOT, "evals/cases/inputs/EVAL-001.json"));
  const reproduced = structuredClone(captured);
  reproduced.evidence = reproduced.evidence
    .filter((item) => ["E1", "E2", "E3"].includes(item.evidence_id))
    .map((item) => item.classification === "OBSERVED" ? { ...item, source_type: "trace", source_system: "single-trace-backend" } : item);
  reproduced.analysis.causal_chain = [
    { step: "The failing trigger was captured during reproduction.", evidence_refs: ["E2"] },
    { step: "The first bad state recurred in a second reproduced observation.", evidence_refs: ["E3"] }
  ];
  reproduced.analysis.reproduction = { status: "reproduced", evidence_refs: ["E2", "E3"] };
  reproduced.analysis.competing_hypotheses = [{ statement: "Alternative path", status: "eliminated", evidence_refs: ["E3"] }];
  const assessment = assessCase(reproduced);
  assert.equal(assessment.status, "CONFIRMED");
  assert.equal(assessment.independently_corroborated, false);
  assert.equal(assessment.reproducibly_verified, true);
  assert.equal(assessment.corroboration_satisfied, true);
  reproduced.analysis.reproduction.evidence_refs = ["E1", "E3"];
  assert.notEqual(assessCase(reproduced).status, "CONFIRMED");
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
  assert.equal(draft.card.schema_version, 3);
  assert.equal(draft.card.scope, "project");
  assert.equal(draft.card.kind, "failure_pattern");
  assert.equal(draft.card.proposed_disposition, "project_memory");
  assert.match(draft.card.canonical_key, /^failure_pattern:/);
  assert.match(draft.card.learning_fingerprint, /^[a-f0-9]{64}$/);
  assert.match(draft.file, /\.rooty[\\/]memory[\\/]drafts/);
  assert.equal(draft.card.source_ledger_count, 6);
  assert.match(draft.card.source_case_fingerprint, /^[a-f0-9]{64}$/);
  const approved = await approveMemory({ projectRoot, draftFile: draft.file, reviewedBy: "team-payments", caseDir });
  assert.equal(approved.card.review_status, "approved");
  assert.equal(approved.card.source_case_status, "CONFIRMED");
  assert.match(approved.file, /\.rooty[\\/]memory[\\/]approved/);
  assert.equal(Object.hasOwn(approved.card, "raw_logs"), false);
});

test("legacy memory drafts remain approvable but new approvals use .rooty", async () => {
  const projectRoot = await tempDirectory("rooty-legacy-memory");
  const caseDir = path.join(await tempDirectory("rooty-legacy-cases"), "verified");
  await runFrozenCase({ projectRoot, ticket: "ROOTY-101", snapshotFile: SNAPSHOT, caseDir });
  const draft = await proposeMemory({ projectRoot, caseDir });
  const legacyDraft = path.join(projectRoot, ".investigator/memory/drafts", path.basename(draft.file));
  await mkdir(path.dirname(legacyDraft), { recursive: true });
  const legacyCard = { ...draft.card, schema_version: 2 };
  for (const field of ["scope", "kind", "canonical_key", "statement", "applicability", "supersedes", "proposed_disposition", "learning_fingerprint"]) delete legacyCard[field];
  delete legacyCard.content_fingerprint;
  legacyCard.content_fingerprint = sha256(legacyCard);
  await writeJson(legacyDraft, legacyCard);

  const approved = await approveMemory({ projectRoot, draftFile: legacyDraft, reviewedBy: "team-payments", caseDir });
  assert.equal(approved.card.schema_version, 2);
  assert.match(approved.file, /\.rooty[\\/]memory[\\/]approved/);
});

test("memory proposal rejects duplicate reusable learning deterministically", async () => {
  const projectRoot = await tempDirectory("rooty-memory-dedup");
  const firstCase = path.join(await tempDirectory("rooty-dedup-cases"), "first");
  const secondCase = path.join(await tempDirectory("rooty-dedup-cases"), "second");
  await runFrozenCase({ projectRoot, ticket: "ROOTY-101", snapshotFile: SNAPSHOT, caseDir: firstCase });
  await runFrozenCase({ projectRoot, ticket: "ROOTY-101", snapshotFile: SNAPSHOT, caseDir: secondCase });
  await proposeMemory({ projectRoot, caseDir: firstCase });
  await assert.rejects(() => proposeMemory({ projectRoot, caseDir: secondCase }), /Duplicate reusable learning already exists/);
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
  const fakeFile = path.join(fakeProject, ".rooty/memory/drafts/INV-FAKE-CONFIRMED.json");
  await writeJson(fakeFile, fake);
  await assert.rejects(
    () => approveMemory({ projectRoot: fakeProject, draftFile: fakeFile, reviewedBy: "attacker", caseDir }),
    /does not belong|fingerprint/
  );

  const detached = path.join(fakeProject, "detached.json");
  await writeJson(detached, sourceDraft.card);
  await assert.rejects(
    () => approveMemory({ projectRoot: fakeProject, draftFile: detached, reviewedBy: "reviewer", caseDir }),
    /outside Rooty memory drafts/
  );

  const missingCase = path.join(fakeProject, ".rooty/memory/drafts/INV-MISSING.json");
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

test("CLI rejects missing option values instead of treating them as a true path", async () => {
  await assert.rejects(
    () => main(["init", "--host", "codex", "--project"]),
    /--project requires a value/
  );
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
    assert.match(source.oauth_access_token_env_var, /^ROOTY_[A-Z0-9_]+_MCP_OAUTH_TOKEN$/);
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

test("discovery skips generated agent and build output directories", async () => {
  const projectRoot = await tempDirectory("rooty-generated-discovery");
  await mkdir(path.join(projectRoot, ".cursor", "skills"), { recursive: true });
  await mkdir(path.join(projectRoot, "service", "obj"), { recursive: true });
  await writeFile(path.join(projectRoot, ".cursor", "skills", "SKILL.md"), "Use Datadog and DD_API_KEY.\n", "utf8");
  await writeFile(path.join(projectRoot, "service", "obj", "project.assets.json"), '{"provider":"mysql"}\n', "utf8");
  await writeFile(path.join(projectRoot, "README.md"), "Production observability uses Grafana.\n", "utf8");
  const discovery = await discoverSources({ packageRoot: ROOT, projectRoot });
  assert.ok(discovery.detections.some((item) => item.provider === "grafana"));
  assert.equal(discovery.detections.some((item) => item.provider === "datadog"), false);
  assert.equal(discovery.detections.some((item) => item.provider === "mysql"), false);
});

test("equal-confidence provider candidates require explicit user selection", async () => {
  const projectRoot = await tempDirectory("rooty-ambiguous-discovery");
  await writeFile(path.join(projectRoot, "README.md"), "Services use both PostgreSQL and MySQL.\n", "utf8");
  const configured = await configureSources({
    packageRoot: ROOT,
    projectRoot,
    endpoints: { database: "https://mcp.example.test/database" }
  });
  const database = configured.registry.environments.production.capabilities.database;
  assert.equal(database.provider, "unconfigured");
  assert.equal(database.status, "needs-user-input");
  assert.deepEqual(database.candidate_providers.sort(), ["mysql", "postgres"]);
  assert.ok(configured.unresolved.includes("database.provider"));
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
  await writeFile(path.join(projectRoot, ".gitignore"), "dist/\n", "utf8");
  const initialized = await initializeHosts({ packageRoot: ROOT, projectRoot, host: "all", demo: true, activateConnectors: true });
  assert.ok(initialized.files.length >= 8);
  const projectIgnore = await readFile(path.join(projectRoot, ".gitignore"), "utf8");
  assert.match(projectIgnore, /^dist\//m);
  for (const entry of [".investigator/discovery.json", ".investigator/cases/", ".investigator/memory/drafts/", ".rooty/memory/drafts/", ".rooty-cases/"]) {
    assert.ok(projectIgnore.split(/\r?\n/).includes(entry), `missing project exclusion: ${entry}`);
  }
  const codex = await readFile(path.join(projectRoot, ".codex/config.toml"), "utf8");
  assert.match(codex, /sandbox_mode = "read-only"/);
  assert.match(codex, /enabled_tools/);
  assert.match(codex, /enabled = true/);
  assert.match(codex, /required = true/);
  assert.doesNotMatch(codex, /enabled = false/);
  assert.match(codex, /bearer_token_env_var = "ROOTY_DATADOG_MCP_OAUTH_TOKEN"/);
  const activation = await readJson(path.join(projectRoot, ".investigator/activated-connectors.json"));
  assert.equal(activation.connectors.length, 5);
  assert.ok(activation.connectors.every((entry) => entry.doctor_probe?.tool));
  assert.ok(activation.connectors.every((entry) => entry.oauth_access_token_env_var));
  const claude = await readJson(path.join(projectRoot, ".claude/settings.json"));
  assert.ok(claude.permissions.deny.includes("Edit"));
  assert.ok(claude.hooks.PreToolUse);
  const claudeMcp = await readJson(path.join(projectRoot, ".mcp.json"));
  assert.equal(claudeMcp.mcpServers.rooty_observability.type, "http");
  assert.equal(claudeMcp.mcpServers.rooty_observability.headers.Authorization, "Bearer ${ROOTY_DATADOG_MCP_OAUTH_TOKEN}");
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
  const matchingLog = await callReadTool("logs_search", { case_id: "INV-TEST-001", from: "2026-08-14T11:00:00Z", to: "2026-08-14T12:00:00Z", query: "authorization deadline" });
  assert.equal(matchingLog.data.length, 1);
  const wrongWindow = await callReadTool("logs_search", { case_id: "INV-TEST-001", from: "2035-08-14T11:00:00Z", to: "2035-08-14T12:00:00Z", query: "authorization" });
  assert.deepEqual(wrongWindow.data, []);
  assert.equal(wrongWindow.event_time_coverage, "2035-08-14T11:00:00Z/2035-08-14T12:00:00Z");
  const wrongQuery = await callReadTool("traces_search", { case_id: "INV-TEST-001", from: "2026-08-14T11:00:00Z", to: "2026-08-14T12:00:00Z", query: "impossible-status" });
  assert.deepEqual(wrongQuery.data, []);
  const inactiveDeployment = await callReadTool("deployments_list", { case_id: "INV-TEST-001", service: "payments-api", from: "2026-08-13T11:00:00Z", to: "2026-08-13T12:00:00Z" });
  assert.deepEqual(inactiveDeployment.data, []);
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
  await writeReadySourceRegistry(projectRoot, capabilities);
  const tokenVariable = "ROOTY_UNREACHABLE_TEST_MCP_OAUTH_TOKEN";
  const previousToken = process.env[tokenVariable];
  process.env[tokenVariable] = "test-token";
  await writeJson(path.join(projectRoot, ".investigator/activated-connectors.json"), {
    schema_version: 1,
    connectors: capabilities.map((capability) => ({
      name: `rooty_${capability}`,
      capability,
      provider: "unreachable-test",
      endpoint: `https://unreachable.invalid/${capability}`,
      auth: "oauth",
      oauth_access_token_env_var: tokenVariable,
      allowed_tools: ["safe_read"],
      doctor_probe: { tool: "safe_read", arguments: { limit: 1 } }
    }))
  });
  try {
    const result = await runDoctor({ packageRoot: ROOT, projectRoot, connectorTimeoutMs: 200 });
    assert.equal(result.ok, false);
    for (const capability of capabilities) {
      assert.equal(result.checks.find((check) => check.name === `rooty_${capability}-authentication`)?.status, "PASS");
      assert.equal(result.checks.find((check) => check.name === `rooty_${capability}-initialize`)?.status, "FAIL");
    }
  } finally {
    if (previousToken === undefined) delete process.env[tokenVariable];
    else process.env[tokenVariable] = previousToken;
  }
});

test("doctor verifies auth, initialize, tool listing, and a harmless read for an activated connector", async () => {
  const tokenVariable = "ROOTY_DOCTOR_TEST_MCP_OAUTH_TOKEN";
  const previousToken = process.env[tokenVariable];
  process.env[tokenVariable] = "doctor-test-token";
  const fake = await startFakeHttpMcp({ expectedAuthorization: "Bearer doctor-test-token" });
  try {
    const projectRoot = await tempDirectory("rooty-doctor-live");
    const capabilities = ["ticketing", "documentation", "observability", "database", "deployments"];
    await writeReadySourceRegistry(projectRoot, capabilities);
    await writeJson(path.join(projectRoot, ".investigator/activated-connectors.json"), {
      schema_version: 1,
      connectors: capabilities.map((capability) => ({
        name: `rooty_${capability}`,
        capability,
        provider: "test",
        endpoint: fake.endpoint,
        auth: "oauth",
        oauth_access_token_env_var: tokenVariable,
        allowed_tools: ["safe_read"],
        doctor_probe: { tool: "safe_read", arguments: { limit: 1 } }
      }))
    });
    const result = await runDoctor({ packageRoot: ROOT, projectRoot, connectorTimeoutMs: 1000 });
    assert.equal(result.ok, true, JSON.stringify(result.checks));
    for (const phase of ["authentication", "initialize", "tools-list", "read-probe"]) {
      assert.equal(result.checks.find((check) => check.name === `rooty_observability-${phase}`)?.status, "PASS");
    }
    for (const method of ["initialize", "notifications/initialized", "tools/list", "tools/call"]) {
      assert.equal(fake.methods.filter((candidate) => candidate === method).length, capabilities.length);
    }
  } finally {
    fake.server.close();
    await once(fake.server, "close");
    if (previousToken === undefined) delete process.env[tokenVariable];
    else process.env[tokenVariable] = previousToken;
  }
});

test("doctor distinguishes production readiness from package-only health", async () => {
  const projectRoot = await tempDirectory("rooty-doctor-readiness");
  const strict = await runDoctor({ packageRoot: ROOT, projectRoot });
  assert.equal(strict.ok, false);
  assert.equal(strict.checks.find((check) => check.name === "source-registry")?.status, "FAIL");
  assert.equal(strict.checks.find((check) => check.name === "activated-connectors")?.status, "FAIL");
  const packageOnly = await runDoctor({ packageRoot: ROOT, projectRoot, requireActivatedConnectors: false });
  assert.equal(packageOnly.ok, true, JSON.stringify(packageOnly.checks));
  assert.equal(packageOnly.checks.find((check) => check.name === "source-registry")?.status, "WARN");
  assert.equal(packageOnly.checks.find((check) => check.name === "activated-connectors")?.status, "WARN");
  await writeReadySourceRegistry(projectRoot, ["observability"]);
  const partial = await runDoctor({ packageRoot: ROOT, projectRoot });
  assert.equal(partial.ok, false);
  assert.match(partial.checks.find((check) => check.name === "source-registry")?.message, /ticketing/);
});

test("doctor verifies package health and starts the bundled connector", async () => {
  const result = await runDoctor({ packageRoot: ROOT, projectRoot: ROOT, requireActivatedConnectors: false });
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  assert.equal(result.checks.find((check) => check.name === "mcp-startup").status, "PASS");
  assert.equal(result.checks.find((check) => check.name === "replay-suite").status, "PASS");
});

test("package is publishable under rooty, retains the alias, includes docs, and excludes the GitHub-only GIF", async () => {
  const manifest = await readJson(path.join(ROOT, "package.json"));
  assert.notEqual(manifest.private, true);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.bin.rooty, "bin/investigator.js");
  assert.equal(manifest.bin.investigator, "bin/investigator.js");
  assert.ok(manifest.files.includes("docs/"));
  assert.equal(manifest.files.includes("rooty-how-it-works.gif"), false);
  // The video pipeline and its rendered media are GitHub-only, like the GIF.
  assert.equal(manifest.files.some((entry) => entry.startsWith("tools")), false);
  assert.equal(manifest.files.some((entry) => entry.startsWith("media")), false);
  const gif = await readFile(path.join(ROOT, "rooty-how-it-works.gif"));
  assert.match(gif.subarray(0, 6).toString("ascii"), /^GIF8[79]a$/);
  const ignoreTemplate = await readFile(path.join(ROOT, "setup/gitignore-template.txt"), "utf8");
  assert.match(ignoreTemplate, /\.investigator\/memory\/drafts\//);
  assert.match(ignoreTemplate, /\.rooty\/memory\/drafts\//);
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

async function startFakeHttpMcp({ expectedAuthorization } = {}) {
  const methods = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk.toString();
    const message = JSON.parse(body);
    methods.push(message.method);
    if (expectedAuthorization && request.headers.authorization !== expectedAuthorization) {
      response.writeHead(401).end();
      return;
    }
    if (message.method !== "initialize" && request.headers["mcp-protocol-version"] !== "2025-11-25") {
      response.writeHead(400).end("missing negotiated MCP protocol header");
      return;
    }
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

async function writeReadySourceRegistry(projectRoot, capabilities) {
  await writeFile(
    path.join(projectRoot, ".gitignore"),
    await readFile(path.join(ROOT, "setup/gitignore-template.txt"), "utf8"),
    "utf8"
  );
  await writeJson(path.join(projectRoot, ".investigator/sources.json"), {
    schema_version: 1,
    service: path.basename(projectRoot),
    environments: {
      production: {
        capabilities: Object.fromEntries(capabilities.map((capability) => [capability, { status: "ready-for-host-rendering" }]))
      }
    }
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
