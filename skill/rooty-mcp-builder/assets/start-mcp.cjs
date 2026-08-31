#!/usr/bin/env node

"use strict";

const { spawn } = require("node:child_process");
const { lstatSync, readFileSync } = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SETTING_PATH_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const RUNTIME_ENVIRONMENT_KEYS = new Set([
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TZ"
]);

function fail(message) {
  throw new Error(`Rooty MCP launcher: ${message}`);
}

function parseKeyBindings(value) {
  const bindings = String(value).split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
    const parts = item.split("=");
    if (parts.length > 2 || !SETTING_PATH_PATTERN.test(parts[0])
      || (parts.length === 2 && !KEY_PATTERN.test(parts[1]))) {
      fail("--keys must contain valid comma-separated SETTING_PATH or SETTING_PATH=CHILD_ENV bindings");
    }
    return { source: parts[0], target: parts[1] ?? (KEY_PATTERN.test(parts[0]) ? parts[0] : undefined) };
  });
  if (!bindings.length) fail("--keys must contain at least one setting name");
  const sources = new Set();
  const targets = new Set();
  for (const binding of bindings) {
    if (sources.has(binding.source) || (binding.target && targets.has(binding.target))) fail("--keys contains a duplicate setting or child environment binding");
    sources.add(binding.source);
    if (binding.target) targets.add(binding.target);
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
  if (command && keys.some(({ target }) => !target)) fail("nested setting paths used with stdio require SETTING_PATH=CHILD_ENV bindings");
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

function validateSettingsDocument(document) {
  if (![1, 2].includes(document?.schema_version) || !document.settings || typeof document.settings !== "object" || Array.isArray(document.settings)) {
    fail("invalid MCP settings schema");
  }
  function validateNode(node, prefix = []) {
    for (const [key, value] of Object.entries(node)) {
      const settingPath = [...prefix, key].join(".");
      if (!KEY_PATTERN.test(key)) fail(`invalid MCP setting path: ${settingPath}`);
      if (typeof value === "string") {
        if (value.includes("\0")) fail(`MCP setting contains a forbidden null byte: ${settingPath}`);
      } else if (value && typeof value === "object" && !Array.isArray(value)) validateNode(value, [...prefix, key]);
      else fail(`MCP setting must be a string or object: ${settingPath}`);
    }
  }
  validateNode(document.settings);
  if (document.schema_version === 1 && Object.values(document.settings).some((value) => typeof value !== "string")) {
    fail("schema-version-1 MCP settings must be flat strings");
  }
  if (document.schema_version === 2) {
    for (const [environment, group] of Object.entries(document.settings)) {
      if (environment.startsWith("ROOTY_SQL_")) fail("schema-version-2 SQL settings must be grouped by environment");
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(environment) || !group || typeof group !== "object" || Array.isArray(group)) {
        fail(`schema-version-2 settings must be grouped by lowercase environment: ${environment}`);
      }
      if (group.sql?.databases !== undefined) fail(`${environment}.sql.databases is deprecated; use ${environment}.sql.catalogs`);
      const catalogs = group.sql?.catalogs;
      if (catalogs === undefined) continue;
      if (!catalogs || typeof catalogs !== "object" || Array.isArray(catalogs)) fail(`${environment}.sql.catalogs must be an object`);
      const used = new Set();
      for (const [domain, catalog] of Object.entries(catalogs)) {
        const mcpUrl = catalog?.mcp_url;
        if (typeof mcpUrl !== "string" || mcpUrl === "") continue;
        const match = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(mcpUrl);
        const port = match ? Number.parseInt(match[1], 10) : 0;
        if (!match || port < 1 || port > 65535) fail(`${environment}.sql.catalogs.${domain}.mcp_url must be an explicit loopback URL`);
        if (used.has(mcpUrl)) fail(`SQL catalog MCP URLs must be unique within ${environment}`);
        used.add(mcpUrl);
      }
    }
  }
  return document;
}

function loadSettings(file, keys) {
  let document;
  try { document = JSON.parse(readFileSync(validateSettingsPath(file), "utf8")); }
  catch (error) { fail(`cannot read MCP settings: ${error.message}`); }
  validateSettingsDocument(document);
  const selected = {};
  const missing = [];
  for (const key of keys) {
    const value = key.split(".").reduce((node, segment) => (
      node && typeof node === "object" && !Array.isArray(node)
        ? node[segment]
        : undefined
    ), document.settings);
    if (typeof value !== "string" || value === "") missing.push(key);
    else selected[key] = value;
  }
  if (missing.length) fail(`required setting keys are missing: ${missing.join(", ")}`);
  return selected;
}

function substitute(template, values) {
  return template.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\}/g, (match, key) => {
    if (values[key] === undefined) fail(`template references undeclared setting key: ${key}`);
    return values[key];
  });
}

function minimalRuntimeEnvironment(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([key, value]) =>
    value !== undefined && RUNTIME_ENVIRONMENT_KEYS.has(key.toUpperCase())
  ));
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
    env: { ...minimalRuntimeEnvironment(), ...childSettings },
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

module.exports = { KEY_PATTERN, SETTING_PATH_PATTERN, launch, loadSettings, minimalRuntimeEnvironment, parseArgs, parseHeaders, parseHttpMessage, parseKeyBindings, runStdio, substitute, validateSettingsDocument, validateSettingsPath };

if (require.main === module) {
  launch().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
