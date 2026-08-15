import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { assessCase, readLedger, verifyLedgerEntries } from "./cases.js";
import { TOOLS } from "./mcp.js";
import { assertNoEmbeddedSecrets, pathExists, readJson } from "./core.js";
import { materializeReplayCase } from "./replay.js";

export async function runDoctor({ packageRoot, projectRoot }) {
  const checks = [];
  const add = (status, name, message) => checks.push({ status, name, message });
  const canonical = path.join(projectRoot, ".agents/skills/root-cause-investigator/SKILL.md");
  const packaged = path.join(packageRoot, "skill/root-cause-investigator/SKILL.md");
  if (await pathExists(canonical) || await pathExists(packaged)) add("PASS", "skill", "root-cause-investigator skill is discoverable or packaged");
  else add("FAIL", "skill", "SKILL.md is missing");

  const recipeFile = path.join(packageRoot, "setup/connector-recipes/catalog.json");
  try {
    const recipes = await readJson(recipeFile);
    const unsafe = recipes.providers.filter((provider) => provider.required_access !== "read-only" || provider.allowed_tools.some((tool) => /(create|update|delete|write|execute|rollback)/i.test(tool)));
    if (unsafe.length) add("FAIL", "connector-recipes", `Unsafe recipes: ${unsafe.map((item) => item.id).join(", ")}`);
    else add("PASS", "connector-recipes", `${recipes.providers.length} provider recipes are read-only allowlists`);
  } catch (error) {
    add("FAIL", "connector-recipes", error.message);
  }

  const sourcesFile = path.join(projectRoot, ".investigator/sources.json");
  if (await pathExists(sourcesFile)) {
    try {
      const sources = await readJson(sourcesFile);
      assertNoEmbeddedSecrets(sources, "sources");
      const unresolved = Object.entries(sources.environments?.production?.capabilities ?? {}).filter(([, value]) => value.status !== "ready-for-host-rendering").map(([key]) => key);
      add(unresolved.length ? "WARN" : "PASS", "source-registry", unresolved.length ? `Unresolved capabilities: ${unresolved.join(", ")}` : "All capabilities have connector references");
    } catch (error) {
      add("FAIL", "source-registry", error.message);
    }
  } else add("WARN", "source-registry", "Run `investigator sources discover` and `sources configure`");

  const unsafeTools = TOOLS.filter((tool) => tool.annotations?.readOnlyHint !== true || tool.annotations?.destructiveHint !== false || /(create|update|delete|write|execute|rollback)/i.test(tool.name));
  if (unsafeTools.length) add("FAIL", "mcp-tools", `Unsafe tools: ${unsafeTools.map((tool) => tool.name).join(", ")}`);
  else add("PASS", "mcp-tools", `${TOOLS.length} bundled tools are explicitly read-only`);

  try {
    const serverInfo = await probeBundledConnector(path.join(packageRoot, "src/mock-mcp-server.js"));
    add("PASS", "mcp-startup", `Bundled connector started as ${serverInfo.name}@${serverInfo.version}`);
  } catch (error) {
    add("FAIL", "mcp-startup", error.message);
  }

  try {
    const suite = await readJson(path.join(packageRoot, "evals/cases/replay-cases.json"));
    if (suite.cases.length !== 15) add("FAIL", "replay-suite", `Expected 15 cases, found ${suite.cases.length}`);
    else {
      for (const item of suite.cases) assessCase(materializeReplayCase(item));
      add("PASS", "replay-suite", "15 replay cases validate");
    }
  } catch (error) {
    add("FAIL", "replay-suite", error.message);
  }

  const caseRoot = path.join(projectRoot, ".investigator/cases");
  if (await pathExists(caseRoot)) {
    add("WARN", "case-location", "Case data is inside the source tree; prefer --case-dir outside the repository");
  } else add("PASS", "case-location", "No investigation evidence is stored in the source tree");

  try {
    const ignore = await readFile(path.join(packageRoot, ".gitignore"), "utf8");
    add(ignore.includes(".investigator/cases") ? "PASS" : "FAIL", "gitignore", "runtime evidence and drafts are excluded from Git");
  } catch (error) {
    add("FAIL", "gitignore", error.message);
  }

  return { ok: !checks.some((check) => check.status === "FAIL"), checks };
}

export async function verifyCaseDirectory(caseDir) {
  const entries = await readLedger(caseDir);
  return verifyLedgerEntries(entries);
}

function probeBundledConnector(serverFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverFile], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let buffer = "";
    let stderr = "";
    const timer = setTimeout(() => finish(new Error("Bundled connector did not initialize within 3000 ms")), 3000);
    function finish(error, value) {
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve(value);
    }
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => finish(error));
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline));
        if (!response.result?.serverInfo) finish(new Error(response.error?.message ?? "Invalid initialize response"));
        else finish(undefined, response.result.serverInfo);
      } catch (error) {
        finish(new Error(`Invalid connector response: ${error.message}; ${stderr}`));
      }
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "rooty-doctor", version: "0.1.0" } } })}\n`);
  });
}
