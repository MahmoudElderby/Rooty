import path from "node:path";
import { parseArgs, option, PACKAGE_ROOT } from "./lib/core.js";
import { discoverSources, configureSources, listSources } from "./lib/sources.js";
import { initializeHosts } from "./lib/hosts.js";
import { runDoctor } from "./lib/doctor.js";
import { assertCaseDirectoryOutsideProject, runFrozenCase, renderExistingCase, appendEvidence } from "./lib/cases.js";
import { proposeMemory, approveMemory } from "./lib/memory.js";
import { runEvaluation } from "./lib/evaluate.js";
import { installRooty, readProjectContext, setDocumentationPaths, splitDocumentationPaths } from "./lib/installer.js";

const HELP = `Rooty Investigator — evidence-first, read-only root-cause analysis

Usage:
  rooty install [--project PATH] [--docs PATH,...] [--json]
  rooty setup [--project PATH] [--docs PATH,...] [--json]
  rooty context show [--project PATH] [--json]
  rooty context set-docs --paths PATH,... [--project PATH] [--json]
  rooty init --host codex|claude|cursor|all [--project PATH] [--demo] [--activate-connectors]
  rooty sources discover [--project PATH] [--output FILE] [--json]
  rooty sources configure [--project PATH] [--discovery FILE] [--<capability>-provider ID] [--<capability>-mcp-url URL] [--<capability>-auth oauth|bearer-env|none] [--<capability>-oauth-token-env NAME] [--<capability>-bearer-token-env NAME]
  rooty sources list <service> --environment <name> [--project PATH]
  rooty doctor [--project PATH] [--json] [--package-only]
  rooty run <ticket> --snapshot FILE [--project PATH] [--case-dir PATH]
  rooty evidence add --case-dir PATH --file FILE [--project PATH]
  rooty report --case-dir PATH [--project PATH]
  rooty memory propose --case-dir PATH [--project PATH]
  rooty memory approve --draft FILE --case-dir PATH --reviewed-by NAME [--project PATH]
  rooty eval [--cases FILE] [--json]

Start with \`rooty install\`. It copies Rooty's agent skills and stores only
confirmed documentation paths. The active AI agent performs discovery and MCP setup.

The CLI never writes secrets. Generated configuration contains only public
endpoints, placeholders, and environment-variable references.`;

const BOOLEAN_OPTIONS = new Set(["help", "demo", "activate-connectors", "json", "package-only"]);

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

function color(code, value) {
  if (!process.stdout.isTTY || process.env.NO_COLOR !== undefined) return value;
  return `\u001b[${code}m${value}\u001b[0m`;
}

function installOutput(result) {
  const lines = [
    `${color("1;32", "INSTALLED")} Rooty skills for Codex, Cursor, and Claude`,
    `${color("1;36", "PROJECT")}   ${result.projectRoot}`,
    `${color("1;36", "SKILLS")}    ${result.skills.join(", ")}`,
    `${color("1;36", "ROOTY")}     .rooty/{config,state,memory/{drafts,approved},mcp/{data,observability,ticketing,custom}}`,
    result.memory.migratedFiles.length
      ? `${color("1;36", "MEMORY")}    copied ${result.memory.migratedFiles.length} legacy card(s); legacy files retained`
      : `${color("1;36", "MEMORY")}    ${result.memory.drafts}`,
    result.documentationPaths.length
      ? `${color("1;36", "DOCS")}      ${result.documentationPaths.join(", ")}`
      : `${color("1;33", "DOCS")}      not selected; the setup agent will ask`,
    "",
    `${color("1", "Next:")} Open Codex, Cursor, or Claude in this project and ask:`,
    `  ${color("36", "Set up Rooty for this project.")}`
  ];
  return `${lines.join("\n")}\n`;
}

export async function main(argv) {
  const { positional, options } = parseArgs(argv);
  assertOptionValues(options);
  const [command, subcommand, ...rest] = positional;
  if (!command || command === "help" || options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  if (command === "install" || command === "setup") {
    const result = await installRooty({
      packageRoot: PACKAGE_ROOT,
      projectRoot: projectFrom(options),
      documentationPaths: splitDocumentationPaths(options.docs)
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
      process.stdout.write(paths.length
        ? `${color("1;36", "DOCUMENTATION")}\n${paths.map((item) => `  - ${item}`).join("\n")}\n`
        : `${color("1;33", "DOCUMENTATION")} No confirmed paths. Ask the setup agent to help select them.\n`);
    }
    return;
  }

  if (command === "context" && subcommand === "set-docs") {
    if (!options.paths) throw new Error("context set-docs requires --paths PATH,...");
    const result = await setDocumentationPaths({
      projectRoot: projectFrom(options),
      documentationPaths: splitDocumentationPaths(options.paths)
    });
    if (options.json) process.stdout.write(`${JSON.stringify(result.context, null, 2)}\n`);
    else process.stdout.write(`${color("1;32", "UPDATED")} Documentation paths: ${result.context.documentation.paths.join(", ")}\n`);
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
      requireActivatedConnectors: !options["package-only"]
    });
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      for (const check of result.checks) process.stdout.write(`${check.status.padEnd(4)} ${check.name}: ${check.message}\n`);
      process.stdout.write(`Doctor: ${result.ok ? "healthy" : "failed"}\n`);
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
