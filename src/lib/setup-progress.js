import path from "node:path";
import { atomicWriteJson, assertNoSymlinkPath, readOptionalJson, resolveProjectRoot } from "./project-state.js";
import { ROOTY_HOST_IDS } from "./installer.js";

export const SETUP_PROGRESS_PATH = ".rooty/state/setup-progress.json";
export const SETUP_STAGES = Object.freeze([
  "INSTALLED",
  "DOCS_CONFIRMED",
  "ENVIRONMENTS_CONFIRMED",
  "DISCOVERED",
  "PROPOSED",
  "APPROVED",
  "CONFIGURED",
  "VERIFIED"
]);
const SETUP_STATUSES = new Set(["in_progress", "paused", "complete"]);
const PAUSE_REASONS = new Set(["skipped", "cancelled"]);

function initialProgress() {
  return {
    schema_version: 1,
    status: "in_progress",
    stage: "INSTALLED",
    updated_at: undefined,
    documentation: { status: "pending" },
    environments: { confirmed: [], selected_for_setup: [], initial_active: undefined },
    capabilities: {}
  };
}

function validateStringArray(value, name) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`Invalid setup progress ${name}`);
  }
}

export function validateSetupProgress(progress) {
  if (!progress || typeof progress !== "object" || Array.isArray(progress) || progress.schema_version !== 1) {
    throw new Error("Invalid setup progress schema");
  }
  if (!SETUP_STATUSES.has(progress.status)) throw new Error(`Invalid setup progress status: ${progress.status}`);
  if (!SETUP_STAGES.includes(progress.stage)) throw new Error(`Invalid setup progress stage: ${progress.stage}`);
  if (progress.active_host !== undefined && !ROOTY_HOST_IDS.includes(progress.active_host)) throw new Error(`Invalid setup progress host: ${progress.active_host}`);
  if (!progress.documentation || !["pending", "confirmed_paths", "confirmed_none"].includes(progress.documentation.status)) {
    throw new Error("Invalid setup progress documentation status");
  }
  if (!progress.environments || typeof progress.environments !== "object") throw new Error("Invalid setup progress environments");
  validateStringArray(progress.environments.confirmed ?? [], "environments.confirmed");
  validateStringArray(progress.environments.selected_for_setup ?? [], "environments.selected_for_setup");
  if (progress.pause !== undefined) {
    if (!PAUSE_REASONS.has(progress.pause.reason) || typeof progress.pause.step !== "string" || !progress.pause.step) {
      throw new Error("Invalid setup progress pause");
    }
  }
  return progress;
}

export async function readSetupProgress(projectRoot) {
  const resolved = await resolveProjectRoot(projectRoot);
  const file = path.join(resolved, SETUP_PROGRESS_PATH);
  const progress = await readOptionalJson(file);
  return progress ? validateSetupProgress(progress) : initialProgress();
}

export async function checkpointSetup({ projectRoot, stage, status = "in_progress", activeHost, pauseReason, nextAction }) {
  const resolved = await resolveProjectRoot(projectRoot);
  if (!SETUP_STAGES.includes(stage)) throw new Error(`Unsupported setup stage: ${stage}`);
  if (!SETUP_STATUSES.has(status)) throw new Error(`Unsupported setup status: ${status}`);
  if (activeHost !== undefined && !ROOTY_HOST_IDS.includes(activeHost)) throw new Error(`Unsupported host: ${activeHost}`);
  if (pauseReason !== undefined && !PAUSE_REASONS.has(pauseReason)) throw new Error(`Unsupported pause reason: ${pauseReason}`);
  const current = await readSetupProgress(resolved);
  const next = {
    ...current,
    status: pauseReason ? "paused" : status,
    stage,
    ...(activeHost ? { active_host: activeHost } : {}),
    updated_at: new Date().toISOString(),
    ...(pauseReason ? { pause: { step: stage, reason: pauseReason, ...(nextAction ? { next_action: nextAction } : {}) } } : { pause: undefined })
  };
  validateSetupProgress(next);
  const file = path.join(resolved, SETUP_PROGRESS_PATH);
  await assertNoSymlinkPath(resolved, file);
  await atomicWriteJson(file, next);
  return { file, progress: next };
}

export async function updateSetupSelections({ projectRoot, documentationStatus, confirmedEnvironments, selectedEnvironments, initialActive, activeHost }) {
  const resolved = await resolveProjectRoot(projectRoot);
  const current = await readSetupProgress(resolved);
  const next = {
    ...current,
    ...(activeHost ? { active_host: activeHost } : {}),
    ...(documentationStatus ? { documentation: { status: documentationStatus } } : {}),
    environments: {
      confirmed: confirmedEnvironments ?? current.environments.confirmed,
      selected_for_setup: selectedEnvironments ?? current.environments.selected_for_setup,
      initial_active: initialActive ?? current.environments.initial_active
    },
    updated_at: new Date().toISOString()
  };
  validateSetupProgress(next);
  const file = path.join(resolved, SETUP_PROGRESS_PATH);
  await assertNoSymlinkPath(resolved, file);
  await atomicWriteJson(file, next);
  return { file, progress: next };
}
