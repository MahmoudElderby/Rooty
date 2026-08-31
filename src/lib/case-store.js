import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256 } from "./core.js";

export const CASE_LOCK_FILE = ".rooty-case.lock";
export const DEFAULT_LOCK_TIMEOUT_MS = 2_000;
export const DEFAULT_STALE_LOCK_MS = 30_000;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function readLock(lockFile) {
  try {
    return JSON.parse(await readFile(lockFile, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    return { malformed: true };
  }
}

async function removeStaleLock(lockFile, staleAfterMs, now) {
  const lock = await readLock(lockFile);
  if (!lock || lock.malformed || typeof lock.created_at !== "string") return false;
  const age = now() - Date.parse(lock.created_at);
  if (!Number.isFinite(age) || age < staleAfterMs || processIsAlive(lock.pid)) return false;
  const current = await readLock(lockFile);
  if (!current || current.nonce !== lock.nonce) return false;
  try {
    await unlink(lockFile);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

export async function resolveCaseDirectory(caseDir, { create = false } = {}) {
  const target = path.resolve(caseDir);
  if (target === path.parse(target).root) throw new Error(`Refusing a filesystem root as a case directory: ${target}`);
  if (create) await mkdir(target, { recursive: true });
  const details = await lstat(target);
  if (!details.isDirectory() || details.isSymbolicLink()) throw new Error(`Case directory must be a non-symlink directory: ${target}`);
  return realpath(target);
}

export async function withCaseLock(caseDir, action, options = {}) {
  const resolved = await resolveCaseDirectory(caseDir);
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_LOCK_MS;
  const retryMs = options.retryMs ?? 25;
  const now = options.now ?? Date.now;
  const deadline = now() + timeoutMs;
  const lockFile = path.join(resolved, CASE_LOCK_FILE);
  const owner = { pid: process.pid, created_at: new Date(now()).toISOString(), nonce: randomUUID() };
  let handle;
  while (!handle) {
    try {
      handle = await open(lockFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = true;
    } catch (error) {
      if (handle && handle !== true) {
        await handle.close().catch(() => {});
        await unlink(lockFile).catch(() => {});
        handle = undefined;
      }
      if (error?.code !== "EEXIST") throw error;
      if (await removeStaleLock(lockFile, staleAfterMs, now)) continue;
      if (now() >= deadline) {
        const current = await readLock(lockFile);
        const identity = current?.malformed ? "malformed lock" : `PID ${current?.pid ?? "unknown"}`;
        throw new Error(`Case is locked by ${identity}: ${resolved}`);
      }
      await delay(Math.min(retryMs, Math.max(1, deadline - now())));
    }
  }
  try {
    return await action(resolved);
  } finally {
    const current = await readLock(lockFile);
    if (current?.nonce === owner.nonce) await unlink(lockFile).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

export async function atomicWriteCaseFile(filePath, content) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  try {
    const existing = await lstat(filePath);
    if (!existing.isFile() || existing.isSymbolicLink()) throw new Error(`Case document must be a regular non-symlink file: ${filePath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporary = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(content, typeof content === "string" ? "utf8" : undefined);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export function atomicWriteCaseText(filePath, content) {
  return atomicWriteCaseFile(filePath, content);
}

export function atomicWriteCaseJson(filePath, value) {
  return atomicWriteCaseText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readNdjson(filePath, { optional = false } = {}) {
  let content;
  try {
    const details = await lstat(filePath);
    if (!details.isFile() || details.isSymbolicLink()) throw new Error(`Case ledger must be a regular non-symlink file: ${filePath}`);
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (optional && error?.code === "ENOENT") return [];
    throw error;
  }
  return content.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Invalid ledger JSON at line ${index + 1}: ${filePath}`);
    }
  });
}

export async function appendLedgerEntry(caseDir, ledgerName, createEntry, verifyEntries, options = {}) {
  if (!/^[a-z][a-z0-9-]*\.ndjson$/.test(ledgerName)) throw new Error(`Invalid case ledger name: ${ledgerName}`);
  return withCaseLock(caseDir, async (resolved) => {
    const ledgerFile = path.join(resolved, ledgerName);
    const entries = await readNdjson(ledgerFile, { optional: true });
    const verification = verifyEntries(entries);
    const entry = await createEntry({ entries, verification, caseDir: resolved });
    verifyEntries([...entries, entry]);
    const handle = await open(ledgerFile, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY, 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(entry)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    return entry;
  }, options);
}

export async function writeContentAddressedExtract(caseDir, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const digest = sha256(bytes);
  return withCaseLock(caseDir, async (resolved) => {
    const extracts = path.join(resolved, "extracts");
    await mkdir(extracts, { recursive: true });
    const extractDetails = await lstat(extracts);
    if (!extractDetails.isDirectory() || extractDetails.isSymbolicLink()) throw new Error(`Case extracts path must be a non-symlink directory: ${extracts}`);
    const file = path.join(extracts, digest);
    try {
      const details = await lstat(file);
      if (!details.isFile() || details.isSymbolicLink()) throw new Error(`Case extract must be a regular non-symlink file: ${file}`);
      const existing = await readFile(file);
      if (!existing.equals(bytes)) throw new Error(`Content-address collision for extract ${digest}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await atomicWriteCaseFile(file, bytes);
    }
    return { content_hash: `sha256:${digest}`, file };
  });
}

export function ledgerEntryHash(entry) {
  const { entry_hash: ignored, ...base } = entry;
  return sha256(canonicalJson(base));
}
