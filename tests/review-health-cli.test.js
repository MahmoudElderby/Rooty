import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "bin", "investigator.js");

async function directory(label) {
  return mkdtemp(path.join(os.tmpdir(), `${label}-`));
}

function run(args) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd: ROOT, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
}

function healthProfile() {
  return {
    schema_version: 1,
    environment: "production",
    confirmation: { status: "CONFIRMED", confirmed_by: "developer" },
    components: [{ id: "api", dependencies: [], probes: [{ id: "ready", read_only: true, timeout_ms: 2000, expected: "ready" }] }]
  };
}

test("session-review CLI writes the public artifact set for an explicit file", async () => {
  const project = await directory("rooty-cli-session-project");
  const input = path.join(project, "cursor.jsonl");
  const output = path.join(project, ".rooty", "session-reviews", "cli-test");
  await writeFile(input, `${JSON.stringify({ role: "assistant", message: { content: [{ type: "text", text: "private" }] } })}\n`, "utf8");
  const result = run(["session", "review", "--host", "cursor", "--input", input, "--project", project, "--output", output]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SESSION_REVIEW cursor:/);
  for (const file of ["session-review.json", "session-review.md", "improvement-draft.json"]) assert.ok((await readFile(path.join(output, file))).length > 0);
});

test("health CLI implements healthy, critical, and invalid exit codes", async () => {
  const root = await directory("rooty-cli-health");
  const profileFile = path.join(root, "profile.json");
  const observationsFile = path.join(root, "observations.json");
  await writeFile(profileFile, JSON.stringify(healthProfile()), "utf8");
  await writeFile(observationsFile, JSON.stringify({ schema_version: 1, environment: "production", identity_verified: true, components: [{ component_id: "api", probes: [{ probe_id: "ready", status: "PASS", evidence_refs: ["OBS-1"] }] }] }), "utf8");
  const healthy = run(["health", "evaluate", "--profile", profileFile, "--observations", observationsFile, "--output", path.join(root, "healthy")]);
  assert.equal(healthy.status, 0, healthy.stderr);
  assert.match(healthy.stdout, /HEALTH HEALTHY/);

  await writeFile(observationsFile, JSON.stringify({ schema_version: 1, environment: "production", identity_verified: true, components: [{ component_id: "api", probes: [{ probe_id: "ready", status: "FAIL", evidence_refs: ["OBS-2"] }] }] }), "utf8");
  const critical = run(["health", "evaluate", "--profile", profileFile, "--observations", observationsFile, "--output", path.join(root, "critical")]);
  assert.equal(critical.status, 2, critical.stderr);
  assert.match(critical.stdout, /HEALTH CRITICAL/);

  const invalid = run(["health", "evaluate", "--profile", profileFile]);
  assert.equal(invalid.status, 3);
  assert.match(invalid.stderr, /Invalid health input/);
});
