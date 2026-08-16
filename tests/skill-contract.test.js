import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("SQL Server skill requires all-catalog multi-source readiness", async () => {
  const recipe = await readFile(
    path.join(ROOT, "skill/rooty-mcp-builder/references/providers/data/sql-server.md"),
    "utf8"
  );

  for (const required of [
    "sys.databases",
    "database_id > 4",
    "data-source-files",
    ".rooty/mcp/data/sql-server/",
    "globally unique key",
    "no empty `entities: {}` object",
    "ASPNETCORE_URLS=http://127.0.0.1:0",
    "describe_entities",
    "every discovered in-scope catalog",
    "Do not use `dab validate` as the readiness gate"
  ]) {
    assert.match(recipe, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
});
