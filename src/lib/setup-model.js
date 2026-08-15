import path from "node:path";
import { pathExists, readJson } from "./core.js";

export async function detectSetupModel(projectRoot) {
  const installManifest = path.join(projectRoot, ".rooty/install-manifest.json");
  if (await pathExists(installManifest)) {
    try {
      const manifest = await readJson(installManifest);
      if (manifest.installation === "agent-led-v3") return "agent-led-v3";
    } catch {
      return "invalid-agent-led-install";
    }
  }
  if (await pathExists(path.join(projectRoot, ".investigator/setup-state.json"))) return "automatic-v2";
  if (await pathExists(path.join(projectRoot, ".investigator/sources.json"))) return "legacy-v1";
  return "unconfigured";
}
