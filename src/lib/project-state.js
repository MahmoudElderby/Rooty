import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function resolveProjectRoot(projectRoot) {
  const resolved = path.resolve(projectRoot);
  if (resolved === path.parse(resolved).root) throw new Error(`Refusing a filesystem root as a project: ${resolved}`);
  let details;
  try { details = await lstat(resolved); }
  catch (error) { throw new Error(`Project folder is unavailable: ${resolved} (${error.message})`); }
  if (!details.isDirectory()) throw new Error(`Project path is not a directory: ${resolved}`);
  if (details.isSymbolicLink()) throw new Error(`Refusing a symlinked project folder: ${resolved}`);
  return resolved;
}

export function ensureProjectPath(projectRoot, candidate) {
  const root = path.resolve(projectRoot);
  const target = path.resolve(candidate);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Refusing path outside project: ${target}`);
  return target;
}

export async function assertNoSymlinkPath(projectRoot, target) {
  const safe = ensureProjectPath(projectRoot, target);
  const relative = path.relative(projectRoot, safe);
  let current = path.resolve(projectRoot);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const details = await lstat(current);
      if (details.isSymbolicLink()) throw new Error(`Refusing symlinked Rooty path: ${current}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return safe;
}

export async function atomicWriteText(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  await writeFile(temporary, content, "utf8");
  await rename(temporary, filePath);
}

export function atomicWriteJson(filePath, value) {
  return atomicWriteText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readOptionalText(filePath) {
  try { return await readFile(filePath, "utf8"); }
  catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function readOptionalJson(filePath) {
  const text = await readOptionalText(filePath);
  if (text === undefined) return undefined;
  return JSON.parse(text);
}
