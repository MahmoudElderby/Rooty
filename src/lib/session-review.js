import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";
import { atomicWriteJson, atomicWriteText, resolveProjectRoot } from "./project-state.js";
import { isoNow, sha256 } from "./core.js";

export const SESSION_HOSTS = Object.freeze(["claude", "codex", "cursor"]);
export const IMPROVEMENT_CATEGORIES = Object.freeze([
  "cli",
  "skill",
  "workflow",
  "documentation",
  "integration",
  "evaluation",
  "host_limitation",
  "memory_candidate"
]);

const MAX_INPUT_BYTES = 128 * 1024 * 1024;
const MAX_DISCOVERY_ENTRIES = 25_000;
const REDACTED = "[REDACTED]";

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function available(value, unit) {
  return value === undefined || value === null
    ? { status: "UNAVAILABLE", value: null, ...(unit ? { unit } : {}) }
    : { status: "AVAILABLE", value, ...(unit ? { unit } : {}) };
}

function parseTime(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    return Number.isFinite(millis) ? millis : undefined;
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function timestampOf(record) {
  return parseTime(record?.timestamp ?? record?.created_at ?? record?.createdAt ?? record?.time ?? record?.ts);
}

function durationOf(record) {
  for (const value of [record?.duration_ms, record?.durationMs, record?.elapsed_ms, record?.elapsedMs]) {
    if (Number.isFinite(Number(value)) && Number(value) >= 0) return Number(value);
  }
  const start = parseTime(record?.started_at_ms ?? record?.started_at ?? record?.start_time);
  const end = parseTime(record?.completed_at_ms ?? record?.completed_at ?? record?.end_time);
  return start !== undefined && end !== undefined && end >= start ? end - start : undefined;
}

export function redactExcerpt(value, limit = 180) {
  if (value === undefined || value === null) return undefined;
  let text = typeof value === "string" ? value : JSON.stringify(value);
  text = text
    .replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, REDACTED)
    .replace(/\b(?:api[_-]?key|authorization|bearer|password|passwd|secret|token)\b\s*[:=]\s*[^\s,;]+/gi, (match) => `${match.split(/[:=]/, 1)[0]}=${REDACTED}`)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, REDACTED)
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, REDACTED)
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/gi, "<USER_HOME>")
    .replace(/\/(?:Users|home)\/[^/\s]+/g, "<USER_HOME>")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return text ? text.slice(0, limit) : undefined;
}

function safeToolName(value) {
  const name = String(value ?? "unknown").trim();
  return /^[A-Za-z0-9_.:-]{1,120}$/.test(name) ? name : "unknown";
}

function inputSignature(toolName, input) {
  return `${safeToolName(toolName)}:${sha256(input ?? null).slice(0, 16)}`;
}

function commandName(input) {
  const command = typeof input === "string" ? input : input?.cmd ?? input?.command;
  if (typeof command !== "string") return undefined;
  const first = command.trim().split(/\s+/, 1)[0]?.replace(/^['"]|['"]$/g, "");
  const base = first ? path.basename(first) : "";
  return /^[A-Za-z0-9_.-]{1,80}$/.test(base) ? base : undefined;
}

function isNoopInput(input) {
  const command = typeof input === "string" ? input : input?.cmd ?? input?.command;
  return typeof command === "string" && /(?:^|\s)(?:--help|-h|--version|-V)(?:\s|$)/.test(command);
}

function outcomeFrom(value) {
  const text = String(value ?? "").toLowerCase();
  if (/timeout|timed out|10060|etimedout/.test(text)) return "TIMEOUT";
  if (/fail|error|denied|reject|cancel|nonzero|non-zero/.test(text)) return "FAILURE";
  if (/success|complete|completed|pass|ok/.test(text)) return "SUCCESS";
  return "UNKNOWN";
}

function recordFailure(record) {
  const candidates = [record?.error, record?.message?.error, record?.result?.error, record?.output, record?.message];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const serialized = typeof candidate === "string" ? candidate : JSON.stringify(candidate);
    const outcome = outcomeFrom(serialized);
    if (outcome === "FAILURE" || outcome === "TIMEOUT") {
      const sensitive = /(?:api[_-]?key|authorization|bearer|password|passwd|secret|token|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|[A-Za-z]:\\Users\\|\/(?:Users|home)\/)/i.test(serialized);
      const codes = serialized.match(/\b(?:ETIMEDOUT|ECONNREFUSED|EACCES|EPERM|HTTP\s+[1-5]\d{2}|Win32\s+10060)\b/gi) ?? [];
      const detail = sensitive ? REDACTED : codes.length ? [...new Set(codes)].join(", ") : "sanitized failure metadata";
      return { outcome, excerpt: `${outcome}: ${detail}` };
    }
  }
  return undefined;
}

function eventFactory(host) {
  let ordinal = 0;
  return (raw, event) => {
    ordinal += 1;
    const timestamp = event.timestamp_ms ?? timestampOf(raw);
    return {
      event_ref: `${host}:${ordinal}:${sha256(raw).slice(0, 12)}`,
      ordinal,
      kind: event.kind,
      ...(event.role ? { role: event.role } : {}),
      ...(event.tool_name ? { tool_name: safeToolName(event.tool_name) } : {}),
      ...(event.lifecycle ? { lifecycle: event.lifecycle } : {}),
      ...(event.call_id ? { call_id_hash: sha256(String(event.call_id)).slice(0, 16) } : {}),
      ...(event.signature ? { signature: event.signature } : {}),
      ...(event.command_name ? { command_name: event.command_name } : {}),
      ...(event.noop !== undefined ? { noop: Boolean(event.noop) } : {}),
      ...(event.outcome ? { outcome: event.outcome } : {}),
      ...(event.error_excerpt ? { error_excerpt: redactExcerpt(event.error_excerpt) } : {}),
      ...(Number.isFinite(timestamp) ? { timestamp: new Date(timestamp).toISOString(), timestamp_ms: timestamp } : {}),
      ...(Number.isFinite(event.duration_ms) ? { duration_ms: event.duration_ms } : {}),
      ...(event.usage ? { usage: event.usage } : {})
    };
  };
}

function usageFrom(value) {
  const usage = value?.usage ?? value?.token_usage ?? value?.tokenUsage ?? value;
  if (!usage || typeof usage !== "object") return undefined;
  const aliases = {
    input_tokens: ["input_tokens", "inputTokens", "input"],
    cached_input_tokens: ["cached_input_tokens", "cachedInputTokens", "cache_read_input_tokens", "cached"],
    cache_write_tokens: ["cache_creation_input_tokens", "cache_write_tokens", "cacheWriteTokens"],
    output_tokens: ["output_tokens", "outputTokens", "output"],
    reasoning_tokens: ["reasoning_tokens", "reasoningTokens"],
    total_tokens: ["total_tokens", "totalTokens", "total"]
  };
  const normalized = {};
  for (const [target, keys] of Object.entries(aliases)) {
    const found = keys.map((key) => usage[key]).find((item) => Number.isFinite(Number(item)));
    if (found !== undefined) normalized[target] = Number(found);
  }
  const context = value?.model_context_window ?? value?.context_window ?? value?.contextWindow;
  if (Number.isFinite(Number(context))) normalized.context_window = Number(context);
  return Object.keys(normalized).length ? normalized : undefined;
}

function contentBlocks(record) {
  const content = record?.message?.content ?? record?.content ?? record?.payload?.message?.content;
  if (Array.isArray(content)) return content;
  return [];
}

function genericEvents(record, make) {
  const events = [];
  const recordType = String(record?.type ?? record?.event ?? "").toLowerCase();
  const role = String(record?.role ?? record?.message?.role ?? record?.payload?.role ?? "").toLowerCase();
  const timestamp = timestampOf(record);

  if (["system", "developer"].includes(role) || ["system", "developer"].includes(recordType)) return events;
  if (["user", "assistant"].includes(role)) events.push(make(record, { kind: "message", role, timestamp_ms: timestamp }));
  if (/compact|context_summary/.test(recordType)) events.push(make(record, { kind: "compaction", timestamp_ms: timestamp }));
  if (/approval|permission_request|ask_user/.test(recordType)) events.push(make(record, { kind: "approval_request", timestamp_ms: timestamp }));
  if (/human_wait|user_wait/.test(recordType)) events.push(make(record, { kind: "human_wait", timestamp_ms: timestamp, duration_ms: durationOf(record) }));

  for (const block of contentBlocks(record)) {
    const type = String(block?.type ?? "").toLowerCase();
    if (["tool_use", "tool_call", "function_call"].includes(type)) {
      const toolName = block.name ?? block.tool_name ?? block.function?.name;
      const input = block.input ?? block.arguments ?? block.function?.arguments;
      const name = safeToolName(toolName);
      events.push(make(block, {
        kind: /ask|approval|permission|request_user_input/i.test(name) ? "approval_request" : "tool",
        tool_name: name,
        lifecycle: "STARTED",
        call_id: block.id ?? block.tool_use_id ?? block.call_id,
        signature: inputSignature(name, input),
        command_name: commandName(input),
        noop: isNoopInput(input),
        timestamp_ms: timestamp
      }));
    } else if (["tool_result", "function_result"].includes(type)) {
      const failure = block.is_error
        ? recordFailure({ error: block.content ?? "error" }) ?? { outcome: "FAILURE", excerpt: "FAILURE: sanitized failure metadata" }
        : undefined;
      events.push(make(block, {
        kind: "tool",
        lifecycle: "FINISHED",
        call_id: block.tool_use_id ?? block.call_id ?? block.id,
        outcome: failure?.outcome ?? "SUCCESS",
        error_excerpt: failure?.excerpt,
        timestamp_ms: timestamp
      }));
    }
  }

  const directTool = record?.tool_name ?? record?.tool?.name ?? record?.name;
  if (/tool_(?:use|call|start)|function_call/.test(recordType) && directTool) {
    const input = record.input ?? record.arguments ?? record.tool?.input;
    events.push(make(record, {
      kind: "tool",
      tool_name: directTool,
      lifecycle: "STARTED",
      call_id: record.call_id ?? record.tool_use_id ?? record.id,
      signature: inputSignature(directTool, input),
      command_name: commandName(input),
      noop: isNoopInput(input),
      timestamp_ms: timestamp
    }));
  }
  if (/tool_(?:result|finish|complete)|function_result/.test(recordType)) {
    const failure = recordFailure(record);
    const explicitStart = parseTime(record?.started_at_ms ?? record?.started_at ?? record?.start_time);
    events.push(make(record, {
      kind: "tool",
      lifecycle: "FINISHED",
      call_id: record.call_id ?? record.tool_use_id ?? record.id,
      outcome: failure?.outcome ?? "SUCCESS",
      error_excerpt: failure?.excerpt,
      timestamp_ms: explicitStart ?? timestamp,
      duration_ms: explicitStart !== undefined ? durationOf(record) : undefined
    }));
  }
  const usage = usageFrom(record?.usage ?? record?.result?.usage ?? record?.message?.usage);
  if (usage) events.push(make(record, { kind: "usage", usage, timestamp_ms: timestamp }));
  return events;
}

function codexEvents(record, make) {
  const events = [];
  if (["session_meta", "turn_context", "world_state"].includes(record?.type)) return events;
  const payload = record?.payload ?? record;
  const role = String(payload?.role ?? payload?.item?.role ?? "").toLowerCase();
  if (["system", "developer"].includes(role)) return events;

  const eventType = String(payload?.type ?? record?.type ?? "").toLowerCase();
  if (eventType === "token_count") {
    const usage = usageFrom(payload?.info?.total_token_usage
      ? { ...payload.info.total_token_usage, model_context_window: payload.info.model_context_window }
      : payload?.info ?? payload);
    if (usage) events.push(make(record, { kind: "usage", usage }));
    return events;
  }
  const item = payload?.item;
  if (item) {
    const itemRole = String(item?.role ?? "").toLowerCase();
    if (["user", "assistant"].includes(itemRole)) {
      events.push(make(record, {
        kind: "message",
        role: itemRole,
        timestamp_ms: parseTime(item.started_at_ms) ?? timestampOf(record),
        duration_ms: durationOf(item)
      }));
    }
    const itemType = String(item?.type ?? "").toLowerCase();
    if (/command|tool|function/.test(itemType)) {
      const toolName = item?.name ?? (itemType.includes("command") ? "command" : itemType);
      const input = item?.input ?? item?.command;
      const failure = recordFailure(item);
      events.push(make(record, {
        kind: /ask|approval|request_user_input/i.test(toolName) ? "approval_request" : "tool",
        tool_name: toolName,
        lifecycle: eventType.includes("started") ? "STARTED" : "FINISHED",
        call_id: item?.id ?? item?.call_id,
        signature: inputSignature(toolName, input),
        command_name: commandName(input),
        noop: isNoopInput(input),
        outcome: eventType.includes("completed") ? failure?.outcome ?? outcomeFrom(item?.status) : undefined,
        error_excerpt: failure?.excerpt,
        timestamp_ms: parseTime(item.started_at_ms) ?? timestampOf(record),
        duration_ms: durationOf(item)
      }));
    }
  }
  if (/compact/.test(eventType)) events.push(make(record, { kind: "compaction" }));
  events.push(...genericEvents(record, make));
  return events;
}

function normalizeRecord(host, record, make) {
  if (!record || typeof record !== "object") return [];
  return host === "codex" ? codexEvents(record, make) : genericEvents(record, make);
}

async function readRecords(inputFile) {
  const details = await lstat(inputFile);
  if (!details.isFile() || details.isSymbolicLink()) throw new Error(`Session input must be a regular file: ${inputFile}`);
  if (details.size > MAX_INPUT_BYTES) throw new Error(`Session input exceeds ${MAX_INPUT_BYTES} bytes`);
  const extension = path.extname(inputFile).toLowerCase();
  if ([".md", ".markdown"].includes(extension)) {
    const text = await readFile(inputFile, "utf8");
    const records = [];
    for (const match of text.matchAll(/^#{1,4}\s*(user|assistant)\b.*$/gim)) records.push({ role: match[1].toLowerCase() });
    return records;
  }

  const first = (await readFile(inputFile, { encoding: "utf8", flag: "r" })).trimStart()[0];
  if (first === "[") {
    const parsed = JSON.parse(await readFile(inputFile, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("Session JSON array expected");
    return parsed;
  }
  if (first === "{") {
    const text = await readFile(inputFile, "utf8");
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed?.messages)) return parsed.messages;
      if (Array.isArray(parsed?.events)) return parsed.events;
      return [parsed];
    } catch {
      // A JSON object on the first line is also the normal JSONL/stream-JSON shape.
    }
  }
  const records = [];
  const reader = createInterface({ input: createReadStream(inputFile, { encoding: "utf8" }), crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of reader) {
    lineNumber += 1;
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); }
    catch (error) { throw new Error(`Invalid JSON on session line ${lineNumber}: ${error.message}`); }
  }
  return records;
}

async function hashFile(inputFile) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(inputFile)) hash.update(chunk);
  return hash.digest("hex");
}

async function findExactFile(root, sessionId, host) {
  let visited = 0;
  const matches = [];
  async function visit(directory) {
    if (visited >= MAX_DISCOVERY_ENTRIES) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if (["ENOENT", "EACCES", "EPERM"].includes(error?.code)) return;
      throw error;
    }
    for (const entry of entries) {
      visited += 1;
      if (visited > MAX_DISCOVERY_ENTRIES) break;
      if (entry.isSymbolicLink()) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) {
        const base = path.basename(entry.name, path.extname(entry.name));
        const exact = base === sessionId || base.endsWith(`-${sessionId}`);
        if (exact && /\.(?:jsonl|json|md|markdown)$/i.test(entry.name)) matches.push(target);
      }
    }
  }
  await visit(root);
  if (!matches.length) throw new Error(`No ${host} session file matched explicit ID ${sessionId}; use --input FILE`);
  if (matches.length > 1) throw new Error(`Session ID ${sessionId} is ambiguous; use --input FILE`);
  return matches[0];
}

async function resolveInput({ host, inputFile, sessionId }) {
  if (Boolean(inputFile) === Boolean(sessionId)) throw new Error("Session review requires exactly one of --session-id ID or --input FILE");
  if (inputFile) return path.resolve(String(inputFile));
  if (!/^[A-Za-z0-9._-]{3,128}$/.test(String(sessionId))) throw new Error("Invalid session ID");
  if (host === "claude") throw new Error("Claude session-ID lookup has no stable local transcript contract; use --input with an explicit JSON or stream-JSON export");
  const root = host === "codex"
    ? path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions")
    : path.join(os.homedir(), ".cursor", "projects");
  return findExactFile(root, String(sessionId), host);
}

function unionDuration(intervals) {
  const sorted = intervals
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end >= start)
    .sort((left, right) => left[0] - right[0]);
  if (!sorted.length) return undefined;
  let total = 0;
  let [start, end] = sorted[0];
  for (const [nextStart, nextEnd] of sorted.slice(1)) {
    if (nextStart <= end) end = Math.max(end, nextEnd);
    else { total += end - start; start = nextStart; end = nextEnd; }
  }
  return total + end - start;
}

function pairToolIntervals(events) {
  const starts = new Map();
  const intervals = [];
  for (const event of events) {
    if (event.kind !== "tool") continue;
    if (Number.isFinite(event.duration_ms) && Number.isFinite(event.timestamp_ms)) {
      intervals.push([event.timestamp_ms, event.timestamp_ms + event.duration_ms]);
      continue;
    }
    if (!event.call_id_hash || !Number.isFinite(event.timestamp_ms)) continue;
    if (event.lifecycle === "STARTED") starts.set(event.call_id_hash, event.timestamp_ms);
    if (event.lifecycle === "FINISHED" && starts.has(event.call_id_hash)) intervals.push([starts.get(event.call_id_hash), event.timestamp_ms]);
  }
  return intervals;
}

function calculateMetrics(events) {
  const timestamps = events.map((event) => event.timestamp_ms).filter(Number.isFinite).sort((a, b) => a - b);
  const wall = timestamps.length >= 2 ? timestamps.at(-1) - timestamps[0] : undefined;
  const humanIntervals = events
    .filter((event) => event.kind === "human_wait" && Number.isFinite(event.timestamp_ms) && Number.isFinite(event.duration_ms))
    .map((event) => [event.timestamp_ms, event.timestamp_ms + event.duration_ms]);
  for (let index = 0; index < events.length; index += 1) {
    const current = events[index];
    if (current.kind !== "approval_request" || current.lifecycle === "FINISHED") continue;
    const nextUser = events.slice(index + 1).find((event) => event.kind === "message" && event.role === "user" && Number.isFinite(event.timestamp_ms));
    const waitStart = Number.isFinite(current.timestamp_ms) ? current.timestamp_ms + (current.duration_ms ?? 0) : undefined;
    if (nextUser && Number.isFinite(waitStart) && nextUser.timestamp_ms >= waitStart) humanIntervals.push([waitStart, nextUser.timestamp_ms]);
  }
  const humanWait = unionDuration(humanIntervals);
  const toolTime = unionDuration(pairToolIntervals(events));
  const signatures = new Map();
  const commands = new Map();
  const attempts = [];
  const attemptByCall = new Map();
  for (const event of events.filter((item) => item.kind === "tool" && item.lifecycle !== "FINISHED")) {
    if (event.signature) signatures.set(event.signature, (signatures.get(event.signature) ?? 0) + 1);
    if (event.command_name) commands.set(event.command_name, (commands.get(event.command_name) ?? 0) + 1);
    const attempt = { signature: event.signature, outcome: event.outcome };
    attempts.push(attempt);
    if (event.call_id_hash) attemptByCall.set(event.call_id_hash, attempt);
  }
  for (const event of events.filter((item) => item.kind === "tool" && item.lifecycle === "FINISHED")) {
    const attempt = event.call_id_hash ? attemptByCall.get(event.call_id_hash) : undefined;
    if (attempt) attempt.outcome = event.outcome;
  }
  const failures = events.filter((event) => ["FAILURE", "TIMEOUT"].includes(event.outcome)).length;
  const timeouts = events.filter((event) => event.outcome === "TIMEOUT").length;
  const repeats = [...signatures.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
  const attemptsBySignature = new Map();
  for (const attempt of attempts.filter((item) => item.signature)) {
    const group = attemptsBySignature.get(attempt.signature) ?? [];
    group.push(attempt);
    attemptsBySignature.set(attempt.signature, group);
  }
  let retries = 0;
  for (const group of attemptsBySignature.values()) {
    for (let index = 1; index < group.length; index += 1) {
      if (group.slice(0, index).some((attempt) => ["FAILURE", "TIMEOUT"].includes(attempt.outcome))) retries += 1;
    }
  }
  const usageEvents = events.filter((event) => event.usage).map((event) => event.usage);
  const usage = {};
  for (const key of ["input_tokens", "cached_input_tokens", "cache_write_tokens", "output_tokens", "reasoning_tokens", "total_tokens", "context_window"]) {
    const values = usageEvents.map((item) => item[key]).filter(Number.isFinite);
    usage[key] = available(values.length ? Math.max(...values) : undefined, "tokens");
  }
  return {
    durations: {
      wall_time: available(wall, "ms"),
      human_wait: available(humanWait, "ms"),
      agent_time: available(wall !== undefined && humanWait !== undefined ? Math.max(0, wall - humanWait) : undefined, "ms"),
      tool_time: available(toolTime, "ms")
    },
    tool_calls: available(events.filter((event) => event.kind === "tool" && event.lifecycle !== "FINISHED").length, "count"),
    command_frequency: [...commands.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([command, count]) => ({ command, count })),
    repeated_calls: available(repeats, "count"),
    noop_calls: available(events.filter((event) => event.noop && event.lifecycle !== "FINISHED").length, "count"),
    retries: available(retries, "count"),
    failures: available(failures, "count"),
    timeouts: available(timeouts, "count"),
    approval_loops: available(events.filter((event) => event.kind === "approval_request" && event.lifecycle !== "FINISHED").length, "count"),
    compactions: available(events.filter((event) => event.kind === "compaction").length, "count"),
    tokens: usage
  };
}

function improvementDrafts(metrics, events) {
  const drafts = [];
  const refs = (predicate) => events.filter(predicate).slice(0, 8).map((event) => event.event_ref);
  function add(category, title, observation, evidenceRefs, proposedEvaluation) {
    drafts.push({
      id: `IMP-${String(drafts.length + 1).padStart(3, "0")}`,
      state: "DRAFT",
      category,
      title,
      observation,
      evidence_refs: evidenceRefs,
      proposed_evaluation: proposedEvaluation
    });
  }
  if ((metrics.noop_calls.value ?? 0) > 1 || (metrics.repeated_calls.value ?? 0) > 2) {
    add("cli", "Reduce repeated process startup and no-op command cost", "The selected session contains repeated or informational tool invocations.", refs((event) => event.noop || event.signature), "Compare median elapsed time and process starts for the same bounded workflow.");
  }
  if ((metrics.timeouts.value ?? 0) > 0) {
    add("integration", "Fail fast before long connector operations", "One or more selected-session tool outcomes were classified as timeouts.", refs((event) => event.outcome === "TIMEOUT"), "Verify a bounded connectivity preflight ends within the profile timeout and prevents redundant full attempts.");
  }
  if ((metrics.approval_loops.value ?? 0) > 2) {
    add("workflow", "Review sequential confirmation boundaries", "The selected session contains multiple developer-response boundaries.", refs((event) => event.kind === "approval_request"), "Replay the use case and compare human-wait boundaries without weakening approval requirements.");
  }
  if ((metrics.compactions.value ?? 0) > 0) {
    add("host_limitation", "Measure context compaction impact", "The host recorded one or more context compactions.", refs((event) => event.kind === "compaction"), "Run a controlled long session and compare continuity and token usage around compaction events.");
  }
  if ((metrics.failures.value ?? 0) > 0 && drafts.length === 0) {
    add("evaluation", "Add a regression fixture for observed tool failures", "The selected session records failed tool outcomes.", refs((event) => event.outcome === "FAILURE"), "A sanitized fixture reproduces the classification and expected recovery behavior.");
  }
  return drafts;
}

function metricText(metric) {
  return metric.status === "AVAILABLE" ? `${metric.value} ${metric.unit ?? ""}`.trim() : "UNAVAILABLE";
}

function renderReview(review) {
  const m = review.metrics;
  return `# Rooty session review\n\n- Host: ${review.host}\n- Session: ${review.session.id}\n- Source hash: \`${review.session.source_hash}\`\n- Generated: ${review.generated_at}\n- Sanitization: ${review.sanitization.policy}\n\n## Timing\n\n| Metric | Value |\n|---|---:|\n| Wall time | ${metricText(m.durations.wall_time)} |\n| Agent time | ${metricText(m.durations.agent_time)} |\n| Human wait | ${metricText(m.durations.human_wait)} |\n| Tool time (interval union) | ${metricText(m.durations.tool_time)} |\n\n## Activity\n\n| Metric | Value |\n|---|---:|\n| Tool calls | ${metricText(m.tool_calls)} |\n| Repeated calls | ${metricText(m.repeated_calls)} |\n| No-op calls | ${metricText(m.noop_calls)} |\n| Failures | ${metricText(m.failures)} |\n| Timeouts | ${metricText(m.timeouts)} |\n| Approval loops | ${metricText(m.approval_loops)} |\n| Compactions | ${metricText(m.compactions)} |\n\n## Findings\n\n${review.findings.length ? review.findings.map((item) => `- ${item}`).join("\n") : "- No evidence-backed improvement finding was produced."}\n\n## Limitations\n\n${review.limitations.map((item) => `- ${item}`).join("\n")}\n`;
}

export async function reviewSession({ host, inputFile, sessionId, projectRoot = process.cwd(), outputDir }) {
  const normalizedHost = String(host ?? "").toLowerCase();
  if (!SESSION_HOSTS.includes(normalizedHost)) throw new Error(`Unsupported session host: ${host}. Choose ${SESSION_HOSTS.join(", ")}.`);
  const project = await resolveProjectRoot(projectRoot);
  const source = await resolveInput({ host: normalizedHost, inputFile, sessionId });
  const records = await readRecords(source);
  const make = eventFactory(normalizedHost);
  const events = records.flatMap((record) => normalizeRecord(normalizedHost, record, make));
  const metrics = calculateMetrics(events);
  const sourceHash = await hashFile(source);
  const id = String(sessionId ?? path.basename(source, path.extname(source))).replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 128);
  const target = outputDir ? path.resolve(String(outputDir)) : path.join(project, ".rooty", "session-reviews", id);
  const safeProjectOutput = path.join(project, ".rooty", "session-reviews");
  if (isInside(project, target) && !isInside(safeProjectOutput, target)) {
    throw new Error("Session review output inside the project must be under Git-ignored .rooty/session-reviews; otherwise choose a directory outside the project");
  }
  const queueDir = path.join(project, ".rooty", "improvements", "drafts");
  await mkdir(target, { recursive: true });
  await mkdir(queueDir, { recursive: true });
  const drafts = improvementDrafts(metrics, events);
  const findings = drafts.map((draft) => `${draft.category}: ${draft.title}`);
  const limitations = [];
  if (metrics.durations.wall_time.status === "UNAVAILABLE") limitations.push("The selected host export did not provide enough timestamps for wall-clock metrics.");
  if (metrics.tokens.total_tokens.status === "UNAVAILABLE") limitations.push("The selected host export did not expose token totals.");
  if (!events.some((event) => event.kind === "tool")) limitations.push("No structured tool lifecycle was available; tool metrics may be zero while timing remains unavailable.");
  if (normalizedHost === "codex") limitations.push("Codex local JSONL is an observed, version-sensitive format rather than a stable public transcript API; unsupported records are ignored fail-closed.");
  const review = {
    schema_version: 1,
    generated_at: isoNow(),
    host: normalizedHost,
    session: { id, selection: sessionId ? "explicit_session_id" : "explicit_input_file", source_hash: sourceHash },
    sanitization: {
      policy: "metadata-only with bounded redacted failure excerpts",
      excluded: ["system_instructions", "developer_instructions", "full_prompts", "raw_tool_output", "credentials", "personal_identifiers", "unrelated_content"]
    },
    normalized_contract: "rooty.session-event.v1",
    metrics,
    events: events.map(({ timestamp_ms, signature, ...event }) => event),
    findings,
    limitations
  };
  const improvement = {
    schema_version: 1,
    state: "DRAFT",
    source_review_hash: sha256(review),
    source_session: { host: normalizedHost, id, source_hash: sourceHash },
    storage_boundary: "improvement_queue_not_incident_memory",
    allowed_categories: IMPROVEMENT_CATEGORIES,
    drafts
  };
  const reviewJson = path.join(target, "session-review.json");
  const reviewMarkdown = path.join(target, "session-review.md");
  const improvementFile = path.join(target, "improvement-draft.json");
  const queueFile = path.join(queueDir, `${normalizedHost}-${id}.json`);
  await atomicWriteJson(reviewJson, review);
  await atomicWriteText(reviewMarkdown, renderReview(review));
  await atomicWriteJson(improvementFile, improvement);
  await atomicWriteJson(queueFile, improvement);
  return { review, files: { review_json: reviewJson, review_markdown: reviewMarkdown, improvement_draft: improvementFile, improvement_queue: queueFile } };
}
