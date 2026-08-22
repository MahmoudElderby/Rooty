// Builds the explainer timeline from tools/video/generated/captured-output.json.
// Nothing here invents CLI text: on-screen terminal output, file counts, hashes,
// evidence and verdicts all come from the capture step.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VIDEO_ROOT = path.dirname(fileURLToPath(import.meta.url));
export const CAPTURE_FILE = path.join(VIDEO_ROOT, "generated/captured-output.json");

export const VARIANTS = ["full", "install", "investigation", "gif"];

const ACT_INSTALL = "Act 1 \u00b7 Installation";
const ACT_INVESTIGATION = "Act 2 \u00b7 Investigation";

export async function readCapture(file = CAPTURE_FILE) {
  return JSON.parse(await readFile(file, "utf8"));
}

/* --------------------------------------------------------------- formatting */

// Mirrors the label colouring in installOutput() (src/cli.js). Capture runs with
// NO_COLOR so the tags are re-applied here from the same label vocabulary.
const INSTALL_LABEL_TONES = {
  INSTALLED: "green",
  HOSTS: "cyan",
  PROJECT: "cyan",
  SKILLS: "cyan",
  ROOTY: "cyan",
  SETTINGS: "cyan",
  MEMORY: "cyan",
  DOCS: "cyan"
};

export function installLine(text) {
  if (text === "") return { tone: "blank", text: "" };
  if (text.startsWith("Next:")) return { tone: "bold", text, tag: { text: "Next:", tone: "text" } };
  if (text.startsWith("  Set up Rooty")) return { tone: "cyan", text };
  const label = text.split(" ")[0];
  const tone = INSTALL_LABEL_TONES[label];
  if (!tone) return { tone: "default", text };
  // The yellow DOCS variant only applies when no documentation path is stored.
  const resolved = label === "DOCS" && text.includes("not selected") ? "amber" : tone;
  return { tone: "default", text: text.slice(label.length), tag: { text: label, tone: resolved } };
}

export function doctorLine(text) {
  const match = /^(PASS|WARN|FAIL)(\s+)(.*)$/.exec(text);
  // The trailing "Doctor: healthy" summary carries no status column.
  if (!match) return { tone: text.startsWith("Doctor:") ? "green" : "default", text };
  const tone = match[1] === "PASS" ? "green" : match[1] === "WARN" ? "amber" : "red";
  return { tone: "muted", text: `${match[2]}${match[3]}`, tag: { text: match[1], tone } };
}

function shortHash(hash) {
  return hash === "GENESIS" ? "GENESIS" : hash.slice(0, 10);
}

function truncate(value, limit) {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}\u2026`;
}

function timeRange(range) {
  const [from, to] = range.split("/");
  const clock = (value) => value.slice(11, 20);
  return `${clock(from)} \u2192 ${clock(to)}`;
}

function rangeStart(range) {
  return range.split("/")[0];
}

/* ------------------------------------------------------------- act builders */

function installScenes(capture) {
  const { install } = capture;
  const summary = install.treeSummary;
  const bannerNoDocs = install.bannerWithoutDocs.map(installLine);
  const bannerDocs = install.bannerWithDocs.map(installLine);
  const docsLine = bannerDocs.find((line) => line.tag?.text === "DOCS");

  const treeItems = [];
  treeItems.push({ name: ".agents/skills/", kind: "dir", badge: "Codex + Cursor" });
  for (const group of summary.skillGroups.filter((group) => group.label.startsWith(".agents/"))) {
    treeItems.push({
      name: group.label.replace(".agents/skills/", ""),
      kind: "new",
      depth: 1,
      badge: `${group.files} files`
    });
  }
  treeItems.push({ name: ".claude/skills/", kind: "dir", badge: "Claude Code" });
  for (const group of summary.skillGroups.filter((group) => group.label.startsWith(".claude/"))) {
    treeItems.push({
      name: group.label.replace(".claude/skills/", ""),
      kind: "new",
      depth: 1,
      badge: `${group.files} files`
    });
  }
  treeItems.push({ name: ".rooty/", kind: "dir", badge: "project state" });
  treeItems.push({ name: "start-mcp.cjs", kind: "file", depth: 1, badge: "settings-backed launcher" });
  treeItems.push({ name: "config/project-context.json", kind: "file", depth: 1, badge: "confirmed doc paths" });
  treeItems.push({ name: "config/mcp-settings.local.json", kind: "file", depth: 1, badge: "local, Git-ignored" });
  treeItems.push({ name: "state/install-manifest.json", kind: "file", depth: 1, badge: "SHA-256 per owned file" });
  treeItems.push({ name: "memory/drafts/ + memory/approved/", kind: "file", depth: 1, badge: "learning, gated" });

  const gitignoreAdded = new Set(
    install.gitignoreAfter.filter((line) => !install.gitignoreBefore.includes(line) && line !== "")
  );

  return [
    {
      id: "install-title",
      act: ACT_INSTALL,
      durationMs: 2800,
      layout: "single",
      panels: [
        {
          type: "titleCard",
          eyebrow: "Part 1 of 2",
          title: "One command installs Rooty. The agent does the rest.",
          sub: "The CLI is mechanical and owns files it can verify. Discovery, provider access, and approvals are handled by the AI agent already in your editor.",
          meta: `rooty-investigator v${capture.rooty_version}  \u00b7  no runtime dependencies`,
          ruleWidth: 24
        }
      ]
    },
    {
      id: "install-command",
      act: ACT_INSTALL,
      kicker: "01 \u00b7 Install",
      title: "npx rooty-investigator install",
      sub: "Real output. The installer reports exactly what it owns and where it put it.",
      durationMs: 6000,
      layout: "single",
      captionAt: 4600,
      caption: "The installer stops here on purpose: **no credentials, no provider calls, no host MCP files yet.**",
      panels: [
        {
          type: "terminal",
          path: capture.display_project,
          at: 0,
          stagger: 300,
          command: { text: install.command, at: 260, durationMs: 1100, settleMs: 360 },
          lines: bannerNoDocs
        }
      ]
    },
    {
      id: "install-tree",
      act: ACT_INSTALL,
      kicker: "02 \u00b7 What lands on disk",
      title: `${summary.skillFileTotal} owned files, three skills, two host locations`,
      sub: "Codex and Cursor read .agents/skills; Claude Code reads .claude/skills. Every file is fingerprinted so reinstalling is safe.",
      durationMs: 5000,
      layout: "wide-left",
      captionAt: 3600,
      caption: `Documentation paths are the only project knowledge Rooty stores: **${install.contextWithDocs.documentation.paths.join(", ")}** \u2014 no map, index, embedding, or cached summary.`,
      panels: [
        { type: "tree", label: capture.display_project, at: 240, stagger: 190, items: treeItems },
        {
          type: "stats",
          label: "install manifest",
          at: 1500,
          stagger: 320,
          columns: 1,
          items: [
            { value: String(install.manifestFileCount), label: "files tracked with a SHA-256 fingerprint" },
            { value: String(install.skills.length), label: `skills: ${install.skills.join(", ")}` },
            { value: install.installationMode, label: "installation mode recorded in .rooty/state" }
          ]
        }
      ]
    },
    {
      id: "install-safety",
      act: ACT_INSTALL,
      kicker: "03 \u00b7 Repeatable, not destructive",
      title: "Reinstalling refuses to clobber your edits",
      sub: "Rooty compares every owned file against its manifest before writing, and merges .gitignore instead of replacing it.",
      durationMs: 5000,
      layout: "split",
      captionAt: 3700,
      caption: "Drafts stay local; approved, sanitized memory is the only thing meant to be shared.",
      panels: [
        {
          type: "terminal",
          label: "after editing an installed skill by hand",
          path: capture.display_project,
          at: 200,
          command: { text: install.refusalCommand, at: 400, durationMs: 900, settleMs: 300 },
          lines: install.refusal.map((text) => ({ tone: "error", text }))
        },
        {
          type: "diff",
          label: ".gitignore",
          at: 2300,
          stagger: 130,
          items: install.gitignoreAfter.map((text) => ({
            text: text === "" ? " " : text,
            tone: gitignoreAdded.has(text) ? "added" : text.startsWith("#") ? "head" : "kept"
          }))
        }
      ]
    },
    {
      id: "install-handoff",
      act: ACT_INSTALL,
      kicker: "04 \u00b7 Agent-led setup",
      title: "Then you ask the agent, in the editor you already use",
      sub: "The CLI hands off. Discovery reads confirmed documentation first, then only the source and configuration needed to verify a choice.",
      durationMs: 6400,
      layout: "split",
      captionAt: 5000,
      caption: "Data and observability are required capabilities. **Ticketing is optional** because you can paste a ticket.",
      panels: [
        {
          type: "chat",
          label: "Codex \u00b7 Cursor \u00b7 Claude Code",
          at: 300,
          items: [
            { role: "user", who: "You", text: "Set up Rooty for this project.", at: 300, typeMs: 1100 },
            {
              role: "agent",
              who: "Agent",
              text: "Reads confirmed docs, proposes exact read-only provider access, asks for approval before any write or external action, then verifies with a harmless probe.",
              at: 2000
            }
          ]
        },
        {
          type: "steps",
          label: "setup state",
          at: 2600,
          stagger: 420,
          items: [
            { label: "Installed", detail: "Manifest and three skills confirmed", states: [{ at: 2600, value: "active" }, { at: 3020, value: "done" }] },
            { label: "Docs confirmed", detail: "Paths stored in project-context.json", states: [{ at: 3020, value: "active" }, { at: 3440, value: "done" }] },
            { label: "Discovered", detail: "Evidence for data and observability candidates", states: [{ at: 3440, value: "active" }, { at: 3860, value: "done" }] },
            { label: "Proposed", detail: "Config path, command, credentials, controls, probe", states: [{ at: 3860, value: "active" }, { at: 4280, value: "done" }] },
            { label: "Approved", detail: "Exact writes and external actions shown first", states: [{ at: 4280, value: "active" }, { at: 4700, value: "done" }] },
            { label: "Configured", detail: "Every credential binding declared, no values", states: [{ at: 4700, value: "active" }, { at: 5120, value: "done" }] },
            { label: "Verified", detail: "Initialize, list tools, block mutations, read probe", states: [{ at: 5120, value: "active" }, { at: 5540, value: "done" }] }
          ]
        }
      ]
    },
    {
      id: "install-doctor",
      act: ACT_INSTALL,
      kicker: "05 \u00b7 Verify",
      title: "rooty doctor \u2014 deterministic, offline, no production access",
      sub: `Ownership, layout, documentation context, read-only tool annotations, and ${capture.investigation.evalOutput[0]?.match(/\d+/)?.[0] ?? "15"} frozen replay cases.`,
      durationMs: 6200,
      layout: "single",
      captionAt: 4400,
      caption: `Docs supplied on install: **${docsLine ? docsLine.text.trim() : install.contextWithDocs.documentation.paths.join(", ")}**`,
      panels: [
        {
          type: "terminal",
          path: capture.display_project,
          at: 0,
          stagger: 190,
          command: { text: "rooty doctor --project .", at: 220, durationMs: 800, settleMs: 260 },
          lines: install.doctorLines.map(doctorLine)
        }
      ]
    }
  ];
}

function investigationScenes(capture) {
  const { investigation } = capture;
  const { analysis, assessment, ledger } = investigation;
  const byId = Object.fromEntries(ledger.map((entry) => [entry.evidence_id, entry]));

  const timelineRows = [...ledger]
    .filter((entry) => entry.classification === "OBSERVED")
    .sort((a, b) => rangeStart(a.event_time_range).localeCompare(rangeStart(b.event_time_range)))
    .map((entry) => ({
      time: timeRange(entry.event_time_range),
      text: entry.observation,
      ref: `(${entry.evidence_id})`,
      tone: entry.evidence_id === "E2" ? "bad" : "default",
      flag: entry.evidence_id === "E2" ? "First bad state" : undefined
    }));

  const competing = analysis.competing_hypotheses ?? [];

  return [
    {
      id: "investigation-title",
      act: ACT_INVESTIGATION,
      durationMs: 2800,
      layout: "single",
      panels: [
        {
          type: "titleCard",
          eyebrow: "Part 2 of 2",
          title: "How the investigation is done",
          sub: "Follow evidence to the earliest verified divergence, test the competing explanation, and only then name a root cause.",
          meta: `Real case ${investigation.caseId}  \u00b7  ticket ${investigation.ticket.id}  \u00b7  frozen snapshot`,
          ruleWidth: 24
        }
      ]
    },
    {
      id: "investigation-intake",
      act: ACT_INVESTIGATION,
      kicker: "06 \u00b7 Intake and expected path",
      title: "Map what should have happened, boundary by boundary",
      sub: "Documentation orients the search; current code and configuration verify it. Each boundary gets an invariant that evidence can contradict.",
      durationMs: 6000,
      layout: "wide-right",
      captionAt: 4600,
      caption: `Reported symptom stays **REPORTED** until something independent shows it: "${investigation.ticket.reported_symptom}"`,
      panels: [
        {
          type: "chat",
          label: "your prompt",
          at: 200,
          items: [
            { role: "user", who: "You", text: investigation.prompt, at: 240, typeMs: 1400 },
            {
              role: "agent",
              who: "Agent",
              text: "Opens a case with an append-only evidence ledger, confirms workspace and connectors are read-only, and records retention, sampling, and coverage gaps before spending a query.",
              at: 2100
            }
          ]
        },
        {
          type: "steps",
          label: "expected request / data flow",
          at: 2400,
          stagger: 430,
          items: investigation.expectedPath.map((step, index) => ({
            label: `${index + 1}. ${step}`,
            states: [{ at: 2400 + index * 430, value: "active" }, { at: 2830 + index * 430, value: "done" }]
          }))
        }
      ]
    },
    {
      id: "investigation-hypotheses",
      act: ACT_INVESTIGATION,
      kicker: "07 \u00b7 Hypotheses before queries",
      title: "Two testable explanations, each with predicted evidence",
      sub: "Every costly query has to test one prediction or close one named gap. Nothing is called confirmed yet.",
      durationMs: 4600,
      layout: "single",
      captionAt: 3300,
      caption: `Symptom signature: **${analysis.symptom_signature.endpoint} \u2192 ${analysis.symptom_signature.response_code}**, fingerprint \`${analysis.symptom_signature.exception_fingerprint}\`, services ${analysis.services.join(" and ")}.`,
      panels: [
        {
          type: "cards",
          at: 500,
          stagger: 520,
          items: investigation.hypotheses.map((hypothesis) => ({
            id: hypothesis.id,
            title: hypothesis.statement,
            state: "pending",
            tag: { text: "untested", tone: "cyan" }
          }))
        }
      ]
    },
    {
      id: "investigation-evidence",
      act: ACT_INVESTIGATION,
      kicker: "08 \u00b7 Read-only evidence",
      title: "Pivot from the strongest identifier outward",
      sub: "Trace ID, then entity plus bounded event time, then version history, then a comparison against successful traffic. Each observation records its source, locator, window, and limits.",
      durationMs: 6600,
      layout: "single",
      captionAt: 5200,
      caption: `Classification is never cosmetic: **REPORTED** is a claim, **OBSERVED** is a cited query, trace, or history record. This case reached ${assessment.observed_support_count} observed supports across ${assessment.observed_source_count} source systems.`,
      panels: [
        {
          type: "chips",
          at: 400,
          stagger: 620,
          columns: 2,
          items: [
            ...ledger.map((entry) => ({
              name: `${entry.source_type} \u00b7 ${entry.source_system}`,
              classification: entry.classification,
              query: truncate(entry.query_or_locator, 58),
              text: entry.observation
            })),
            {
              name: "mutation and admin tools",
              classification: "BLOCKED",
              query: "explicit allowlist per MCP server",
              text: "Rooty investigates. It does not patch code, change data, mutate tickets, deploy, or mitigate."
            }
          ]
        }
      ]
    },
    {
      id: "investigation-first-bad-state",
      act: ACT_INVESTIGATION,
      kicker: "09 \u00b7 First bad state",
      title: "Normalize to UTC, then find the earliest verified divergence",
      sub: "Event time is recorded separately from retrieval time, so a late log cannot pose as an early cause.",
      durationMs: 6000,
      layout: "single",
      captionAt: 4700,
      caption: `**${analysis.first_bad_state}**`,
      panels: [
        {
          type: "timeline",
          label: "event time \u00b7 UTC \u00b7 2026-08-14",
          at: 400,
          stagger: 640,
          items: timelineRows
        }
      ]
    },
    {
      id: "investigation-falsify",
      act: ACT_INVESTIGATION,
      kicker: "10 \u00b7 Falsification",
      title: "Attack the strongest competitor before believing the leader",
      sub: "Compare successful traffic, then verify incident-time version and configuration. An alternative is only eliminated when observed evidence rules it out.",
      durationMs: 5400,
      layout: "single",
      captionAt: 4100,
      caption: `Trigger and root cause stay separate: trigger \`${analysis.trigger_class}\`, root cause \`${analysis.root_cause_class}\`.`,
      panels: [
        {
          type: "cards",
          at: 400,
          stagger: 900,
          items: [
            ...competing.map((hypothesis, index) => ({
              title: hypothesis.statement,
              body: `Eliminated by ${hypothesis.evidence_refs.join(", ")} \u2014 ${byId[hypothesis.evidence_refs[0]]?.source_type ?? "observed"} evidence.`,
              tag: { text: hypothesis.status, tone: "red" },
              strikeAt: 900 + index * 900,
              states: [
                { at: 400 + index * 900, value: "active" },
                { at: 900 + index * 900, value: "eliminated" }
              ]
            })),
            {
              id: "H2",
              title: investigation.hypotheses.find((item) => item.status === "confirmed")?.statement ?? "",
              body: analysis.causal_chain
                .map((step, index) => `${index + 1}. ${step.step} (${step.evidence_refs.join(", ")})`)
                .join("\n"),
              tag: { text: "survives", tone: "green" },
              states: [
                { at: 2200, value: "active" },
                { at: 3100, value: "confirmed" }
              ],
              at: 2200
            }
          ]
        }
      ]
    },
    {
      id: "investigation-verdict",
      act: ACT_INVESTIGATION,
      kicker: "11 \u00b7 One outcome, no confidence score",
      title: "CONFIRMED has to be earned",
      sub: "Distinct observed support for every material link, an established first bad state, observed elimination of material alternatives, no critical gap, and corroboration or reproduction.",
      durationMs: 5800,
      layout: "single",
      captionAt: 4400,
      caption: "Abstention is a real result. Five of the fifteen frozen evaluation cases are expected to end **INCONCLUSIVE**.",
      panels: [
        {
          type: "verdicts",
          at: 400,
          stagger: 300,
          items: [
            {
              label: "CONFIRMED",
              detail: "Every material causal link has distinct observed support, and nothing critical is missing.",
              states: [
                { at: 400, value: "dimmed" },
                { at: 2400, value: "chosen" }
              ]
            },
            { label: "PROBABLE", detail: "Best fit for the evidence, but named critical corroboration is missing." },
            { label: "INCONCLUSIVE", detail: "Evidence expired, sampled, contradictory, or simply insufficient." }
          ]
        },
        {
          type: "stats",
          label: `assessment recorded for ${investigation.caseId}`,
          at: 3000,
          stagger: 280,
          columns: 4,
          items: [
            { value: assessment.status, label: "computed from the ledger, not asserted" },
            { value: String(assessment.observed_support_count), label: "observed supports across the causal chain" },
            { value: String(assessment.observed_source_count), label: "independent source systems corroborating" },
            { value: String(assessment.critical_gaps.length), label: "critical evidence gaps outstanding" }
          ]
        }
      ]
    },
    {
      id: "investigation-artifacts",
      act: ACT_INVESTIGATION,
      kicker: "12 \u00b7 Artifacts",
      title: "A deterministic report over an append-only ledger",
      sub: `Each ledger entry is hashed over its own content plus the previous hash, so a tampered or reordered entry stops verifying.`,
      durationMs: 5600,
      layout: "split",
      captionAt: 4300,
      caption: `Case evidence is written outside the investigated source tree: **${investigation.caseFiles.join(", ")}**`,
      panels: [
        {
          type: "report",
          label: "report.md",
          at: 300,
          stagger: 210,
          items: [
            { text: `# Root-cause investigation ${investigation.caseId}`, tone: "h1" },
            { text: "## 1. Investigation status", tone: "h2" },
            { text: assessment.status, tone: "status" },
            { text: "## 5. Root cause, trigger, and contributing conditions", tone: "h2" },
            { text: `- Root cause: ${analysis.root_cause}` },
            { text: `- Trigger: ${analysis.trigger}` },
            { text: "## 9. Evidence gaps and limitations", tone: "h2" },
            { text: `- ${analysis.evidence_gaps[0].description}`, tone: "dim" }
          ]
        },
        {
          type: "chain",
          label: "evidence.ndjson \u00b7 hash chain",
          at: 1900,
          stagger: 320,
          items: ledger.map((entry) => ({
            seq: `sequence ${entry.sequence}`,
            id: entry.evidence_id,
            classification: entry.classification,
            previous: shortHash(entry.previous_hash),
            hash: shortHash(entry.entry_hash)
          }))
        }
      ]
    },
    {
      id: "investigation-memory",
      act: ACT_INVESTIGATION,
      kicker: "13 \u00b7 Learning, gated",
      title: "Rooty proposes a draft. A human approves it.",
      sub: "Only a currently verified CONFIRMED case can become a draft, and approval re-verifies the source case and its hash chain before anything is reusable.",
      durationMs: 5800,
      layout: "wide-right",
      captionAt: 4400,
      caption: "Approved memory can suggest a pivot in a later case. **It can never prove one.**",
      panels: [
        {
          type: "cards",
          label: "proposed learning card",
          at: 300,
          stagger: 400,
          items: [
            {
              title: investigation.draft.kind,
              body: investigation.draft.concern_key ?? "",
              tag: { text: investigation.draft.review_status ?? "draft", tone: "amber" },
              state: "active"
            },
            {
              title: "Reusable pivots",
              body: investigation.draft.useful_pivots.join(", "),
              tag: { text: "sanitized", tone: "cyan" }
            },
            {
              title: "Rejected content",
              body: "Raw logs, credentials, and production payloads are refused by the sanitization scan.",
              tag: { text: "blocked", tone: "red" }
            }
          ]
        },
        {
          type: "terminal",
          label: "human-in-the-loop promotion",
          at: 1600,
          stagger: 340,
          plain: false,
          lines: [
            { tone: "muted", text: `$ ${investigation.proposeCommand}` },
            ...investigation.proposeOutput.map((text) => ({ tone: "cyan", text })),
            { tone: "blank", text: "" },
            { tone: "muted", text: `$ ${investigation.approveCommand}` },
            ...investigation.approveOutput.map((text) => ({ tone: "green", text })),
            { tone: "blank", text: "" },
            { tone: "dim", text: `reviewed_by ${investigation.approved.reviewed_by} \u00b7 expires after ${investigation.retention_days ?? 180} days` }
          ]
        }
      ]
    }
  ];
}

function outroScene(capture) {
  return {
    id: "outro",
    act: "",
    durationMs: 3600,
    layout: "single",
    panels: [
      {
        type: "titleCard",
        eyebrow: "Get started",
        title: "npx rooty-investigator install",
        sub: 'Then open the project in Codex, Cursor, or Claude Code and ask: "Set up Rooty for this project."',
        meta: `${capture.investigation.evalOutput[0]}  \u00b7  github.com/MahmoudElderby/Rooty`,
        ruleWidth: 30
      }
    ]
  };
}

/* ------------------------------------------------------------------ variants */

// Trims trailing hold time only. Throws if a cut would clip an animation, so a
// shorter variant can never silently hide content.
function trimTo(scene, durationMs) {
  const latest = latestAnimationEnd(scene);
  if (durationMs < latest) {
    throw new Error(`Cannot trim scene ${scene.id} to ${durationMs}ms; animations run to ${latest}ms`);
  }
  return { ...scene, durationMs };
}

const REVEAL_MS = 420;

/** Mirrors the reveal timing the stage derives, including the terminal cursor. */
export function latestAnimationEnd(scene) {
  let latest = scene.captionAt === undefined ? 0 : scene.captionAt + REVEAL_MS;
  for (const panel of scene.panels ?? []) {
    const base = panel.at ?? 0;
    if (panel.type === "titleCard") {
      latest = Math.max(latest, base + 820 + REVEAL_MS);
      continue;
    }
    let cursor = base;
    if (panel.command) {
      const at = panel.command.at ?? cursor;
      const durationMs = panel.command.durationMs ?? Math.max(500, panel.command.text.length * 32);
      latest = Math.max(latest, at + durationMs);
      cursor = at + durationMs + (panel.command.settleMs ?? 320);
    }
    const isTerminal = panel.type === "terminal";
    const stagger = panel.stagger ?? (isTerminal ? 120 : 150);
    const items = panel.items ?? panel.lines ?? [];
    items.forEach((item, index) => {
      const at = typeof item.at === "number" ? item.at : (isTerminal ? cursor : base) + index * stagger;
      latest = Math.max(latest, at + (item.typeMs ?? 0) + REVEAL_MS);
      for (const state of item.states ?? []) latest = Math.max(latest, state.at + REVEAL_MS);
      if (item.strikeAt !== undefined) latest = Math.max(latest, item.strikeAt + 380);
    });
  }
  return Math.round(latest);
}

/** Scales every timing in a scene, used to tighten the looping GIF variant. */
function scaleScene(scene, factor) {
  const scale = (value) => (typeof value === "number" ? Math.round(value * factor) : value);
  const scaleItem = (item) => ({
    ...item,
    ...(item.at !== undefined ? { at: scale(item.at) } : {}),
    ...(item.typeMs !== undefined ? { typeMs: scale(item.typeMs) } : {}),
    ...(item.strikeAt !== undefined ? { strikeAt: scale(item.strikeAt) } : {}),
    ...(item.states ? { states: item.states.map((state) => ({ ...state, at: scale(state.at) })) } : {})
  });
  return {
    ...scene,
    durationMs: scale(scene.durationMs),
    ...(scene.captionAt !== undefined ? { captionAt: scale(scene.captionAt) } : {}),
    panels: (scene.panels ?? []).map((panel) => ({
      ...panel,
      ...(panel.at !== undefined ? { at: scale(panel.at) } : {}),
      ...(panel.stagger !== undefined ? { stagger: scale(panel.stagger) } : {}),
      ...(panel.command
        ? {
            command: {
              ...panel.command,
              ...(panel.command.at !== undefined ? { at: scale(panel.command.at) } : {}),
              ...(panel.command.durationMs !== undefined ? { durationMs: scale(panel.command.durationMs) } : {}),
              ...(panel.command.settleMs !== undefined ? { settleMs: scale(panel.command.settleMs) } : {})
            }
          }
        : {}),
      ...(panel.items ? { items: panel.items.map(scaleItem) } : {}),
      ...(panel.lines ? { lines: panel.lines.map(scaleItem) } : {})
    }))
  };
}

/** Shortens a scene to its animation end plus a fixed reading hold. */
function tighten(scene, factor, holdMs) {
  const scaled = scaleScene(scene, factor);
  return trimTo(scaled, latestAnimationEnd(scaled) + holdMs);
}

export async function buildTimeline({ variant = "full", fps = 30, width = 1920, height = 1080, capture } = {}) {
  if (!VARIANTS.includes(variant)) throw new Error(`Unknown variant: ${variant}`);
  const data = capture ?? (await readCapture());
  const install = installScenes(data);
  const investigation = investigationScenes(data);
  const outro = outroScene(data);

  let scenes;
  if (variant === "install") scenes = [...install, outro];
  else if (variant === "investigation") scenes = [...investigation, outro];
  else if (variant === "gif") {
    // A silent, looping README hero: the four beats that read at a glance,
    // tightened because a loop gets watched more than once.
    const pick = (list, id) => list.find((scene) => scene.id === id);
    scenes = [
      tighten(pick(install, "install-command"), 0.78, 620),
      tighten(pick(install, "install-tree"), 0.78, 620),
      tighten(pick(investigation, "investigation-evidence"), 0.72, 620),
      tighten(pick(investigation, "investigation-verdict"), 0.78, 700)
    ];
  } else scenes = [...install, ...investigation, outro];

  const durationMs = scenes.reduce((total, scene) => total + scene.durationMs, 0);
  return {
    schema_version: 1,
    variant,
    fps,
    width,
    height,
    durationMs,
    totalFrames: Math.round((durationMs / 1000) * fps),
    rooty_version: data.rooty_version,
    scenes
  };
}
