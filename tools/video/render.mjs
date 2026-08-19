#!/usr/bin/env node
// Renders explainer frames by driving headless Chrome over the DevTools
// Protocol. Uses Node's built-in WebSocket, so the pipeline needs no npm
// dependencies -- matching Rooty's standard-library-only policy.
//
//   node tools/video/render.mjs --variant full
//   node tools/video/render.mjs --variant gif --fps 12
//   node tools/video/render.mjs --variant full --sample 6   # smoke frames only
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildTimeline, readCapture, VARIANTS } from "./storyboard.mjs";

const VIDEO_ROOT = path.dirname(fileURLToPath(import.meta.url));
const STAGE_DIR = path.join(VIDEO_ROOT, "stage");
const GENERATED_DIR = path.join(VIDEO_ROOT, "generated");

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/usr/local/bin/google-chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].filter(Boolean);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

export function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const [key, inline] = token.slice(2).split("=");
    if (inline !== undefined) flags[key] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      flags[key] = argv[index + 1];
      index += 1;
    } else flags[key] = true;
  }
  return flags;
}

async function resolveChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await readFile(candidate);
      return candidate;
    } catch (error) {
      if (error.code === "EISDIR") continue;
      if (error.code === "EACCES") return candidate; // executable but unreadable
      if (error.code !== "ENOENT") throw error;
    }
  }
  throw new Error(
    `No Chrome binary found. Set CHROME_PATH or install one of: ${CHROME_CANDIDATES.join(", ")}`
  );
}

function serveStage(timelineJson) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/timeline.json") {
      response.writeHead(200, { "content-type": MIME[".json"] });
      response.end(timelineJson);
      return;
    }
    const name = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = path.join(STAGE_DIR, path.normalize(name).replace(/^(\.\.[/\\])+/, ""));
    if (!file.startsWith(STAGE_DIR)) {
      response.writeHead(403).end("forbidden");
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

/** Minimal DevTools Protocol client over the built-in WebSocket. */
class DevTools {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", () => reject(new Error(`Cannot reach DevTools at ${this.url}`)), {
        once: true
      });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(`${message.error.message} (${entry.method})`));
      else entry.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, { awaitPromise = false } = {}) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(`Page error: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    }
    return result.result?.value;
  }

  close() {
    this.socket?.close();
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDevToolsPort(profileDir, timeoutMs = 20000) {
  const portFile = path.join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const [port] = (await readFile(portFile, "utf8")).split("\n");
      if (port) return Number(port);
    } catch {
      /* chrome has not written the file yet */
    }
    await sleep(80);
  }
  throw new Error("Chrome did not expose a DevTools port");
}

async function findPageTarget(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* devtools endpoint not ready */
    }
    await sleep(80);
  }
  throw new Error("Chrome did not expose a page target");
}

export async function renderFrames({
  variant = "full",
  fps = 30,
  width = 1920,
  height = 1080,
  sample,
  outDir,
  capture,
  onProgress
} = {}) {
  if (!VARIANTS.includes(variant)) throw new Error(`Unknown variant: ${variant}`);
  const timeline = await buildTimeline({ variant, fps, width, height, capture: capture ?? (await readCapture()) });
  const framesDir = outDir ?? path.join(GENERATED_DIR, "frames", variant);
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });
  await mkdir(GENERATED_DIR, { recursive: true });
  const timelineJson = `${JSON.stringify(timeline, null, 2)}\n`;
  await writeFile(path.join(GENERATED_DIR, `timeline-${variant}.json`), timelineJson);

  const chrome = await resolveChrome();
  const { server, port: httpPort } = await serveStage(timelineJson);
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "rooty-video-chrome-"));
  const pageUrl = `http://127.0.0.1:${httpPort}/index.html`;

  const child = spawn(
    chrome,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--mute-audio",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--force-color-profile=srgb",
      `--window-size=${width},${height}`,
      `--user-data-dir=${profileDir}`,
      "--remote-debugging-port=0",
      pageUrl
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  let chromeStderr = "";
  child.stderr.on("data", (chunk) => {
    chromeStderr += chunk;
  });

  const written = [];
  let client;
  try {
    const devtoolsPort = await waitForDevToolsPort(profileDir);
    const target = await findPageTarget(devtoolsPort);
    client = new DevTools(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    });

    const deadline = Date.now() + 20000;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      ready = await client.evaluate("document.documentElement.dataset.ready === '1'");
      if (!ready) await sleep(100);
    }
    if (!ready) throw new Error(`Stage never signalled ready. Chrome said:\n${chromeStderr}`);
    // The device-metrics override lands after first paint, so re-fit once the
    // layout viewport is guaranteed to match the design size.
    await client.evaluate("window.rootyFit()");
    const viewport = await client.evaluate("[window.innerWidth, window.innerHeight].join('x')");
    if (viewport !== `${width}x${height}`) {
      throw new Error(`Viewport is ${viewport}, expected ${width}x${height}`);
    }

    const total = timeline.totalFrames;
    const indices = sample
      ? Array.from({ length: Number(sample) }, (_, index) =>
          Math.min(total - 1, Math.round((index * (total - 1)) / Math.max(1, Number(sample) - 1)))
        )
      : Array.from({ length: total }, (_, index) => index);

    for (const [position, frame] of indices.entries()) {
      await client.evaluate(`window.rootySeek(${frame})`);
      // Two animation frames guarantee the compositor has the seeked state.
      await client.evaluate(
        "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
        { awaitPromise: true }
      );
      const shot = await client.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false
      });
      const file = path.join(framesDir, `frame-${String(frame).padStart(5, "0")}.png`);
      await writeFile(file, Buffer.from(shot.data, "base64"));
      written.push(file);
      if (onProgress && (position % 60 === 0 || position === indices.length - 1)) {
        onProgress({ done: position + 1, total: indices.length, variant });
      }
    }
  } finally {
    client?.close();
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGKILL");
    await Promise.race([exited, sleep(4000)]);
    server.close();
    // Chrome can still be flushing its profile as it dies; retry the cleanup.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(profileDir, { recursive: true, force: true });
        break;
      } catch {
        await sleep(200);
      }
    }
  }

  return { variant, timeline, framesDir, frames: written.length, fps, width, height };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const result = await renderFrames({
    variant: String(flags.variant ?? "full"),
    fps: Number(flags.fps ?? 30),
    width: Number(flags.width ?? 1920),
    height: Number(flags.height ?? 1080),
    sample: flags.sample,
    outDir: flags.out ? path.resolve(String(flags.out)) : undefined,
    onProgress: ({ done, total, variant }) =>
      process.stdout.write(`\rrendering ${variant}: ${done}/${total} frames`)
  });
  const files = await readdir(result.framesDir);
  process.stdout.write(
    `\rrendered ${result.frames} frames (${files.length} files) at ${result.width}x${result.height} ` +
      `${result.fps}fps into ${result.framesDir}\n`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
