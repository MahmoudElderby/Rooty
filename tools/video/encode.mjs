#!/usr/bin/env node
// Encodes rendered PNG frames into the published assets with ffmpeg.
import { execFile } from "node:child_process";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const run = promisify(execFile);

function ffmpeg(args) {
  return run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { maxBuffer: 1 << 26 });
}

/** Frames must be contiguous from 0 so the image2 demuxer can read a sequence. */
async function assertContiguous(framesDir) {
  const files = (await readdir(framesDir)).filter((name) => name.endsWith(".png")).sort();
  if (files.length === 0) throw new Error(`No frames in ${framesDir}`);
  const expected = files.map((_, index) => `frame-${String(index).padStart(5, "0")}.png`);
  const mismatch = files.findIndex((name, index) => name !== expected[index]);
  if (mismatch !== -1) {
    throw new Error(
      `Frame sequence has a gap at ${files[mismatch]} (expected ${expected[mismatch]}). ` +
        "Encoding needs a full render, not a --sample run."
    );
  }
  return files.length;
}

export async function encodeMp4({ framesDir, fps, out, width, height, crf = 20 }) {
  const frames = await assertContiguous(framesDir);
  await mkdir(path.dirname(out), { recursive: true });
  const filters = [];
  if (width && height) filters.push(`scale=${width}:${height}:flags=lanczos`);
  filters.push("format=yuv420p");
  await ffmpeg([
    "-framerate",
    String(fps),
    "-start_number",
    "0",
    "-i",
    path.join(framesDir, "frame-%05d.png"),
    "-vf",
    filters.join(","),
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    String(crf),
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    out
  ]);
  return { out, frames, bytes: (await stat(out)).size };
}

export async function encodeWebm({ framesDir, fps, out, width, height, crf = 34 }) {
  const frames = await assertContiguous(framesDir);
  await mkdir(path.dirname(out), { recursive: true });
  const filters = [];
  if (width && height) filters.push(`scale=${width}:${height}:flags=lanczos`);
  await ffmpeg([
    "-framerate",
    String(fps),
    "-start_number",
    "0",
    "-i",
    path.join(framesDir, "frame-%05d.png"),
    ...(filters.length ? ["-vf", filters.join(",")] : []),
    "-c:v",
    "libvpx-vp9",
    "-crf",
    String(crf),
    "-b:v",
    "0",
    "-row-mt",
    "1",
    out
  ]);
  return { out, frames, bytes: (await stat(out)).size };
}

/** Single-invocation two-pass palette GIF: palettegen and paletteuse via split. */
export async function encodeGif({ framesDir, fps, out, width, colors = 128, bayerScale = 4 }) {
  const frames = await assertContiguous(framesDir);
  await mkdir(path.dirname(out), { recursive: true });
  const filter =
    `scale=${width}:-1:flags=lanczos,split[a][b];` +
    `[a]palettegen=max_colors=${colors}:stats_mode=diff[p];` +
    `[b][p]paletteuse=dither=bayer:bayer_scale=${bayerScale}:diff_mode=rectangle`;
  await ffmpeg([
    "-framerate",
    String(fps),
    "-start_number",
    "0",
    "-i",
    path.join(framesDir, "frame-%05d.png"),
    "-filter_complex",
    filter,
    "-loop",
    "0",
    out
  ]);
  return { out, frames, bytes: (await stat(out)).size };
}

export function formatBytes(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(2)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

async function main() {
  process.stderr.write("encode.mjs is a library; run tools/video/generate.mjs instead.\n");
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  await main();
}
