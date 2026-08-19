#!/usr/bin/env node
// Regenerates the Rooty explainer assets end to end.
//
//   node tools/video/generate.mjs                      # every target
//   node tools/video/generate.mjs --target gif          # README hero only
//   node tools/video/generate.mjs --check               # 6 sample frames, no encode
//   node tools/video/generate.mjs --skip-capture        # reuse captured-output.json
import { spawn } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { encodeGif, encodeMp4, encodeWebm, formatBytes } from "./encode.mjs";
import { parseFlags, renderFrames } from "./render.mjs";
import { readCapture } from "./storyboard.mjs";

const VIDEO_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(VIDEO_ROOT, "../..");
const GENERATED_DIR = path.join(VIDEO_ROOT, "generated");

// Each target pairs a storyboard variant with its published artifact. The GIF is
// deliberately smaller and slower: it is a silent looping README hero, while the
// MP4s carry the full detail.
export const TARGETS = {
  gif: {
    variant: "gif",
    // GIF delays are stored in hundredths of a second, so only rates that divide
    // 100 evenly play back at the authored speed. 20fps is 5cs per frame.
    fps: 20,
    encode: (framesDir, fps) =>
      encodeGif({
        framesDir,
        fps,
        out: path.join(REPO_ROOT, "rooty-how-it-works.gif"),
        // 1200px matches the asset this replaces, so the README renders identically.
        width: 1200,
        colors: 160
      }),
    budgetBytes: 6.5 * 1024 * 1024
  },
  full: {
    variant: "full",
    fps: 30,
    encode: (framesDir, fps) =>
      encodeMp4({ framesDir, fps, out: path.join(REPO_ROOT, "media/rooty-how-it-works.mp4") })
  },
  install: {
    variant: "install",
    fps: 30,
    encode: (framesDir, fps) =>
      encodeMp4({ framesDir, fps, out: path.join(REPO_ROOT, "media/rooty-install.mp4") })
  },
  investigation: {
    variant: "investigation",
    fps: 30,
    encode: (framesDir, fps) =>
      encodeMp4({ framesDir, fps, out: path.join(REPO_ROOT, "media/rooty-investigation.mp4") })
  },
  webm: {
    variant: "full",
    fps: 30,
    encode: (framesDir, fps) =>
      encodeWebm({ framesDir, fps, out: path.join(REPO_ROOT, "media/rooty-how-it-works.webm") })
  }
};

function capture() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(VIDEO_ROOT, "capture.mjs")], { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`capture.mjs exited ${code}`))));
  });
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const requested = flags.target ? String(flags.target).split(",") : ["gif", "full", "install", "investigation"];
  for (const name of requested) {
    if (!TARGETS[name]) throw new Error(`Unknown target: ${name}. Known: ${Object.keys(TARGETS).join(", ")}`);
  }

  if (!flags["skip-capture"]) await capture();
  const captured = await readCapture();
  process.stdout.write(`Using captured output from Rooty ${captured.rooty_version}\n`);

  if (flags.check) {
    const variant = String(flags.variant ?? "full");
    const outDir = path.join(GENERATED_DIR, "check", variant);
    await rm(outDir, { recursive: true, force: true });
    const result = await renderFrames({
      variant,
      fps: Number(flags.fps ?? 30),
      sample: Number(flags.sample ?? 6),
      outDir,
      capture: captured
    });
    process.stdout.write(`\ncheck: ${result.frames} sample frames in ${outDir}\n`);
    return;
  }

  await mkdir(path.join(REPO_ROOT, "media"), { recursive: true });
  const summary = [];
  for (const name of requested) {
    const target = TARGETS[name];
    const fps = Number(flags.fps ?? target.fps);
    const render = await renderFrames({
      variant: target.variant,
      fps,
      capture: captured,
      onProgress: ({ done, total }) => process.stdout.write(`\r${name}: rendering ${done}/${total} frames`)
    });
    process.stdout.write(`\r${name}: encoding ${render.frames} frames                    \n`);
    const encoded = await target.encode(render.framesDir, fps);
    const seconds = render.timeline.durationMs / 1000;
    summary.push({ name, ...encoded, seconds, fps, budgetBytes: target.budgetBytes });
  }

  process.stdout.write("\n");
  for (const item of summary) {
    const relative = path.relative(REPO_ROOT, item.out);
    const over = item.budgetBytes && item.bytes > item.budgetBytes;
    process.stdout.write(
      `${item.name.padEnd(14)} ${relative.padEnd(34)} ${item.seconds.toFixed(1)}s ` +
        `${String(item.fps).padStart(2)}fps ${item.frames} frames ${formatBytes(item.bytes)}` +
        `${over ? `  OVER BUDGET (${formatBytes(item.budgetBytes)})` : ""}\n`
    );
  }
  const overBudget = summary.filter((item) => item.budgetBytes && item.bytes > item.budgetBytes);
  if (overBudget.length) {
    process.stderr.write(
      `\n${overBudget.length} asset(s) exceed their size budget. Lower --fps or the GIF width in TARGETS.\n`
    );
    process.exitCode = 1;
  }
}

await main();
