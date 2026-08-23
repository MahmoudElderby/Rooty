import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LAUNCHER = path.join(ROOT, "skill/rooty-mcp-builder/assets/start-mcp.cjs");
const require = createRequire(import.meta.url);
const { loadSettings, parseArgs, runStdio, substitute } = require(LAUNCHER);

async function settingsFile(values, schemaVersion = 1) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "rooty-mcp-settings-"));
  const directory = path.join(projectRoot, ".rooty/config");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, "mcp-settings.local.json");
  await writeFile(file, `${JSON.stringify({ schema_version: schemaVersion, settings: values }, null, 2)}\n`);
  return file;
}

test("MCP launcher reads only explicitly declared JSON setting keys", async () => {
  const file = await settingsFile({ ROOTY_TOKEN: "secret-value", UNUSED: "not-forwarded" });
  assert.deepEqual(loadSettings(file, ["ROOTY_TOKEN"]), { ROOTY_TOKEN: "secret-value" });
  assert.equal(substitute("Bearer ${ROOTY_TOKEN}", { ROOTY_TOKEN: "secret-value" }), "Bearer secret-value");
  assert.throws(() => loadSettings(file, ["MISSING"]), /required setting keys are missing/);
});

test("MCP launcher parses stdio and HTTP modes without credential values in arguments", async () => {
  const file = await settingsFile({ ROOTY_TOKEN: "secret-value" });
  const stdio = parseArgs(["--settings", file, "--keys", "ROOTY_TOKEN", "--", process.execPath, "server.js"]);
  assert.equal(stdio.command, process.execPath);
  assert.deepEqual(stdio.commandArgs, ["server.js"]);
  const http = parseArgs(["--settings", file, "--keys", "ROOTY_TOKEN", "--url", "https://example.test", "--header", "Authorization: Bearer ${ROOTY_TOKEN}"]);
  assert.equal(http.url, "https://example.test");
  assert.doesNotMatch(JSON.stringify(http), /secret-value/);
});

test("MCP launcher can map a JSON setting to the child process key a server expects", async () => {
  const file = await settingsFile({ ROOTY_ORDERS_PROD_URLS: "http://127.0.0.1:5101" });
  const invocation = parseArgs(["--settings", file, "--keys", "ROOTY_ORDERS_PROD_URLS=ASPNETCORE_URLS", "--", process.execPath]);
  let options;
  const fakeChild = { once() {}, kill() {} };
  runStdio(invocation, loadSettings(file, invocation.keys), (_command, _args, received) => {
    options = received;
    return fakeChild;
  });
  assert.equal(options.env.ASPNETCORE_URLS, "http://127.0.0.1:5101");
  assert.equal(options.env.ROOTY_ORDERS_PROD_URLS, undefined);
});

test("MCP launcher resolves grouped environment paths and maps them to child keys", async () => {
  const file = await settingsFile({
    prod: {
      sql: {
        server: "sql-ecm-prd-san-1.database.windows.net",
        user: "rooty_reader",
        password: "secret-value",
        options: "TrustServerCertificate=True;Trusted_Connection=False;Encrypt=True;MultipleActiveResultSets=true",
        catalogs: { orders: { name: "StoreCloud_Orders", mcp_url: "http://127.0.0.1:55104" } },
        elasticsearch: { ignored: "provider nesting is explicit under prod, not sql" }
      },
      elasticsearch: {
        url: "https://els-ecm-prd-san-1.example.test",
        username: "elastic",
        password: "elastic-secret"
      }
    }
  }, 2);
  const bindings = [
    "prod.sql.server=ROOTY_SQL_PROD_SERVER",
    "prod.sql.user=ROOTY_SQL_PROD_USER",
    "prod.sql.password=ROOTY_SQL_PROD_PASSWORD",
    "prod.sql.options=ROOTY_SQL_PROD_OPTIONS",
    "prod.sql.catalogs.orders.name=ROOTY_SQL_PROD_CATALOG",
    "prod.sql.catalogs.orders.mcp_url=ASPNETCORE_URLS",
    "prod.elasticsearch.url=ROOTY_ES_PROD_URL",
    "prod.elasticsearch.password=ROOTY_ES_PROD_PASSWORD"
  ].join(",");
  const invocation = parseArgs(["--settings", file, "--keys", bindings, "--", process.execPath]);
  let options;
  runStdio(invocation, loadSettings(file, invocation.keys), (_command, _args, received) => {
    options = received;
    return { once() {}, kill() {} };
  });
  assert.equal(options.env.ROOTY_SQL_PROD_SERVER, "sql-ecm-prd-san-1.database.windows.net");
  assert.equal(options.env.ROOTY_SQL_PROD_CATALOG, "StoreCloud_Orders");
  assert.equal(options.env.ROOTY_SQL_PROD_OPTIONS, "TrustServerCertificate=True;Trusted_Connection=False;Encrypt=True;MultipleActiveResultSets=true");
  assert.equal(options.env.ROOTY_ES_PROD_URL, "https://els-ecm-prd-san-1.example.test");
  assert.equal(options.env.ROOTY_ES_PROD_PASSWORD, "elastic-secret");
  assert.equal(options.env.ASPNETCORE_URLS, "http://127.0.0.1:55104");
});

test("HTTP MCP bridge resolves URL and authorization from local JSON settings", async () => {
  let authorization;
  const server = createServer((request, response) => {
    authorization = request.headers.authorization;
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const message = JSON.parse(body);
      response.writeHead(200, { "content-type": "application/json", "mcp-session-id": "rooty-test-session" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "test", version: "1" } } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
  const file = await settingsFile({ ROOTY_MCP_URL: endpoint, ROOTY_MCP_TOKEN: "json-only-token" });
  const child = spawn(process.execPath, [LAUNCHER, "--settings", file, "--keys", "ROOTY_MCP_URL,ROOTY_MCP_TOKEN", "--url", "${ROOTY_MCP_URL}", "--header", "Authorization: Bearer ${ROOTY_MCP_TOKEN}"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  try {
    const response = new Promise((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const newline = output.indexOf("\n");
        if (newline !== -1) resolve(JSON.parse(output.slice(0, newline)));
      });
      child.once("error", reject);
      child.once("exit", (code) => { if (code && !output) reject(new Error(`launcher exited ${code}`)); });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } })}\n`);
    const message = await response;
    assert.equal(message.result.protocolVersion, "2025-11-25");
    assert.equal(authorization, "Bearer json-only-token");
  } finally {
    child.kill();
    await new Promise((resolve) => server.close(resolve));
  }
});
