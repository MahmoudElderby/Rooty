import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runDoctor } from "../src/lib/doctor.js";
import { runFrozenCase } from "../src/lib/cases.js";
import { installRooty } from "../src/lib/installer.js";
import { readJson } from "../src/lib/core.js";
import {
  buildTimeline,
  doctorLine,
  installLine,
  latestAnimationEnd,
  readCapture,
  VARIANTS
} from "../tools/video/storyboard.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "bin/investigator.js");
const SNAPSHOT = path.join(ROOT, "evals/mock-sources/confirmed-timeout.json");
const STAGE_JS = path.join(ROOT, "tools/video/stage/stage.js");

async function tempDirectory(name) {
  return mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

function rooty(args, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** Every string the stage will paint, so tests can check it against real output. */
function onScreenText(timeline) {
  const strings = [];
  for (const scene of timeline.scenes) {
    for (const key of ["kicker", "title", "sub", "caption"]) {
      if (scene[key]) strings.push(scene[key]);
    }
    for (const panel of scene.panels ?? []) {
      for (const key of ["label", "path", "title", "sub", "eyebrow", "meta"]) {
        if (panel[key]) strings.push(panel[key]);
      }
      if (panel.command) strings.push(panel.command.text);
      for (const item of [...(panel.items ?? []), ...(panel.lines ?? [])]) {
        for (const key of ["text", "name", "title", "body", "label", "detail", "query", "time", "id", "hash", "previous", "value"]) {
          if (typeof item[key] === "string" && item[key]) strings.push(item[key]);
        }
        // A tagged terminal line paints as one visual line: label span + text.
        if (item.tag?.text) {
          strings.push(item.tag.text);
          if (typeof item.text === "string") strings.push(`${item.tag.text}${item.text}`);
        }
      }
    }
  }
  return strings;
}

test("captured output matches what the CLI prints today", async () => {
  const capture = await readCapture();
  const manifest = await readJson(path.join(ROOT, "package.json"));
  assert.equal(capture.rooty_version, manifest.version, "re-run tools/video/capture.mjs after a version bump");

  const projectRoot = await tempDirectory("rooty-video-install");
  await writeFile(path.join(projectRoot, "README.md"), "# demo\n");
  const installed = await rooty(["install", "--project", projectRoot]);
  assert.equal(installed.code, 0, installed.stderr);

  // Compare label vocabulary and shape rather than absolute paths, which the
  // capture rewrites to a stable display path.
  const liveLabels = installed.stdout
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => line.split(" ")[0]);
  const capturedLabels = capture.install.bannerWithoutDocs.map((line) => line.split(" ")[0]);
  assert.deepEqual(capturedLabels, liveLabels, "install banner changed; re-run tools/video/capture.mjs");
  assert.match(capture.install.bannerWithoutDocs[0], /^INSTALLED /);
  assert.ok(capture.install.bannerWithoutDocs.includes("  Set up Rooty for this project."));

  // Every label the installer emits must have a colour rule in the storyboard.
  for (const line of capture.install.bannerWithoutDocs) {
    if (line === "" || line.startsWith("  ") || line.startsWith("Next:")) continue;
    const classified = installLine(line);
    assert.ok(classified.tag, `install banner label is not coloured by storyboard.mjs: ${line}`);
  }
});

test("captured doctor and install facts match a live run", async () => {
  const capture = await readCapture();
  const projectRoot = await tempDirectory("rooty-video-doctor");
  await writeFile(path.join(projectRoot, "README.md"), "# demo\n");
  const result = await installRooty({ packageRoot: ROOT, projectRoot, documentationPaths: ["README.md"] });
  assert.equal(result.skills.length, capture.install.skills.length);
  assert.deepEqual(result.skills, capture.install.skills);
  assert.deepEqual(result.targets, capture.install.skillTargets);

  const manifest = await readJson(path.join(projectRoot, ".rooty/state/install-manifest.json"));
  assert.equal(
    Object.keys(manifest.files).length,
    capture.install.manifestFileCount,
    "owned file count changed; re-run tools/video/capture.mjs"
  );
  assert.equal(manifest.installation, capture.install.installationMode);

  const doctor = await runDoctor({ packageRoot: ROOT, projectRoot, requireActivatedConnectors: true });
  const capturedNames = capture.install.doctorLines
    .map((line) => line.trim())
    .filter((line) => /^(PASS|WARN|FAIL)/.test(line))
    .map((line) => doctorLine(line).text.trim().split(":")[0]);
  assert.deepEqual(
    doctor.checks.map((check) => check.name),
    capturedNames,
    "doctor checks changed; re-run tools/video/capture.mjs"
  );
});

test("captured investigation matches the frozen snapshot and a live case run", async () => {
  const capture = await readCapture();
  const snapshot = await readJson(SNAPSHOT);
  const investigation = capture.investigation;

  assert.equal(investigation.caseId, snapshot.case_id);
  assert.equal(investigation.ticket.id, snapshot.ticket.id);
  assert.deepEqual(investigation.expectedPath, snapshot.expected_path);
  assert.deepEqual(investigation.hypotheses, snapshot.hypotheses);
  assert.equal(investigation.analysis.root_cause, snapshot.analysis.root_cause);
  assert.equal(investigation.analysis.first_bad_state, snapshot.analysis.first_bad_state);
  assert.equal(investigation.ledger.length, snapshot.evidence.length);
  for (const [index, entry] of investigation.ledger.entries()) {
    assert.equal(entry.evidence_id, snapshot.evidence[index].evidence_id);
    assert.equal(entry.observation, snapshot.evidence[index].observation);
    assert.equal(entry.classification, snapshot.evidence[index].classification);
  }

  const projectRoot = await tempDirectory("rooty-video-case-project");
  const caseDir = path.join(await tempDirectory("rooty-video-case"), "case");
  const run = await runFrozenCase({ projectRoot, ticket: "ROOTY-101", snapshotFile: SNAPSHOT, caseDir });
  assert.equal(run.status, investigation.assessment.status);

  // The hash chain is shown on screen, so a change in canonical hashing has to
  // invalidate the capture rather than silently render stale hashes.
  const ledger = (await readFile(path.join(caseDir, "evidence.ndjson"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    ledger.map((entry) => [entry.sequence, entry.previous_hash, entry.entry_hash]),
    investigation.ledger.map((entry) => [entry.sequence, entry.previous_hash, entry.entry_hash]),
    "evidence hash chain changed; re-run tools/video/capture.mjs"
  );
  assert.equal(ledger[0].previous_hash, "GENESIS");
});

test("every storyboard variant fits its scene durations and uses known panels", async () => {
  const capture = await readCapture();
  const available = new Set(
    [...(await readFile(STAGE_JS, "utf8")).matchAll(/^ {2}(\w+)\(panel, track\)/gm)].map((match) => match[1])
  );
  assert.ok(available.size >= 10, "could not parse panel builders from stage.js");

  for (const variant of VARIANTS) {
    const timeline = await buildTimeline({ variant, capture });
    assert.ok(timeline.scenes.length > 0, variant);
    assert.equal(timeline.totalFrames, Math.round((timeline.durationMs / 1000) * timeline.fps));
    for (const scene of timeline.scenes) {
      const latest = latestAnimationEnd(scene);
      assert.ok(
        scene.durationMs >= latest,
        `${variant}/${scene.id} is ${scene.durationMs}ms but animates until ${latest}ms`
      );
      for (const panel of scene.panels ?? []) {
        assert.ok(available.has(panel.type), `${variant}/${scene.id} uses unknown panel type ${panel.type}`);
      }
    }
  }
});

test("on-screen terminal text is quoted from the capture, not written by hand", async () => {
  const capture = await readCapture();
  const timeline = await buildTimeline({ variant: "full", capture });
  const strings = onScreenText(timeline);

  const mustAppear = [
    capture.install.bannerWithoutDocs[0],
    capture.install.command,
    capture.install.refusal[0],
    capture.investigation.analysis.root_cause,
    capture.investigation.analysis.first_bad_state,
    capture.investigation.assessment.status,
    capture.investigation.evalOutput[0]
  ];
  for (const value of mustAppear) {
    assert.ok(
      strings.some((item) => item.includes(value)),
      `expected the video to show captured text: ${value}`
    );
  }

  // Real observations and hashes, never paraphrases.
  for (const entry of capture.investigation.ledger) {
    assert.ok(
      strings.some((item) => item.includes(entry.observation)),
      `evidence ${entry.evidence_id} observation is missing from the video`
    );
  }
  for (const line of capture.install.doctorLines) {
    if (!line.startsWith("PASS")) continue;
    const message = doctorLine(line).text.trim();
    assert.ok(
      strings.some((item) => item.includes(message)),
      `doctor line missing from the video: ${line}`
    );
  }
});

test("video tooling and media stay out of the published package", async () => {
  const manifest = await readJson(path.join(ROOT, "package.json"));
  for (const entry of manifest.files) {
    assert.doesNotMatch(entry, /^(tools|media)\b/, `${entry} would ship the video pipeline to npm`);
  }
  assert.equal(manifest.files.includes("docs/"), true);
});
