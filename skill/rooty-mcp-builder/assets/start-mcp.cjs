#!/usr/bin/env node

"use strict";

const { spawn } = require("node:child_process");
const { lstatSync, readFileSync } = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function fail(message) {
  throw new Error(`Rooty MCP launcher: ${message}`);
}

function parseKeyBindings(value) {
  const bindings = String(value).split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
    const parts = item.split("=");
    if (parts.length > 2 || parts.some((part) => !KEY_PATTERN.test(part))) {
      fail("--keys must contain valid comma-separated NAME or NAME=CHILD_ENV bindings");
    }
    return { source: parts[0], target: parts[1] ?? parts[0] };
  });
  if (!bindings.length) fail("--keys must contain at least one setting name");
  const sources = new Set();
  const targets = new Set();
  for (const binding of bindings) {
    if (sources.has(binding.source) || targets.has(binding.target)) fail("--keys contains a duplicate setting or child environment binding");
    sources.add(binding.source);
    targets.add(binding.target);
  }
  return bindings;
}

function parseArgs(argv) {
  let settingsFile;
  let keys;
  let url;
  const headers = [];
  let index = 0;
  while (index < argv.length) {
    const flag = argv[index];
    if (flag === "--") break;
    const value = argv[index + 1];
    if (!value) fail(`${flag} requires a value`);
    if (flag === "--settings") settingsFile = value;
    else if (flag === "--keys") keys = parseKeyBindings(value);
    else if (flag === "--url") url = value;
    else if (flag === "--header") headers.push(value);
    else fail(`unsupported argument: ${flag}`);
    index += 2;
  }
  const command = argv[index] === "--" ? argv[index + 1] : undefined;
  const commandArgs = command ? argv.slice(index + 2) : [];
  if (!settingsFile || !path.isAbsolute(settingsFile)) fail("--settings must identify an absolute MCP settings file");
  if (!Array.isArray(keys) || !keys.length) fail("--keys is required");
  if (Boolean(url) === Boolean(command)) fail("choose exactly one HTTP --url or stdio command after --");
  return { settingsFile, keyBindings: keys, keys: keys.map(({ source }) => source), url, headers, command, commandArgs };
}

function validateSettingsPath(file) {
  const normalized = path.resolve(file);
  const segments = normalized.split(path.sep).map((item) => item.toLowerCase());
  if (segments.slice(-3).join("/") !== ".rooty/config/mcp-settings.local.json") {
    fail("settings must use .rooty/config/mcp-settings.local.json");
  }
  const details = lstatSync(normalized);
  if (!details.isFile() || details.isSymbolicLink()) fail("MCP settings must be a regular non-symlink file");
  return normalized;
}

function loadSettings(file, keys) {
  let document;
  try { document = JSON.parse(readFileSync(validateSettingsPath(file), "utf8")); }
  catch (error) { fail(`cannot read MCP settings: ${error.message}`); }
  if (document?.schema_version !== 1 || !document.settings || typeof document.settings !== "object" || Array.isArray(document.settings)) {
    fail("invalid MCP settings schema");
  }
  const selected = {};
  const missing = [];
  for (const key of keys) {
    const value = document.settings[key];
    if (typeof value !== "string" || value === "") missing.push(key);
    else selected[key] = value;
  }
  if (missing.length) fail(`required setting keys are missing: ${missing.join(", ")}`);
  return selected;
}

function substitute(template, values) {
  return template.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, key) => {
    if (values[key] === undefined) fail(`template references undeclared setting key: ${key}`);
    return values[key];
  });
}

function parseHeaders(items, values) {
  const headers = {};
  for (const item of items) {
    const separator = item.indexOf(":");
    if (separator < 1) fail("--header must use Name: value syntax");
    const name = item.slice(0, separator).trim();
    const value = substitute(item.slice(separator + 1).trim(), values);
    if (!name || /[\r\n]/.test(name + value)) fail("invalid HTTP header");
    headers[name] = value;
  }
  return headers;
}

function parseHttpMessage(text, expectedId) {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const messages = trimmed.split(/\r?\n\r?\n/).flatMap((event) => event.split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5).trim())));
  return messages.find((message) => expectedId === undefined || message.id === expectedId) ?? messages[0];
}

async function runHttpBridge(invocation, values) {
  const endpoint = substitute(invocation.url, values);
  const configuredHeaders = parseHeaders(invocation.headers, values);
  let sessionId;
  let protocolVersion;
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    let request;
    try { request = JSON.parse(line); }
    catch { continue; }
    try {
      const headers = { ...configuredHeaders, "content-type": "application/json", accept: "application/json, text/event-stream" };
      if (sessionId) headers["mcp-session-id"] = sessionId;
      if (protocolVersion) headers["mcp-protocol-version"] = protocolVersion;
      const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(request) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      sessionId = response.headers.get("mcp-session-id") ?? sessionId;
      const message = parseHttpMessage(await response.text(), request.id);
      if (request.method === "initialize" && message?.result?.protocolVersion) protocolVersion = message.result.protocolVersion;
      if (request.id !== undefined && message) process.stdout.write(`${JSON.stringify(message)}\n`);
    } catch (error) {
      if (request.id !== undefined) process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "Rooty HTTP bridge failed; inspect endpoint reachability and local setting availability" } })}\n`);
    }
  }
}

function runStdio(invocation, values, spawnImpl = spawn) {
  const childSettings = Object.fromEntries(invocation.keyBindings.map(({ source, target }) => [target, values[source]]));
  const child = spawnImpl(invocation.command, invocation.commandArgs, {
    env: { ...process.env, ...childSettings },
    shell: false,
    stdio: "inherit",
    windowsHide: true
  });
  child.once("error", (error) => {
    process.stderr.write(`Rooty MCP launcher: MCP failed to start: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => { process.exitCode = Number.isInteger(code) ? code : signal ? 1 : 0; });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
  return child;
}

async function launch(argv = process.argv.slice(2)) {
  const invocation = parseArgs(argv);
  const values = loadSettings(invocation.settingsFile, invocation.keys);
  return invocation.url ? runHttpBridge(invocation, values) : runStdio(invocation, values);
}

module.exports = { KEY_PATTERN, launch, loadSettings, parseArgs, parseHeaders, parseHttpMessage, parseKeyBindings, runStdio, substitute, validateSettingsPath };

if (require.main === module) {
  launch().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
