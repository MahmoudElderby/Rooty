import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  getMcpSetting,
  initializeMcpSettings,
  listMcpSettingKeys,
  resolveMcpSettingValues,
  settingsStatus,
  validateMcpSettings
} from "../src/lib/mcp-settings.js";

test("new MCP settings use grouped schema version 2 and preserve nested values", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "rooty-grouped-settings-"));
  const keys = [
    "prod.sql.server",
    "prod.sql.user",
    "prod.sql.password",
    "prod.sql.options",
    "prod.sql.catalogs.orders.name",
    "prod.sql.catalogs.orders.mcp_url",
    "prod.elasticsearch.url",
    "prod.elasticsearch.username",
    "prod.elasticsearch.password"
  ];
  const first = await initializeMcpSettings({ projectRoot, keys });
  assert.equal(first.settings.schema_version, 2);
  assert.deepEqual(listMcpSettingKeys(first.settings), [...keys].sort());
  assert.ok(settingsStatus(first.settings, keys).every((item) => item.status === "MISSING"));

  first.settings.settings.prod.sql.server = "sql-ecm-prd-san-1.database.windows.net";
  first.settings.settings.prod.elasticsearch.url = "https://els-ecm-prd-san-1.example.test";
  const file = JSON.parse(await readFile(first.file, "utf8"));
  file.settings.prod.sql.server = first.settings.settings.prod.sql.server;
  file.settings.prod.elasticsearch.url = first.settings.settings.prod.elasticsearch.url;
  const resolved = resolveMcpSettingValues(file, ["prod.sql.server", "prod.sql.user", "prod.elasticsearch.url"]);
  assert.deepEqual(resolved, {
    values: {
      "prod.sql.server": "sql-ecm-prd-san-1.database.windows.net",
      "prod.elasticsearch.url": "https://els-ecm-prd-san-1.example.test"
    },
    missing: ["prod.sql.user"]
  });
});

test("schema version 2 supports provider-oriented generated settings with placeholders", () => {
  const settings = validateMcpSettings({
    schema_version: 2,
    settings: {
      prod: {
        sql: {
          server: "sql-ecm-prd-san-1.database.windows.net",
          user: "<READONLY_SQL_USER>",
          password: "<READONLY_SQL_PASSWORD>",
          options: "TrustServerCertificate=True;Trusted_Connection=False;Encrypt=True;MultipleActiveResultSets=true",
          catalogs: {
            authenticator: { name: "StoreCloud_Authenticator", mcp_url: "http://127.0.0.1:55101" },
            support_ticket: { name: "StoreCloud_SupportTicket", mcp_url: "http://127.0.0.1:55113" }
          }
        },
        elasticsearch: {
          url: "https://els-ecm-prd-san-1-dfe614.es.southafricanorth.azure.elastic-cloud.com",
          username: "elastic",
          password: "<ELASTICSEARCH_PASSWORD>"
        }
      }
    }
  });

  assert.deepEqual(listMcpSettingKeys(settings), [
    "prod.elasticsearch.password",
    "prod.elasticsearch.url",
    "prod.elasticsearch.username",
    "prod.sql.catalogs.authenticator.mcp_url",
    "prod.sql.catalogs.authenticator.name",
    "prod.sql.catalogs.support_ticket.mcp_url",
    "prod.sql.catalogs.support_ticket.name",
    "prod.sql.options",
    "prod.sql.password",
    "prod.sql.server",
    "prod.sql.user"
  ]);
  assert.equal(getMcpSetting(settings, "prod.sql.catalogs.support_ticket.name"), "StoreCloud_SupportTicket");
  assert.equal(getMcpSetting(settings, "prod.elasticsearch.password"), "<ELASTICSEARCH_PASSWORD>");
});

test("MCP settings continue to accept the legacy flat schema", () => {
  const legacy = validateMcpSettings({ schema_version: 1, settings: { ROOTY_TOKEN: "available" } });
  assert.equal(getMcpSetting(legacy, "ROOTY_TOKEN"), "available");
  assert.deepEqual(settingsStatus(legacy), [{ key: "ROOTY_TOKEN", status: "AVAILABLE" }]);
});

test("schema version 2 enforces grouped SQL settings and unique catalog MCP URLs", () => {
  assert.throws(
    () => validateMcpSettings({ schema_version: 2, settings: { ROOTY_SQL_ORDERS_PROD: "legacy" } }),
    /must be grouped by environment/
  );
  assert.throws(
    () => validateMcpSettings({
      schema_version: 2,
      settings: {
        prod: {
          sql: { databases: { orders: { name: "Orders", mcp_url: "http://127.0.0.1:55101" } } }
        }
      }
    }),
    /sql\.databases is deprecated; use prod\.sql\.catalogs/
  );
  assert.throws(
    () => validateMcpSettings({
      schema_version: 2,
      settings: {
        prod: {
          sql: {
            server: "sql-ecm-prd-san-1.database.windows.net",
            user: "rooty_reader",
            password: "secret",
            options: "Encrypt=True",
            catalogs: {
              orders: { name: "Orders", mcp_url: "http://127.0.0.1:55101" },
              logger: { name: "Logger", mcp_url: "http://127.0.0.1:55101" }
            }
          }
        }
      }
    }),
    /SQL catalog MCP URLs must be unique within prod/
  );
});
