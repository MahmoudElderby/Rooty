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
    "rooty-sql-{domain}",
    ".rooty/mcp-{domain}/dab-config.json",
    "each catalog independently"
  ]);
  requires(recipe, [
    "Codex, Cursor, and Claude",
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
