import { chmod, readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJson, assertNoSymlinkPath, readOptionalJson, resolveProjectRoot } from "./project-state.js";

export const MCP_SETTINGS_PATH = ".rooty/config/mcp-settings.local.json";
export const MCP_SETTINGS_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateMcpSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings) || settings.schema_version !== 1) {
    throw new Error("Invalid MCP settings schema");
  }
  if (!settings.settings || typeof settings.settings !== "object" || Array.isArray(settings.settings)) {
    throw new Error("MCP settings require a settings object");
  }
  for (const [key, value] of Object.entries(settings.settings)) {
    if (!MCP_SETTINGS_KEY_PATTERN.test(key)) throw new Error(`Invalid MCP setting key: ${key}`);
    if (typeof value !== "string") throw new Error(`MCP setting ${key} must be a string`);
    if (value.includes("\0")) throw new Error(`MCP setting ${key} contains a forbidden null byte`);
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
  const current = await readMcpSettings(resolved, { required: false }) ?? { schema_version: 1, settings: {} };
  const next = { schema_version: 1, settings: { ...current.settings } };
  for (const key of [...new Set(keys)].sort()) if (next.settings[key] === undefined) next.settings[key] = "";
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
  const keys = requestedKeys?.length ? [...new Set(requestedKeys)].sort() : Object.keys(settings?.settings ?? {}).sort();
  return keys.map((key) => ({
    key,
    status: Object.prototype.hasOwnProperty.call(settings?.settings ?? {}, key) && settings.settings[key] !== "" ? "AVAILABLE" : "MISSING"
  }));
}

export function resolveMcpSettingValues(settings, keys) {
  const values = {};
  const missing = [];
  for (const key of [...new Set(keys ?? [])]) {
    const value = settings?.settings?.[key];
    if (typeof value !== "string" || value === "") missing.push(key);
    else values[key] = value;
  }
  return { values, missing };
}
