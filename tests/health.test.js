import test from "node:test";
import assert from "node:assert/strict";
import { evaluateHealthDocuments } from "../src/lib/health.js";

function profile() {
  return {
    schema_version: 1,
    environment: "production",
    confirmation: { status: "CONFIRMED", confirmed_by: "developer" },
    components: [
      { id: "database", dependencies: [], probes: [{ id: "db-read", read_only: true, timeout_ms: 3000, expected: "bounded read succeeds" }] },
      { id: "api", dependencies: ["database"], probes: [{ id: "api-ready", read_only: true, timeout_ms: 3000, expected: "ready=true" }] }
    ],
    cloud_resources: { required: false }
  };
}

function observations(db = "PASS", api = "PASS", concern = false) {
  return {
    schema_version: 1,
    environment: "production",
    identity_verified: true,
    components: [
      { component_id: "database", probes: [{ probe_id: "db-read", status: db, evidence_refs: ["OBS-DB"] }] },
      { component_id: "api", probes: [{ probe_id: "api-ready", status: api, evidence_refs: ["OBS-API"] }], log_indicators: concern ? [{ id: "errors", status: "CONCERN", evidence_refs: ["OBS-LOG"] }] : [] }
    ],
    limitations: []
  };
}

test("health evaluation distinguishes healthy, degraded, critical, and unknown", () => {
  assert.equal(evaluateHealthDocuments(profile(), observations()).overall_status, "HEALTHY");
  assert.equal(evaluateHealthDocuments(profile(), observations("PASS", "PASS", true)).overall_status, "DEGRADED");
  const critical = evaluateHealthDocuments(profile(), observations("FAIL", "PASS"));
  assert.equal(critical.overall_status, "CRITICAL");
  assert.equal(critical.alerts[0].alert_type, "PROJECT_COMPONENT_FAILURE");
  assert.deepEqual(critical.dependency_effects[0], { component_id: "api", dependency_id: "database", dependency_status: "CRITICAL", effect: "DEPENDENCY_FAILURE" });
  const unknown = evaluateHealthDocuments(profile(), observations("UNAVAILABLE", "PASS"));
  assert.equal(unknown.overall_status, "UNKNOWN");
  assert.equal(unknown.visibility_gaps[0].warning_type, "VISIBILITY_GAP");
  assert.equal(evaluateHealthDocuments(profile(), observations("UNAVAILABLE", "PASS", true)).overall_status, "UNKNOWN");
});

test("health evaluation treats identity mismatch as critical and rejects invalid profiles", () => {
  const mismatched = observations();
  mismatched.environment = "preprod";
  assert.equal(evaluateHealthDocuments(profile(), mismatched).overall_status, "CRITICAL");
  const unconfirmed = profile();
  unconfirmed.confirmation.status = "DRAFT";
  assert.throws(() => evaluateHealthDocuments(unconfirmed, observations()), /developer confirmation/);
  const transport = profile();
  transport.components[0].id = "mcp-database";
  assert.throws(() => evaluateHealthDocuments(transport, observations()), /MCP transport/);
  const cloud = profile();
  cloud.cloud_resources.required = true;
  const cloudGap = evaluateHealthDocuments(cloud, observations());
  assert.equal(cloudGap.overall_status, "UNKNOWN");
  assert.equal(cloudGap.visibility_gaps.at(-1).component_id, "cloud-resources");
});
