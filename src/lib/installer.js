import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { MEMORY_PATHS, migrateLegacyMemory } from "./memory-store.js";

export const ROOTY_SKILLS = ["rooty-setup", "rooty-mcp-builder", "root-cause-investigator"];
export const ROOTY_SKILL_TARGETS = [".agents/skills", ".claude/skills"];

const INSTALLATION_MODE = "agent-led-v3";
export const ROOTY_PATHS = Object.freeze({
  manifest: ".rooty/state/install-manifest.json",
  context: ".rooty/config/project-context.json",
  legacyManifest: ".rooty/install-manifest.json",
  legacyContext: ".rooty/project-context.json"
});
export const ROOTY_PROJECT_DIRECTORIES = Object.freeze([
  ".rooty/config",
  ".rooty/state",
  MEMORY_PATHS.drafts,
  MEMORY_PATHS.approved,
  ".rooty/mcp/data",
  ".rooty/mcp/observability",
  ".rooty/mcp/ticketing",
  ".rooty/mcp/custom"
]);

function slash(value) {
  return value.split(path.sep).join("/");
}

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function exists(candidate) {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function assertProjectRoot(projectRoot) {
  const resolved = path.resolve(projectRoot);
  if (resolved === path.parse(resolved).root) {
    throw new Error(`Refusing to install into a filesystem root: ${resolved}`);
  }
  let details;
  try {
    details = await lstat(resolved);
  } catch (error) {
    throw new Error(`Project folder is unavailable: ${resolved} (${error.message})`);
  }
  if (!details.isDirectory()) throw new Error(`Project path is not a directory: ${resolved}`);
  if (details.isSymbolicLink()) throw new Error(`Refusing a symlinked project folder: ${resolved}`);
  return resolved;
}

async function assertNoSymlinkSegments(projectRoot, target) {
  if (!isInside(projectRoot, target)) throw new Error(`Refusing target outside project: ${target}`);
  const relative = path.relative(projectRoot, target);
  let current = projectRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!await exists(current)) continue;
    const details = await lstat(current);
    if (details.isSymbolicLink()) throw new Error(`Refusing symlinked installation path: ${current}`);
  }
}

async function listFiles(root) {
  const files = [];
  async function visit(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.join(prefix, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Packaged skills must not contain symlinks: ${absolute}`);
      if (entry.isDirectory()) await visit(absolute, relative);
      else if (entry.isFile()) files.push({ absolute, relative });
    }
  }
  await visit(root);
  return files;
}

async function readManifest(projectRoot) {
  const canonical = path.join(projectRoot, ROOTY_PATHS.manifest);
  const legacy = path.join(projectRoot, ROOTY_PATHS.legacyManifest);
  const file = await exists(canonical) ? canonical : legacy;
  if (!await exists(file)) return undefined;
  try {
    const details = await lstat(file);
    if (!details.isFile() || details.isSymbolicLink()) throw new Error("manifest is not a regular file");
    const manifest = JSON.parse(await readFile(file, "utf8"));
    if (manifest?.schema_version !== 1 || manifest?.installation !== INSTALLATION_MODE || typeof manifest?.files !== "object") {
      throw new Error("unsupported manifest shape");
    }
    return manifest;
  } catch (error) {
    throw new Error(`Cannot trust existing Rooty install manifest: ${error.message}`);
  }
}

async function atomicJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

async function ensureProjectGitignore(packageRoot, projectRoot) {
  const template = await readFile(path.join(packageRoot, "setup/gitignore-template.txt"), "utf8");
  const target = path.join(projectRoot, ".gitignore");
  if (!await exists(target)) {
    await writeFile(target, template, "utf8");
    return { file: target, changed: true };
  }
  const details = await lstat(target);
  if (!details.isFile() || details.isSymbolicLink()) throw new Error(`Refusing unsafe Git ignore target: ${target}`);
  const existing = await readFile(target, "utf8");
  const existingLines = new Set(existing.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const missing = template.split(/\r?\n/).filter((line) => line && !line.startsWith("#") && !existingLines.has(line));
  if (missing.length === 0) return { file: target, changed: false };
  const separator = existing.endsWith("\n") ? "" : "\n";
  await appendFile(target, `${separator}\n# Rooty runtime state\n${missing.join("\n")}\n`, "utf8");
  return { file: target, changed: true };
}

export function splitDocumentationPaths(value) {
  if (value === undefined || value === null || value === "") return [];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean);
}

export async function normalizeDocumentationPaths(projectRoot, values) {
  const normalized = [];
  const seen = new Set();
  for (const raw of splitDocumentationPaths(values)) {
    const absolute = path.resolve(projectRoot, raw);
    if (absolute === path.parse(absolute).root || absolute === projectRoot) {
      throw new Error(`Documentation path is too broad; choose a documentation file or folder: ${raw}`);
    }
    let details;
    try {
      details = await stat(absolute);
    } catch (error) {
      throw new Error(`Documentation path is unavailable: ${raw} (${error.message})`);
    }
    if (!details.isDirectory() && !details.isFile()) {
      throw new Error(`Documentation path must be a file or directory: ${raw}`);
    }
    const stored = isInside(projectRoot, absolute) ? slash(path.relative(projectRoot, absolute)) : path.normalize(absolute);
    const key = process.platform === "win32" ? stored.toLowerCase() : stored;
    if (!seen.has(key)) {
      seen.add(key);
      normalized.push(stored);
    }
  }
  return normalized;
}

export async function readProjectContext(projectRoot) {
  const resolved = await assertProjectRoot(projectRoot);
  const canonical = path.join(resolved, ROOTY_PATHS.context);
  const legacy = path.join(resolved, ROOTY_PATHS.legacyContext);
  const file = await exists(canonical) ? canonical : legacy;
  if (!await exists(file)) return { schema_version: 1, documentation: { paths: [] } };
  const details = await lstat(file);
  if (!details.isFile() || details.isSymbolicLink()) throw new Error(`Invalid Rooty project context: ${file}`);
  const context = JSON.parse(await readFile(file, "utf8"));
  if (context?.schema_version !== 1 || !Array.isArray(context?.documentation?.paths)) {
    throw new Error(`Invalid Rooty project context: ${file}`);
  }
  return context;
}

export async function setDocumentationPaths({ projectRoot, documentationPaths }) {
  const resolved = await assertProjectRoot(projectRoot);
  const contextFile = path.join(resolved, ROOTY_PATHS.context);
  const legacyContextFile = path.join(resolved, ROOTY_PATHS.legacyContext);
  await assertNoSymlinkSegments(resolved, contextFile);
  await assertNoSymlinkSegments(resolved, legacyContextFile);
  const paths = await normalizeDocumentationPaths(resolved, documentationPaths);
  const context = { schema_version: 1, documentation: { paths } };
  await atomicJson(contextFile, context);
  if (await exists(legacyContextFile)) await unlink(legacyContextFile);
  return { file: contextFile, context };
}

export async function installRooty({ packageRoot, projectRoot, documentationPaths = [] }) {
  const resolved = await assertProjectRoot(projectRoot);
  for (const relative of [
    ROOTY_PATHS.manifest,
    ROOTY_PATHS.context,
    ROOTY_PATHS.legacyManifest,
    ROOTY_PATHS.legacyContext
  ]) {
    await assertNoSymlinkSegments(resolved, path.join(resolved, relative));
  }
  const manifest = await readManifest(resolved);
  const planned = [];
  const nextFiles = {};

  for (const targetRoot of ROOTY_SKILL_TARGETS) {
    for (const skill of ROOTY_SKILLS) {
      const sourceRoot = path.join(packageRoot, "skill", skill);
      const targetSkillRoot = path.join(resolved, targetRoot, skill);
      if (!await exists(sourceRoot)) throw new Error(`Packaged Rooty skill is missing: ${sourceRoot}`);
      await assertNoSymlinkSegments(resolved, targetSkillRoot);
      for (const source of await listFiles(sourceRoot)) {
        const target = path.join(targetSkillRoot, source.relative);
        const key = slash(path.relative(resolved, target));
        const content = await readFile(source.absolute);
        const sourceHash = digest(content);
        const previousHash = manifest?.files?.[key];
        if (await exists(target)) {
          const details = await lstat(target);
          if (!details.isFile() || details.isSymbolicLink()) throw new Error(`Refusing non-file skill target: ${target}`);
          const currentHash = digest(await readFile(target));
          const ownedAndUnmodified = previousHash && currentHash === previousHash;
          const alreadyCurrent = currentHash === sourceHash;
          if (!ownedAndUnmodified && !alreadyCurrent) {
            throw new Error(`Refusing to overwrite modified or unowned skill file: ${target}`);
          }
          if (!alreadyCurrent) planned.push({ target, content });
        } else {
          planned.push({ target, content });
        }
        nextFiles[key] = sourceHash;
      }
    }
  }

  const contextFile = path.join(resolved, ROOTY_PATHS.context);
  const manifestFile = path.join(resolved, ROOTY_PATHS.manifest);
  const legacyContextFile = path.join(resolved, ROOTY_PATHS.legacyContext);
  const legacyManifestFile = path.join(resolved, ROOTY_PATHS.legacyManifest);
  const gitignoreFile = path.join(resolved, ".gitignore");
  for (const directory of ROOTY_PROJECT_DIRECTORIES) {
    await assertNoSymlinkSegments(resolved, path.join(resolved, directory));
  }
  await assertNoSymlinkSegments(resolved, contextFile);
  await assertNoSymlinkSegments(resolved, manifestFile);
  await assertNoSymlinkSegments(resolved, legacyContextFile);
  await assertNoSymlinkSegments(resolved, legacyManifestFile);
  await assertNoSymlinkSegments(resolved, gitignoreFile);
  if (await exists(gitignoreFile)) {
    const details = await lstat(gitignoreFile);
    if (!details.isFile() || details.isSymbolicLink()) throw new Error(`Refusing unsafe Git ignore target: ${gitignoreFile}`);
  }

  const suppliedDocs = splitDocumentationPaths(documentationPaths);
  const context = suppliedDocs.length > 0
    ? { schema_version: 1, documentation: { paths: await normalizeDocumentationPaths(resolved, suppliedDocs) } }
    : await readProjectContext(resolved);

  const memoryMigration = await migrateLegacyMemory(resolved);

  for (const directory of ROOTY_PROJECT_DIRECTORIES) {
    await mkdir(path.join(resolved, directory), { recursive: true });
  }
  for (const item of planned) {
    await mkdir(path.dirname(item.target), { recursive: true });
    await writeFile(item.target, item.content);
  }
  await atomicJson(contextFile, context);
  const gitignore = await ensureProjectGitignore(packageRoot, resolved);

  const packageManifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const nextManifest = {
    schema_version: 1,
    installation: INSTALLATION_MODE,
    package: { name: packageManifest.name, version: packageManifest.version },
    skill_targets: ROOTY_SKILL_TARGETS,
    skills: ROOTY_SKILLS,
    files: Object.fromEntries(Object.entries(nextFiles).sort(([left], [right]) => left.localeCompare(right))),
    project_context: ROOTY_PATHS.context
  };
  await atomicJson(manifestFile, nextManifest);
  if (await exists(legacyContextFile)) await unlink(legacyContextFile);
  if (await exists(legacyManifestFile)) await unlink(legacyManifestFile);

  return {
    installation: INSTALLATION_MODE,
    projectRoot: resolved,
    manifestFile,
    contextFile,
    documentationPaths: context.documentation.paths,
    memory: {
      drafts: path.join(resolved, MEMORY_PATHS.drafts),
      approved: path.join(resolved, MEMORY_PATHS.approved),
      migratedFiles: memoryMigration.copiedFiles,
      legacyFilesRetained: memoryMigration.legacyFilesRetained
    },
    gitignore,
    skills: ROOTY_SKILLS,
    targets: ROOTY_SKILL_TARGETS,
    writtenFiles: planned.map((item) => item.target)
  };
}

export async function inspectRootyInstall(projectRoot) {
  const resolved = await assertProjectRoot(projectRoot);
  const checks = [];
  const add = (status, name, message) => checks.push({ status, name, message });
  let manifest;
  try {
    manifest = await readManifest(resolved);
    if (!manifest) throw new Error("Run `rooty install` from the project folder");
    add("PASS", "install-manifest", `Rooty ${manifest.package?.version ?? "unknown"} uses ${manifest.installation}`);
  } catch (error) {
    add("FAIL", "install-manifest", error.message);
    return { ok: false, installation: undefined, checks };
  }

  const missing = [];
  const modified = [];
  for (const [relative, expectedHash] of Object.entries(manifest.files)) {
    const target = path.resolve(resolved, relative);
    if (!isInside(resolved, target)) {
      modified.push(relative);
      continue;
    }
    if (!await exists(target)) {
      missing.push(relative);
      continue;
    }
    const details = await lstat(target);
    if (!details.isFile() || details.isSymbolicLink() || digest(await readFile(target)) !== expectedHash) modified.push(relative);
  }
  if (missing.length || modified.length) {
    add("FAIL", "installed-skills", `Missing: ${missing.length}; modified: ${modified.length}. Re-run \`rooty install\` after reviewing local changes.`);
  } else {
    add("PASS", "installed-skills", `${manifest.skills.length} skills are intact in ${manifest.skill_targets.length} host locations`);
  }

  const missingDirectories = [];
  const unsafeDirectories = [];
  for (const relative of ROOTY_PROJECT_DIRECTORIES) {
    const target = path.join(resolved, relative);
    if (!await exists(target)) {
      missingDirectories.push(relative);
      continue;
    }
    const details = await lstat(target);
    if (!details.isDirectory() || details.isSymbolicLink()) unsafeDirectories.push(relative);
  }
  if (missingDirectories.length || unsafeDirectories.length) {
    add("FAIL", "rooty-layout", `Missing directories: ${missingDirectories.join(", ") || "none"}; unsafe directories: ${unsafeDirectories.join(", ") || "none"}. Re-run \`rooty install\`.`);
  } else {
    add("PASS", "rooty-layout", `Canonical memory is available at ${MEMORY_PATHS.root}`);
  }

  try {
    const ignore = await readFile(path.join(resolved, ".gitignore"), "utf8");
    const lines = new Set(ignore.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    if (!lines.has(`${MEMORY_PATHS.drafts}/`)) throw new Error(`Missing ${MEMORY_PATHS.drafts}/`);
    add("PASS", "memory-gitignore", "Memory drafts are excluded from Git");
  } catch (error) {
    add("FAIL", "memory-gitignore", `${error.message}. Re-run \`rooty install\`.`);
  }

  try {
    const context = await readProjectContext(resolved);
    const count = context.documentation.paths.length;
    add(count ? "PASS" : "WARN", "documentation-context", count
      ? `${count} confirmed documentation path(s) are available to the setup agent`
      : "No documentation path is confirmed; the setup agent will ask before source inspection");
  } catch (error) {
    add("FAIL", "documentation-context", error.message);
  }
  return { ok: !checks.some((check) => check.status === "FAIL"), installation: manifest.installation, checks };
}
