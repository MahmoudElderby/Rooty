import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { readLedger, verifyLedgerEntries } from "./cases.js";
import { runEvaluation } from "./evaluate.js";
import { TOOLS } from "./mcp.js";
import { assertNoEmbeddedSecrets, pathExists, readJson } from "./core.js";

const REQUIRED_CAPABILITIES = ["ticketing", "documentation", "observability", "database", "deployments"];
const REQUIRED_GITIGNORE_ENTRIES = [
  ".investigator/discovery.json",
  ".investigator/cases/",
  ".investigator/memory/drafts/",
  ".rooty-cases/"
];

export async function runDoctor({ packageRoot, projectRoot, connectorTimeoutMs = 3000, requireActivatedConnectors = true }) {
  const checks = [];
  const add = (status, name, message) => checks.push({ status, name, message });
  const canonical = path.join(projectRoot, ".agents/skills/root-cause-investigator/SKILL.md");
  const packaged = path.join(packageRoot, "skill/root-cause-investigator/SKILL.md");
  if (await pathExists(canonical) || await pathExists(packaged)) add("PASS", "skill", "root-cause-investigator skill is discoverable or packaged");
  else add("FAIL", "skill", "SKILL.md is missing");

  const recipeFile = path.join(packageRoot, "setup/connector-recipes/catalog.json");
  try {
    const recipes = await readJson(recipeFile);
    const unsafe = recipes.providers.filter((provider) =>
      provider.required_access !== "read-only" ||
      provider.allowed_tools.some((tool) => /(create|update|delete|write|execute|rollback)/i.test(tool)) ||
      provider.capabilities.some((capability) => !provider.doctor_probes?.[capability])
    );
    if (unsafe.length) add("FAIL", "connector-recipes", `Unsafe or unprobeable recipes: ${unsafe.map((item) => item.id).join(", ")}`);
    else add("PASS", "connector-recipes", `${recipes.providers.length} provider recipes have read-only allowlists and probes`);
  } catch (error) {
    add("FAIL", "connector-recipes", error.message);
  }

  const sourcesFile = path.join(projectRoot, ".investigator/sources.json");
  if (await pathExists(sourcesFile)) {
    try {
      const sources = await readJson(sourcesFile);
      assertNoEmbeddedSecrets(sources, "sources");
      const capabilities = sources.environments?.production?.capabilities ?? {};
      const unresolved = REQUIRED_CAPABILITIES.filter((capability) => capabilities[capability]?.status !== "ready-for-host-rendering");
      for (const [capability, value] of Object.entries(capabilities)) {
        if (value.status !== "ready-for-host-rendering" && !unresolved.includes(capability)) unresolved.push(capability);
      }
      add(unresolved.length && requireActivatedConnectors ? "FAIL" : unresolved.length ? "WARN" : "PASS", "source-registry", unresolved.length ? `Unresolved capabilities: ${unresolved.join(", ")}` : "All capabilities have connector references");
    } catch (error) {
      add("FAIL", "source-registry", error.message);
    }
  } else add(requireActivatedConnectors ? "FAIL" : "WARN", "source-registry", "Run `rooty sources discover` and `rooty sources configure`");

  const unsafeTools = TOOLS.filter((tool) => tool.annotations?.readOnlyHint !== true || tool.annotations?.destructiveHint !== false || /(create|update|delete|write|execute|rollback)/i.test(tool.name));
  if (unsafeTools.length) add("FAIL", "mcp-tools", `Unsafe tools: ${unsafeTools.map((tool) => tool.name).join(", ")}`);
  else add("PASS", "mcp-tools", `${TOOLS.length} bundled tools are explicitly read-only`);

  try {
    const serverInfo = await probeBundledConnector(path.join(packageRoot, "src/mock-mcp-server.js"));
    add("PASS", "mcp-startup", `Bundled connector started as ${serverInfo.name}@${serverInfo.version}`);
  } catch (error) {
    add("FAIL", "mcp-startup", error.message);
  }

  const activationFile = path.join(projectRoot, ".investigator/activated-connectors.json");
  if (await pathExists(activationFile)) {
    try {
      const activation = await readJson(activationFile);
      assertNoEmbeddedSecrets(activation, "activated-connectors");
      const connectors = activation.connectors ?? [];
      const connectorChecks = await Promise.all(connectors.map((connector) => doctorConnectorChecks(connector, connectorTimeoutMs)));
      if (connectorChecks.length === 0) add(requireActivatedConnectors ? "FAIL" : "WARN", "activated-connectors", "Activation manifest contains no connectors");
      else {
        const activatedCapabilities = new Set(connectors.map((connector) => connector.capability));
        const missing = REQUIRED_CAPABILITIES.filter((capability) => !activatedCapabilities.has(capability));
        add(missing.length && requireActivatedConnectors ? "FAIL" : missing.length ? "WARN" : "PASS", "activated-connectors-coverage", missing.length ? `Capabilities are not activated: ${missing.join(", ")}` : "All required capabilities are activated");
        for (const group of connectorChecks) checks.push(...group);
      }
    } catch (error) {
      add("FAIL", "activated-connectors", error.message);
    }
  } else add(requireActivatedConnectors ? "FAIL" : "WARN", "activated-connectors", "No production connectors are activated");

  try {
    const evaluation = await runEvaluation({ casesFile: path.join(packageRoot, "evals/cases/replay-cases.json") });
    if (!evaluation.ok || evaluation.total !== 15) add("FAIL", "replay-suite", `${evaluation.passed}/${evaluation.total} independent replay cases passed`);
    else add("PASS", "replay-suite", "15 independent frozen replay cases validate");
  } catch (error) {
    add("FAIL", "replay-suite", error.message);
  }

  const caseRoot = path.join(projectRoot, ".investigator/cases");
  if (await pathExists(caseRoot)) add("FAIL", "case-location", "Case data is inside the source tree; move it outside before investigating");
  else add("PASS", "case-location", "No investigation evidence is stored in the source tree");

  const ignoreFile = requireActivatedConnectors
    ? path.join(projectRoot, ".gitignore")
    : path.join(packageRoot, "setup/gitignore-template.txt");
  try {
    const ignore = await readFile(ignoreFile, "utf8");
    const lines = new Set(ignore.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    const missing = REQUIRED_GITIGNORE_ENTRIES.filter((entry) => !lines.has(entry));
    if (missing.length > 0) add("FAIL", "gitignore", `Missing Rooty exclusions in ${ignoreFile}: ${missing.join(", ")}`);
    else add("PASS", "gitignore", requireActivatedConnectors
      ? "Project excludes Rooty runtime evidence and drafts from Git"
      : "Packaged project gitignore template covers Rooty runtime evidence and drafts");
  } catch (error) {
    add("FAIL", "gitignore", `Cannot validate Rooty Git exclusions at ${ignoreFile}: ${error.message}`);
  }

  return { ok: !checks.some((check) => check.status === "FAIL"), checks };
}

export async function verifyCaseDirectory(caseDir) {
  const entries = await readLedger(caseDir);
  return verifyLedgerEntries(entries);
}

async function doctorConnectorChecks(connector, timeoutMs) {
  const checks = [];
  const add = (status, phase, message) => checks.push({ status, name: `${connector.name}-${phase}`, message });
  if (!connector.name || !connector.endpoint || !Array.isArray(connector.allowed_tools)) {
    add("FAIL", "configuration", "Activation entry is missing name, endpoint, or allowed_tools");
    return checks;
  }
  if (connector.auth === "bearer-env") {
    const variable = connector.bearer_token_env_var;
    if (!variable || !process.env[variable]) {
      add("FAIL", "authentication", `Bearer credential environment variable is unavailable: ${variable ?? "<missing>"}`);
      return checks;
    }
    add("PASS", "authentication", `Bearer credential is available through ${variable}`);
  } else if (connector.auth === "none") {
    let hostname;
    try { hostname = new URL(connector.endpoint).hostname; }
    catch { add("FAIL", "authentication", `Invalid connector endpoint: ${connector.endpoint}`); return checks; }
    if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
      add("FAIL", "authentication", "Unauthenticated MCP is allowed only on a loopback endpoint");
      return checks;
    }
    add("PASS", "authentication", "Unauthenticated loopback MCP is configured; the live read probe will verify access");
  } else if (connector.auth === "oauth") {
    const variable = connector.oauth_access_token_env_var;
    if (!variable || !process.env[variable]) {
      add("FAIL", "authentication", `OAuth access-token environment variable is unavailable: ${variable ?? "<missing>"}`);
      return checks;
    }
    add("PASS", "authentication", `OAuth access token is available through ${variable}`);
  } else {
    add("FAIL", "authentication", `Unsupported or unconfigured auth mode: ${connector.auth ?? "<missing>"}`);
    return checks;
  }

  const client = new HttpMcpClient(connector, timeoutMs);
  try {
    const initialized = await client.initialize();
    add("PASS", "initialize", `Connected using MCP ${initialized.protocolVersion ?? "negotiated protocol"}`);
  } catch (error) {
    add("FAIL", "initialize", error.message);
    return checks;
  }

  let tools;
  try {
    tools = await client.listTools();
    const names = new Set(tools.map((tool) => tool.name));
    const missing = connector.allowed_tools.filter((tool) => !names.has(tool));
    if (missing.length) throw new Error(`Activated allowlist tools were not advertised: ${missing.join(", ")}`);
    add("PASS", "tools-list", `${tools.length} tools advertised; activated allowlist resolved`);
  } catch (error) {
    add("FAIL", "tools-list", error.message);
    return checks;
  }

  try {
    const probe = connector.doctor_probe;
    if (!probe?.tool || !connector.allowed_tools.includes(probe.tool)) throw new Error("A harmless doctor_probe from the activated allowlist is required");
    if (!tools.some((tool) => tool.name === probe.tool)) throw new Error(`Probe tool is not advertised: ${probe.tool}`);
    const result = await client.callTool(probe.tool, probe.arguments ?? {});
    if (result?.isError === true) throw new Error(`Read probe returned an MCP tool error from ${probe.tool}`);
    add("PASS", "read-probe", `${probe.tool} completed without a mutation request`);
  } catch (error) {
    add("FAIL", "read-probe", error.message);
  }
  return checks;
}

class HttpMcpClient {
  constructor(connector, timeoutMs) {
    this.connector = connector;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.sessionId = undefined;
  }

  async initialize() {
    const result = await this.request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "rooty-doctor", version: "0.1.0" }
    });
    if (!result?.protocolVersion) throw new Error("MCP initialize did not negotiate a protocol version");
    this.protocolVersion = result.protocolVersion;
    await this.notify("notifications/initialized", {});
    return result;
  }

  async listTools() {
    const result = await this.request("tools/list", {});
    if (!Array.isArray(result?.tools)) throw new Error("tools/list did not return a tools array");
    return result.tools;
  }

  callTool(name, args) {
    return this.request("tools/call", { name, arguments: args });
  }

  request(method, params) {
    return this.send({ jsonrpc: "2.0", id: this.nextId++, method, params }, true);
  }

  notify(method, params) {
    return this.send({ jsonrpc: "2.0", method, params }, false);
  }

  async send(body, expectsResponse) {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    if (this.protocolVersion) headers["mcp-protocol-version"] = this.protocolVersion;
    const credentialVariable = this.connector.auth === "bearer-env"
      ? this.connector.bearer_token_env_var
      : this.connector.auth === "oauth"
        ? this.connector.oauth_access_token_env_var
        : undefined;
    if (credentialVariable) headers.authorization = `Bearer ${process.env[credentialVariable]}`;
    let response;
    try {
      response = await fetch(this.connector.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw new Error(`MCP ${body.method} connection failed for ${this.connector.endpoint}: ${error.message}`);
    }
    if (!response.ok) throw new Error(`MCP ${body.method} returned HTTP ${response.status}${[401, 403].includes(response.status) ? " (authentication unavailable or unauthorized)" : ""}`);
    this.sessionId = response.headers.get("mcp-session-id") ?? this.sessionId;
    const text = await response.text();
    if (!expectsResponse && !text.trim()) return undefined;
    const message = parseMcpMessage(text, expectsResponse ? body.id : undefined);
    if (!message && expectsResponse) throw new Error(`MCP ${body.method} returned no JSON-RPC response`);
    if (message?.error) throw new Error(`MCP ${body.method} error: ${message.error.message ?? JSON.stringify(message.error)}`);
    return message?.result;
  }
}

function parseMcpMessage(text, expectedId) {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try { return JSON.parse(trimmed); }
  catch {
    const messages = [];
    for (const block of trimmed.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
      if (!data || data === "[DONE]") continue;
      try { messages.push(JSON.parse(data)); }
      catch { /* try the next SSE event */ }
    }
    if (expectedId !== undefined) return messages.find((message) => message.id === expectedId) ?? messages.find((message) => message.error);
    if (messages.length) return messages.at(-1);
  }
  throw new Error("Connector returned invalid JSON or SSE");
}

function probeBundledConnector(serverFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverFile], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let buffer = "";
    let stderr = "";
    const timer = setTimeout(() => finish(new Error("Bundled connector did not initialize within 3000 ms")), 3000);
    function finish(error, value) {
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else resolve(value);
    }
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => finish(error?.code === "EPERM" || error?.code === "EACCES"
      ? new Error(`Execution environment denied the bundled connector process (${error.code}); verify process-execution policy or sandbox permissions`)
      : error));
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline));
        if (!response.result?.serverInfo) finish(new Error(response.error?.message ?? "Invalid initialize response"));
        else finish(undefined, response.result.serverInfo);
      } catch (error) {
        finish(new Error(`Invalid connector response: ${error.message}; ${stderr}`));
      }
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "rooty-doctor", version: "0.1.0" } } })}\n`);
  });
}
