import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  installRooty,
  inspectRootyInstall,
  readProjectContext,
  ROOTY_SKILLS,
  ROOTY_SKILL_TARGETS,
  setDocumentationPaths
} from "../src/lib/installer.js";
import { detectSetupModel } from "../src/lib/setup-model.js";
import { runDoctor } from "../src/lib/doctor.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function project(name) {
  return mkdtemp(path.join(os.tmpdir(), `${name}-`));
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
  }

  assert.deepEqual(await readProjectContext(projectRoot), { schema_version: 1, documentation: { paths: [] } });
  assert.equal(await detectSetupModel(projectRoot), "agent-led-v3");
  const inspected = await inspectRootyInstall(projectRoot);
  assert.equal(inspected.ok, true, JSON.stringify(inspected.checks));
  assert.equal(inspected.checks.find((check) => check.name === "documentation-context")?.status, "WARN");
});

test("install records confirmed documentation paths and is idempotent", async () => {
  const projectRoot = await project("rooty-docs");
  await mkdir(path.join(projectRoot, "docs"));
  await writeFile(path.join(projectRoot, "README.md"), "# Project\n", "utf8");

  const first = await installRooty({ packageRoot: ROOT, projectRoot, documentationPaths: ["README.md", "docs", "docs"] });
  assert.deepEqual(first.documentationPaths, ["README.md", "docs"]);
  const second = await installRooty({ packageRoot: ROOT, projectRoot });
  assert.equal(second.writtenFiles.length, 0);
  assert.deepEqual(second.documentationPaths, ["README.md", "docs"]);

  await setDocumentationPaths({ projectRoot, documentationPaths: ["docs"] });
  assert.deepEqual((await readProjectContext(projectRoot)).documentation.paths, ["docs"]);
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
