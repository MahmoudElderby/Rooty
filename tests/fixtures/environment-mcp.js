#!/usr/bin/env node
import readline from "node:readline";

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }

input.on("line", (line) => {
  let request;
  try { request = JSON.parse(line); }
  catch { return; }
  if (request.method === "notifications/initialized") return;
  if (request.method === "initialize") {
    send({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "rooty-environment-test", version: "1" } } });
    return;
  }
  if (request.method === "tools/list") {
    send({ jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "bounded_read", description: "Return the configured environment", inputSchema: { type: "object", additionalProperties: false } }] } });
    return;
  }
  if (request.method === "tools/call" && request.params?.name === "bounded_read") {
    send({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: `environment=${process.env.ROOTY_TEST_ENV}` }] } });
    return;
  }
  if (request.id !== undefined) send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" } });
});
