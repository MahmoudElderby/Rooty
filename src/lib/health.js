import path from "node:path";
import { assertNoEmbeddedSecrets, isoNow, readJson } from "./core.js";
import { atomicWriteJson, atomicWriteText } from "./project-state.js";

export const HEALTH_STATES = Object.freeze(["HEALTHY", "DEGRADED", "CRITICAL", "UNKNOWN"]);
const PROBE_STATES = new Set(["PASS", "FAIL", "UNAVAILABLE"]);

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateProfile(profile) {
  assertNoEmbeddedSecrets(profile, "health profile");
  if (profile?.schema_version !== 1) throw new Error("Health profile schema_version must be 1");
  if (!nonEmpty(profile?.environment)) throw new Error("Health profile requires environment identity");
  if (profile?.confirmation?.status !== "CONFIRMED") throw new Error("Health profile requires developer confirmation before evaluation");
  if (!Array.isArray(profile.components) || !profile.components.length) throw new Error("Health profile requires at least one project component");
  const ids = new Set();
  for (const component of profile.components) {
    if (!nonEmpty(component?.id) || ids.has(component.id)) throw new Error("Health component IDs must be non-empty and unique");
    ids.add(component.id);
    if (component.transport === "mcp" || /^mcp(?:[-_ ]|$)/i.test(component.id)) throw new Error(`MCP transport cannot be a measured project component: ${component.id}`);
    if (!Array.isArray(component.dependencies)) throw new Error(`Health component ${component.id} requires dependencies`);
    if (!Array.isArray(component.probes) || !component.probes.length) throw new Error(`Health component ${component.id} requires bounded read-only probes`);
    const probeIds = new Set();
    for (const probe of component.probes) {
      if (!nonEmpty(probe?.id) || probe.read_only !== true || !Number.isFinite(Number(probe.timeout_ms)) || Number(probe.timeout_ms) <= 0 || !nonEmpty(probe.expected)) {
        throw new Error(`Health component ${component.id} has an invalid probe; id, read_only=true, timeout_ms, and expected are required`);
      }
      if (probeIds.has(probe.id)) throw new Error(`Duplicate health probe ${probe.id} for ${component.id}`);
      probeIds.add(probe.id);
      if (probe.timeout_ms > 120_000) throw new Error(`Health probe ${probe.id} exceeds the 120000ms bound`);
    }
    if (component.log_indicators !== undefined) {
      if (!Array.isArray(component.log_indicators)) throw new Error(`Health component ${component.id} log_indicators must be an array`);
      for (const indicator of component.log_indicators) {
        if (!nonEmpty(indicator?.id) || indicator.read_only !== true || !Number.isFinite(Number(indicator.timeout_ms)) || indicator.timeout_ms <= 0 || indicator.timeout_ms > 120_000 || !Number.isFinite(Number(indicator.window_minutes)) || indicator.window_minutes <= 0 || indicator.window_minutes > 1440 || !nonEmpty(indicator.concerning_condition)) {
          throw new Error(`Health component ${component.id} has an invalid bounded log indicator`);
        }
      }
    }
  }
  for (const component of profile.components) {
    for (const dependency of component.dependencies) if (!ids.has(dependency)) throw new Error(`Unknown dependency ${dependency} for ${component.id}`);
  }
}

function validateObservations(observations) {
  assertNoEmbeddedSecrets(observations, "health observations");
  if (observations?.schema_version !== 1) throw new Error("Health observations schema_version must be 1");
  if (!nonEmpty(observations?.environment)) throw new Error("Health observations require environment identity");
  if (!Array.isArray(observations.components)) throw new Error("Health observations require components");
  const componentIds = new Set();
  for (const component of observations.components) {
    if (!nonEmpty(component?.component_id)) throw new Error("Health observation requires component_id");
    if (componentIds.has(component.component_id)) throw new Error(`Duplicate health observation for ${component.component_id}`);
    componentIds.add(component.component_id);
    if (!Array.isArray(component.probes)) throw new Error(`Health observation ${component.component_id} requires probes`);
    const probeIds = new Set();
    for (const probe of component.probes) {
      if (!nonEmpty(probe?.probe_id) || !PROBE_STATES.has(probe.status)) throw new Error(`Invalid probe observation for ${component.component_id}`);
      if (probeIds.has(probe.probe_id)) throw new Error(`Duplicate probe observation ${probe.probe_id} for ${component.component_id}`);
      probeIds.add(probe.probe_id);
      if (probe.evidence_refs !== undefined && !Array.isArray(probe.evidence_refs)) throw new Error(`Probe ${probe.probe_id} evidence_refs must be an array`);
    }
    if ((component.log_indicators ?? []).some((indicator) => !["OK", "CONCERN", "UNAVAILABLE"].includes(indicator?.status))) throw new Error(`Invalid log indicator observation for ${component.component_id}`);
  }
}

function componentStatus(profileComponent, observation, identityMismatch) {
  if (identityMismatch) return "CRITICAL";
  if (!observation) return "UNKNOWN";
  const byProbe = new Map(observation.probes.map((probe) => [probe.probe_id, probe]));
  const required = profileComponent.probes.map((probe) => byProbe.get(probe.id));
  if (required.some((probe) => probe?.status === "FAIL")) return "CRITICAL";
  if (required.some((probe) => !probe || probe.status === "UNAVAILABLE")) return "UNKNOWN";
  const logSignals = observation.log_indicators ?? [];
  if (logSignals.some((signal) => signal.status === "CONCERN")) return "DEGRADED";
  return "HEALTHY";
}

function dependencyEffects(components) {
  const byId = new Map(components.map((component) => [component.id, component]));
  const effects = [];
  for (const component of components) {
    for (const dependency of component.dependencies) {
      const upstream = byId.get(dependency);
      if (upstream && ["CRITICAL", "UNKNOWN"].includes(upstream.status)) {
        effects.push({ component_id: component.id, dependency_id: dependency, dependency_status: upstream.status, effect: upstream.status === "CRITICAL" ? "DEPENDENCY_FAILURE" : "VISIBILITY_GAP" });
      }
    }
  }
  return effects;
}

function renderHealth(report) {
  const rows = report.components.map((component) => `| ${component.id} | ${component.status} | ${component.dependencies.join(", ") || "none"} |`).join("\n");
  return `# Rooty project health\n\n- Environment: ${report.environment}\n- Overall status: **${report.overall_status}**\n- Evaluated: ${report.evaluated_at}\n\n## Components\n\n| Component | Status | Dependencies |\n|---|---|---|\n${rows}\n\n## Alerts\n\n${report.alerts.length ? report.alerts.map((alert) => `- ${alert.severity} ${alert.component_id}: ${alert.message}`).join("\n") : "- None."}\n\n## Visibility gaps\n\n${report.visibility_gaps.length ? report.visibility_gaps.map((gap) => `- ${gap.component_id}: ${gap.message}`).join("\n") : "- None."}\n\n## Dependency effects\n\n${report.dependency_effects.length ? report.dependency_effects.map((effect) => `- ${effect.component_id} depends on ${effect.dependency_id} (${effect.dependency_status}).`).join("\n") : "- None."}\n\n## Limitations\n\n${report.limitations.length ? report.limitations.map((item) => `- ${item}`).join("\n") : "- None recorded."}\n\n## Recommended next investigation\n\n${report.recommended_next_investigation.map((item) => `- ${item}`).join("\n")}\n`;
}

export function evaluateHealthDocuments(profile, observations) {
  validateProfile(profile);
  validateObservations(observations);
  const identityMismatch = profile.environment !== observations.environment || observations.identity_verified === false;
  const cloudVisibilityGap = profile.cloud_resources?.required === true && observations.cloud_visibility !== true;
  const observedById = new Map(observations.components.map((component) => [component.component_id, component]));
  const components = profile.components.map((component) => {
    const observation = observedById.get(component.id);
    const status = componentStatus(component, observation, identityMismatch);
    const probeById = new Map((observation?.probes ?? []).map((probe) => [probe.probe_id, probe]));
    return {
      id: component.id,
      name: component.name ?? component.id,
      status,
      dependencies: component.dependencies,
      probes: component.probes.map((probe) => {
        const observed = probeById.get(probe.id);
        return {
          id: probe.id,
          status: identityMismatch ? "FAIL" : observed?.status ?? "UNAVAILABLE",
          expected: probe.expected,
          evidence_refs: observed?.evidence_refs ?? [],
          ...(observed?.limitation ? { limitation: observed.limitation } : {})
        };
      }),
      log_indicators: observation?.log_indicators ?? [],
      limitations: observation?.limitations ?? []
    };
  });
  let overall = "HEALTHY";
  if (components.some((component) => component.status === "CRITICAL")) overall = "CRITICAL";
  else if (cloudVisibilityGap || components.some((component) => component.status === "UNKNOWN")) overall = "UNKNOWN";
  else if (components.some((component) => component.status === "DEGRADED")) overall = "DEGRADED";
  const alerts = components.filter((component) => component.status === "CRITICAL").map((component) => ({
    alert_type: "PROJECT_COMPONENT_FAILURE",
    severity: "CRITICAL",
    component_id: component.id,
    message: identityMismatch ? "Environment identity did not match the confirmed health profile." : "At least one configured project-component probe failed.",
    evidence_refs: component.probes.flatMap((probe) => probe.evidence_refs)
  }));
  const visibilityGaps = components.filter((component) => component.status === "UNKNOWN").map((component) => ({
    warning_type: "VISIBILITY_GAP",
    component_id: component.id,
    message: "A required probe could not run because access or MCP capability was unavailable.",
    missing_probes: component.probes.filter((probe) => probe.status === "UNAVAILABLE").map((probe) => probe.id)
  }));
  if (cloudVisibilityGap) visibilityGaps.push({
    warning_type: "VISIBILITY_GAP",
    component_id: "cloud-resources",
    message: "Required cloud-resource visibility is unavailable; provider-neutral MCP setup or research is needed.",
    missing_probes: ["cloud-resource-coverage"]
  });
  const limitations = [...(observations.limitations ?? [])];
  if (identityMismatch) limitations.push(`Expected environment ${profile.environment}; observed ${observations.environment}.`);
  if (cloudVisibilityGap) limitations.push("Required cloud-resource visibility is unavailable; provider-neutral cloud MCP setup or research is still needed.");
  const next = [];
  if (alerts.length) next.push("Open a bounded root-cause investigation for the failed component and its affected dependents.");
  if (visibilityGaps.length) next.push("Restore read-only access or add the missing MCP capability, then repeat only the unavailable probes.");
  if (overall === "DEGRADED") next.push("Investigate the bounded concerning log indicators while project probes still pass.");
  if (overall === "HEALTHY") next.push("No immediate investigation is recommended; retain this report as the manual baseline.");
  return {
    schema_version: 1,
    evaluated_at: isoNow(),
    environment: profile.environment,
    overall_status: overall,
    components,
    alerts,
    visibility_gaps: visibilityGaps,
    dependency_effects: dependencyEffects(components),
    limitations,
    recommended_next_investigation: next,
    notification_delivery: "NOT_CONFIGURED"
  };
}

export async function evaluateHealth({ profileFile, observationsFile, outputDir }) {
  if (!profileFile || !observationsFile || !outputDir) throw new Error("health evaluate requires --profile FILE, --observations FILE, and --output DIR");
  const profile = await readJson(path.resolve(String(profileFile)));
  const observations = await readJson(path.resolve(String(observationsFile)));
  const report = evaluateHealthDocuments(profile, observations);
  const target = path.resolve(String(outputDir));
  const project = path.resolve(process.cwd());
  const safeProjectOutput = path.join(project, ".rooty", "health-reports");
  if (isInside(project, target) && !isInside(safeProjectOutput, target)) {
    throw new Error("Health output inside the project must be under Git-ignored .rooty/health-reports; otherwise choose a directory outside the project");
  }
  const jsonFile = path.join(target, "health-report.json");
  const markdownFile = path.join(target, "health-report.md");
  await atomicWriteJson(jsonFile, report);
  await atomicWriteText(markdownFile, renderHealth(report));
  const exitCode = report.overall_status === "CRITICAL" ? 2 : report.overall_status === "HEALTHY" ? 0 : 1;
  return { report, exitCode, files: { json: jsonFile, markdown: markdownFile } };
}
