import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runDoctor } from "../src/lib/doctor.js";
import { configureEnvironmentProfiles, discoverEnvironments, inspectEnvironmentProject, planEnvironmentSwitch, readActiveEnvironments, useEnvironment, validateEnvironmentProfiles } from "../src/lib/environments.js";
import { installRooty, setDocumentationPaths } from "../src/lib/installer.js";
import { configureMcpSettings, MCP_SETTINGS_PATH, readMcpSettings } from "../src/lib/mcp-settings.js";
import { checkpointSetup, readSetupProgress } from "../src/lib/setup-progress.js";
import { main } from "../src/cli.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(ROOT, "tests/fixtures/environment-mcp.js");

async function project(name) {
  return mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

function target(environment, capability, artifact, projectRoot) {
  const short = environment === "production" ? "prod" : environment;
  const settingKey = `ROOTY_TEST_ENV_${environment.toUpperCase()}`;
  return {
    name: `rooty-${short}-${capability}`,
    artifacts: [artifact, ".rooty/start-mcp.cjs"],
    settings_keys: [settingKey],
    allowed_tools: ["bounded_read"],
    probe: { tool: "bounded_read", arguments: {}, expect_contains: `environment=${environment}` },
    hosts: Object.fromEntries(["cursor", "claude", "codex"].map((host) => [host, {
        type: "stdio",
        command: process.execPath,
        args: [path.join(projectRoot, ".rooty/start-mcp.cjs"), "--settings", path.join(projectRoot, MCP_SETTINGS_PATH), "--keys", settingKey, "--", process.execPath, FIXTURE]
      }]))
  };
}

function profiles(artifact, projectRoot = "C:/project") {
  return {
    schema_version: 1,
    environments: {
      production: { classification: "production", aliases: ["prod"] },
      preprod: { classification: "non-production", aliases: ["pre-production"] }
    },
    logical_servers: {
      data: {
        capability: "data",
        required: true,
        targets: {
          production: target("production", "data", artifact, projectRoot),
          preprod: target("preprod", "data", artifact, projectRoot)
        }
      },
      observability: {
        capability: "observability",
        required: true,
        targets: {
          production: target("production", "observability", artifact, projectRoot),
          preprod: target("preprod", "observability", artifact, projectRoot)
        }
      }
    }
  };
}

async function configuredProject() {
  const projectRoot = await project("rooty-environments");
  await installRooty({ packageRoot: ROOT, projectRoot, hosts: ["cursor"] });
  await setDocumentationPaths({ projectRoot, confirmNone: true });
  const artifact = ".rooty/mcp/data/sql-server/shared/dab-config.json";
  await mkdir(path.join(projectRoot, path.dirname(artifact)), { recursive: true });
  await writeFile(path.join(projectRoot, artifact), "{}\n", "utf8");
  const profileFile = path.join(projectRoot, "profiles.json");
  await writeFile(profileFile, `${JSON.stringify(profiles(artifact, projectRoot), null, 2)}\n`, "utf8");
  await configureEnvironmentProfiles({ projectRoot, sourceFile: profileFile });
  const settingsSource = path.join(projectRoot, "settings-source.json");
  await writeFile(settingsSource, `${JSON.stringify({ schema_version: 1, settings: { ROOTY_TEST_ENV_PRODUCTION: "production", ROOTY_TEST_ENV_PREPROD: "preprod" } }, null, 2)}\n`);
  await configureMcpSettings({ projectRoot, sourceFile: settingsSource });
  await checkpointSetup({ projectRoot, stage: "CONFIGURED", activeHost: "cursor" });
  return projectRoot;
}

test("environment switch infers one configured host and never leaves duplicate logical MCPs", async () => {
  const projectRoot = await configuredProject();
  await mkdir(path.join(projectRoot, ".cursor"), { recursive: true });
  await writeFile(path.join(projectRoot, ".cursor/mcp.json"), `${JSON.stringify({ mcpServers: { unrelated: { url: "https://example.test/mcp" } } }, null, 2)}\n`);

  const planned = await planEnvironmentSwitch({ projectRoot, environment: "preprod" });
  assert.equal(planned.ok, true, JSON.stringify(planned));
  assert.deepEqual(planned.hosts, ["cursor"]);
  await useEnvironment({ projectRoot, environment: "preprod" });
  let config = JSON.parse(await readFile(path.join(projectRoot, ".cursor/mcp.json"), "utf8"));
  assert.deepEqual(Object.keys(config.mcpServers).sort(), ["rooty-preprod-data", "rooty-preprod-observability", "unrelated"]);
  assert.equal((await readActiveEnvironments(projectRoot)).hosts.cursor.environment, "preprod");

  await useEnvironment({ projectRoot, environment: "production" });
  config = JSON.parse(await readFile(path.join(projectRoot, ".cursor/mcp.json"), "utf8"));
  assert.deepEqual(Object.keys(config.mcpServers).sort(), ["rooty-prod-data", "rooty-prod-observability", "unrelated"]);
  assert.equal(Object.keys(config.mcpServers).filter((name) => name.includes("data")).length, 1);

  await useEnvironment({ projectRoot, environment: "prod" });
  assert.equal((await readActiveEnvironments(projectRoot)).hosts.cursor.environment, "production");
});

test("explicit all-host switch renders Cursor, Claude, and Codex without touching unrelated MCPs", async () => {
  const projectRoot = await project("rooty-all-host-environments");
  await installRooty({ packageRoot: ROOT, projectRoot, hosts: ["cursor", "claude", "codex"] });
  const artifact = ".rooty/mcp/shared/config.json";
  await mkdir(path.join(projectRoot, path.dirname(artifact)), { recursive: true });
  await writeFile(path.join(projectRoot, artifact), "{}\n");
  const profileFile = path.join(projectRoot, "profiles.json");
  await writeFile(profileFile, `${JSON.stringify(profiles(artifact, projectRoot), null, 2)}\n`);
  await configureEnvironmentProfiles({ projectRoot, sourceFile: profileFile });
  const settingsSource = path.join(projectRoot, "settings-source.json");
  await writeFile(settingsSource, `${JSON.stringify({ schema_version: 1, settings: { ROOTY_TEST_ENV_PRODUCTION: "production", ROOTY_TEST_ENV_PREPROD: "preprod" } }, null, 2)}\n`);
  await configureMcpSettings({ projectRoot, sourceFile: settingsSource });
  await mkdir(path.join(projectRoot, ".cursor"), { recursive: true });
  await mkdir(path.join(projectRoot, ".codex"), { recursive: true });
  await writeFile(path.join(projectRoot, ".cursor/mcp.json"), '{"mcpServers":{"unrelated":{"url":"https://example.test/mcp"}}}\n');
  await writeFile(path.join(projectRoot, ".mcp.json"), '{"mcpServers":{"unrelated":{"url":"https://example.test/mcp"}}}\n');
  await writeFile(path.join(projectRoot, ".codex/config.toml"), '[mcp_servers.unrelated]\nurl = "https://example.test/mcp"\n');

  const result = await useEnvironment({ projectRoot, environment: "preprod", allHosts: true });
  assert.deepEqual(result.hosts.sort(), ["claude", "codex", "cursor"]);
  for (const file of [".cursor/mcp.json", ".mcp.json"]) {
    const config = JSON.parse(await readFile(path.join(projectRoot, file), "utf8"));
    assert.deepEqual(Object.keys(config.mcpServers).sort(), ["rooty-preprod-data", "rooty-preprod-observability", "unrelated"]);
  }
  const codex = await readFile(path.join(projectRoot, ".codex/config.toml"), "utf8");
  assert.match(codex, /\[mcp_servers\.unrelated\]/);
  assert.match(codex, /\[mcp_servers\."rooty-preprod-data"\]/);
  assert.doesNotMatch(codex, /rooty-prod-data/);
});

test("project readiness rejects a managed MCP whose connection differs from the confirmed environment profile", async () => {
  const projectRoot = await configuredProject();
  await useEnvironment({ projectRoot, environment: "preprod" });
  const file = path.join(projectRoot, ".cursor/mcp.json");
  const config = JSON.parse(await readFile(file, "utf8"));
  config.mcpServers["rooty-preprod-data"].args = ["stale-entry.js"];
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
  const result = await inspectEnvironmentProject(projectRoot, "cursor");
  assert.equal(result.configured, false);
  assert.match(result.checks.find((check) => check.status === "FAIL").message, /differ from the confirmed environment profile/);
});

test("switch validation blocks missing runtime artifacts before creating host configuration", async () => {
  const projectRoot = await project("rooty-blocked-environment");
  await installRooty({ packageRoot: ROOT, projectRoot, hosts: ["cursor"] });
  const profileFile = path.join(projectRoot, "profiles.json");
  await writeFile(profileFile, `${JSON.stringify(profiles(".rooty/mcp/missing/config.json"), null, 2)}\n`);
  await configureEnvironmentProfiles({ projectRoot, sourceFile: profileFile });
  await assert.rejects(useEnvironment({ projectRoot, environment: "preprod" }), /missing artifact/);
  await assert.rejects(readFile(path.join(projectRoot, ".cursor/mcp.json"), "utf8"), { code: "ENOENT" });
});

test("environment profiles reject legacy machine environment credentials", () => {
  const profile = profiles(".rooty/mcp/shared/config.json");
  profile.logical_servers.data.targets.preprod.credential_envs = ["ROOTY_TOKEN"];
  assert.throws(() => validateEnvironmentProfiles(profile), /Legacy credential_envs are unsupported/);
});

test("settings-backed profiles require the Rooty launcher for every host", () => {
  const profile = profiles(".rooty/mcp/shared/config.json");
  profile.logical_servers.data.targets.preprod.hosts.cursor = { command: process.execPath, args: [FIXTURE] };
  assert.throws(() => validateEnvironmentProfiles(profile), /must invoke \.rooty\/start-mcp\.cjs/);
});

test("settings-backed profiles reject host env values and undeclared launcher keys", () => {
  const profile = profiles(".rooty/mcp/shared/config.json");
  const entry = profile.logical_servers.data.targets.production.hosts.cursor;
  entry.env = { ROOTY_TOKEN: "value" };
  assert.throws(() => validateEnvironmentProfiles(profile), /Host env is forbidden/);
  delete entry.env;
  entry.args[entry.args.indexOf("--keys") + 1] += ",UNDECLARED";
  assert.throws(() => validateEnvironmentProfiles(profile), /exactly match settings_keys/);
});

test("settings CLI never prints configured values", async () => {
  const projectRoot = await project("rooty-settings-output");
  await installRooty({ packageRoot: ROOT, projectRoot, hosts: ["cursor"] });
  const sourceFile = path.join(projectRoot, "settings-source.json");
  const secret = "do-not-print-this-value";
  await writeFile(sourceFile, `${JSON.stringify({ schema_version: 1, settings: { ROOTY_API_TOKEN: secret } })}\n`);
  const outputs = [];
  const write = process.stdout.write;
  process.stdout.write = (value) => { outputs.push(String(value)); return true; };
  try {
    await main(["settings", "configure", "--file", sourceFile, "--project", projectRoot, "--json"]);
    await main(["settings", "status", "--project", projectRoot]);
  } finally {
    process.stdout.write = write;
  }
  assert.doesNotMatch(outputs.join(""), new RegExp(secret));
  assert.match(outputs.join(""), /ROOTY_API_TOKEN/);
  assert.equal((await readMcpSettings(projectRoot)).settings.ROOTY_API_TOKEN, secret);
});

test("environment discovery reports bounded unconfirmed candidates without reading secret files", async () => {
  const projectRoot = await project("rooty-env-discovery");
  await mkdir(path.join(projectRoot, "deploy"));
  await writeFile(path.join(projectRoot, "deploy/production.yaml"), "environment: production\n");
  await writeFile(path.join(projectRoot, "deploy/preprod.yaml"), "environment: preprod\n");
  await writeFile(path.join(projectRoot, "secrets.yaml"), "environment: staging\npassword: hidden\n");
  const result = await discoverEnvironments({ projectRoot });
  assert.deepEqual(result.candidates.map((item) => item.id), ["production", "preprod"]);
  assert.ok(result.candidates.every((item) => item.status === "UNCONFIRMED"));
});

test("environment discovery ignores Rooty's installed skill examples", async () => {
  const projectRoot = await project("rooty-env-own-skills");
  await installRooty({ packageRoot: ROOT, projectRoot, hosts: ["cursor", "claude"] });
  await mkdir(path.join(projectRoot, "deploy"));
  await writeFile(path.join(projectRoot, "deploy/production.yaml"), "environment: production\n");
  const result = await discoverEnvironments({ projectRoot });
  assert.deepEqual(result.candidates.map((item) => item.id), ["production"]);
  assert.ok(result.candidates[0].evidence.every((item) => !item.includes("skills")));
});

test("setup pause persists cancellation and a later checkpoint resumes it", async () => {
  const projectRoot = await project("rooty-setup-progress");
  await installRooty({ packageRoot: ROOT, projectRoot, hosts: ["cursor"] });
  await checkpointSetup({ projectRoot, stage: "ENVIRONMENTS_CONFIRMED", pauseReason: "cancelled", nextAction: "Confirm environments" });
  let progress = await readSetupProgress(projectRoot);
  assert.equal(progress.status, "paused");
  assert.equal(progress.pause.reason, "cancelled");
  await checkpointSetup({ projectRoot, stage: "ENVIRONMENTS_CONFIRMED", activeHost: "cursor" });
  progress = await readSetupProgress(projectRoot);
  assert.equal(progress.status, "in_progress");
  assert.equal(progress.pause, undefined);
});

test("agent-led doctor separates package, project, and live environment readiness", async () => {
  const projectRoot = await configuredProject();
  await useEnvironment({ projectRoot, environment: "preprod" });
  const result = await runDoctor({ packageRoot: ROOT, projectRoot, connectorTimeoutMs: 10000, host: "cursor" });
  assert.equal(result.sections.package.status, "READY", JSON.stringify(result.checks));
  assert.equal(result.sections.project.status, "READY", JSON.stringify(result.checks));
  assert.equal(result.sections.investigation.status, "READY", JSON.stringify(result.checks));
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  assert.ok(result.sections.investigation.checks.some((check) => check.name.endsWith("identity-read") && check.status === "PASS"));
  assert.equal(result.identity_verifications.length, 1);
  const identity = result.identity_verifications[0];
  assert.equal(identity.status, "READY");
  assert.equal(identity.host.id, "cursor");
  assert.equal(identity.environment.id, "preprod");
  assert.match(identity.project.root_fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.match(identity.host.config_generation, /^sha256:[a-f0-9]{64}$/);
  assert.match(identity.environment.profile_hash, /^sha256:[a-f0-9]{64}$/);
  assert.match(identity.verification_hash, /^sha256:[a-f0-9]{64}$/);
  assert.ok(identity.providers.every((provider) => provider.allowed_tools.length > 0));
  assert.doesNotMatch(JSON.stringify(identity), /secret-value/);
});

test("CLI supports standard version flags", async () => {
  const version = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8")).version;
  const outputs = [];
  const write = process.stdout.write;
  process.stdout.write = (value) => { outputs.push(String(value)); return true; };
  try {
    await main(["--version"]);
    await main(["-V"]);
  } finally {
    process.stdout.write = write;
  }
  assert.deepEqual(outputs, [`${version}\n`, `${version}\n`]);
});
