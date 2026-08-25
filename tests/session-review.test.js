import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { reviewSession } from "../src/lib/session-review.js";

async function directory(label) {
  return mkdtemp(path.join(os.tmpdir(), `${label}-`));
}

async function jsonl(file, records) {
  await writeFile(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

test("session review normalizes Codex timing, unions tools, and sanitizes persisted content", async () => {
  const projectRoot = await directory("rooty-session-project");
  const input = path.join(await directory("rooty-session-input"), "codex.jsonl");
  const base = Date.parse("2026-08-25T00:00:00.000Z");
  await jsonl(input, [
    { timestamp: new Date(base).toISOString(), type: "session_meta", payload: { base_instructions: "SYSTEM password=never-store-this" } },
    { timestamp: new Date(base + 1000).toISOString(), type: "event_msg", payload: { type: "item_completed", item: { type: "AgentMessage", role: "assistant", started_at_ms: base + 900, completed_at_ms: base + 1000, content: "full private prompt" } } },
    { timestamp: new Date(base + 1200).toISOString(), type: "event_msg", payload: { type: "item_started", item: { id: "call-1", type: "CommandExecution", command: "npx rooty --help" } } },
    { timestamp: new Date(base + 3200).toISOString(), type: "event_msg", payload: { type: "item_completed", item: { id: "call-1", type: "CommandExecution", command: "npx rooty --help", status: "failed", output: "token=abc123 user@example.com timed out" } } },
    { timestamp: new Date(base + 1800).toISOString(), type: "event_msg", payload: { type: "item_started", item: { id: "call-2", type: "CommandExecution", command: "npx rooty --help" } } },
    { timestamp: new Date(base + 4200).toISOString(), type: "event_msg", payload: { type: "item_completed", item: { id: "call-2", type: "CommandExecution", command: "npx rooty --help", status: "completed" } } },
    { timestamp: new Date(base + 5000).toISOString(), type: "event_msg", payload: { type: "item_started", item: { id: "ask-1", type: "ToolCall", name: "request_user_input", input: { question: "secret prompt" } } } },
    { timestamp: new Date(base + 7000).toISOString(), type: "event_msg", payload: { type: "item_completed", item: { type: "UserMessage", role: "user", content: "private answer" } } },
    { timestamp: new Date(base + 7100).toISOString(), type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 20, total_tokens: 120 }, model_context_window: 200000 } } },
    { timestamp: new Date(base + 7200).toISOString(), type: "event_msg", payload: { type: "context_compacted" } }
  ]);

  const result = await reviewSession({ host: "codex", inputFile: input, projectRoot });
  assert.equal(result.review.metrics.durations.wall_time.value, 6300);
  assert.equal(result.review.metrics.durations.tool_time.value, 3000);
  assert.equal(result.review.metrics.noop_calls.value, 2);
  assert.equal(result.review.metrics.repeated_calls.value, 1);
  assert.equal(result.review.metrics.timeouts.value, 1);
  assert.equal(result.review.metrics.failures.value, 1);
  assert.equal(result.review.metrics.retries.value, 1);
  assert.equal(result.review.metrics.approval_loops.value, 1);
  assert.equal(result.review.metrics.durations.human_wait.value, 2000);
  assert.equal(result.review.metrics.durations.agent_time.value, 4300);
  assert.equal(result.review.metrics.compactions.value, 1);
  assert.equal(result.review.metrics.tokens.total_tokens.value, 120);
  assert.equal(result.review.metrics.tokens.cached_input_tokens.value, 50);
  assert.equal(result.review.metrics.tokens.context_window.value, 200000);
  const persisted = await readFile(result.files.review_json, "utf8");
  for (const forbidden of ["never-store-this", "full private prompt", "private answer", "abc123", "user@example.com", "secret prompt"]) assert.doesNotMatch(persisted, new RegExp(forbidden));
  assert.match(persisted, /\[REDACTED\]/);
  assert.match(result.files.improvement_queue, /\.rooty[\\/]improvements[\\/]drafts/);
  const improvement = JSON.parse(await readFile(result.files.improvement_draft, "utf8"));
  assert.equal(improvement.storage_boundary, "improvement_queue_not_incident_memory");
  assert.ok(improvement.drafts.some((item) => item.category === "cli"));
  assert.ok(improvement.drafts.some((item) => item.category === "integration"));
});

test("Cursor and Claude adapters preserve capability differences as UNAVAILABLE", async () => {
  const projectRoot = await directory("rooty-host-capabilities");
  const inputRoot = await directory("rooty-host-inputs");
  const cursor = path.join(inputRoot, "cursor.jsonl");
  await jsonl(cursor, [
    { role: "user", message: { content: [{ type: "text", text: "do not persist me" }] } },
    { role: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "read_file", input: { path: "private.txt" } }] } }
  ]);
  const cursorResult = await reviewSession({ host: "cursor", inputFile: cursor, projectRoot, outputDir: path.join(projectRoot, ".rooty", "session-reviews", "cursor-output") });
  assert.equal(cursorResult.review.metrics.durations.wall_time.status, "UNAVAILABLE");
  assert.equal(cursorResult.review.metrics.tokens.total_tokens.status, "UNAVAILABLE");

  const claude = path.join(inputRoot, "claude.jsonl");
  await jsonl(claude, [
    { type: "assistant", timestamp: "2026-08-25T00:00:00Z", message: { role: "assistant", content: [{ type: "text", text: "hidden" }] } },
    { type: "result", timestamp: "2026-08-25T00:00:01Z", usage: { input_tokens: 30, cache_read_input_tokens: 10, output_tokens: 5 } }
  ]);
  const claudeResult = await reviewSession({ host: "claude", inputFile: claude, projectRoot, outputDir: path.join(projectRoot, ".rooty", "session-reviews", "claude-output") });
  assert.equal(claudeResult.review.metrics.tokens.input_tokens.value, 30);
  assert.equal(claudeResult.review.metrics.tokens.cached_input_tokens.value, 10);
});

test("session analysis requires one explicit target and never selects implicit history", async () => {
  const projectRoot = await directory("rooty-explicit-session");
  const input = path.join(await directory("rooty-explicit-input"), "session.jsonl");
  await jsonl(input, [{ role: "assistant", message: { content: [] } }]);
  await assert.rejects(() => reviewSession({ host: "codex", projectRoot }), /exactly one/);
  await assert.rejects(() => reviewSession({ host: "codex", inputFile: "one.jsonl", sessionId: "two", projectRoot }), /exactly one/);
  await assert.rejects(() => reviewSession({ host: "claude", sessionId: "abc-123", projectRoot }), /explicit JSON or stream-JSON export/);
  await assert.rejects(() => reviewSession({ host: "cursor", inputFile: input, projectRoot, outputDir: path.join(projectRoot, "tracked-review") }), /Git-ignored \.rooty\/session-reviews/);
});
