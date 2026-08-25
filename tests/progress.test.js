import test from "node:test";
import assert from "node:assert/strict";
import { createProgressBar } from "../src/lib/progress.js";

function captureStream() {
  const chunks = [];
  return { chunks, write: (chunk) => { chunks.push(String(chunk)); return true; } };
}

test("progress bar renders determinate install progress and closes on success", () => {
  const stream = captureStream();
  const progress = createProgressBar({ stream, width: 8 });
  progress.update({ current: 1, total: 4, label: "Checking skills" });
  progress.update({ current: 4, total: 4, label: "Installation complete" });
  progress.finish();
  const output = stream.chunks.join("");
  assert.match(output, /Installing Rooty \[##------\]\s+25% Checking skills/);
  assert.match(output, /Installing Rooty \[########\] 100% Installation complete/);
  assert.ok(output.endsWith("\n"));
});

test("progress bar stays silent when disabled and renders a terminal failure", () => {
  const silent = captureStream();
  const disabled = createProgressBar({ stream: silent, enabled: false });
  disabled.update({ current: 1, total: 2, label: "Ignored" });
  disabled.finish();
  assert.equal(silent.chunks.length, 0);

  const stream = captureStream();
  const progress = createProgressBar({ stream, width: 6 });
  progress.update({ current: 1, total: 2, label: "Writing" });
  progress.fail();
  assert.match(stream.chunks.join(""), /\[!!!!!!\] FAILED Installation failed\n$/);
});

