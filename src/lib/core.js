import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const VALID_CLASSIFICATIONS = new Set(["REPORTED", "OBSERVED", "INFERRED", "HYPOTHESIS", "UNKNOWN"]);
export const VALID_OUTCOMES = new Set(["CONFIRMED", "PROBABLE", "INCONCLUSIVE"]);

export function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const equal = token.indexOf("=");
    if (equal !== -1) {
      options[token.slice(2, equal)] = token.slice(equal + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return { positional, options };
}

export function option(options, key, fallback) {
  const value = options[key];
  return value === undefined ? fallback : value;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function isoNow() {
  return new Date().toISOString();
}

export function makeCaseId(date = new Date()) {
  const day = date.toISOString().slice(0, 10).replaceAll("-", "");
  return `INV-${day}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export function ensureInside(parent, candidate) {
  const root = path.resolve(parent);
  const target = path.resolve(candidate);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing path outside project: ${target}`);
  }
  return target;
}

export function isSecretLikeKey(key) {
  return /(^|_)(secret|password|token|api_?key|app_?key|private_?key)$/i.test(key);
}

export function assertNoEmbeddedSecrets(value, location = "configuration") {
  const findings = [];
  function visit(node, trail) {
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      const next = `${trail}.${key}`;
      if (isSecretLikeKey(key) && typeof child === "string" && child.trim() !== "" && !key.endsWith("_env")) {
        findings.push(next);
      }
      visit(child, next);
    }
  }
  visit(value, location);
  if (findings.length > 0) {
    throw new Error(`Embedded credential values are forbidden: ${findings.join(", ")}`);
  }
}

export function normalizeEnvironment(value) {
  const environment = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(environment)) {
    throw new Error(`Invalid environment name: ${value}`);
  }
  return environment;
}

export function isBoundedIsoRange(from, to, maxHours = 24) {
  const start = Date.parse(from);
  const end = Date.parse(to);
  return Number.isFinite(start) && Number.isFinite(end) && start < end && end - start <= maxHours * 3_600_000;
}
