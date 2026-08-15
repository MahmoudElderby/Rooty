import path from "node:path";
import { parseArgs, option, PACKAGE_ROOT } from "./lib/core.js";
import { discoverSources, configureSources, listSources } from "./lib/sources.js";
import { initializeHosts } from "./lib/hosts.js";
import { runDoctor } from "./lib/doctor.js";
import { assertCaseDirectoryOutsideProject, runFrozenCase, renderExistingCase, appendEvidence } from "./lib/cases.js";
import { proposeMemory, approveMemory } from "./lib/memory.js";
import { runEvaluation } from "./lib/evaluate.js";

const HELP = `Rooty Investigator — evidence-first, read-only root-cause analysis

Usage:
  rooty init --host codex|claude|cursor|all [--project PATH] [--demo] [--activate-connectors]
  rooty sources discover [--project PATH] [--output FILE]
  rooty sources configure [--project PATH] [--discovery FILE] [--<capability>-provider ID] [--<capability>-mcp-url URL]
  rooty sources list <service> --environment <name> [--project PATH]
  rooty doctor [--project PATH] [--json]
  rooty run <ticket> --snapshot FILE [--project PATH] [--case-dir PATH]
  rooty evidence add --case-dir PATH --file FILE [--project PATH]
  rooty report --case-dir PATH [--project PATH]
  rooty memory propose --case-dir PATH [--project PATH]
  rooty memory approve --draft FILE --case-dir PATH --reviewed-by NAME [--project PATH]
  rooty eval [--cases FILE] [--json]

The CLI never writes secrets. Generated source configuration contains only public
endpoints, placeholders, and environment-variable references.`;

function projectFrom(options) {
  return path.resolve(String(option(options, "project", process.cwd())));
}

export async function main(argv) {
  const { positional, options } = parseArgs(argv);
  const [command, subcommand, ...rest] = positional;
  if (!command || command === "help" || options.help) {
    process.stdout.write(`${HELP}\n`);
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
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "sources" && subcommand === "configure") {
    const capabilities = ["ticketing", "documentation", "observability", "database", "deployments"];
    const endpoints = Object.fromEntries(capabilities.filter((capability) => options[`${capability}-mcp-url`]).map((capability) => [capability, String(options[`${capability}-mcp-url`])]));
    const providers = Object.fromEntries(capabilities.filter((capability) => options[`${capability}-provider`]).map((capability) => [capability, String(options[`${capability}-provider`])]));
    const auth = Object.fromEntries(capabilities.filter((capability) => options[`${capability}-auth`]).map((capability) => [capability, String(options[`${capability}-auth`])]));
    const bearerTokenEnv = Object.fromEntries(capabilities.filter((capability) => options[`${capability}-bearer-token-env`]).map((capability) => [capability, String(options[`${capability}-bearer-token-env`])]));
    const result = await configureSources({
      packageRoot: PACKAGE_ROOT,
      projectRoot: projectFrom(options),
      discoveryFile: options.discovery ? path.resolve(String(options.discovery)) : undefined,
      endpoints,
      providers,
      auth,
      bearerTokenEnv
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
    const result = await runDoctor({ packageRoot: PACKAGE_ROOT, projectRoot: projectFrom(options) });
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
