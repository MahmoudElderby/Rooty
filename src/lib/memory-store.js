import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "./core.js";

export const MEMORY_PATHS = Object.freeze({
  root: ".rooty/memory",
  drafts: ".rooty/memory/drafts",
  approved: ".rooty/memory/approved",
  legacyRoot: ".investigator/memory",
  legacyDrafts: ".investigator/memory/drafts",
  legacyApproved: ".investigator/memory/approved"
});

export function memoryRoots(projectRoot) {
  return {
    drafts: path.join(projectRoot, MEMORY_PATHS.drafts),
    approved: path.join(projectRoot, MEMORY_PATHS.approved),
    legacyDrafts: path.join(projectRoot, MEMORY_PATHS.legacyDrafts),
    legacyApproved: path.join(projectRoot, MEMORY_PATHS.legacyApproved)
  };
}

async function assertNoSymlinkSegments(projectRoot, target) {
  if (!isInside(projectRoot, target)) throw new Error(`Refusing memory path outside project: ${target}`);
  const projectDetails = await lstat(path.resolve(projectRoot));
  if (!projectDetails.isDirectory() || projectDetails.isSymbolicLink()) throw new Error(`Refusing unsafe memory project root: ${projectRoot}`);
  const relative = path.relative(path.resolve(projectRoot), path.resolve(target));
  let current = path.resolve(projectRoot);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!await pathExists(current)) continue;
    const details = await lstat(current);
    if (details.isSymbolicLink()) throw new Error(`Refusing symlinked memory path: ${current}`);
  }
}

export async function ensureMemoryDirectories(projectRoot) {
  const roots = memoryRoots(projectRoot);
  await assertNoSymlinkSegments(projectRoot, roots.drafts);
  await assertNoSymlinkSegments(projectRoot, roots.approved);
  await mkdir(roots.drafts, { recursive: true });
  await mkdir(roots.approved, { recursive: true });
  return roots;
}

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function resolveMemoryDraft(projectRoot, candidate) {
  const roots = memoryRoots(projectRoot);
  const resolved = path.resolve(candidate);
  if (isInside(roots.drafts, resolved) || isInside(roots.legacyDrafts, resolved)) {
    await assertNoSymlinkSegments(projectRoot, resolved);
    return resolved;
  }
  throw new Error(`Refusing path outside Rooty memory drafts: ${resolved}`);
}

async function jsonFiles(projectRoot, directory) {
  if (!await pathExists(directory)) return [];
  await assertNoSymlinkSegments(projectRoot, directory);
  const details = await lstat(directory);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`Memory path is not a trusted directory: ${directory}`);
  }
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing symlinked memory artifact: ${candidate}`);
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) files.push(candidate);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

export async function listMemoryCards(projectRoot, kind) {
  const roots = memoryRoots(projectRoot);
  const directories = kind === "draft"
    ? [roots.drafts, roots.legacyDrafts]
    : kind === "approved"
      ? [roots.approved, roots.legacyApproved]
      : [roots.drafts, roots.approved, roots.legacyDrafts, roots.legacyApproved];
  const files = [];
  for (const directory of directories) files.push(...await jsonFiles(projectRoot, directory));
  return files;
}

export async function migrateLegacyMemory(projectRoot) {
  const roots = memoryRoots(projectRoot);
  await assertNoSymlinkSegments(projectRoot, roots.drafts);
  await assertNoSymlinkSegments(projectRoot, roots.approved);
  const pairs = [
    [roots.legacyDrafts, roots.drafts],
    [roots.legacyApproved, roots.approved]
  ];
  const planned = [];
  const preserved = [];

  for (const [legacyRoot, canonicalRoot] of pairs) {
    for (const source of await jsonFiles(projectRoot, legacyRoot)) {
      const target = path.join(canonicalRoot, path.basename(source));
      if (await pathExists(target)) {
        const targetDetails = await lstat(target);
        if (!targetDetails.isFile() || targetDetails.isSymbolicLink()) throw new Error(`Refusing unsafe canonical memory artifact: ${target}`);
        const [legacyContent, canonicalContent] = await Promise.all([readFile(source), readFile(target)]);
        if (!legacyContent.equals(canonicalContent)) {
          throw new Error(`Refusing conflicting legacy memory migration: ${source} -> ${target}`);
        }
        preserved.push(target);
      } else {
        planned.push({ source, target });
      }
    }
  }

  await ensureMemoryDirectories(projectRoot);
  for (const item of planned) await copyFile(item.source, item.target, constants.COPYFILE_EXCL);
  return {
    copiedFiles: planned.map((item) => item.target),
    existingFiles: preserved,
    legacyFilesRetained: planned.map((item) => item.source)
  };
}
