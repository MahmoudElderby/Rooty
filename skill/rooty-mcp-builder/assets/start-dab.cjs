#!/usr/bin/env node

"use strict";

const { spawn } = require("node:child_process");
const { existsSync, readFileSync, statSync } = require("node:fs");
const path = require("node:path");

const BINDING_PATTERN = /^ROOTY_SQL_[A-Z0-9]+(?:_[A-Z0-9]+)*$/;
const DOMAIN_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CANONICAL_CONFIG_ANCESTORS = Object.freeze([".rooty", "mcp", "data", "sql-server"]);
const LEGACY_DOMAIN_FOLDER_PATTERN = /^mcp-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REQUIRED_TOOLS = Object.freeze({
  "describe-entities": true,
  "create-record": false,
  "read-records": true,
  "update-record": false,
  "delete-record": false,
  "execute-entity": false
});

function fail(message) {
  throw new Error(`Rooty DAB launcher: ${message}`);
}

function parseArgs(argv) {
  const expected = ["--dab", "--config", "--credential-env"];
  if (argv.length !== 6) {
    fail("expected --dab <absolute-dab> --config <absolute-dab-config> --credential-env <binding-name>");
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (argv[index * 2] !== expected[index]) fail(`expected ${expected[index]}`);
  }
  return {
    dabPath: argv[1],
    configPath: argv[3],
    credentialName: argv[5]
  };
}

function trailingSegments(directory, count) {
  const segments = [];
  let current = directory;
  for (let index = 0; index < count; index += 1) {
    segments.unshift(path.basename(current).toLowerCase());
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return segments;
}

function isCanonicalConfigDirectory(configDirectory) {
  for (const suffixCount of [1, 2]) {
    const expected = CANONICAL_CONFIG_ANCESTORS.length + suffixCount;
    const segments = trailingSegments(configDirectory, expected);
    if (segments.length !== expected) continue;
    if (!CANONICAL_CONFIG_ANCESTORS.every((name, index) => segments[index] === name)) continue;
    const suffix = segments.slice(CANONICAL_CONFIG_ANCESTORS.length);
    if (suffix.every((value) => DOMAIN_PATTERN.test(value))) return true;
  }
  return false;
}

function isLegacyConfigDirectory(configDirectory) {
  const segments = trailingSegments(configDirectory, 2);
  return segments.length === 2 && segments[0] === ".rooty" && LEGACY_DOMAIN_FOLDER_PATTERN.test(segments[1]);
}

function validateInvocation({ dabPath, configPath, credentialName }, env = process.env) {
  if (!path.isAbsolute(dabPath)) fail("DAB executable path must be absolute");
  if (!path.isAbsolute(configPath)) fail("DAB config path must be absolute");
  if (!["dab", "dab.exe"].includes(path.basename(dabPath).toLowerCase())) {
    fail("--dab must identify the DAB executable directly; shell wrappers are forbidden");
  }
  if (path.basename(configPath).toLowerCase() !== "dab-config.json") {
    fail("--config must identify dab-config.json");
  }

  const configDirectory = path.dirname(configPath);
  if (!isCanonicalConfigDirectory(configDirectory) && !isLegacyConfigDirectory(configDirectory)) {
    fail("dab-config.json must be isolated in a .rooty/mcp/data/sql-server/<domain> or .rooty/mcp/data/sql-server/<environment>/<domain> folder");
  }
  if (!BINDING_PATTERN.test(credentialName)) {
    fail("credential binding must use the ROOTY_SQL_<DOMAIN> naming convention");
  }
  if (!Object.prototype.hasOwnProperty.call(env, credentialName) || env[credentialName] === "") {
    fail(`credential binding ${credentialName} is missing from the host process environment`);
  }

  const binding = env.ASPNETCORE_URLS;
  const match = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(binding || "");
  const port = match ? Number.parseInt(match[1], 10) : 0;
  if (!match || port < 1 || port > 65535) {
    fail("ASPNETCORE_URLS must be one explicit http://127.0.0.1:<port> binding");
  }
  return { configDirectory, port };
}

function containsKey(value, forbidden) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => containsKey(item, forbidden));
  return Object.entries(value).some(([key, nested]) => forbidden.has(key) || containsKey(nested, forbidden));
}

function validateDabConfig(config, credentialName) {
  if (!config || typeof config !== "object" || Array.isArray(config)) fail("DAB config must be a JSON object");
  if (containsKey(config, new Set(["data-source-files"]))) fail("data-source-files is forbidden");
  if (containsKey(config, new Set(["autoentities"]))) fail("autoentities is forbidden");

  const source = config["data-source"];
  if (typeof source?.["database-type"] !== "string" || source["database-type"].toLowerCase() !== "mssql") {
    fail("DAB data source must be mssql");
  }
  if (source?.["connection-string"] !== `@env('${credentialName}')`) {
    fail(`connection string must be exactly @env('${credentialName}')`);
  }

  const runtime = config.runtime;
  if (runtime?.rest?.enabled !== false || runtime?.graphql?.enabled !== false) {
    fail("REST and GraphQL must be disabled for the Rooty MCP process");
  }
  if (runtime?.mcp?.enabled !== true) fail("MCP must be enabled");
  const tools = runtime.mcp["dml-tools"];
  const allowedToolKeys = new Set([...Object.keys(REQUIRED_TOOLS), "aggregate-records"]);
  for (const tool of Object.keys(tools || {})) {
    if (!allowedToolKeys.has(tool)) fail(`unexpected MCP tool setting is forbidden: ${tool}`);
  }
  for (const [tool, expected] of Object.entries(REQUIRED_TOOLS)) {
    if (tools?.[tool] !== expected) fail(`${tool} must be ${expected}`);
  }
  const aggregate = tools?.["aggregate-records"];
  if (aggregate !== true) {
    if (aggregate?.enabled !== true) fail("aggregate-records must be enabled");
    if (!Number.isInteger(aggregate["query-timeout"]) || aggregate["query-timeout"] < 1 || aggregate["query-timeout"] > 30) {
      fail("aggregate-records query-timeout must be an integer from 1 to 30 seconds");
    }
  }

  const entities = config.entities;
  if (!entities || typeof entities !== "object" || Array.isArray(entities) || Object.keys(entities).length === 0) {
    fail("at least one explicit entity is required");
  }
  for (const [name, entity] of Object.entries(entities)) {
    const type = typeof entity?.source?.type === "string" ? entity.source.type.toLowerCase() : undefined;
    if (!["table", "view"].includes(type) || typeof entity?.source?.object !== "string") {
      fail(`entity ${name} must explicitly identify a table or view`);
    }
    const permissions = entity.permissions;
    if (!Array.isArray(permissions) || permissions.length !== 1) fail(`entity ${name} must have one rooty-reader permission`);
    const permission = permissions[0];
    if (permission?.role !== "rooty-reader" || !Array.isArray(permission?.actions) || permission.actions.length !== 1 || permission.actions[0] !== "read") {
      fail(`entity ${name} must grant only read to rooty-reader`);
    }
  }
}

function childEnvironment(env = process.env) {
  const child = { ...env };
  for (const key of Object.keys(child)) {
    if (key.toLowerCase() === "dab_environment") delete child[key];
  }
  return child;
}

function dabArgs(configPath) {
  return [
    "start",
    "--mcp-stdio",
    "role:rooty-reader",
    "--config",
    configPath,
    "--LogLevel",
    "Error"
  ];
}

function prepareLaunch(argv = process.argv.slice(2), env = process.env) {
  const invocation = parseArgs(argv);
  const { configDirectory } = validateInvocation(invocation, env);
  for (const file of [invocation.dabPath, invocation.configPath]) {
    if (!existsSync(file) || !statSync(file).isFile()) fail(`required file is unavailable: ${file}`);
  }
  if (existsSync(path.join(configDirectory, ".env"))) {
    fail("credential files beside dab-config.json are forbidden; configure the named host environment binding");
  }

  let config;
  try {
    config = JSON.parse(readFileSync(invocation.configPath, "utf8"));
  } catch (error) {
    fail(`cannot read dab-config.json: ${error.message}`);
  }
  validateDabConfig(config, invocation.credentialName);

  return {
    invocation,
    args: dabArgs(invocation.configPath),
    options: {
      cwd: configDirectory,
      env: childEnvironment(env),
      shell: false,
      stdio: "inherit",
      windowsHide: true
    }
  };
}

function launch(argv = process.argv.slice(2), env = process.env, spawnImpl = spawn) {
  const prepared = prepareLaunch(argv, env);
  const child = spawnImpl(prepared.invocation.dabPath, prepared.args, prepared.options);
  child.once("error", (error) => {
    process.stderr.write(`Rooty DAB launcher: DAB failed to start: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = Number.isInteger(code) ? code : signal ? 1 : 0;
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => child.kill(signal));
  }
  return child;
}

module.exports = {
  BINDING_PATTERN,
  childEnvironment,
  dabArgs,
  isCanonicalConfigDirectory,
  isLegacyConfigDirectory,
  launch,
  parseArgs,
  prepareLaunch,
  validateDabConfig,
  validateInvocation
};

if (require.main === module) {
  try {
    launch();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
