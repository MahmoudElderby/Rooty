import path from "node:path";
import { readFile } from "node:fs/promises";
import { parseArgs, option, PACKAGE_ROOT } from "./lib/core.js";
import { discoverSources, configureSources, listSources } from "./lib/sources.js";
import { initializeHosts } from "./lib/hosts.js";
import { runDoctor } from "./lib/doctor.js";
import { assertCaseDirectoryOutsideProject, runFrozenCase, renderExistingCase, appendEvidence } from "./lib/cases.js";
import { proposeMemory, approveMemory } from "./lib/memory.js";
import { runEvaluation } from "./lib/evaluate.js";
import {
  installRooty,
  readProjectContext,
  setDocumentationPaths,
  splitDocumentationPaths,
  ROOTY_HOSTS,
  ROOTY_HOST_IDS
} from "./lib/installer.js";
import {
  configureEnvironmentProfiles,
  discoverEnvironments,
  planEnvironmentSwitch,
  readActiveEnvironments,
  readEnvironmentProfiles,
  useEnvironment
} from "./lib/environments.js";
import { checkpointSetup, readSetupProgress, updateSetupSelections } from "./lib/setup-progress.js";

const HELP = `Rooty Investigator — evidence-first, read-only root-cause analysis

Usage:
  rooty install [--cursor] [--claude] [--codex] [--project PATH] [--docs PATH,...] [--json]
  rooty setup [--cursor] [--claude] [--codex] [--project PATH] [--docs PATH,...] [--json]
  rooty context show [--project PATH] [--json]
  rooty context set-docs (--paths PATH,... | --none) [--project PATH] [--json]
  rooty setup status [--project PATH] [--json]
  rooty setup checkpoint --stage STATE [--host HOST] [--status STATUS] [--project PATH] [--json]
  rooty setup pause --stage STATE --reason skipped|cancelled [--next-action TEXT] [--project PATH] [--json]
  rooty setup selections [--documentation STATUS] [--confirmed NAME,...] [--selected NAME,...] [--active NAME] [--host HOST] [--project PATH] [--json]
  rooty env discover [--project PATH] [--json]
  rooty env configure --file FILE [--project PATH] [--json]
  rooty env list [--project PATH] [--json]
  rooty env plan NAME [--host HOST | --all-hosts] [--project PATH] [--json]
  rooty env use NAME [--host HOST | --all-hosts] [--project PATH] [--json]
  rooty init --host codex|claude|cursor|all [--project PATH] [--demo] [--activate-connectors]
  rooty sources discover [--project PATH] [--output FILE] [--json]
  rooty sources configure [--project PATH] [--discovery FILE] [--<capability>-provider ID] [--<capability>-mcp-url URL] [--<capability>-auth oauth|bearer-env|none] [--<capability>-oauth-token-env NAME] [--<capability>-bearer-token-env NAME]
  rooty sources list <service> --environment <name> [--project PATH]
  rooty doctor [--project PATH] [--host HOST] [--environment NAME] [--json] [--package-only]
  rooty run <ticket> --snapshot FILE [--project PATH] [--case-dir PATH]
  rooty evidence add --case-dir PATH --file FILE [--project PATH]
  rooty report --case-dir PATH [--project PATH]
  rooty memory propose --case-dir PATH [--project PATH]
  rooty memory approve --draft FILE --case-dir PATH --reviewed-by NAME [--project PATH]
  rooty eval [--cases FILE] [--json]

Start with \`rooty install\`. It copies Rooty's agent skills and stores only
confirmed documentation paths. The active AI agent performs discovery and MCP setup.

Name the hosts to install for with \`--cursor\`, \`--claude\`, or \`--codex\`, or with
\`--host cursor,claude\`. Without a host flag, Rooty reuses the hosts from the previous
install, otherwise it installs for every host it detects in the project, otherwise for
all of them.

The CLI never writes secrets. Generated configuration contains only public
endpoints, placeholders, and environment-variable references.`;

const BOOLEAN_OPTIONS = new Set([
  "help",
  "demo",
  "activate-connectors",
  "json",
  "package-only",
  "all-hosts",
  "none",
  ...ROOTY_HOST_IDS
]);

function assertOptionValues(options) {
  for (const [key, value] of Object.entries(options)) {
    if (value === true && !BOOLEAN_OPTIONS.has(key)) {
      throw new Error(`--${key} requires a value`);
    }
  }
}

function projectFrom(options) {
  return path.resolve(String(option(options, "project", process.cwd())));
}

function splitList(value) {
  if (value === undefined) return undefined;
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

async function packageVersion() {
  return JSON.parse(await readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8")).version;
}

function color(code, value) {
  if (!process.stdout.isTTY || process.env.NO_COLOR !== undefined) return value;
  return `\u001b[${code}m${value}\u001b[0m`;
}

const HOST_SELECTION_REASON = Object.freeze({
  requested: "requested",
  "previous-install": "reused from the previous install",
  detected: "detected in this project",
  undetected: "no host detected; installed for all"
});

function installOutput(result) {
  const labels = result.hosts.map((host) => ROOTY_HOSTS[host].label);
  const lines = [
    `${color("1;32", "INSTALLED")} Rooty skills for ${labels.join(", ")}`,
    `${color("1;36", "HOSTS")}     ${result.hosts.join(", ")} (${HOST_SELECTION_REASON[result.hostSelection]})`,
    `${color("1;36", "PROJECT")}   ${result.projectRoot}`,
    `${color("1;36", "SKILLS")}    ${result.skills.join(", ")} in ${result.targets.join(", ")}`,
    `${color("1;36", "ROOTY")}     .rooty/{config,state,memory/{drafts,approved}}`,
    result.memory.migratedFiles.length
      ? `${color("1;36", "MEMORY")}    copied ${result.memory.migratedFiles.length} legacy card(s); legacy files retained`
      : `${color("1;36", "MEMORY")}    ${result.memory.drafts}`,
    result.documentationPaths.length
      ? `${color("1;36", "DOCS")}      ${result.documentationPaths.join(", ")}`
      : `${color("1;33", "DOCS")}      not selected; the setup agent will ask`
  ];
  if (result.unmanagedFiles.length) {
    lines.push(`${color("1;33", "UNTRACKED")} ${result.unmanagedFiles.length} skill file(s) from hosts you did not select remain on disk; delete them yourself or re-run with that host`);
  }
  lines.push(
    "",
    `${color("1", "Next:")} Open ${labels.join(", ")} in this project and ask:`,
    `  ${color("36", "Set up Rooty for this project.")}`
  );
  return `${lines.join("\n")}\n`;
}

export async function main(argv) {
  if (argv.length === 1 && ["--version", "-V"].includes(argv[0])) {
    process.stdout.write(`${await packageVersion()}\n`);
    return;
  }
  const { positional, options } = parseArgs(argv);
  assertOptionValues(options);
  const [command, subcommand, ...rest] = positional;
  if (!command || command === "help" || options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  if (command === "setup" && subcommand === "status") {
    const progress = await readSetupProgress(projectFrom(options));
    if (options.json) process.stdout.write(`${JSON.stringify(progress, null, 2)}\n`);
    else {
      process.stdout.write(`SETUP ${progress.status.toUpperCase()}\nSTAGE ${progress.stage}\n`);
      if (progress.active_host) process.stdout.write(`HOST  ${progress.active_host}\n`);
      if (progress.pause) process.stdout.write(`PAUSE ${progress.pause.reason}: ${progress.pause.next_action ?? progress.pause.step}\n`);
    }
    return;
  }

  if (command === "setup" && ["checkpoint", "pause"].includes(subcommand)) {
    if (!options.stage) throw new Error(`setup ${subcommand} requires --stage`);
    if (subcommand === "pause" && !options.reason) throw new Error("setup pause requires --reason skipped|cancelled");
    const result = await checkpointSetup({
      projectRoot: projectFrom(options),
      stage: String(options.stage).toUpperCase(),
      status: options.status ? String(options.status) : "in_progress",
      activeHost: options.host ? String(options.host) : undefined,
      pauseReason: subcommand === "pause" ? String(options.reason) : undefined,
      nextAction: options["next-action"] ? String(options["next-action"]) : undefined
    });
    if (options.json) process.stdout.write(`${JSON.stringify(result.progress, null, 2)}\n`);
    else process.stdout.write(`${subcommand === "pause" ? "PAUSED" : "CHECKPOINTED"} ${result.progress.stage}\n`);
    return;
  }

  if (command === "setup" && subcommand === "selections") {
    const result = await updateSetupSelections({
      projectRoot: projectFrom(options),
      documentationStatus: options.documentation ? String(options.documentation) : undefined,
      confirmedEnvironments: splitList(options.confirmed),
      selectedEnvironments: splitList(options.selected),
      initialActive: options.active ? String(options.active) : undefined,
      activeHost: options.host ? String(options.host) : undefined
    });
    if (options.json) process.stdout.write(`${JSON.stringify(result.progress, null, 2)}\n`);
    else process.stdout.write("UPDATED setup selections\n");
    return;
  }

  if (command === "install" || (command === "setup" && !subcommand)) {
    const result = await installRooty({
      packageRoot: PACKAGE_ROOT,
      projectRoot: projectFrom(options),
      documentationPaths: splitDocumentationPaths(options.docs),
      hosts: [
        ...ROOTY_HOST_IDS.filter((host) => options[host] !== undefined),
        ...(options.host === undefined ? [] : [String(options.host)])
      ]
    });
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else process.stdout.write(installOutput(result));
    return;
  }

  if (command === "context" && subcommand === "show") {
    const context = await readProjectContext(projectFrom(options));
    if (options.json) process.stdout.write(`${JSON.stringify(context, null, 2)}\n`);
    else {
      const paths = context.documentation.paths;
      process.stdout.write(context.documentation.status === "confirmed_none"
        ? `${color("1;36", "DOCUMENTATION")} Developer confirmed that no documentation entry point is available.\n`
        : paths.length
        ? `${color("1;36", "DOCUMENTATION")}\n${paths.map((item) => `  - ${item}`).join("\n")}\n`
        : `${color("1;33", "DOCUMENTATION")} No confirmed paths. Ask the setup agent to help select them.\n`);
    }
    return;
  }

  if (command === "context" && subcommand === "set-docs") {
    if (Boolean(options.paths) === Boolean(options.none)) throw new Error("context set-docs requires exactly one of --paths PATH,... or --none");
    const result = await setDocumentationPaths({
      projectRoot: projectFrom(options),
      documentationPaths: splitDocumentationPaths(options.paths),
      confirmNone: Boolean(options.none)
    });
    await updateSetupSelections({ projectRoot: projectFrom(options), documentationStatus: result.context.documentation.status });
    await checkpointSetup({ projectRoot: projectFrom(options), stage: "DOCS_CONFIRMED" });
    if (options.json) process.stdout.write(`${JSON.stringify(result.context, null, 2)}\n`);
    else process.stdout.write(result.context.documentation.status === "confirmed_none"
      ? `${color("1;32", "UPDATED")} Confirmed that no documentation entry point is available\n`
      : `${color("1;32", "UPDATED")} Documentation paths: ${result.context.documentation.paths.join(", ")}\n`);
    return;
  }

  if (command === "env" && subcommand === "discover") {
    const result = await discoverEnvironments({ projectRoot: projectFrom(options) });
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      process.stdout.write(`Scanned ${result.scanned_files} safe files. Environment candidates are unconfirmed:\n`);
      if (!result.candidates.length) process.stdout.write("  none\n");
      for (const candidate of result.candidates) process.stdout.write(`  ${candidate.id}: ${candidate.evidence.length} evidence path(s)\n`);
      process.stdout.write("Next: ask the developer which environments to configure and which one to activate.\n");
    }
    return;
  }

  if (command === "env" && subcommand === "configure") {
    if (!options.file) throw new Error("env configure requires --file");
    const result = await configureEnvironmentProfiles({ projectRoot: projectFrom(options), sourceFile: String(options.file) });
    if (options.json) process.stdout.write(`${JSON.stringify(result.profiles, null, 2)}\n`);
    else process.stdout.write(`CONFIGURED ${Object.keys(result.profiles.environments).join(", ")} in ${result.file}\n`);
    return;
  }

  if (command === "env" && ["list", "current"].includes(subcommand)) {
    const projectRoot = projectFrom(options);
    const profiles = await readEnvironmentProfiles(projectRoot, { required: false });
    const active = await readActiveEnvironments(projectRoot);
    const result = { environments: Object.keys(profiles?.environments ?? {}), active: active.hosts };
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      process.stdout.write(`ENVIRONMENTS ${result.environments.join(", ") || "none configured"}\n`);
      for (const [host, state] of Object.entries(active.hosts)) process.stdout.write(`ACTIVE ${host}: ${state.environment} (${state.status})\n`);
    }
    return;
  }

  if (command === "env" && ["plan", "use"].includes(subcommand)) {
    const environment = rest[0];
    if (!environment) throw new Error(`env ${subcommand} requires an environment name`);
    if (options.host && options["all-hosts"]) throw new Error("Choose --host or --all-hosts, not both");
    const input = {
      projectRoot: projectFrom(options),
      environment,
      host: options.host ? String(options.host) : undefined,
      allHosts: Boolean(options["all-hosts"])
    };
    const result = subcommand === "plan" ? await planEnvironmentSwitch(input) : await useEnvironment(input);
    if (options.json) process.stdout.write(`${JSON.stringify(result, (key, value) => key === "entry" ? undefined : value, 2)}\n`);
    else {
      process.stdout.write(`${subcommand === "plan" ? "PLAN" : "SWITCHED"} ${result.environment}\n`);
      for (const plan of result.plans) {
        process.stdout.write(`HOST ${plan.host}\n`);
        process.stdout.write(`  config ${plan.config_file}\n`);
        process.stdout.write(`  environment ${plan.current_environment ?? "none"} -> ${plan.target_environment}\n`);
        for (const name of plan.removed) process.stdout.write(`  - ${name}\n`);
        for (const name of plan.added) process.stdout.write(`  + ${name}\n`);
        for (const item of plan.targets) {
          const connection = item.entry.url ?? [item.entry.command, ...(item.entry.args ?? [])].join(" ");
          process.stdout.write(`  = ${item.logicalId}: ${connection}\n`);
        }
        for (const message of plan.missing) process.stdout.write(`  ! ${message}\n`);
      }
      if (subcommand === "use") process.stdout.write("Reload the host MCP servers, then run `rooty doctor`.\n");
    }
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === "init") {
    const result = await initializeHosts({
      packageRoot: PACKAGE_ROOT,
      projectRoot: projectFrom(options),
      host: String(option(options, "host", "all")),
      demo: Boolean(options.demo),
      activateConnectors: Boolean(options["activate-connectors"])
    });
    process.stdout.write(`Initialized: ${result.files.join(", ")}\nConnectors activated: ${result.connectorsActivated.join(", ") || "demo only / none"}\n`);
    return;
  }

  if (command === "sources" && subcommand === "discover") {
    const result = await discoverSources({
      packageRoot: PACKAGE_ROOT,
      projectRoot: projectFrom(options),
      output: options.output ? path.resolve(String(options.output)) : undefined
    });
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      process.stdout.write(`Discovery complete for ${result.project}: scanned ${result.scanned_files} safe files.\n`);
      if (result.detections.length === 0) process.stdout.write("Candidates: none; provider selection is required for every capability.\n");
      else {
        process.stdout.write("Candidates (not yet validated):\n");
        for (const detection of result.detections) {
          process.stdout.write(`  ${detection.capability.padEnd(14)} ${detection.provider} (${Math.round(Number(detection.confidence) * 100)}%, ${detection.evidence.length} source file(s))\n`);
        }
      }
      process.stdout.write(`Skipped sensitive/unreadable files: ${result.warnings.length}; details are in the discovery file.\n`);
      process.stdout.write(`Discovery file: ${result.output_file}\n`);
      process.stdout.write("Next: validate the candidates, then run `rooty sources configure --project <path> ...`.\n");
    }
    return;
  }

  if (command === "sources" && subcommand === "configure") {
    const capabilities = ["ticketing", "documentation", "observability", "database", "deployments"];
    const endpoints = Object.fromEntries(capabilities.filter((capability) => options[`${capability}-mcp-url`]).map((capability) => [capability, String(options[`${capability}-mcp-url`])]));
    const providers = Object.fromEntries(capabilities.filter((capability) => options[`${capability}-provider`]).map((capability) => [capability, String(options[`${capability}-provider`])]));
    const auth = Object.fromEntries(capabilities.filter((capability) => options[`${capability}-auth`]).map((capability) => [capability, String(options[`${capability}-auth`])]));
    const bearerTokenEnv = Object.fromEntries(capabilities.filter((capability) => options[`${capability}-bearer-token-env`]).map((capability) => [capability, String(options[`${capability}-bearer-token-env`])]));
    const oauthTokenEnv = Object.fromEntries(capabilities.filter((capability) => options[`${capability}-oauth-token-env`]).map((capability) => [capability, String(options[`${capability}-oauth-token-env`])]));
    const result = await configureSources({
      packageRoot: PACKAGE_ROOT,
      projectRoot: projectFrom(options),
      discoveryFile: options.discovery ? path.resolve(String(options.discovery)) : undefined,
      endpoints,
      providers,
      auth,
      bearerTokenEnv,
      oauthTokenEnv
    });
    process.stdout.write(`Wrote ${result.file}; unresolved: ${result.unresolved.join(", ") || "none"}\n`);
    return;
  }

  if (command === "sources" && subcommand === "list") {
    const service = rest[0];
    if (!service) throw new Error("sources list requires a service name");
    const result = await listSources({
      projectRoot: projectFrom(options),
      service,
      environment: option(options, "environment", "production")
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "doctor") {
    const result = await runDoctor({
      packageRoot: PACKAGE_ROOT,
      projectRoot: projectFrom(options),
      packageOnly: Boolean(options["package-only"]),
      host: options.host ? String(options.host) : undefined,
      environment: options.environment ? String(options.environment) : undefined
    });
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      process.stdout.write(`VERSION ${result.version.cli}${result.version.project_install ? ` (project ${result.version.project_install})` : ""}\n`);
      const labels = { package: "PACKAGE_READY", project: "PROJECT_CONFIGURED", investigation: "INVESTIGATION_READY" };
      for (const [name, section] of Object.entries(result.sections)) {
        process.stdout.write(`${labels[name]} ${section.status}\n`);
        for (const check of section.checks) process.stdout.write(`  ${check.status.padEnd(4)} ${check.name}: ${check.message}\n`);
      }
    }
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === "run") {
    const ticket = subcommand;
    if (!ticket || !options.snapshot) throw new Error("run requires <ticket> and --snapshot FILE");
    const projectRoot = projectFrom(options);
    const result = await runFrozenCase({
      projectRoot,
      ticket,
      snapshotFile: path.resolve(String(options.snapshot)),
      caseDir: options["case-dir"] ? path.resolve(String(options["case-dir"])) : undefined
    });
    process.stdout.write(`Case ${result.caseId}: ${result.status}\nReport: ${result.reportFile}\n`);
    return;
  }

  if (command === "evidence" && subcommand === "add") {
    if (!options["case-dir"] || !options.file) throw new Error("evidence add requires --case-dir and --file");
    const caseDir = await assertCaseDirectoryOutsideProject(projectFrom(options), path.resolve(String(options["case-dir"])));
    const result = await appendEvidence(caseDir, await importJson(path.resolve(String(options.file))));
    process.stdout.write(`Appended ${result.evidence_id} at sequence ${result.sequence}\n`);
    return;
  }

  if (command === "report") {
    if (!options["case-dir"]) throw new Error("report requires --case-dir");
    const caseDir = await assertCaseDirectoryOutsideProject(projectFrom(options), path.resolve(String(options["case-dir"])));
    const result = await renderExistingCase(caseDir);
    process.stdout.write(`Rendered ${result.reportFile}\n`);
    return;
  }

  if (command === "memory" && subcommand === "propose") {
    if (!options["case-dir"]) throw new Error("memory propose requires --case-dir");
    const result = await proposeMemory({ projectRoot: projectFrom(options), caseDir: path.resolve(String(options["case-dir"])) });
    process.stdout.write(`Draft: ${result.file}\n`);
    return;
  }

  if (command === "memory" && subcommand === "approve") {
    if (!options.draft || !options["case-dir"] || !options["reviewed-by"]) throw new Error("memory approve requires --draft, --case-dir, and --reviewed-by");
    const result = await approveMemory({
      projectRoot: projectFrom(options),
      draftFile: path.resolve(String(options.draft)),
      reviewedBy: String(options["reviewed-by"]),
      caseDir: path.resolve(String(options["case-dir"]))
    });
    process.stdout.write(`Approved: ${result.file}\n`);
    return;
  }

  if (command === "eval") {
    const result = await runEvaluation({
      casesFile: options.cases ? path.resolve(String(options.cases)) : path.join(PACKAGE_ROOT, "evals/cases/replay-cases.json")
    });
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else process.stdout.write(`Evaluation: ${result.passed}/${result.total} passed; mutations blocked ${result.mutations_blocked}/${result.mutation_attempts}; unsupported confirmations ${result.unsupported_confirmations}\n`);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  throw new Error(`Unknown command.\n\n${HELP}`);
}

async function importJson(filePath) {
  const { readFile } = await import("node:fs/promises");
  return JSON.parse(await readFile(filePath, "utf8"));
}
