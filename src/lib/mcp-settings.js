import { chmod, readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJson, assertNoSymlinkPath, readOptionalJson, resolveProjectRoot } from "./project-state.js";

export const MCP_SETTINGS_PATH = ".rooty/config/mcp-settings.local.json";
export const MCP_SETTINGS_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const MCP_SETTINGS_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

function settingSegments(key) {
  if (!MCP_SETTINGS_KEY_PATTERN.test(key)) throw new Error(`Invalid MCP setting key: ${key}`);
  return key.split(".");
}

function validateSettingNode(node, segments = []) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new Error(`MCP setting ${segments.join(".") || "settings"} must be an object`);
  }
  for (const [key, value] of Object.entries(node)) {
    if (!MCP_SETTINGS_ENV_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid MCP setting key: ${[...segments, key].join(".")}`);
    }
    const path = [...segments, key];
    if (typeof value === "string") {
      if (value.includes("\0")) throw new Error(`MCP setting ${path.join(".")} contains a forbidden null byte`);
    } else {
      validateSettingNode(value, path);
    }
  }
}

function validateGroupedSqlSettings(settings) {
  for (const [key, value] of Object.entries(settings)) {
    if (key.startsWith("ROOTY_SQL_")) {
      throw new Error("Schema-version-2 SQL settings must be grouped by environment");
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) || !value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Schema-version-2 settings must be grouped by lowercase environment: ${key}`);
    }
    const sql = value.sql;
    if (sql === undefined) continue;
    if (!sql || typeof sql !== "object" || Array.isArray(sql)) throw new Error(`MCP setting ${key}.sql must be an object`);
    if (sql.databases !== undefined) {
      throw new Error(`MCP setting ${key}.sql.databases is deprecated; use ${key}.sql.catalogs`);
    }
    const catalogs = sql.catalogs;
    if (catalogs === undefined) continue;
    if (!catalogs || typeof catalogs !== "object" || Array.isArray(catalogs)) {
      throw new Error(`MCP setting ${key}.sql.catalogs must be an object`);
    }
    const usedMcpUrls = new Map();
    for (const [domain, catalog] of Object.entries(catalogs)) {
      if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
        throw new Error(`MCP setting ${key}.sql.catalogs.${domain} must be an object`);
      }
      const mcpUrl = catalog.mcp_url;
      if (typeof mcpUrl !== "string" || mcpUrl === "") continue;
      const match = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(mcpUrl);
      const port = match ? Number.parseInt(match[1], 10) : 0;
      if (!match || port < 1 || port > 65535) {
        throw new Error(`MCP setting ${key}.sql.catalogs.${domain}.mcp_url must be an explicit loopback URL`);
      }
      const previous = usedMcpUrls.get(mcpUrl);
      if (previous) throw new Error(`SQL catalog MCP URLs must be unique within ${key}: ${previous}, ${domain}`);
      usedMcpUrls.set(mcpUrl, domain);
    }
  }
}

export function getMcpSetting(settings, key) {
  let value = settings?.settings;
  for (const segment of settingSegments(key)) {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || !Object.prototype.hasOwnProperty.call(value, segment)) return undefined;
    value = value[segment];
  }
  return value;
}

export function hasMcpSetting(settings, key) {
  return typeof getMcpSetting(settings, key) === "string";
}

function setMcpSetting(settings, key, value) {
  const segments = settingSegments(key);
  let node = settings.settings;
  for (const segment of segments.slice(0, -1)) {
    if (node[segment] === undefined) node[segment] = {};
    if (!node[segment] || typeof node[segment] !== "object" || Array.isArray(node[segment])) {
      throw new Error(`MCP setting path conflicts with a string value: ${key}`);
    }
    node = node[segment];
  }
  const leaf = segments.at(-1);
  if (node[leaf] === undefined) node[leaf] = value;
  else if (typeof node[leaf] !== "string") throw new Error(`MCP setting path conflicts with an object value: ${key}`);
}

export function listMcpSettingKeys(settings) {
  const keys = [];
  function visit(node, prefix = []) {
    for (const [key, value] of Object.entries(node ?? {})) {
      const path = [...prefix, key];
      if (typeof value === "string") keys.push(path.join("."));
      else visit(value, path);
    }
  }
  visit(settings?.settings);
  return keys.sort();
}

export function validateMcpSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings) || ![1, 2].includes(settings.schema_version)) {
    throw new Error("Invalid MCP settings schema");
  }
  if (!settings.settings || typeof settings.settings !== "object" || Array.isArray(settings.settings)) {
    throw new Error("MCP settings require a settings object");
  }
  if (settings.schema_version === 1) {
    for (const [key, value] of Object.entries(settings.settings)) {
      if (!MCP_SETTINGS_KEY_PATTERN.test(key) || key.includes(".")) throw new Error(`Invalid MCP setting key: ${key}`);
      if (typeof value !== "string") throw new Error(`MCP setting ${key} must be a string`);
      if (value.includes("\0")) throw new Error(`MCP setting ${key} contains a forbidden null byte`);
    }
  } else {
    validateSettingNode(settings.settings);
    validateGroupedSqlSettings(settings.settings);
  }
  return settings;
}

async function protectSettingsFile(file) {
  if (process.platform !== "win32") await chmod(file, 0o600);
}

export async function readMcpSettings(projectRoot, { required = true } = {}) {
  const resolved = await resolveProjectRoot(projectRoot);
  const file = path.join(resolved, MCP_SETTINGS_PATH);
  await assertNoSymlinkPath(resolved, file);
  const settings = await readOptionalJson(file);
  if (!settings && required) throw new Error(`MCP settings are missing: ${file}`);
  return settings ? validateMcpSettings(settings) : undefined;
}

export async function initializeMcpSettings({ projectRoot, keys = [] }) {
  const resolved = await resolveProjectRoot(projectRoot);
  const invalid = keys.find((key) => !MCP_SETTINGS_KEY_PATTERN.test(key));
  if (invalid) throw new Error(`Invalid MCP setting key: ${invalid}`);
  const current = await readMcpSettings(resolved, { required: false }) ?? { schema_version: 2, settings: {} };
  if (current.schema_version === 1 && keys.some((key) => key.includes("."))) {
    throw new Error("Cannot add nested setting paths to a legacy schema-version-1 file; import a reviewed schema-version-2 file with `rooty settings configure`");
  }
  if (current.schema_version === 2 && keys.some((key) => !key.includes("."))) {
    throw new Error("Schema-version-2 settings require an environment-grouped dotted path, such as prod.provider.token");
  }
  const next = { schema_version: current.schema_version, settings: structuredClone(current.settings) };
  for (const key of [...new Set(keys)].sort()) setMcpSetting(next, key, "");
  const file = path.join(resolved, MCP_SETTINGS_PATH);
  await assertNoSymlinkPath(resolved, file);
  await atomicWriteJson(file, next);
  await protectSettingsFile(file);
  return { file, settings: next, status: settingsStatus(next, keys) };
}

export async function configureMcpSettings({ projectRoot, sourceFile }) {
  const resolved = await resolveProjectRoot(projectRoot);
  const source = validateMcpSettings(JSON.parse(await readFile(path.resolve(sourceFile), "utf8")));
  const file = path.join(resolved, MCP_SETTINGS_PATH);
  await assertNoSymlinkPath(resolved, file);
  await atomicWriteJson(file, source);
  await protectSettingsFile(file);
  return { file, settings: source, status: settingsStatus(source) };
}

export function settingsStatus(settings, requestedKeys) {
  const keys = requestedKeys?.length ? [...new Set(requestedKeys)].sort() : listMcpSettingKeys(settings);
  return keys.map((key) => ({
    key,
    status: hasMcpSetting(settings, key) && getMcpSetting(settings, key) !== "" ? "AVAILABLE" : "MISSING"
  }));
}

export function resolveMcpSettingValues(settings, keys) {
  const values = {};
  const missing = [];
  for (const key of [...new Set(keys ?? [])]) {
    const value = getMcpSetting(settings, key);
    if (typeof value !== "string" || value === "") missing.push(key);
    else values[key] = value;
  }
  return { values, missing };
}
