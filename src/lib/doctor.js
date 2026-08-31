import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { readLedger, verifyLedgerEntries } from "./cases.js";
import { runEvaluation } from "./evaluate.js";
import { TOOLS } from "./mcp.js";
import { assertNoEmbeddedSecrets, fingerprint, isoNow, minimalRuntimeEnvironment, pathExists, readJson } from "./core.js";
import { inspectRootyInstall, ROOTY_HOSTS, ROOTY_PATHS, ROOTY_SKILLS } from "./installer.js";
import { detectSetupModel } from "./setup-model.js";
import { buildLockedEnvironmentIdentity, inspectEnvironmentProject, readActiveEnvironments, readEnvironmentProfiles, resolveEnvironmentId, targetsForEnvironment } from "./environments.js";
import { readSetupProgress } from "./setup-progress.js";
import { readMcpSettings, resolveMcpSettingValues } from "./mcp-settings.js";

const REQUIRED_CAPABILITIES = ["ticketing", "documentation", "observability", "database", "deployments"];
const REQUIRED_GITIGNORE_ENTRIES = [
  ".investigator/discovery.json",
  ".investigator/cases/",
  ".investigator/memory/drafts/",
  ".rooty/memory/drafts/",
  ".rooty/state/active-environments.json",
  ".rooty/state/setup-progress.json",
  ".rooty/config/mcp-settings.local.json",
  ".rooty-cases/"
];

const PACKAGE_CHECK_NAMES = new Set(["skill", "connector-recipes", "mcp-tools", "mcp-startup", "replay-suite", "gitignore"]);

function section(status, checks) {
  return { status, ok: status === "READY", checks };
}

function statusFor(checks, notChecked = false) {
  if (notChecked) return "NOT_CHECKED";
  return checks.some((check) => check.status === "FAIL") ? "NOT_READY" : "READY";
}

export async function runDoctor({ packageRoot, projectRoot, connectorTimeoutMs = 3000, requireActivatedConnectors = true, packageOnly, host, environment }) {
  const onlyPackage = packageOnly ?? !requireActivatedConnectors;
  const packageManifest = await readJson(path.join(packageRoot, "package.json"));
  const packageLegacy = await runCompatibilityDoctor({ packageRoot, projectRoot: packageRoot, connectorTimeoutMs, requireActivatedConnectors: false });
  const packageChecks = [
    { status: "PASS", name: "package-version", message: `${packageManifest.name}@${packageManifest.version}` },
    { status: Number(process.versions.node.split(".")[0]) >= 20 ? "PASS" : "FAIL", name: "node-version", message: `Node ${process.versions.node}; Rooty requires Node 20 or newer` },
    ...packageLegacy.checks.filter((check) => PACKAGE_CHECK_NAMES.has(check.name))
  ];
  if (onlyPackage) {
    const sections = {
      package: section(statusFor(packageChecks), packageChecks),
      project: section("NOT_CHECKED", []),
      investigation: section("NOT_CHECKED", [])
    };
    return { ok: sections.package.ok, version: { cli: packageManifest.version }, sections, checks: packageChecks.map((check) => ({ ...check, section: "package" })) };
  }

  const setupModel = await detectSetupModel(projectRoot);
  let projectChecks = [];
  let investigationChecks = [];
  let projectVersion;
  if (["agent-led-v3", "invalid-agent-led-install"].includes(setupModel)) {
    const installation = await inspectRootyInstall(projectRoot);
    projectChecks.push(...installation.checks.map((check) => check.name === "documentation-context" && check.status === "WARN"
      ? { ...check, status: "FAIL", message: `${check.message}. Confirm paths with \`rooty context set-docs --paths ...\` or explicitly confirm none with \`--none\`.` }
      : check));
    projectVersion = installation.checks.find((check) => check.name === "install-manifest")?.message.match(/Rooty ([^ ]+)/)?.[1];
    if (projectVersion && projectVersion !== packageManifest.version) {
      projectChecks.push({ status: "WARN", name: "project-version", message: `Project skills were installed by Rooty ${projectVersion}; executing CLI is ${packageManifest.version}. Re-run \`rooty install\`.` });
    } else if (projectVersion) projectChecks.push({ status: "PASS", name: "project-version", message: `Project and CLI both use Rooty ${packageManifest.version}` });
    try {
      const progress = await readSetupProgress(projectRoot);
      projectChecks.push({ status: progress.status === "paused" ? "WARN" : "PASS", name: "setup-progress", message: progress.status === "paused" ? `Setup paused at ${progress.stage}: ${progress.pause?.reason}` : `Setup progress is ${progress.status} at ${progress.stage}` });
    } catch (error) {
      projectChecks.push({ status: "FAIL", name: "setup-progress", message: error.message });
    }
    try {
      const environmentProject = await inspectEnvironmentProject(projectRoot, host);
      projectChecks.push(...environmentProject.checks);
      if (!environmentProject.checks.some((check) => check.name.endsWith("host-mcp-config"))) {
        const candidateHosts = host ? [host] : installation.hosts;
        const paths = candidateHosts.filter((candidate) => ROOTY_HOSTS[candidate]).map((candidate) => ROOTY_HOSTS[candidate].mcpConfig);
        projectChecks.push({ status: "FAIL", name: "host-mcp-config", message: `No active Rooty host MCP config is confirmed; expected one of: ${paths.join(", ") || "an installed host config"}` });
      }
    } catch (error) {
      projectChecks.push({ status: "FAIL", name: "environment-configuration", message: error.message });
    }
    const projectReady = !projectChecks.some((check) => check.status === "FAIL");
    if (!projectReady) {
      investigationChecks.push({ status: "FAIL", name: "investigation-blocked", message: "Project configuration is incomplete; live environment probes were not run" });
    } else {
      investigationChecks = await runAgentLedInvestigationChecks({ projectRoot, host, environment, connectorTimeoutMs });
    }
  } else {
    const strict = await runCompatibilityDoctor({ packageRoot, projectRoot, connectorTimeoutMs, requireActivatedConnectors: true });
    const packageNames = new Set(packageChecks.map((check) => check.name));
    for (const check of strict.checks) {
      if (packageNames.has(check.name)) continue;
      if (["source-registry", "case-location", "gitignore"].includes(check.name)) projectChecks.push(check);
      else investigationChecks.push(check);
    }
  }
  const sections = {
    package: section(statusFor(packageChecks), packageChecks),
    project: section(statusFor(projectChecks), projectChecks),
    investigation: section(statusFor(investigationChecks), investigationChecks)
  };
  const checks = Object.entries(sections).flatMap(([name, value]) => value.checks.map((check) => ({ ...check, section: name })));
  const result = {
    ok: sections.package.ok && sections.project.ok && sections.investigation.ok,
    setupModel,
    version: { cli: packageManifest.version, ...(projectVersion ? { project_install: projectVersion } : {}) },
    sections,
    checks
  };
  if (result.ok && setupModel === "agent-led-v3") {
    const active = await readActiveEnvironments(projectRoot);
    const hosts = host ? [host] : Object.keys(active.hosts).sort();
    result.identity_verifications = [];
    for (const targetHost of hosts) {
      const identity = await buildLockedEnvironmentIdentity({ projectRoot, host: targetHost, environment });
      const artifact = { ...identity, verified_at: isoNow(), status: "READY" };
      artifact.verification_hash = fingerprint(artifact);
      result.identity_verifications.push(artifact);
    }
  }
  return result;
}

async function runCompatibilityDoctor({ packageRoot, projectRoot, connectorTimeoutMs = 3000, requireActivatedConnectors = true }) {
  const setupModel = await detectSetupModel(projectRoot);
  const checks = [];
  const add = (status, name, message) => checks.push({ status, name, message });
  const missingSkills = [];
  for (const skill of ROOTY_SKILLS) {
    const canonical = path.join(projectRoot, `.agents/skills/${skill}/SKILL.md`);
    const packaged = path.join(packageRoot, `skill/${skill}/SKILL.md`);
    if (!await pathExists(canonical) && !await pathExists(packaged)) missingSkills.push(skill);
  }
  if (missingSkills.length === 0) add("PASS", "skill", `${ROOTY_SKILLS.length} Rooty skills are discoverable or packaged`);
  else add("FAIL", "skill", `Missing skills: ${missingSkills.join(", ")}`);

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
  } else add(requireActivatedConnectors ? "FAIL" : "WARN", "source-registry", requireActivatedConnectors
    ? "Advanced source registry is missing"
    : "Advanced compatibility source registry is not configured");

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
  } else add(requireActivatedConnectors ? "FAIL" : "WARN", "activated-connectors", requireActivatedConnectors
    ? "No production connectors are activated"
    : "No advanced compatibility connectors are activated");

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

function resolveEnvironmentValue(value) {
  if (typeof value !== "string") return value;
  return value.replace(/\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}/g, (match, name) => {
    if (!process.env[name]) throw new Error(`Credential environment variable is unavailable: ${name}`);
    return process.env[name];
  });
}

function environmentForEntry(entry) {
  const env = minimalRuntimeEnvironment();
  for (const name of entry.env_vars ?? []) {
    const variable = typeof name === "string" ? name : name?.name;
    if (variable && !process.env[variable]) throw new Error(`Credential environment variable is unavailable: ${variable}`);
    if (variable) env[variable] = process.env[variable];
  }
  for (const [key, value] of Object.entries(entry.env ?? {})) env[key] = resolveEnvironmentValue(value);
  return env;
}

function headersForEntry(entry) {
  return Object.fromEntries(Object.entries(entry.headers ?? {}).map(([key, value]) => [key, resolveEnvironmentValue(value)]));
}

async function runAgentLedInvestigationChecks({ projectRoot, host, environment, connectorTimeoutMs }) {
  const checks = [];
  const profiles = await readEnvironmentProfiles(projectRoot);
  const mcpSettings = await readMcpSettings(projectRoot, { required: false });
  const requestedEnvironment = environment ? resolveEnvironmentId(profiles, environment) : undefined;
  const active = await readActiveEnvironments(projectRoot);
  const hosts = host ? [host] : Object.keys(active.hosts);
  if (!hosts.length) return [{ status: "FAIL", name: "active-environment", message: "No active environment is recorded for any host" }];
  for (const targetHost of hosts) {
    if (!ROOTY_HOSTS[targetHost]) {
      checks.push({ status: "FAIL", name: `${targetHost}-environment`, message: "Unsupported host" });
      continue;
    }
    const activeEnvironment = active.hosts[targetHost]?.environment;
    if (!activeEnvironment) {
      checks.push({ status: "FAIL", name: `${targetHost}-environment`, message: "No active environment is recorded" });
      continue;
    }
    if (requestedEnvironment && requestedEnvironment !== activeEnvironment) {
      checks.push({ status: "FAIL", name: `${targetHost}-environment`, message: `Requested ${requestedEnvironment}, but the host configuration targets ${activeEnvironment}` });
      continue;
    }
    const selection = targetsForEnvironment(profiles, activeEnvironment, targetHost);
    for (const missing of selection.missing) checks.push({ status: "FAIL", name: `${targetHost}-environment-coverage`, message: missing });
    for (const capability of ["data", "observability"]) {
      if (!selection.targets.some((item) => item.capability === capability)) {
        checks.push({ status: "FAIL", name: `${targetHost}-${capability}-coverage`, message: `No ${activeEnvironment} ${capability} MCP target is configured` });
      }
    }
    for (const item of selection.targets) {
      const prefix = `${targetHost}-${item.target.name}`;
      const missingArtifacts = [];
      for (const relative of item.target.artifacts ?? []) {
        const file = path.resolve(projectRoot, relative);
        if (!await pathExists(file)) missingArtifacts.push(relative);
      }
      if (missingArtifacts.length) {
        checks.push({ status: "FAIL", name: `${prefix}-artifacts`, message: `Missing provider artifacts: ${missingArtifacts.join(", ")}` });
        continue;
      }
      const missingSettings = resolveMcpSettingValues(mcpSettings, item.target.settings_keys ?? []).missing;
      if (missingSettings.length) {
        checks.push({ status: "FAIL", name: `${prefix}-settings`, message: `MCP settings are unavailable: ${missingSettings.join(", ")}` });
        continue;
      }
      if (!Array.isArray(item.target.allowed_tools) || !item.target.allowed_tools.length || !item.target.probe?.tool || !item.target.probe?.expect_contains) {
        checks.push({ status: "FAIL", name: `${prefix}-probe-definition`, message: "A reviewed tool allowlist and environment identity probe with expect_contains are required" });
        continue;
      }
      let client;
      try {
        if (item.entry.url) {
          client = new HttpMcpClient({
            name: item.target.name,
            endpoint: resolveEnvironmentValue(item.entry.url),
            auth: "none",
            headers: headersForEntry(item.entry),
            allowed_tools: item.target.allowed_tools,
            doctor_probe: item.target.probe
          }, connectorTimeoutMs);
        } else {
          client = new StdioMcpClient(item.entry, connectorTimeoutMs);
        }
        checks.push(...await probeMcpTarget(client, item.target, prefix, activeEnvironment));
      } catch (error) {
        checks.push({ status: "FAIL", name: `${prefix}-initialize`, message: error.message });
      } finally {
        await client?.close?.();
      }
    }
  }
  return checks;
}

async function probeMcpTarget(client, target, prefix, environment) {
  const checks = [];
  try {
    const initialized = await client.initialize();
    checks.push({ status: "PASS", name: `${prefix}-initialize`, message: `MCP initialized for ${environment} using ${initialized.protocolVersion ?? "a negotiated protocol"}` });
  } catch (error) {
    return [{ status: "FAIL", name: `${prefix}-initialize`, message: error.message }];
  }
  let tools;
  try {
    tools = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    const allowed = [...target.allowed_tools].sort();
    const mutation = names.filter((name) => /(create|update|delete|write|execute|rollback|deploy|mutate)/i.test(name));
    const missing = allowed.filter((name) => !names.includes(name));
    const unexpected = names.filter((name) => !allowed.includes(name));
    if (mutation.length || missing.length || unexpected.length) {
      throw new Error(`Tool surface differs from the reviewed allowlist; missing=[${missing.join(", ")}], unexpected=[${unexpected.join(", ")}], mutation=[${mutation.join(", ")}]`);
    }
    checks.push({ status: "PASS", name: `${prefix}-tools`, message: `${names.length} advertised tools exactly match the reviewed read-only allowlist` });
  } catch (error) {
    checks.push({ status: "FAIL", name: `${prefix}-tools`, message: error.message });
    return checks;
  }
  try {
    const result = await client.callTool(target.probe.tool, target.probe.arguments ?? {});
    if (result?.isError === true) throw new Error(`Identity probe returned an MCP tool error from ${target.probe.tool}`);
    const serialized = JSON.stringify(result);
    if (!serialized.includes(target.probe.expect_contains)) throw new Error(`Probe did not confirm ${environment}; expected marker ${JSON.stringify(target.probe.expect_contains)}`);
    checks.push({ status: "PASS", name: `${prefix}-identity-read`, message: `${target.probe.tool} completed a bounded read and confirmed ${environment}` });
  } catch (error) {
    checks.push({ status: "FAIL", name: `${prefix}-identity-read`, message: error.message });
  }
  return checks;
}

class StdioMcpClient {
  constructor(entry, timeoutMs) {
    this.entry = entry;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
  }

  start() {
    if (this.child) return;
    this.child = spawn(this.entry.command, this.entry.args ?? [], {
      cwd: this.entry.cwd,
      env: environmentForEntry(this.entry),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString();
      let newline;
      while ((newline = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); }
        catch { continue; }
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`MCP error: ${message.error.message ?? JSON.stringify(message.error)}`));
        else pending.resolve(message.result);
      }
    });
    this.child.once("error", (error) => this.rejectAll(new Error(`MCP process failed to start: ${error.message}`)));
    this.child.once("exit", (code) => this.rejectAll(new Error(`MCP process exited before completing the probe (code ${code})`)));
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  request(method, params) {
    this.start();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP ${method} timed out after ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method, params) {
    this.start();
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async initialize() {
    const result = await this.request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "rooty-doctor", version: "1" } });
    this.notify("notifications/initialized", {});
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

  close() {
    this.child?.kill();
  }
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
      ...(this.connector.headers ?? {}),
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
    child.on("error", (error) => finish(error));
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
