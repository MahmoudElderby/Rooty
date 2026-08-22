import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  childEnvironment,
  dabArgs,
  parseArgs,
  prepareLaunch,
  validateDabConfig,
  validateInvocation
} = require("../skill/rooty-mcp-builder/assets/start-dab.cjs");

const WINDOWS = process.platform === "win32";
const dabPath = WINDOWS ? "C:\\tools\\dab.exe" : "/tools/dab";

function projectPath(...segments) {
  return path.join(WINDOWS ? "C:\\project" : "/project", ...segments);
}

const configPath = projectPath(".rooty", "mcp", "data", "sql-server", "orders", "dab-config.json");
const legacyConfigPath = projectPath(".rooty", "mcp-orders", "dab-config.json");

function config(overrides = {}) {
  return {
    "data-source": {
      "database-type": "mssql",
      "connection-string": "@env('ROOTY_SQL_ORDERS')"
    },
    runtime: {
      rest: { enabled: false },
      graphql: { enabled: false },
      mcp: {
        enabled: true,
        "dml-tools": {
          "describe-entities": true,
          "create-record": false,
          "read-records": true,
          "update-record": false,
          "delete-record": false,
          "execute-entity": false,
          "aggregate-records": { enabled: true, "query-timeout": 15 }
        }
      }
    },
    entities: {
      Orders: {
        source: { object: "sales.Orders", type: "table" },
        permissions: [{ role: "rooty-reader", actions: ["read"] }]
      }
    },
    ...overrides
  };
}

test("launcher parses one fixed absolute per-catalog invocation", () => {
  const parsed = parseArgs([
    "--dab",
    dabPath,
    "--config",
    configPath,
    "--credential-env",
    "ROOTY_SQL_ORDERS"
  ]);
  assert.deepEqual(parsed, { dabPath, configPath, credentialName: "ROOTY_SQL_ORDERS" });
  assert.deepEqual(
    validateInvocation(parsed, {
      ROOTY_SQL_ORDERS: "not-inspected",
      ASPNETCORE_URLS: "http://127.0.0.1:55101"
    }),
    { configDirectory: path.dirname(configPath), port: 55101 }
  );
});

test("launcher isolates each catalog under the canonical provider layout and still accepts the legacy folder", () => {
  const env = { ROOTY_SQL_ORDERS: "not-inspected", ASPNETCORE_URLS: "http://127.0.0.1:55101" };
  const invocation = { dabPath, credentialName: "ROOTY_SQL_ORDERS" };

  assert.equal(
    validateInvocation({ ...invocation, configPath: legacyConfigPath }, env).configDirectory,
    path.dirname(legacyConfigPath)
  );
  const environmentConfigPath = projectPath(".rooty", "mcp", "data", "sql-server", "preprod", "orders", "dab-config.json");
  assert.equal(
    validateInvocation({ ...invocation, configPath: environmentConfigPath }, env).configDirectory,
    path.dirname(environmentConfigPath)
  );
  for (const rejected of [
    projectPath(".rooty", "mcp", "data", "orders", "dab-config.json"),
    projectPath(".rooty", "mcp", "observability", "sql-server", "orders", "dab-config.json"),
    projectPath(".rooty", "mcp", "data", "sql-server", "dab-config.json"),
    projectPath(".rooty", "mcp", "data", "sql-server", "orders_archive", "dab-config.json"),
    projectPath("mcp", "data", "sql-server", "orders", "dab-config.json")
  ]) {
    assert.throws(
      () => validateInvocation({ ...invocation, configPath: rejected }, env),
      /must be isolated in a \.rooty\/mcp\/data\/sql-server\/<domain> or \.rooty\/mcp\/data\/sql-server\/<environment>\/<domain> folder/,
      rejected
    );
  }
});

test("launcher uses only the reviewed DAB arguments", () => {
  const args = dabArgs(configPath);
  assert.deepEqual(args, [
    "start",
    "--mcp-stdio",
    "role:rooty-reader",
    "--config",
    configPath,
    "--LogLevel",
    "Error"
  ]);
  assert.equal(args.includes("--no-https-redirect"), false);
});

test("launcher accepts an explicit read-only single-catalog config", () => {
  assert.doesNotThrow(() => validateDabConfig(config(), "ROOTY_SQL_ORDERS"));
});

test("launcher rejects multi-source, autoentity, and mutation-enabled configs", () => {
  assert.throws(
    () => validateDabConfig(config({ "data-source-files": ["other.json"] }), "ROOTY_SQL_ORDERS"),
    /data-source-files is forbidden/
  );
  assert.throws(
    () => validateDabConfig(config({ autoentities: {} }), "ROOTY_SQL_ORDERS"),
    /autoentities is forbidden/
  );
  const unsafe = config();
  unsafe.runtime.mcp["dml-tools"]["update-record"] = true;
  assert.throws(() => validateDabConfig(unsafe, "ROOTY_SQL_ORDERS"), /update-record must be false/);
});

test("launcher rejects literal credentials, missing settings, implicit ports, and wrappers", () => {
  const literal = config();
  literal["data-source"]["connection-string"] = "Server=example;Password=secret";
  assert.throws(() => validateDabConfig(literal, "ROOTY_SQL_ORDERS"), /connection string must be exactly/);

  const invocation = { dabPath, configPath, credentialName: "ROOTY_SQL_ORDERS" };
  assert.throws(
    () => validateInvocation(invocation, { ASPNETCORE_URLS: "http://127.0.0.1:55101" }),
    /credential setting ROOTY_SQL_ORDERS was not injected/
  );
  assert.throws(
    () => validateInvocation(invocation, { ROOTY_SQL_ORDERS: "x", ASPNETCORE_URLS: "http://127.0.0.1:0" }),
    /explicit http:\/\/127\.0\.0\.1:<port>/
  );
  const wrapper = { ...invocation, dabPath: WINDOWS ? "C:\\Windows\\System32\\cmd.exe" : "/bin/sh" };
  assert.throws(
    () => validateInvocation(wrapper, { ROOTY_SQL_ORDERS: "x", ASPNETCORE_URLS: "http://127.0.0.1:55101" }),
    /shell wrappers are forbidden/
  );
});

test("launcher removes DAB_ENVIRONMENT without touching the credential binding", () => {
  const env = childEnvironment({
    ROOTY_SQL_ORDERS: "not-inspected",
    DAB_ENVIRONMENT: "Development",
    dab_environment: "Test",
    ASPNETCORE_URLS: "http://127.0.0.1:55101"
  });
  assert.equal(env.DAB_ENVIRONMENT, undefined);
  assert.equal(env.dab_environment, undefined);
  assert.equal(env.ROOTY_SQL_ORDERS, "not-inspected");
});

test("launcher prepares the catalog CWD and refuses a neighboring credential file", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "rooty-dab-launch-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const catalogDirectory = path.join(temporary, ".rooty", "mcp", "data", "sql-server", "orders");
  await mkdir(catalogDirectory, { recursive: true });
  const localDab = path.join(temporary, WINDOWS ? "dab.exe" : "dab");
  const localConfig = path.join(catalogDirectory, "dab-config.json");
  await writeFile(localDab, "placeholder", "utf8");
  await writeFile(localConfig, JSON.stringify(config()), "utf8");
  const argv = [
    "--dab",
    localDab,
    "--config",
    localConfig,
    "--credential-env",
    "ROOTY_SQL_ORDERS"
  ];
  const env = {
    ROOTY_SQL_ORDERS: "not-inspected",
    ASPNETCORE_URLS: "http://127.0.0.1:55101",
    DAB_ENVIRONMENT: "Development"
  };

  const prepared = prepareLaunch(argv, env);
  assert.equal(prepared.options.cwd, catalogDirectory);
  assert.equal(prepared.options.shell, false);
  assert.equal(prepared.options.env.DAB_ENVIRONMENT, undefined);

  await writeFile(path.join(catalogDirectory, ".env"), "", "utf8");
  assert.throws(() => prepareLaunch(argv, env), /credential files beside dab-config\.json are forbidden/);
});
