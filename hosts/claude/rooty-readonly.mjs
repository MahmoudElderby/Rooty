#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const event = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const policy = JSON.parse(await readFile(new URL("../rooty-allowed-tools.json", import.meta.url), "utf8"));
if (!policy.allowedTools.includes(event.tool_name)) {
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `Rooty investigator policy blocks non-read tool: ${event.tool_name}` } })}\n`);
}
