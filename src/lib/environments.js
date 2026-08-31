import { createHash } from "node:crypto";
import { lstat, readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { assertNoEmbeddedSecrets, fingerprint } from "./core.js";
import { inspectRootyInstall, ROOTY_HOSTS, ROOTY_HOST_IDS } from "./installer.js";
import { hasMcpSetting, MCP_SETTINGS_ENV_KEY_PATTERN, MCP_SETTINGS_KEY_PATTERN, MCP_SETTINGS_PATH, readMcpSettings, resolveMcpSettingValues } from "./mcp-settings.js";
import { atomicWriteJson, atomicWriteText, assertNoSymlinkPath, ensureProjectPath, readOptionalJson, readOptionalText, resolveProjectRoot } from "./project-state.js";
import { readSetupProgress } from "./setup-progress.js";

export const ENVIRONMENT_PROFILES_PATH = ".rooty/config/environment-profiles.json";
export const ACTIVE_ENVIRONMENTS_PATH = ".rooty/state/active-environments.json";
const ENVIRONMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOGICAL_SERVER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MCP_NAME_PATTERN = /^rooty-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_DISCOVERY_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".json", ".jsonc", ".yaml", ".yml", ".toml", ".xml", ".props", ".csproj"]);
const SKIPPED_DIRECTORIES = new Set([".git", ".agents", ".rooty", "node_modules", "dist", "build", "coverage", ".next", "vendor", "bin", "obj", "memory"]);
const SENSITIVE_PATH = /(^|[._-])(secret|secrets|credential|credentials|password|token|private|\.env)([._-]|$)/i;
const ENVIRONMENT_TERMS = Object.freeze([
  { id: "production", aliases: ["production", "prod"] },
  { id: "preprod", aliases: ["preprod", "pre-production", "preproduction"] },
  { id: "staging", aliases: ["staging", "stage"] },
  { id: "qa", aliases: ["qa", "quality-assurance"] },
  { id: "development", aliases: ["development", "dev"] }
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function slash(value) {
  return value.split(path.sep).join("/");
}

function validateStringArray(value, name) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error(`Invalid ${name}`);
}

function walkValues(value, visit, trail = "profile") {
  if (Array.isArray(value)) return value.forEach((item, index) => walkValues(item, visit, `${trail}[${index}]`));
  if (!value || typeof value !== "object") return visit(value, trail);
  for (const [key, child] of Object.entries(value)) walkValues(child, visit, `${trail}.${key}`);
}

function assertSafeProfileValues(profile) {
  assertNoEmbeddedSecrets(profile, "environment-profiles");
  walkValues(profile, (value, trail) => {
    if (typeof value !== "string") return;
    if (/https?:\/\/[^\s/@]+:[^\s/@]+@/i.test(value)) throw new Error(`Embedded URL credentials are forbidden at ${trail}`);
    if (/-----BEGIN [A-Z ]+PRIVATE KEY-----/.test(value)) throw new Error(`Embedded private key is forbidden at ${trail}`);
  });
}

function validateHostEntry(entry, host, location) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`Invalid host entry at ${location}.${host}`);
  if (host === "codex") {
    if (!entry.command && !entry.url) throw new Error(`Codex entry requires command or url at ${location}`);
  } else if (!entry.command && !entry.url) throw new Error(`${ROOTY_HOSTS[host].label} entry requires command or url at ${location}`);
  if (entry.command !== undefined && typeof entry.command !== "string") throw new Error(`Invalid command at ${location}.${host}`);
  if (entry.url !== undefined) {
    if (typeof entry.url !== "string") throw new Error(`Invalid url at ${location}.${host}`);
    const interpolation = /\$\{[^}]+\}/.test(entry.url);
    if (!interpolation) {
      let parsed;
      try { parsed = new URL(entry.url); }
      catch { throw new Error(`Invalid MCP URL at ${location}.${host}`); }
      if (parsed.username || parsed.password) throw new Error(`MCP URL must not contain credentials at ${location}.${host}`);
    }
  }
  if (entry.args !== undefined) validateStringArray(entry.args, `${location}.${host}.args`);
  for (const [key, value] of Object.entries(entry.headers ?? {})) {
    if (/authorization|api[-_]?key/i.test(key) && typeof value === "string" && !/\$\{[^}]+\}/.test(value)) {
      throw new Error(`Credential header must use environment interpolation at ${location}.${host}.${key}`);
    }
  }
}

function validateSettingsBackedEntry(entry, keys, location) {
  if (!keys.length) return;
  if (entry.url) throw new Error(`Settings-backed host entry must use the Rooty stdio launcher at ${location}`);
  if (entry.env_vars?.length) throw new Error(`Machine env_vars are forbidden for settings-backed entry at ${location}`);
  if (entry.env && Object.keys(entry.env).length) throw new Error(`Host env is forbidden for settings-backed entry at ${location}`);
  if (entry.headers && Object.keys(entry.headers).length) throw new Error(`Host headers are forbidden for settings-backed entry at ${location}`);
  if (entry.bearer_token_env_var || entry.env_http_headers) throw new Error(`Host environment authentication is forbidden for settings-backed entry at ${location}`);
  const args = entry.args ?? [];
  const launcher = String(args[0] ?? "").replaceAll("\\", "/").toLowerCase();
  if (!launcher.endsWith("/.rooty/start-mcp.cjs")) throw new Error(`Settings-backed entry must invoke .rooty/start-mcp.cjs at ${location}`);
  const settingsIndex = args.indexOf("--settings");
  const settingsPath = String(args[settingsIndex + 1] ?? "").replaceAll("\\", "/").toLowerCase();
  if (settingsIndex < 0 || !settingsPath.endsWith(`/${MCP_SETTINGS_PATH}`)) throw new Error(`Settings-backed entry must reference ${MCP_SETTINGS_PATH} at ${location}`);
  const keysIndex = args.indexOf("--keys");
  const bindings = String(args[keysIndex + 1] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (bindings.some((binding) => {
    const parts = binding.split("=");
    return parts.length > 2 || !MCP_SETTINGS_KEY_PATTERN.test(parts[0])
      || (parts.length === 2 && !MCP_SETTINGS_ENV_KEY_PATTERN.test(parts[1]));
  })) throw new Error(`Settings-backed entry has invalid key bindings at ${location}`);
  const declared = new Set(bindings.map((item) => item.split("=")[0]));
  const missing = keys.filter((key) => !declared.has(key));
  const extra = [...declared].filter((key) => !keys.includes(key));
  if (keysIndex < 0 || missing.length || extra.length) throw new Error(`Settings-backed entry keys must exactly match settings_keys at ${location}; missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}`);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--header") continue;
    const header = String(args[index + 1] ?? "");
    if (/^(authorization|api[-_]?key)\s*:/i.test(header) && !keys.some((key) => header.includes(`\${${key}}`))) {
      throw new Error(`Credential header must reference a declared JSON setting key at ${location}`);
    }
  }
}

export function validateEnvironmentProfiles(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile) || profile.schema_version !== 1) {
    throw new Error("Invalid environment profile schema");
  }
  if (!profile.environments || typeof profile.environments !== "object" || Array.isArray(profile.environments)) {
    throw new Error("Environment profiles require an environments object");
  }
  if (!profile.logical_servers || typeof profile.logical_servers !== "object" || Array.isArray(profile.logical_servers)) {
    throw new Error("Environment profiles require a logical_servers object");
  }
  for (const [environment, definition] of Object.entries(profile.environments)) {
    if (!ENVIRONMENT_PATTERN.test(environment)) throw new Error(`Invalid environment id: ${environment}`);
    if (!definition || typeof definition !== "object" || !["production", "non-production"].includes(definition.classification)) {
      throw new Error(`Environment ${environment} requires a classification`);
    }
    validateStringArray(definition.aliases, `environment ${environment} aliases`);
  }
  const renderedNames = new Map();
  const environmentTokens = new Map();
  for (const [environment, definition] of Object.entries(profile.environments)) {
    for (const token of [environment, ...(definition.aliases ?? [])].map((value) => value.toLowerCase())) {
      const owner = environmentTokens.get(token);
      if (owner && owner !== environment) throw new Error(`Environment alias ${token} is ambiguous between ${owner} and ${environment}`);
      environmentTokens.set(token, environment);
    }
  }
  for (const [logicalId, server] of Object.entries(profile.logical_servers)) {
    if (!LOGICAL_SERVER_PATTERN.test(logicalId)) throw new Error(`Invalid logical server id: ${logicalId}`);
    if (!server || typeof server !== "object" || typeof server.capability !== "string" || !server.capability) {
      throw new Error(`Logical server ${logicalId} requires a capability`);
    }
    if (!server.targets || typeof server.targets !== "object" || Array.isArray(server.targets)) throw new Error(`Logical server ${logicalId} requires targets`);
    for (const [environment, target] of Object.entries(server.targets)) {
      if (!profile.environments[environment]) throw new Error(`Logical server ${logicalId} references unknown environment ${environment}`);
      if (!target || typeof target !== "object" || !MCP_NAME_PATTERN.test(target.name ?? "")) throw new Error(`Invalid MCP name for ${logicalId}.${environment}`);
      const visibleTokens = new Set([environment, ...(profile.environments[environment].aliases ?? [])].map((value) => value.replace(/[^a-z0-9]+/g, "-")));
      if (![...visibleTokens].some((token) => target.name.includes(`-${token}-`) || target.name.endsWith(`-${token}`))) {
        throw new Error(`MCP name ${target.name} must visibly identify environment ${environment}`);
      }
      validateStringArray(target.artifacts, `${logicalId}.${environment}.artifacts`);
      if ((target.credential_envs ?? []).length) throw new Error(`Legacy credential_envs are unsupported for ${logicalId}.${environment}; use settings_keys and ${MCP_SETTINGS_PATH}`);
      validateStringArray(target.settings_keys, `${logicalId}.${environment}.settings_keys`);
      if ((target.settings_keys ?? []).some((key) => !MCP_SETTINGS_KEY_PATTERN.test(key))) throw new Error(`Invalid MCP setting key for ${logicalId}.${environment}`);
      validateStringArray(target.allowed_tools, `${logicalId}.${environment}.allowed_tools`);
      if (!target.hosts || typeof target.hosts !== "object" || Array.isArray(target.hosts)) throw new Error(`Target ${logicalId}.${environment} requires hosts`);
      for (const [host, entry] of Object.entries(target.hosts)) {
        if (!ROOTY_HOST_IDS.includes(host)) throw new Error(`Unsupported host ${host} in ${logicalId}.${environment}`);
        validateHostEntry(entry, host, `${logicalId}.${environment}.hosts`);
        validateSettingsBackedEntry(entry, target.settings_keys ?? [], `${logicalId}.${environment}.${host}`);
        if (!(target.settings_keys ?? []).length && (entry.env_vars?.length || /\$\{(?:env:)?[A-Za-z_][A-Za-z0-9_]*\}/.test(JSON.stringify(entry)))) {
          throw new Error(`Machine environment interpolation is unsupported at ${logicalId}.${environment}.${host}; use settings_keys and ${MCP_SETTINGS_PATH}`);
        }
        const key = `${host}:${target.name}`;
        if (renderedNames.has(key)) throw new Error(`Duplicate rendered MCP name ${target.name} for ${host}; every logical environment target needs a distinct name`);
        renderedNames.set(key, `${logicalId}/${environment}`);
      }
      if (target.probe !== undefined && (typeof target.probe?.tool !== "string" || !target.probe.tool)) {
        throw new Error(`Invalid probe for ${logicalId}.${environment}`);
      }
    }
  }
  assertSafeProfileValues(profile);
  return profile;
}

export function resolveEnvironmentId(profiles, requested) {
  const token = String(requested).trim().toLowerCase();
  if (profiles.environments[token]) return token;
  const matches = Object.entries(profiles.environments)
    .filter(([, definition]) => (definition.aliases ?? []).some((alias) => alias.toLowerCase() === token))
    .map(([environment]) => environment);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`Environment alias is ambiguous: ${requested}`);
  throw new Error(`Unknown environment: ${requested}`);
}

export async function readEnvironmentProfiles(projectRoot, { required = true } = {}) {
  const resolved = await resolveProjectRoot(projectRoot);
  const file = path.join(resolved, ENVIRONMENT_PROFILES_PATH);
  const profile = await readOptionalJson(file);
  if (!profile && required) throw new Error(`Environment profiles are missing: ${file}`);
  return profile ? validateEnvironmentProfiles(profile) : undefined;
}

export async function configureEnvironmentProfiles({ projectRoot, sourceFile }) {
  const resolved = await resolveProjectRoot(projectRoot);
  const source = JSON.parse(await readFile(path.resolve(sourceFile), "utf8"));
  validateEnvironmentProfiles(source);
  const file = path.join(resolved, ENVIRONMENT_PROFILES_PATH);
  await assertNoSymlinkPath(resolved, file);
  await atomicWriteJson(file, source);
  return { file, profiles: source };
}

function validateActiveState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state) || state.schema_version !== 1 || typeof state.hosts !== "object") {
    throw new Error("Invalid active environment state");
  }
  for (const [host, value] of Object.entries(state.hosts)) {
    if (!ROOTY_HOST_IDS.includes(host) || !value || typeof value.environment !== "string") throw new Error(`Invalid active environment host: ${host}`);
  }
  return state;
}

export async function readActiveEnvironments(projectRoot) {
  const resolved = await resolveProjectRoot(projectRoot);
  const state = await readOptionalJson(path.join(resolved, ACTIVE_ENVIRONMENTS_PATH));
  return state ? validateActiveState(state) : { schema_version: 1, hosts: {} };
}

function allManagedNames(profiles) {
  const names = new Set();
  for (const server of Object.values(profiles.logical_servers)) {
    for (const target of Object.values(server.targets)) names.add(target.name);
  }
  return names;
}

function parseJsonHost(text, file) {
  let parsed;
  try { parsed = text === undefined ? { mcpServers: {} } : JSON.parse(text); }
  catch (error) { throw new Error(`Cannot safely merge malformed MCP JSON ${file}: ${error.message}`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`MCP configuration must be an object: ${file}`);
  if (parsed.mcpServers === undefined) parsed.mcpServers = {};
  if (!parsed.mcpServers || typeof parsed.mcpServers !== "object" || Array.isArray(parsed.mcpServers)) throw new Error(`mcpServers must be an object: ${file}`);
  return parsed;
}

function tomlHeaderName(line) {
  const match = /^\s*\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))(?:\.[^\]]+)?\]\s*$/.exec(line);
  return match ? (match[1] ?? match[2]) : undefined;
}

function removeManagedToml(text, managedNames) {
  const lines = (text ?? "").split(/\r?\n/);
  const output = [];
  let removing = false;
  const found = new Set();
  for (const line of lines) {
    const anyTable = /^\s*\[[^\]]+\]\s*$/.test(line);
    if (anyTable) {
      const name = tomlHeaderName(line);
      removing = Boolean(name && managedNames.has(name));
      if (removing) found.add(name);
    }
    if (!removing) output.push(line);
  }
  return { text: output.join("\n").replace(/\s+$/, ""), found };
}

function extractManagedToml(text, managedNames) {
  const entries = new Map();
  let name;
  let lines = [];
  const flush = () => {
    if (name) entries.set(name, lines.join("\n").trim());
    name = undefined;
    lines = [];
  };
  for (const line of (text ?? "").split(/\r?\n/)) {
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) {
      const nextName = tomlHeaderName(line);
      if (nextName !== name) flush();
      if (nextName && managedNames.has(nextName)) name = nextName;
    }
    if (name) lines.push(line);
  }
  flush();
  return entries;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
}

function entriesEqual(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function tomlValue(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(", ")}]`;
  throw new Error(`Unsupported Codex MCP value: ${JSON.stringify(value)}`);
}

function renderCodexEntry(name, entry) {
  const nested = [];
  const lines = [`[mcp_servers.${JSON.stringify(name)}]`];
  for (const [key, value] of Object.entries(entry)) {
    if (value === undefined) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) nested.push([key, value]);
    else lines.push(`${key} = ${tomlValue(value)}`);
  }
  for (const [key, value] of nested) {
    lines.push("", `[mcp_servers.${JSON.stringify(name)}.${key}]`);
    for (const [nestedKey, nestedValue] of Object.entries(value)) lines.push(`${nestedKey} = ${tomlValue(nestedValue)}`);
  }
  return lines.join("\n");
}

async function currentManagedNames(projectRoot, host, profiles) {
  const file = path.join(projectRoot, ROOTY_HOSTS[host].mcpConfig);
  const text = await readOptionalText(file);
  const managed = allManagedNames(profiles);
  if (host === "codex") {
    const entries = extractManagedToml(text, managed);
    return { file, text, entries, names: new Set(entries.keys()) };
  }
  const parsed = parseJsonHost(text, file);
  return { file, text, parsed, names: new Set(Object.keys(parsed.mcpServers).filter((name) => managed.has(name))) };
}

async function inferHosts(projectRoot, profiles, explicitHost, allHosts) {
  if (explicitHost !== undefined) {
    if (!ROOTY_HOST_IDS.includes(explicitHost)) throw new Error(`Unsupported host: ${explicitHost}`);
    return [explicitHost];
  }
  const configured = [];
  for (const host of ROOTY_HOST_IDS) {
    if ((await currentManagedNames(projectRoot, host, profiles)).names.size) configured.push(host);
  }
  if (allHosts) {
    if (configured.length) return configured;
    const install = await inspectRootyInstall(projectRoot);
    if (!install.ok) throw new Error("Cannot infer hosts until Rooty installation is healthy");
    return install.hosts;
  }
  if (configured.length === 1) return configured;
  if (configured.length > 1) throw new Error(`Multiple configured hosts found: ${configured.join(", ")}. Use --host or --all-hosts.`);
  const progress = await readSetupProgress(projectRoot);
  if (progress.active_host) return [progress.active_host];
  const install = await inspectRootyInstall(projectRoot);
  if (!install.ok) throw new Error("Cannot infer a host until Rooty installation is healthy");
  if (install.hosts.length === 1) return install.hosts;
  throw new Error(`Multiple installed hosts found: ${install.hosts.join(", ")}. Use --host.`);
}

function selectedTargets(profiles, environment, host) {
  const targets = [];
  const missing = [];
  for (const [logicalId, server] of Object.entries(profiles.logical_servers)) {
    const target = server.targets[environment];
    if (!target) {
      if (server.required !== false) missing.push(`${logicalId}: no ${environment} target`);
      continue;
    }
    const entry = target.hosts[host];
    if (!entry) {
      if (server.required !== false) missing.push(`${logicalId}: no ${host} rendering for ${environment}`);
      continue;
    }
    targets.push({ logicalId, capability: server.capability, required: server.required !== false, target, entry });
  }
  return { targets, missing };
}

async function validateTargetRuntime(projectRoot, selected) {
  const missingArtifacts = [];
  const requiredKeys = selected.flatMap((item) => item.target.settings_keys ?? []);
  const settings = requiredKeys.length ? await readMcpSettings(projectRoot, { required: false }) : undefined;
  const missingSettings = resolveMcpSettingValues(settings, requiredKeys).missing;
  for (const item of selected) {
    for (const artifact of item.target.artifacts ?? []) {
      const file = ensureProjectPath(projectRoot, path.resolve(projectRoot, artifact));
      try {
        const details = await lstat(file);
        if (!details.isFile() || details.isSymbolicLink()) missingArtifacts.push(artifact);
      } catch (error) {
        if (error?.code === "ENOENT") missingArtifacts.push(artifact);
        else throw error;
      }
    }
  }
  return { missingArtifacts: [...new Set(missingArtifacts)], missingSettings: [...new Set(missingSettings)] };
}

export async function planEnvironmentSwitch({ projectRoot, environment, host, allHosts = false }) {
  const resolved = await resolveProjectRoot(projectRoot);
  const profiles = await readEnvironmentProfiles(resolved);
  const canonical = resolveEnvironmentId(profiles, environment);
  const hosts = await inferHosts(resolved, profiles, host, allHosts);
  const active = await readActiveEnvironments(resolved);
  const plans = [];
  for (const targetHost of hosts) {
    const current = await currentManagedNames(resolved, targetHost, profiles);
    const selection = selectedTargets(profiles, canonical, targetHost);
    const runtime = await validateTargetRuntime(resolved, selection.targets);
    const desiredNames = selection.targets.map((item) => item.target.name);
    const removed = [...current.names].filter((name) => !desiredNames.includes(name)).sort();
    const added = desiredNames.filter((name) => !current.names.has(name)).sort();
    plans.push({
      host: targetHost,
      config_file: current.file,
      current_environment: active.hosts[targetHost]?.environment,
      target_environment: canonical,
      removed,
      added,
      retained: desiredNames.filter((name) => current.names.has(name)).sort(),
      missing: [...selection.missing, ...runtime.missingArtifacts.map((item) => `missing artifact: ${item}`), ...runtime.missingSettings.map((item) => `missing MCP setting: ${item}`)],
      targets: selection.targets
    });
  }
  return {
    ok: plans.every((plan) => plan.missing.length === 0),
    project: resolved,
    environment: canonical,
    hosts,
    plans
  };
}

function renderHostConfig(plan, existingText, profiles) {
  const managed = allManagedNames(profiles);
  if (plan.host === "codex") {
    const clean = removeManagedToml(existingText, managed).text;
    const blocks = plan.targets.map((item) => renderCodexEntry(item.target.name, item.entry));
    return `${[clean, ...blocks].filter(Boolean).join("\n\n")}\n`;
  }
  const parsed = parseJsonHost(existingText, plan.config_file);
  for (const name of managed) delete parsed.mcpServers[name];
  for (const item of plan.targets) parsed.mcpServers[item.target.name] = item.entry;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export async function useEnvironment({ projectRoot, environment, host, allHosts = false }) {
  const plan = await planEnvironmentSwitch({ projectRoot, environment, host, allHosts });
  if (!plan.ok) throw new Error(`Environment switch is blocked:\n${plan.plans.flatMap((item) => item.missing.map((message) => `  ${item.host}: ${message}`)).join("\n")}`);
  const profiles = await readEnvironmentProfiles(plan.project);
  const originals = new Map();
  const rendered = new Map();
  for (const hostPlan of plan.plans) {
    const existing = await readOptionalText(hostPlan.config_file);
    originals.set(hostPlan.config_file, existing);
    rendered.set(hostPlan.config_file, renderHostConfig(hostPlan, existing, profiles));
    await assertNoSymlinkPath(plan.project, hostPlan.config_file);
  }
  const state = await readActiveEnvironments(plan.project);
  for (const hostPlan of plan.plans) {
    const content = rendered.get(hostPlan.config_file);
    state.hosts[hostPlan.host] = {
      environment: plan.environment,
      status: "APPLIED_PENDING_RELOAD",
      changed_at: new Date().toISOString(),
      configuration_generation: sha256(content),
      managed_entries: hostPlan.targets.map((item) => item.target.name).sort()
    };
  }
  const stateFile = path.join(plan.project, ACTIVE_ENVIRONMENTS_PATH);
  const originalState = await readOptionalText(stateFile);
  await assertNoSymlinkPath(plan.project, stateFile);
  const written = [];
  try {
    for (const [file, content] of rendered) {
      await atomicWriteText(file, content);
      written.push(file);
    }
    await atomicWriteJson(stateFile, state);
  } catch (error) {
    for (const file of written.reverse()) {
      const original = originals.get(file);
      if (original !== undefined) await atomicWriteText(file, original);
      else {
        try { await unlink(file); }
        catch (restoreError) { if (restoreError?.code !== "ENOENT") throw restoreError; }
      }
    }
    if (originalState !== undefined) await atomicWriteText(stateFile, originalState);
    else {
      try { await unlink(stateFile); }
      catch (restoreError) { if (restoreError?.code !== "ENOENT") throw restoreError; }
    }
    throw error;
  }
  return { ...plan, state_file: stateFile, status: "APPLIED_PENDING_RELOAD" };
}

function termRegex(alias) {
  return new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
}

export async function discoverEnvironments({ projectRoot, maxFiles = 500, maxFileBytes = 262144 }) {
  const resolved = await resolveProjectRoot(projectRoot);
  const evidence = new Map(ENVIRONMENT_TERMS.map((item) => [item.id, new Set()]));
  const warnings = [];
  let scanned = 0;
  async function visit(directory, prefix = "") {
    if (scanned >= maxFiles) return;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (scanned >= maxFiles) break;
      const relative = path.join(prefix, entry.name);
      const relativeSlash = slash(relative);
      if (entry.isSymbolicLink()) { warnings.push(`${relativeSlash}: symlink skipped`); continue; }
      if (entry.isDirectory()) {
        const generatedClaudeSkills = relativeSlash.toLowerCase() === ".claude/skills";
        if (!SKIPPED_DIRECTORIES.has(entry.name.toLowerCase()) && !generatedClaudeSkills) await visit(path.join(directory, entry.name), relative);
        continue;
      }
      if (!entry.isFile() || SENSITIVE_PATH.test(entry.name) || !SAFE_DISCOVERY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const absolute = path.join(directory, entry.name);
      const details = await lstat(absolute);
      if (details.size > maxFileBytes) { warnings.push(`${relativeSlash}: oversized file skipped`); continue; }
      let text;
      try { text = await readFile(absolute, "utf8"); }
      catch (error) { warnings.push(`${relativeSlash}: ${error.message}`); continue; }
      scanned += 1;
      const searchable = `${relativeSlash}\n${text}`;
      for (const item of ENVIRONMENT_TERMS) {
        const matched = item.aliases.find((alias) => termRegex(alias).test(searchable));
        if (matched) evidence.get(item.id).add(`${relativeSlash} (${matched})`);
      }
    }
  }
  await visit(resolved);
  const candidates = ENVIRONMENT_TERMS
    .filter((item) => evidence.get(item.id).size)
    .map((item) => ({ id: item.id, aliases: item.aliases, evidence: [...evidence.get(item.id)].slice(0, 20), status: "UNCONFIRMED" }));
  return { schema_version: 1, project: resolved, scanned_files: scanned, candidates, warnings, truncated: scanned >= maxFiles };
}

export async function inspectEnvironmentProject(projectRoot, host) {
  const resolved = await resolveProjectRoot(projectRoot);
  const profiles = await readEnvironmentProfiles(resolved, { required: false });
  const active = await readActiveEnvironments(resolved);
  if (!profiles) return { configured: false, active, checks: [{ status: "FAIL", name: "environment-profiles", message: "No confirmed environment profiles found" }] };
  const hosts = host ? [host] : Object.keys(active.hosts);
  const checks = [];
  if (!hosts.length) checks.push({ status: "FAIL", name: "active-environment", message: "No host has an active Rooty environment" });
  for (const targetHost of hosts) {
    if (!ROOTY_HOST_IDS.includes(targetHost)) {
      checks.push({ status: "FAIL", name: "active-environment", message: `Unsupported host in environment state: ${targetHost}` });
      continue;
    }
    const state = active.hosts[targetHost];
    if (!state || !profiles.environments[state.environment]) {
      checks.push({ status: "FAIL", name: `${targetHost}-active-environment`, message: "Active environment is missing or unknown" });
      continue;
    }
    const current = await currentManagedNames(resolved, targetHost, profiles);
    const selection = selectedTargets(profiles, state.environment, targetHost);
    if (current.text === undefined) {
      checks.push({ status: "FAIL", name: `${targetHost}-host-mcp-config`, message: `Host MCP config is missing: ${current.file}` });
    } else {
      checks.push({ status: "PASS", name: `${targetHost}-host-mcp-config`, message: `Host MCP config exists: ${current.file}` });
    }
    const runtime = await validateTargetRuntime(resolved, selection.targets);
    if (runtime.missingArtifacts.length) {
      const dabMissing = runtime.missingArtifacts.filter((artifact) => path.basename(artifact).toLowerCase() === "dab-config.json");
      checks.push({
        status: "FAIL",
        name: `${targetHost}-provider-artifacts`,
        message: dabMissing.length === runtime.missingArtifacts.length
          ? `No usable DAB configs found for active targets: ${dabMissing.join(", ")}`
          : `Provider artifacts are missing: ${runtime.missingArtifacts.join(", ")}`
      });
    } else if (selection.targets.some((item) => (item.target.artifacts ?? []).length)) {
      checks.push({ status: "PASS", name: `${targetHost}-provider-artifacts`, message: "All active environment provider artifacts exist as regular project files" });
    }
    const requiredSettingKeys = [...new Set(selection.targets.flatMap((item) => item.target.settings_keys ?? []))];
    if (requiredSettingKeys.length) {
      const settings = await readMcpSettings(resolved, { required: false });
      const absent = requiredSettingKeys.filter((key) => !hasMcpSetting(settings, key));
      if (!settings) checks.push({ status: "FAIL", name: `${targetHost}-mcp-settings`, message: `MCP settings file is missing: ${MCP_SETTINGS_PATH}` });
      else if (absent.length) checks.push({ status: "FAIL", name: `${targetHost}-mcp-settings`, message: `MCP settings file does not declare: ${absent.join(", ")}` });
      else checks.push({ status: "PASS", name: `${targetHost}-mcp-settings`, message: `${requiredSettingKeys.length} required MCP setting key(s) are declared locally` });
    }
    const desired = new Set(selection.targets.map((item) => item.target.name));
    const missing = [...desired].filter((name) => !current.names.has(name));
    const stale = [...current.names].filter((name) => !desired.has(name));
    const changed = selection.targets
      .filter((item) => current.names.has(item.target.name))
      .filter((item) => targetHost === "codex"
        ? current.entries.get(item.target.name) !== renderCodexEntry(item.target.name, item.entry).trim()
        : !entriesEqual(current.parsed.mcpServers[item.target.name], item.entry))
      .map((item) => item.target.name);
    if (selection.missing.length || missing.length || stale.length || changed.length) {
      checks.push({ status: "FAIL", name: `${targetHost}-mcp-environment`, message: [...selection.missing, ...(missing.length ? [`missing entries: ${missing.join(", ")}`] : []), ...(stale.length ? [`stale entries: ${stale.join(", ")}`] : []), ...(changed.length ? [`entries differ from the confirmed environment profile: ${changed.join(", ")}`] : [])].join("; ") });
    } else {
      checks.push({ status: "PASS", name: `${targetHost}-mcp-environment`, message: `${desired.size} Rooty MCP entries consistently target ${state.environment}` });
    }
  }
  return { configured: !checks.some((check) => check.status === "FAIL"), profiles, active, checks };
}

export function targetsForEnvironment(profiles, environment, host) {
  return selectedTargets(profiles, environment, host);
}

function normalizedProjectIdentity(projectRoot) {
  const normalized = slash(path.resolve(projectRoot));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function prefixedSha256(value) {
  return String(value).startsWith("sha256:") ? String(value) : `sha256:${value}`;
}

export async function buildLockedEnvironmentIdentity({ projectRoot, host, environment }) {
  if (!ROOTY_HOST_IDS.includes(host)) throw new Error(`Unsupported host for locked identity: ${host}`);
  const resolved = await resolveProjectRoot(projectRoot);
  const profiles = await readEnvironmentProfiles(resolved);
  const active = await readActiveEnvironments(resolved);
  const activeState = active.hosts[host];
  if (!activeState) throw new Error(`No active environment is recorded for ${host}`);
  const canonicalEnvironment = environment ? resolveEnvironmentId(profiles, environment) : activeState.environment;
  if (canonicalEnvironment !== activeState.environment) {
    throw new Error(`Requested ${canonicalEnvironment}, but ${host} targets ${activeState.environment}`);
  }
  if (!activeState.configuration_generation) throw new Error(`Active ${host} configuration has no generation fingerprint`);
  const selection = selectedTargets(profiles, canonicalEnvironment, host);
  if (selection.missing.length) throw new Error(`Cannot lock incomplete provider identity: ${selection.missing.join("; ")}`);
  const providers = selection.targets.map((item) => ({
    instance_id: item.target.name,
    capability: item.capability,
    configuration_hash: fingerprint({
      logical_id: item.logicalId,
      environment: canonicalEnvironment,
      name: item.target.name,
      artifacts: [...(item.target.artifacts ?? [])].sort(),
      settings_keys: [...(item.target.settings_keys ?? [])].sort(),
      probe: item.target.probe,
      host: item.entry
    }),
    allowlist_hash: fingerprint([...(item.target.allowed_tools ?? [])].sort()),
    allowed_tools: [...(item.target.allowed_tools ?? [])].sort()
  })).sort((left, right) => left.instance_id.localeCompare(right.instance_id));
  const environmentProfile = {
    id: canonicalEnvironment,
    definition: profiles.environments[canonicalEnvironment],
    providers: selection.targets.map((item) => ({
      logical_id: item.logicalId,
      capability: item.capability,
      target: item.target
    })).sort((left, right) => left.logical_id.localeCompare(right.logical_id))
  };
  return {
    schema_version: 1,
    project: { root_fingerprint: fingerprint({ root: normalizedProjectIdentity(resolved) }) },
    host: { id: host, config_generation: prefixedSha256(activeState.configuration_generation) },
    environment: { id: canonicalEnvironment, profile_hash: fingerprint(environmentProfile) },
    providers
  };
}
