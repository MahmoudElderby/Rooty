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
  const input = typeof value === "string" || ArrayBuffer.isView(value) ? value : canonicalJson(value);
  return createHash("sha256").update(input).digest("hex");
}

export function fingerprint(value) {
  return `sha256:${sha256(canonicalJson(value))}`;
}

const RFC3339_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

export function parseRfc3339Instant(value, name = "timestamp") {
  const text = String(value ?? "");
  const match = RFC3339_INSTANT.exec(text);
  if (!match) throw new Error(`${name} must be an RFC 3339 instant with an explicit offset`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offset] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) {
    throw new Error(`${name} is not a valid RFC 3339 calendar instant`);
  }
  if (offset !== "Z") {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) throw new Error(`${name} has an invalid RFC 3339 offset`);
  }
  const milliseconds = Date.parse(text);
  if (!Number.isFinite(milliseconds)) throw new Error(`${name} is not a valid RFC 3339 instant`);
  return milliseconds;
}

export function parseRfc3339Range(value, name = "time range") {
  const text = String(value ?? "");
  const parts = text.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error(`${name} must contain two bounded RFC 3339 instants`);
  const start = parseRfc3339Instant(parts[0], `${name} start`);
  const end = parseRfc3339Instant(parts[1], `${name} end`);
  if (start > end) throw new Error(`${name} start must not be after its end`);
  return { start, end, from: parts[0], to: parts[1] };
}

const RUNTIME_ENVIRONMENT_KEYS = new Set([
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TZ"
]);

export function minimalRuntimeEnvironment(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([key, value]) =>
    value !== undefined && RUNTIME_ENVIRONMENT_KEYS.has(key.toUpperCase())
  ));
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
