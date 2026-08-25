import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function content(relative) {
  return readFile(path.join(ROOT, relative), "utf8");
}

function requires(text, values) {
  for (const value of values) {
    assert.match(text, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
}

test("SQL Server skill requires one explicit MCP per live catalog", async () => {
  const overview = await content("skill/rooty-mcp-builder/references/providers/data/sql-server.md");
  const recipe = await content("skill/rooty-mcp-builder/references/providers/data/sql-server-cursor.md");

  requires(overview, [
    "sql-server-cursor.md",
    "sys.databases",
    "INFORMATION_SCHEMA.TABLES",
    "rooty-{environment}-sql-{domain}",
    ".rooty/mcp/data/sql-server/{environment}/{domain}/dab-config.json",
    "each catalog independently"
  ]);
  requires(recipe, [
    "Codex, Cursor, and Claude",
    ".rooty/start-mcp.cjs",
    ".rooty/start-dab.cjs",
    "explicit entities",
    "--credential-env",
    "ROOTY_SQL_ORDERS",
    "ASPNETCORE_URLS",
    "http://127.0.0.1:55101",
    "--mcp-stdio",
    "role:rooty-reader",
    "--LogLevel",
    "Do not use `dab validate` on DAB 2.0.10",
    "data-source-files",
    "autoentities",
    "DAB_ENVIRONMENT",
    "--no-https-redirect"
  ]);
  assert.doesNotMatch(recipe, /"data-source-files"\s*:/i);
  assert.doesNotMatch(recipe, /"autoentities"\s*:/i);
  assert.doesNotMatch(recipe, /--no-https-redirect\s*$/im);
});

test("all supported hosts and setup lifecycle route SQL through the tested recipe", async () => {
  for (const relative of [
    "skill/rooty-mcp-builder/references/hosts/codex.md",
    "skill/rooty-mcp-builder/references/hosts/cursor.md",
    "skill/rooty-mcp-builder/references/hosts/claude.md",
    "skill/rooty-setup/references/setup-lifecycle.md"
  ]) {
    assert.match(await content(relative), /sql-server-cursor\.md/i, relative);
  }
});

test("Elasticsearch 8 compatibility uses the official image and list_indices probe", async () => {
  const recipe = await content("skill/rooty-mcp-builder/references/providers/observability/elasticsearch.md");
  requires(recipe, [
    "8.19.15",
    "docker.elastic.co/mcp/elasticsearch",
    "ES_VERSION=8",
    "list_indices",
    "separate approval"
  ]);
});

test("investigation method includes validated preflight and governed learning behavior", async () => {
  const investigator = await content("skill/root-cause-investigator/SKILL.md");
  const workflow = await content("skill/root-cause-investigator/references/investigation-workflow.md");
  const setup = await content("skill/rooty-setup/SKILL.md");
  const cursorAdapter = await content("hosts/cursor/root-cause-investigator.mdc");

  requires(investigator, [
    "pre-query evidence map",
    "reconcile conflicting identifiers",
    "failure surfaces",
    "through wrappers",
    "universal",
    "project",
    "case_only",
    "Never merge learning directly into host rule files"
  ]);
  requires(workflow, [
    "incident-time history versus current state",
    "no single reported source is automatically authoritative",
    "bounded successful cohort",
    "cheapest discriminating test"
  ]);
  requires(setup, [".rooty/memory/{drafts,approved}", "Do not create always-on host investigation rules"]);
  assert.match(cursorAdapter, /alwaysApply:\s*false/);
});

test("setup routes developer questions through the active host's own question experience", async () => {
  const setup = await content("skill/rooty-setup/SKILL.md");
  const questions = await content("skill/rooty-setup/references/asking-questions.md");

  assert.match(setup, /references\/asking-questions\.md/);
  requires(setup, ["structured question tool", "escapes the candidate list"]);
  requires(questions, [
    "AskQuestion",
    "AskUserQuestion",
    "Codex",
    "no structured question tool exists",
    "ask the same question in plain text",
    "include an option that escapes the list",
    "It is not an approval surface",
    "rooty context set-docs"
  ]);
});

test("setup supports confirmed environment discovery and conversational deterministic switching", async () => {
  const setup = await content("skill/rooty-setup/SKILL.md");
  const profiles = await content("skill/rooty-mcp-builder/references/environment-profiles.md");
  requires(setup, [
    "rooty env discover --json",
    "rooty setup selections",
    "rooty env plan <environment> --json",
    "rooty env use <environment>",
    "rooty-prod-sql-orders",
    "rooty-preprod-sql-orders",
    "never keep both",
    "rooty doctor --environment <environment>"
  ]);
  requires(profiles, [
    "logical_servers",
    "settings_keys",
    "mcp-settings.local.json",
    "allowed_tools",
    "expect_contains",
    "exactly one target per logical catalog"
  ]);
});

test("log storage review stays scoped, provider-neutral, file-capable, and report-only", async () => {
  const skill = await content("skill/log-storage-review/SKILL.md");
  const playbook = await content("skill/log-storage-review/references/analysis-playbook.md");
  const normalization = await content("skill/log-storage-review/references/identity-normalization.md");
  const adapters = await content("skill/log-storage-review/references/provider-adapters.md");

  requires(skill, [
    "Store-wide",
    "Target-scoped",
    "lightweight parent baseline",
    "Repeated calls",
    "Payload size",
    "Daily growth",
    "Report only"
  ]);
  requires(playbook, ["Lock the scope", "compatible totals", "Do not silently widen"]);
  requires(normalization, ["do not carry discovered project rules back into this skill", "raw-to-canonical mapping"]);
  requires(adapters, [
    "Scoped execution",
    "File-based logs",
    "stream records",
    "event timestamps",
    "Never truncate",
    "Target filter is unavailable or ambiguous"
  ]);
});
