import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  detectProjectHosts,
  installRooty,
  inspectRootyInstall,
  normalizeHosts,
  readProjectContext,
  ROOTY_HOST_IDS,
  ROOTY_PATHS,
  ROOTY_PROJECT_DIRECTORIES,
  ROOTY_SKILLS,
  ROOTY_SKILL_TARGETS,
  setDocumentationPaths,
  skillTargetsForHosts
} from "../src/lib/installer.js";
import { detectSetupModel } from "../src/lib/setup-model.js";
import { runDoctor } from "../src/lib/doctor.js";
import { main } from "../src/cli.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function project(name) {
  return mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

async function cliJson(argv) {
  const chunks = [];
  const write = process.stdout.write;
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    await main([...argv, "--json"]);
  } finally {
    process.stdout.write = write;
  }
  return JSON.parse(chunks.join(""));
}

test("agent-led install copies all Rooty skills for supported hosts", async () => {
  const projectRoot = await project("rooty-install");
  const result = await installRooty({ packageRoot: ROOT, projectRoot });

  assert.equal(result.installation, "agent-led-v3");
  assert.deepEqual(result.skills, ROOTY_SKILLS);
  for (const target of ROOTY_SKILL_TARGETS) {
    for (const skill of ROOTY_SKILLS) {
      const installed = await readFile(path.join(projectRoot, target, skill, "SKILL.md"), "utf8");
      const packaged = await readFile(path.join(ROOT, "skill", skill, "SKILL.md"), "utf8");
      assert.equal(installed, packaged);
    }
    const installedLauncher = await readFile(
      path.join(projectRoot, target, "rooty-mcp-builder", "assets", "start-dab.cjs"),
      "utf8"
    );
    const packagedLauncher = await readFile(
      path.join(ROOT, "skill", "rooty-mcp-builder", "assets", "start-dab.cjs"),
      "utf8"
    );
    assert.equal(installedLauncher, packagedLauncher);
  }

  assert.deepEqual(await readProjectContext(projectRoot), { schema_version: 1, documentation: { paths: [] } });
  assert.deepEqual((await readdir(path.join(projectRoot, ".rooty"))).sort(), ["config", "memory", "state"]);
  for (const directory of ROOTY_PROJECT_DIRECTORIES) {
    await readdir(path.join(projectRoot, directory));
  }
  assert.match(await readFile(path.join(projectRoot, ".gitignore"), "utf8"), /\.rooty\/memory\/drafts\//);
  const manifest = JSON.parse(await readFile(path.join(projectRoot, ROOTY_PATHS.manifest), "utf8"));
  assert.equal(manifest.project_context, ROOTY_PATHS.context);
  assert.deepEqual(manifest.hosts, [...ROOTY_HOST_IDS]);
  assert.equal(await detectSetupModel(projectRoot), "agent-led-v3");
  assert.equal(result.hostSelection, "undetected");
  const inspected = await inspectRootyInstall(projectRoot);
  assert.equal(inspected.ok, true, JSON.stringify(inspected.checks));
  assert.deepEqual(inspected.hosts, [...ROOTY_HOST_IDS]);
  assert.equal(inspected.checks.find((check) => check.name === "documentation-context")?.status, "WARN");
  assert.equal(inspected.checks.find((check) => check.name === "rooty-layout")?.status, "PASS");
  assert.equal(inspected.checks.find((check) => check.name === "memory-gitignore")?.status, "PASS");
});

test("install writes skills only for the requested hosts", async () => {
  const projectRoot = await project("rooty-host-claude");
  const result = await installRooty({ packageRoot: ROOT, projectRoot, hosts: ["claude"] });

  assert.deepEqual(result.hosts, ["claude"]);
  assert.equal(result.hostSelection, "requested");
  assert.deepEqual(result.targets, [".claude/skills"]);
  await readdir(path.join(projectRoot, ".claude/skills/rooty-setup"));
  await assert.rejects(() => readdir(path.join(projectRoot, ".agents")), /ENOENT/);

  const manifest = JSON.parse(await readFile(path.join(projectRoot, ROOTY_PATHS.manifest), "utf8"));
  assert.deepEqual(manifest.hosts, ["claude"]);
  assert.deepEqual(manifest.skill_targets, [".claude/skills"]);
  assert.equal(Object.keys(manifest.files).every((file) => file.startsWith(".claude/skills/")), true);

  const inspected = await inspectRootyInstall(projectRoot);
  assert.equal(inspected.ok, true, JSON.stringify(inspected.checks));
  assert.match(inspected.checks.find((check) => check.name === "installed-skills").message, /Claude/);

  await assert.rejects(
    () => installRooty({ packageRoot: ROOT, projectRoot, hosts: ["windsurf"] }),
    /Unsupported host: windsurf/
  );
});

test("install accepts host names through the CLI shorthand and the --host list", async () => {
  const shorthand = await project("rooty-cli-shorthand");
  assert.deepEqual((await cliJson(["install", "--project", shorthand, "--codex"])).hosts, ["codex"]);

  const list = await project("rooty-cli-host-list");
  assert.deepEqual((await cliJson(["install", "--project", list, "--host", "claude,cursor"])).hosts, ["claude", "cursor"]);

  await assert.rejects(
    () => main(["install", "--project", list, "--host", "windsurf"]),
    /Unsupported host: windsurf/
  );
});

test("host selection falls back to detection, then to the previous install", async () => {
  const projectRoot = await project("rooty-host-detect");
  await mkdir(path.join(projectRoot, ".cursor"));

  const detected = await detectProjectHosts(projectRoot);
  assert.deepEqual(detected, ["cursor"]);
  const first = await installRooty({ packageRoot: ROOT, projectRoot });
  assert.deepEqual(first.hosts, ["cursor"]);
  assert.equal(first.hostSelection, "detected");
  assert.deepEqual(first.targets, [".agents/skills"]);

  // A later Claude marker must not silently widen an install that already recorded its hosts.
  await mkdir(path.join(projectRoot, ".claude"));
  const second = await installRooty({ packageRoot: ROOT, projectRoot });
  assert.deepEqual(second.hosts, ["cursor"]);
  assert.equal(second.hostSelection, "previous-install");
  assert.equal(second.writtenFiles.length, 0);
  await assert.rejects(() => readdir(path.join(projectRoot, ".claude/skills")), /ENOENT/);

  const widened = await installRooty({ packageRoot: ROOT, projectRoot, hosts: ["cursor", "claude"] });
  assert.deepEqual(widened.hosts, ["claude", "cursor"]);
  assert.deepEqual(widened.targets, skillTargetsForHosts(["claude", "cursor"]));
  assert.deepEqual(widened.unmanagedFiles, []);
});

test("a manifest written before host targeting keeps covering every host", async () => {
  const projectRoot = await project("rooty-host-upgrade");
  await mkdir(path.join(projectRoot, ".cursor"));
  await installRooty({ packageRoot: ROOT, projectRoot });
  const manifestFile = path.join(projectRoot, ROOTY_PATHS.manifest);
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  delete manifest.hosts;
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const result = await installRooty({ packageRoot: ROOT, projectRoot });
  assert.deepEqual(result.hosts, [...ROOTY_HOST_IDS]);
  assert.equal(result.hostSelection, "previous-install");
  assert.deepEqual(result.targets, [...ROOTY_SKILL_TARGETS]);
  assert.deepEqual(result.unmanagedFiles, []);
  assert.deepEqual(await inspectRootyInstall(projectRoot).then((check) => check.hosts), [...ROOTY_HOST_IDS]);
});

test("narrowing the host list stops tracking files instead of deleting them", async () => {
  const projectRoot = await project("rooty-host-narrow");
  await installRooty({ packageRoot: ROOT, projectRoot });
  const claudeSkill = path.join(projectRoot, ".claude/skills/rooty-setup/SKILL.md");

  const narrowed = await installRooty({ packageRoot: ROOT, projectRoot, hosts: ["cursor"] });
  assert.deepEqual(narrowed.hosts, ["cursor"]);
  assert.equal(narrowed.unmanagedFiles.some((file) => file.startsWith(".claude/skills/")), true);
  await readFile(claudeSkill, "utf8");

  const manifest = JSON.parse(await readFile(path.join(projectRoot, ROOTY_PATHS.manifest), "utf8"));
  assert.equal(Object.keys(manifest.files).some((file) => file.startsWith(".claude/skills/")), false);
  assert.equal((await inspectRootyInstall(projectRoot)).ok, true);

  // Re-adding the host reclaims the untouched files without a conflict.
  const restored = await installRooty({ packageRoot: ROOT, projectRoot, hosts: ["cursor", "claude"] });
  assert.deepEqual(restored.unmanagedFiles, []);
  assert.equal(restored.writtenFiles.length, 0);
});

test("install removes the empty MCP category placeholders and preserves provider artifacts", async () => {
  const projectRoot = await project("rooty-mcp-layout");
  await installRooty({ packageRoot: ROOT, projectRoot, hosts: ["cursor"] });
  await assert.rejects(() => readdir(path.join(projectRoot, ".rooty/mcp")), /ENOENT/);

  await mkdir(path.join(projectRoot, ".rooty/mcp/observability"), { recursive: true });
  await mkdir(path.join(projectRoot, ".rooty/mcp/data/sql-server/orders"), { recursive: true });
  await writeFile(path.join(projectRoot, ".rooty/mcp/data/sql-server/orders/dab-config.json"), "{}\n", "utf8");

  const result = await installRooty({ packageRoot: ROOT, projectRoot, hosts: ["cursor"] });
  assert.deepEqual(result.prunedDirectories, [".rooty/mcp/observability"]);
  assert.deepEqual((await readdir(path.join(projectRoot, ".rooty/mcp"))).sort(), ["data"]);
  await readFile(path.join(projectRoot, ".rooty/mcp/data/sql-server/orders/dab-config.json"), "utf8");
  assert.deepEqual(normalizeHosts(["cursor", "all", "CLAUDE"]), [...ROOTY_HOST_IDS]);
});

test("install copies legacy memory into the canonical Rooty layout without deleting the source", async () => {
  const projectRoot = await project("rooty-memory-migration");
  const legacyDraft = path.join(projectRoot, ".investigator/memory/drafts/INV-LEGACY.json");
  const legacyApproved = path.join(projectRoot, ".investigator/memory/approved/INV-APPROVED.json");
  await mkdir(path.dirname(legacyDraft), { recursive: true });
  await mkdir(path.dirname(legacyApproved), { recursive: true });
  await writeFile(legacyDraft, "{\"kind\":\"draft\"}\n", "utf8");
  await writeFile(legacyApproved, "{\"kind\":\"approved\"}\n", "utf8");

  const result = await installRooty({ packageRoot: ROOT, projectRoot });
  assert.equal(result.memory.migratedFiles.length, 2);
  assert.equal(await readFile(path.join(projectRoot, ".rooty/memory/drafts/INV-LEGACY.json"), "utf8"), "{\"kind\":\"draft\"}\n");
  assert.equal(await readFile(path.join(projectRoot, ".rooty/memory/approved/INV-APPROVED.json"), "utf8"), "{\"kind\":\"approved\"}\n");
  assert.equal(await readFile(legacyDraft, "utf8"), "{\"kind\":\"draft\"}\n");
  assert.equal(await readFile(legacyApproved, "utf8"), "{\"kind\":\"approved\"}\n");
});

test("install refuses conflicting legacy memory before installing skills", async () => {
  const projectRoot = await project("rooty-memory-conflict");
  const legacyDraft = path.join(projectRoot, ".investigator/memory/drafts/INV-CONFLICT.json");
  const canonicalDraft = path.join(projectRoot, ".rooty/memory/drafts/INV-CONFLICT.json");
  await mkdir(path.dirname(legacyDraft), { recursive: true });
  await mkdir(path.dirname(canonicalDraft), { recursive: true });
  await writeFile(legacyDraft, "{\"source\":\"legacy\"}\n", "utf8");
  await writeFile(canonicalDraft, "{\"source\":\"canonical\"}\n", "utf8");

  await assert.rejects(() => installRooty({ packageRoot: ROOT, projectRoot }), /conflicting legacy memory migration/);
  await assert.rejects(() => readFile(path.join(projectRoot, ".agents/skills/rooty-setup/SKILL.md"), "utf8"), /ENOENT/);
});

test("install records confirmed documentation paths and is idempotent", async () => {
  const projectRoot = await project("rooty-docs");
  await mkdir(path.join(projectRoot, "docs"));
  await writeFile(path.join(projectRoot, "README.md"), "# Project\n", "utf8");
  await writeFile(path.join(projectRoot, ".gitignore"), "node_modules/\n", "utf8");

  const first = await installRooty({ packageRoot: ROOT, projectRoot, documentationPaths: ["README.md", "docs", "docs"] });
  assert.deepEqual(first.documentationPaths, ["README.md", "docs"]);
  const second = await installRooty({ packageRoot: ROOT, projectRoot });
  assert.equal(second.writtenFiles.length, 0);
  assert.deepEqual(second.documentationPaths, ["README.md", "docs"]);
  const ignore = await readFile(path.join(projectRoot, ".gitignore"), "utf8");
  assert.match(ignore, /^node_modules\//);
  assert.match(ignore, /\.rooty\/memory\/drafts\//);

  await setDocumentationPaths({ projectRoot, documentationPaths: ["docs"] });
  assert.deepEqual((await readProjectContext(projectRoot)).documentation.paths, ["docs"]);
});

test("install migrates the flat 0.2 Rooty state layout", async () => {
  const projectRoot = await project("rooty-layout-migration");
  await mkdir(path.join(projectRoot, "docs"));
  await installRooty({ packageRoot: ROOT, projectRoot, documentationPaths: ["docs"] });

  const manifest = JSON.parse(await readFile(path.join(projectRoot, ROOTY_PATHS.manifest), "utf8"));
  manifest.project_context = ROOTY_PATHS.legacyContext;
  await writeFile(path.join(projectRoot, ROOTY_PATHS.manifest), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(path.join(projectRoot, ROOTY_PATHS.context), path.join(projectRoot, ROOTY_PATHS.legacyContext));
  await rename(path.join(projectRoot, ROOTY_PATHS.manifest), path.join(projectRoot, ROOTY_PATHS.legacyManifest));

  assert.equal(await detectSetupModel(projectRoot), "agent-led-v3");
  const result = await installRooty({ packageRoot: ROOT, projectRoot });
  assert.deepEqual(result.documentationPaths, ["docs"]);
  assert.deepEqual((await readProjectContext(projectRoot)).documentation.paths, ["docs"]);
  await assert.rejects(() => readFile(path.join(projectRoot, ROOTY_PATHS.legacyContext), "utf8"), /ENOENT/);
  await assert.rejects(() => readFile(path.join(projectRoot, ROOTY_PATHS.legacyManifest), "utf8"), /ENOENT/);
});

test("install preflights every owned file before writing and refuses local modifications", async () => {
  const projectRoot = await project("rooty-conflict");
  await installRooty({ packageRoot: ROOT, projectRoot });
  const missing = path.join(projectRoot, ".agents/skills/rooty-setup/agents/openai.yaml");
  const modified = path.join(projectRoot, ".claude/skills/root-cause-investigator/SKILL.md");
  await rm(missing);
  await writeFile(modified, "user-owned change\n", "utf8");

  await assert.rejects(
    () => installRooty({ packageRoot: ROOT, projectRoot }),
    /Refusing to overwrite modified or unowned skill file/
  );
  await assert.rejects(() => readFile(missing, "utf8"), /ENOENT/);
  assert.equal(await readFile(modified, "utf8"), "user-owned change\n");
});

test("documentation context rejects missing and dangerously broad paths", async () => {
  const projectRoot = await project("rooty-doc-scope");
  await assert.rejects(
    () => setDocumentationPaths({ projectRoot, documentationPaths: [projectRoot] }),
    /too broad/
  );
  await assert.rejects(
    () => setDocumentationPaths({ projectRoot, documentationPaths: ["missing-docs"] }),
    /unavailable/
  );
});

test("installer refuses symlinked Rooty target paths", async (context) => {
  const projectRoot = await project("rooty-symlink");
  const outside = await project("rooty-symlink-outside");
  await mkdir(path.join(projectRoot, ".agents"));
  try {
    await symlink(outside, path.join(projectRoot, ".agents", "skills"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error?.code)) {
      context.skip("Creating symlinks requires Windows Developer Mode or elevation");
      return;
    }
    throw error;
  }
  await assert.rejects(
    () => installRooty({ packageRoot: ROOT, projectRoot }),
    /symlinked installation path/
  );
});

test("doctor recognizes an agent-led install without requiring the legacy source registry", async () => {
  const projectRoot = await project("rooty-agent-doctor");
  await installRooty({ packageRoot: ROOT, projectRoot });
  const result = await runDoctor({ packageRoot: ROOT, projectRoot });
  assert.equal(result.setupModel, "agent-led-v3");
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  assert.equal(result.checks.some((check) => check.name === "source-registry"), false);
  assert.equal(result.checks.find((check) => check.name === "installed-skills")?.status, "PASS");
});
