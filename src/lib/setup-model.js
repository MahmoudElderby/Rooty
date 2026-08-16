import path from "node:path";
import { pathExists, readJson } from "./core.js";
import { ROOTY_PATHS } from "./installer.js";

export async function detectSetupModel(projectRoot) {
  const candidates = [ROOTY_PATHS.manifest, ROOTY_PATHS.legacyManifest].map((relative) => path.join(projectRoot, relative));
  const installManifest = (await Promise.all(candidates.map(pathExists))).findIndex(Boolean);
  if (installManifest !== -1) {
    try {
      const manifest = await readJson(candidates[installManifest]);
      if (manifest.installation === "agent-led-v3") return "agent-led-v3";
    } catch {
      return "invalid-agent-led-install";
    }
  }
  if (await pathExists(path.join(projectRoot, ".investigator/setup-state.json"))) return "automatic-v2";
  if (await pathExists(path.join(projectRoot, ".investigator/sources.json"))) return "legacy-v1";
  return "unconfigured";
}
