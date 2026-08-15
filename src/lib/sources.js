import { opendir, readFile } from "node:fs/promises";
import path from "node:path";
import { assertNoEmbeddedSecrets, isoNow, normalizeEnvironment, pathExists, readJson, writeJson } from "./core.js";

const SKIP_DIRECTORIES = new Set([".git", "node_modules", ".investigator", "dist", "build", "coverage", ".next", ".venv"]);
const TEXT_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".json", ".yaml", ".yml", ".toml", ".tf", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".kt", ".xml", ".properties", ".env.example"]);
const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 1_000_000;
const SENSITIVE_PATH_PART = /^(?:\.env(?:\..+)?|(?:secrets?|credentials?|passwords?|tokens?|private[-_.]?keys?|vault)(?:[._-].*)?)$/i;
const STRUCTURED_CONFIG_EXTENSIONS = new Set([".json", ".yaml", ".yml", ".toml", ".properties"]);

function isPotentiallySensitivePath(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).split(/[\\/]/).some((part) => SENSITIVE_PATH_PART.test(part) && part !== ".env.example");
}

function containsCredentialMaterial(filePath, content) {
  if (/-----BEGIN [A-Z ]+PRIVATE KEY-----/.test(content)) return true;
  if (!STRUCTURED_CONFIG_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return false;
  const assignment = /["']?(?:secret|password|passwd|token|access_token|api[_-]?key|app[_-]?key|private[_-]?key)["']?\s*[:=]\s*["']?([^"'#,\s][^"'#,\r\n]*)/gim;
  for (const match of content.matchAll(assignment)) {
    const value = match[1].trim();
    const placeholder = /^(?:\$\{|\$[A-Z_]|process\.env|os\.environ|env\(|<|REDACTED|CHANGEME|EXAMPLE|PLACEHOLDER|null\b|false\b)/i.test(value) || /^[A-Z][A-Z0-9_]{2,}$/.test(value);
    if (!placeholder) return true;
  }
  return false;
}

async function* walk(root) {
  const queue = [root];
  let count = 0;
  while (queue.length > 0 && count < MAX_FILES) {
    const current = queue.shift();
    const directory = await opendir(current);
    for await (const entry of directory) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) queue.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      count += 1;
      const extension = entry.name === ".env.example" ? ".env.example" : path.extname(entry.name).toLowerCase();
      if (TEXT_EXTENSIONS.has(extension) || /^Dockerfile/i.test(entry.name)) yield fullPath;
    }
  }
}

export async function discoverSources({ packageRoot, projectRoot, output }) {
  const rules = await readJson(path.join(packageRoot, "setup/discovery-rules/rules.json"));
  const detections = new Map();
  let scannedFiles = 0;
  const warnings = [];
  for await (const filePath of walk(projectRoot)) {
    if (isPotentiallySensitivePath(projectRoot, filePath)) {
      warnings.push(`Skipped potentially sensitive file: ${path.relative(projectRoot, filePath)}`);
      continue;
    }
    scannedFiles += 1;
    let content;
    try {
      const buffer = await readFile(filePath);
      if (buffer.length > MAX_FILE_BYTES) {
        warnings.push(`Skipped oversized file: ${path.relative(projectRoot, filePath)}`);
        continue;
      }
      content = buffer.toString("utf8");
      if (containsCredentialMaterial(filePath, content)) {
        warnings.push(`Skipped structured configuration containing credential material: ${path.relative(projectRoot, filePath)}`);
        continue;
      }
    } catch (error) {
      warnings.push(`Unreadable file: ${path.relative(projectRoot, filePath)} (${error.code ?? "error"})`);
      continue;
    }
    for (const rule of rules.rules) {
      const regularExpression = new RegExp(rule.pattern, rule.flags ?? "i");
      if (!regularExpression.test(content) && !regularExpression.test(path.relative(projectRoot, filePath))) continue;
      const key = `${rule.capability}:${rule.provider}`;
      const existing = detections.get(key) ?? {
        capability: rule.capability,
        provider: rule.provider,
        confidence: rule.confidence,
        repository_classification: "INFERRED",
        evidence: []
      };
      if (existing.evidence.length < 8) existing.evidence.push(path.relative(projectRoot, filePath).replaceAll("\\", "/"));
      detections.set(key, existing);
    }
  }
  const result = {
    schema_version: 1,
    project: path.basename(projectRoot),
    generated_at: isoNow(),
    scanned_files: scannedFiles,
    detections: [...detections.values()].sort((left, right) => left.capability.localeCompare(right.capability) || left.provider.localeCompare(right.provider)),
    warnings
  };
  const outputFile = output ?? path.join(projectRoot, ".investigator/discovery.json");
  await writeJson(outputFile, result);
  return result;
}

function validateEndpoint(value, capability) {
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new Error(`Invalid ${capability} MCP URL: ${value}`); }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new Error(`${capability} MCP URL must use HTTPS or loopback HTTP`);
  }
  if (parsed.username || parsed.password) throw new Error(`${capability} MCP URL must not embed credentials`);
  for (const key of parsed.searchParams.keys()) {
    if (/(token|secret|password|key)/i.test(key)) throw new Error(`${capability} MCP URL must not contain credential query parameters`);
  }
  return parsed.toString();
}

function resolveAuth(requested, bearerTokenEnv, oauthTokenEnv, recipe, endpoint, capability) {
  const selected = requested ?? (recipe.auth === "oauth" ? "oauth" : undefined);
  if (!selected) return { auth: "unconfigured", issue: `${capability}.auth` };
  if (!["oauth", "bearer-env", "none"].includes(selected)) throw new Error(`Invalid ${capability} auth mode: ${selected}`);
  if (selected === "oauth") {
    const providerName = recipe.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    const variable = oauthTokenEnv ?? `ROOTY_${providerName}_MCP_OAUTH_TOKEN`;
    if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(variable)) {
      throw new Error(`${capability} OAuth requires a valid --${capability}-oauth-token-env environment-variable name`);
    }
    return { auth: selected, oauth_access_token_env_var: variable };
  }
  if (selected === "none") {
    const hostname = new URL(endpoint).hostname;
    if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) throw new Error(`${capability} may use auth=none only with a loopback MCP URL`);
  }
  if (selected === "bearer-env") {
    if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(bearerTokenEnv ?? "")) throw new Error(`${capability} bearer auth requires --${capability}-bearer-token-env with an environment-variable name`);
    return { auth: selected, bearer_token_env_var: bearerTokenEnv };
  }
  return { auth: selected };
}

export async function configureSources({ packageRoot, projectRoot, discoveryFile, endpoints = {}, auth = {}, bearerTokenEnv = {}, oauthTokenEnv = {}, providers = {} }) {
  const targetDiscovery = discoveryFile ?? path.join(projectRoot, ".investigator/discovery.json");
  const discovery = await pathExists(targetDiscovery)
    ? await readJson(targetDiscovery)
    : await discoverSources({ packageRoot, projectRoot, output: targetDiscovery });
  const recipes = await readJson(path.join(packageRoot, "setup/connector-recipes/catalog.json"));
  const capabilities = ["ticketing", "documentation", "observability", "database", "deployments"];
  const configured = {};
  const unresolved = [];
  for (const capability of capabilities) {
    const candidates = discovery.detections.filter((item) => item.capability === capability);
    const requestedProvider = providers[capability];
    const selected = requestedProvider
      ? candidates.find((item) => item.provider === requestedProvider) ?? {
          capability,
          provider: requestedProvider,
          confidence: 1,
          repository_classification: "REPORTED",
          evidence: ["explicit-provider-selection"]
        }
      : candidates.sort((left, right) => Number(right.confidence) - Number(left.confidence))[0];
    if (!selected) {
      const endpoint = endpoints[capability] ? validateEndpoint(endpoints[capability], capability) : undefined;
      configured[capability] = {
        provider: "unconfigured",
        status: "needs-user-input",
        required_access: "read-only",
        ...(endpoint ? { endpoint } : {})
      };
      unresolved.push(`${capability}.provider`);
      continue;
    }
    const recipe = recipes.providers.find((item) => item.id === selected.provider && item.capabilities.includes(capability));
    if (!recipe) {
      configured[capability] = { provider: selected.provider, status: "recipe-missing", required_access: "read-only" };
      unresolved.push(capability);
      continue;
    }
    const reusedEndpoint = Object.values(configured).find((item) => item.provider === recipe.id && item.endpoint)?.endpoint;
    const endpointValue = endpoints[capability] ?? reusedEndpoint;
    const endpoint = endpointValue ? validateEndpoint(endpointValue, capability) : undefined;
    if (!endpoint) unresolved.push(`${capability}.endpoint`);
    const authResult = endpoint ? resolveAuth(auth[capability], bearerTokenEnv[capability], oauthTokenEnv[capability], recipe, endpoint, capability) : { auth: "unconfigured" };
    if (authResult.issue) unresolved.push(authResult.issue);
    configured[capability] = {
      provider: recipe.id,
      status: endpoint && authResult.auth !== "unconfigured" ? "ready-for-host-rendering" : "needs-user-input",
      required_access: "read-only",
      auth: authResult.auth,
      ...(authResult.bearer_token_env_var ? { bearer_token_env_var: authResult.bearer_token_env_var } : {}),
      ...(authResult.oauth_access_token_env_var ? { oauth_access_token_env_var: authResult.oauth_access_token_env_var } : {}),
      ...(endpoint ? { endpoint } : {}),
      endpoint_env_reference: recipe.endpoint_env,
      credential_env: recipe.credential_env ?? [],
      allowed_tools: recipe.allowed_tools,
      doctor_probe: recipe.doctor_probes?.[capability],
      discovery_evidence: selected.evidence,
      mapping_status: requestedProvider ? "USER_CONFIGURED" : "INFERRED"
    };
  }
  const registry = {
    schema_version: 1,
    generated_at: isoNow(),
    service: discovery.project,
    aliases: [],
    owners: [],
    time_zone: "UTC",
    environments: {
      production: {
        capabilities: configured
      }
    }
  };
  assertNoEmbeddedSecrets(registry, "sources");
  const file = path.join(projectRoot, ".investigator/sources.json");
  await writeJson(file, registry);
  return { file, unresolved, registry };
}

export async function listSources({ projectRoot, service, environment }) {
  const registryFile = path.join(projectRoot, ".investigator/sources.json");
  if (!await pathExists(registryFile)) throw new Error(`Source registry not found: ${registryFile}`);
  const registry = await readJson(registryFile);
  if (registry.service !== service && !(registry.aliases ?? []).includes(service)) {
    throw new Error(`Unknown service ${service}; registry contains ${registry.service}`);
  }
  const normalized = normalizeEnvironment(environment);
  const selected = registry.environments?.[normalized];
  if (!selected) throw new Error(`Environment ${normalized} is not registered for ${service}`);
  return { service: registry.service, environment: normalized, ...selected };
}
