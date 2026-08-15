import path from "node:path";
import { assertNoEmbeddedSecrets, canonicalJson, pathExists, readJson, sha256 } from "./core.js";

const PROVIDERS = new Set(["mssql", "elasticsearch", "jira"]);
const KINDS = new Set(["database", "observability", "ticketing"]);
const CLASSIFICATIONS = new Set(["DETECTED", "AI_SUGGESTED", "REPORTED"]);
const PLAN_STATES = new Set(["proposed", "approved", "generated", "verified", "blocked"]);
const CREDENTIAL_RESOLUTIONS = new Set(["environment", "host-oauth"]);
const SAFE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]{2,127}$/;

function assertSetupNoSecrets(value, location) {
  assertNoEmbeddedSecrets(value, location);
  const serialized = JSON.stringify(value);
  if (/(?:^|[;"'\s])(?:password|pwd|user id|uid)\s*=|-----BEGIN [A-Z ]+PRIVATE KEY-----|(?:api[_-]?key|access[_-]?token)\s*[:=]\s*["'][^$<{]/i.test(serialized)) {
    throw new Error(`Embedded credential values are forbidden in ${location}`);
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function requireRelativePath(value, label) {
  if (typeof value !== "string" || !value || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || value.split(/[\\/]/).includes("..") || !SAFE_SEGMENT.test(value.replaceAll("\\", "/"))) {
    throw new Error(`${label} must be a normalized project-relative path`);
  }
}

function requireStringArray(value, label, pattern) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || (pattern && !pattern.test(item)))) throw new Error(`${label} must be a string array`);
}

export function stableResourceId({ provider, serviceRoot, logicalName, environment }) {
  for (const [key, value] of Object.entries({ provider, serviceRoot, logicalName, environment })) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`Stable resource ID requires ${key}`);
  }
  requireRelativePath(serviceRoot === "." ? "project" : serviceRoot, "serviceRoot");
  const slug = logicalName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "resource";
  const identity = { provider: provider.toLowerCase(), service_root: serviceRoot.replaceAll("\\", "/"), logical_name: logicalName, environment: environment.toLowerCase() };
  return `${slug}-${sha256(identity).slice(0, 12)}`;
}

export function validateResourceInventory(inventory) {
  requireObject(inventory, "resource inventory");
  if (inventory.schema_version !== 2 || !Array.isArray(inventory.resources)) throw new Error("Resource inventory schema_version must be 2 and resources must be an array");
  const ids = new Set();
  for (const resource of inventory.resources) {
    requireObject(resource, "resource");
    if (typeof resource.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,79}$/.test(resource.id) || ids.has(resource.id)) throw new Error(`Invalid or duplicate resource id: ${resource.id}`);
    ids.add(resource.id);
    if (!KINDS.has(resource.kind) || !PROVIDERS.has(resource.provider)) throw new Error(`Unsupported resource kind/provider: ${resource.kind}/${resource.provider}`);
    requireRelativePath(resource.service_root, `${resource.id}.service_root`);
    if (!CLASSIFICATIONS.has(resource.classification)) throw new Error(`Invalid classification for ${resource.id}`);
    requireStringArray(resource.credential_references ?? [], `${resource.id}.credential_references`, ENV_NAME);
    if (!Array.isArray(resource.evidence) || resource.evidence.length === 0) throw new Error(`${resource.id}.evidence must not be empty`);
    for (const evidence of resource.evidence) {
      requireRelativePath(evidence.path, `${resource.id}.evidence.path`);
      if (typeof evidence.signal !== "string" || !evidence.signal.trim()) throw new Error(`${resource.id}.evidence.signal is required`);
    }
  }
  requireObject(inventory.capability_bindings, "capability_bindings");
  for (const [capability, bindings] of Object.entries(inventory.capability_bindings)) {
    if (!KINDS.has(capability)) throw new Error(`Unsupported capability binding: ${capability}`);
    requireStringArray(bindings, `capability_bindings.${capability}`);
    if (bindings.some((id) => !ids.has(id))) throw new Error(`Unknown resource in capability_bindings.${capability}`);
  }
  assertSetupNoSecrets(inventory, "resource-inventory");
  return inventory;
}

export function approvalDigest(inventory, plan) {
  const { state, approved_digest, generated_at, verified_at, ...approvedPlan } = plan;
  const material = {
    inventory,
    plan: approvedPlan
  };
  return `sha256:${sha256(material)}`;
}

export function validateMcpPlan(plan, inventory, { requireCurrentApproval = true } = {}) {
  requireObject(plan, "MCP plan");
  validateResourceInventory(inventory);
  if (plan.schema_version !== 1 || !PLAN_STATES.has(plan.state) || !Array.isArray(plan.servers)) throw new Error("Invalid MCP plan schema or state");
  const resourceIds = new Set(inventory.resources.map((resource) => resource.id));
  for (const server of plan.servers) {
    requireStringArray(server.resources, `${server.id}.resources`);
    requireStringArray(server.credential_references ?? [], `${server.id}.credential_references`, ENV_NAME);
    requireStringArray(server.allowed_tools, `${server.id}.allowed_tools`);
    if (server.resources.some((id) => !resourceIds.has(id))) throw new Error(`${server.id} references an unknown resource`);
    if (server.allowed_tools.some((tool) => /(^|[_-])(create|update|delete|write|execute|transition|comment|admin)([_-]|$)/i.test(tool))) throw new Error(`${server.id} contains a mutation-capable tool`);
    if (!server.command && !server.url) throw new Error(`${server.id} requires a trusted command or URL`);
  }
  assertSetupNoSecrets(plan, "mcp-plan");
  if (requireCurrentApproval && ["approved", "generated", "verified"].includes(plan.state)) {
    const expected = approvalDigest(inventory, plan);
    if (plan.approved_digest !== expected) throw new Error("MCP plan approval is stale or missing");
  }
  return plan;
}

export function validateCredentialRequirements(value) {
  requireObject(value, "credential requirements");
  if (value.schema_version !== 1 || !Array.isArray(value.requirements)) throw new Error("Invalid credential-requirements schema");
  for (const requirement of value.requirements) {
    if (!ENV_NAME.test(requirement.name ?? "") || typeof requirement.connector !== "string" || typeof requirement.required !== "boolean" || requirement.secret !== true || !CREDENTIAL_RESOLUTIONS.has(requirement.resolution)) throw new Error("Invalid credential requirement");
  }
  assertSetupNoSecrets(value, "credential-requirements");
  return value;
}

export function validateAiSuggestions(value) {
  requireObject(value, "AI suggestions");
  if (value.schema_version !== 1 || !Array.isArray(value.suggestions)) throw new Error("Invalid AI-suggestion schema");
  for (const suggestion of value.suggestions) {
    if (suggestion.classification !== "AI_SUGGESTED" || !PROVIDERS.has(suggestion.provider) || !Array.isArray(suggestion.evidence) || suggestion.evidence.length === 0) throw new Error("Invalid AI suggestion");
    for (const evidence of suggestion.evidence) requireRelativePath(evidence.path, "AI suggestion evidence path");
  }
  assertSetupNoSecrets(value, "ai-suggestions");
  return value;
}

export async function detectProjectMode(projectRoot) {
  const inventoryFile = path.join(projectRoot, ".investigator/resource-inventory.json");
  const planFile = path.join(projectRoot, ".investigator/mcp-plan.json");
  const legacyFile = path.join(projectRoot, ".investigator/sources.json");
  if (await pathExists(inventoryFile) || await pathExists(planFile)) return { mode: "automatic-v2", inventoryFile, planFile };
  if (await pathExists(legacyFile)) return { mode: "legacy-v1", sourcesFile: legacyFile };
  return { mode: "uninitialized" };
}

export async function readProjectSetup(projectRoot) {
  const mode = await detectProjectMode(projectRoot);
  if (mode.mode === "legacy-v1") return { ...mode, sources: await readJson(mode.sourcesFile) };
  if (mode.mode === "automatic-v2") {
    const inventory = await readJson(mode.inventoryFile);
    const plan = await readJson(mode.planFile);
    validateMcpPlan(plan, inventory);
    return { ...mode, inventory, plan };
  }
  return mode;
}

export function canonicalSetupJson(value) {
  return `${canonicalJson(value)}\n`;
}
