#!/usr/bin/env node
// Captures real Rooty CLI behaviour into generated/captured-output.json so the
// explainer video never shows hand-written text. Everything rendered on screen
// originates here.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const VIDEO_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(VIDEO_ROOT, "../..");
const CLI = path.join(REPO_ROOT, "bin/investigator.js");
const SNAPSHOT = path.join(REPO_ROOT, "evals/mock-sources/confirmed-timeout.json");
const GENERATED_DIR = path.join(VIDEO_ROOT, "generated");
const OUTPUT_FILE = path.join(GENERATED_DIR, "captured-output.json");

// Sandbox paths are absolute temp directories. The video shows these stable
// display paths instead so frames stay readable and reproducible.
const DISPLAY_PROJECT = "~/work/checkout-api";
const DISPLAY_CASE_DIR = "~/rooty-cases/INV-20260815-DEMO0001";

function rooty(args, { cwd = REPO_ROOT, expectFailure = false } = {}) {
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
    child.on("close", (code) => {
      if (code !== 0 && !expectFailure) {
        reject(new Error(`rooty ${args.join(" ")} exited ${code}\n${stderr}${stdout}`));
        return;
      }
      if (code === 0 && expectFailure) {
        reject(new Error(`rooty ${args.join(" ")} unexpectedly succeeded`));
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });
}

function lines(value) {
  return value.replace(/\n$/, "").split("\n");
}

async function walk(root, relative = "") {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const collected = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const next = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      collected.push({ path: next, type: "directory" });
      collected.push(...(await walk(root, next)));
    } else {
      collected.push({ path: next, type: "file" });
    }
  }
  return collected;
}

// Groups the installed tree into the handful of rows a viewer can actually read
// in a few seconds, while keeping the true file counts.
function summarizeTree(entries) {
  const groups = [
    { label: ".agents/skills/rooty-setup/", prefix: ".agents/skills/rooty-setup/" },
    { label: ".agents/skills/rooty-mcp-builder/", prefix: ".agents/skills/rooty-mcp-builder/" },
    { label: ".agents/skills/root-cause-investigator/", prefix: ".agents/skills/root-cause-investigator/" },
    { label: ".claude/skills/rooty-setup/", prefix: ".claude/skills/rooty-setup/" },
    { label: ".claude/skills/rooty-mcp-builder/", prefix: ".claude/skills/rooty-mcp-builder/" },
    { label: ".claude/skills/root-cause-investigator/", prefix: ".claude/skills/root-cause-investigator/" }
  ];
  const summary = groups.map((group) => ({
    label: group.label,
    files: entries.filter((entry) => entry.type === "file" && entry.path.startsWith(group.prefix)).length
  }));
  const rootyFiles = entries.filter((entry) => entry.type === "file" && entry.path.startsWith(".rooty/"));
  return {
    skillGroups: summary,
    skillFileTotal: summary.reduce((total, group) => total + group.files, 0),
    rootyFiles: rootyFiles.map((entry) => entry.path),
    rootyDirectories: entries
      .filter((entry) => entry.type === "directory" && entry.path.startsWith(".rooty"))
      .map((entry) => entry.path)
  };
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function createSandboxProject(root) {
  await mkdir(path.join(root, "docs"), { recursive: true });
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "README.md"), "# checkout-api\n\nCheckout and payment authorization service.\n");
  await writeFile(path.join(root, "docs/architecture.md"), "# Architecture\n\ncheckout-api calls payments-api to authorize.\n");
  await writeFile(path.join(root, "src/checkout.js"), "export function checkout() {}\n");
  // Pre-existing ignore rules prove the installer merges instead of overwriting.
  await writeFile(path.join(root, ".gitignore"), "node_modules/\ndist/\n");
}

async function captureInstall(workspace) {
  const projectRoot = path.join(workspace, "checkout-api");
  await mkdir(projectRoot, { recursive: true });
  await createSandboxProject(projectRoot);

  const gitignoreBefore = await readFile(path.join(projectRoot, ".gitignore"), "utf8");
  const withoutDocs = await rooty(["install", "--project", projectRoot]);
  const treeEntries = await walk(projectRoot);
  const gitignoreAfter = await readFile(path.join(projectRoot, ".gitignore"), "utf8");
  const manifest = await readJson(path.join(projectRoot, ".rooty/state/install-manifest.json"));
  const context = await readJson(path.join(projectRoot, ".rooty/config/project-context.json"));

  const withDocs = await rooty(["install", "--project", projectRoot, "--docs", "README.md,docs"]);
  const contextWithDocs = await readJson(path.join(projectRoot, ".rooty/config/project-context.json"));
  // A freshly installed project is package-ready but intentionally not yet MCP-configured.
  const doctor = await rooty(["doctor", "--project", projectRoot], { expectFailure: true });

  // Safety beat: a locally edited skill file must block the next install.
  const editedSkill = path.join(projectRoot, ".agents/skills/rooty-setup/SKILL.md");
  const original = await readFile(editedSkill, "utf8");
  await writeFile(editedSkill, `${original}\n<!-- local edit -->\n`);
  const refusal = await rooty(["install", "--project", projectRoot], { expectFailure: true });
  await writeFile(editedSkill, original);

  const manifestFileCount = Object.keys(manifest.files ?? {}).length;
  return {
    projectRoot,
    command: "npx rooty-investigator install",
    bannerWithoutDocs: lines(withoutDocs.stdout),
    bannerWithDocs: lines(withDocs.stdout),
    docsCommand: 'npx rooty-investigator install --docs "README.md,docs"',
    tree: treeEntries.map((entry) => entry.path),
    treeSummary: summarizeTree(treeEntries),
    skills: manifest.skills,
    skillTargets: manifest.skill_targets,
    installationMode: manifest.installation,
    manifestFileCount,
    trackedFileHashSample: Object.entries(manifest.files ?? {})
      .slice(0, 3)
      .map(([file, hash]) => ({ file, hash })),
    context,
    contextWithDocs,
    gitignoreBefore: lines(gitignoreBefore),
    gitignoreAfter: lines(gitignoreAfter),
    doctorLines: lines(doctor.stdout),
    refusalCommand: "npx rooty-investigator install",
    refusal: lines(refusal.stderr)
  };
}

async function captureInvestigation(workspace, projectRoot) {
  const caseDir = path.join(workspace, "rooty-cases", "INV-20260815-DEMO0001");
  const run = await rooty([
    "run",
    "ROOTY-101",
    "--project",
    projectRoot,
    "--snapshot",
    SNAPSHOT,
    "--case-dir",
    caseDir
  ]);
  const report = await rooty(["report", "--project", projectRoot, "--case-dir", caseDir]);
  const caseState = await readJson(path.join(caseDir, "case.json"));
  const ledgerRaw = await readFile(path.join(caseDir, "evidence.ndjson"), "utf8");
  const ledger = ledgerRaw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const reportMarkdown = await readFile(path.join(caseDir, "report.md"), "utf8");

  const propose = await rooty(["memory", "propose", "--project", projectRoot, "--case-dir", caseDir]);
  const draftFile = propose.stdout.replace(/^Draft:\s*/, "").trim();
  const draft = await readJson(draftFile);
  const approve = await rooty([
    "memory",
    "approve",
    "--project",
    projectRoot,
    "--case-dir",
    caseDir,
    "--draft",
    draftFile,
    "--reviewed-by",
    "team-payments"
  ]);
  const approved = await readJson(approve.stdout.replace(/^Approved:\s*/, "").trim());
  const evaluation = await rooty(["eval"]);
  const caseFiles = (await readdir(caseDir)).sort();

  return {
    caseDir,
    prompt: "Investigate PAY-123. Root cause only.\nDo not propose or apply fixes.",
    runCommand: `rooty run ROOTY-101 --snapshot evals/mock-sources/confirmed-timeout.json --case-dir ${DISPLAY_CASE_DIR}`,
    runOutput: lines(run.stdout),
    reportCommand: `rooty report --case-dir ${DISPLAY_CASE_DIR}`,
    reportOutput: lines(report.stdout),
    caseId: caseState.case_id,
    ticket: caseState.ticket,
    expectedPath: caseState.expected_path,
    hypotheses: caseState.hypotheses,
    analysis: caseState.analysis,
    assessment: caseState.assessment,
    snapshotSha256: caseState.source_snapshot_sha256,
    caseFiles,
    ledger: ledger.map((entry) => ({
      evidence_id: entry.evidence_id,
      classification: entry.classification,
      source_type: entry.source_type,
      source_system: entry.source_system,
      event_time_range: entry.event_time_range,
      query_or_locator: entry.query_or_locator,
      observation: entry.observation,
      limitations: entry.limitations,
      supports: entry.supports ?? [],
      contradicts: entry.contradicts ?? [],
      sequence: entry.sequence,
      previous_hash: entry.previous_hash,
      entry_hash: entry.entry_hash
    })),
    reportMarkdown,
    reportSections: reportMarkdown
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.replace(/^##\s*/, "")),
    proposeCommand: `rooty memory propose --case-dir ${DISPLAY_CASE_DIR}`,
    proposeOutput: lines(propose.stdout),
    approveCommand: "rooty memory approve --draft ... --reviewed-by team-payments",
    approveOutput: lines(approve.stdout),
    draft: {
      case_id: draft.case_id,
      scope: draft.scope,
      kind: draft.kind,
      concern_key: draft.concern_key ?? draft.canonical_key ?? null,
      review_status: draft.review_status ?? null,
      root_cause_class: draft.root_cause_class ?? null,
      useful_pivots: draft.useful_pivots ?? []
    },
    approved: {
      case_id: approved.case_id,
      review_status: approved.review_status ?? null,
      reviewed_by: approved.reviewed_by ?? null
    },
    // The absolute expiry is review-time dependent; the retention window is the
    // stable fact worth showing.
    retention_days:
      approved.reviewed_at && approved.expires_at
        ? Math.round(
            (Date.parse(approved.expires_at) - Date.parse(approved.reviewed_at)) / 86400000
          )
        : null,
    evalCommand: "rooty eval",
    evalOutput: lines(evaluation.stdout)
  };
}

// Replaces sandbox temp paths with the stable display paths used on screen.
function redact(value, replacements) {
  if (typeof value === "string") {
    let next = value;
    for (const [from, to] of replacements) next = next.split(from).join(to);
    return next;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, replacements));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item, replacements)]));
  }
  return value;
}

async function main() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "rooty-video-capture-"));
  try {
    const install = await captureInstall(workspace);
    const investigation = await captureInvestigation(workspace, install.projectRoot);
    const packageJson = await readJson(path.join(REPO_ROOT, "package.json"));

    const replacements = [
      [investigation.caseDir, DISPLAY_CASE_DIR],
      [install.projectRoot, DISPLAY_PROJECT],
      [REPO_ROOT, "~/src/rooty"],
      [workspace, "~"]
    ];

    const captured = {
      schema_version: 1,
      generator: "tools/video/capture.mjs",
      rooty_version: packageJson.version,
      node_version: process.version,
      display_project: DISPLAY_PROJECT,
      display_case_dir: DISPLAY_CASE_DIR,
      install: redact({ ...install, projectRoot: DISPLAY_PROJECT }, replacements),
      investigation: redact({ ...investigation, caseDir: DISPLAY_CASE_DIR }, replacements)
    };

    await mkdir(GENERATED_DIR, { recursive: true });
    await writeFile(OUTPUT_FILE, `${JSON.stringify(captured, null, 2)}\n`);
    const written = await stat(OUTPUT_FILE);
    process.stdout.write(
      `Captured Rooty ${captured.rooty_version} output: ${install.bannerWithoutDocs.length} install lines, ` +
        `${install.doctorLines.length} doctor lines, ${investigation.ledger.length} ledger entries ` +
        `(${written.size} bytes)\n${OUTPUT_FILE}\n`
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

await main();
