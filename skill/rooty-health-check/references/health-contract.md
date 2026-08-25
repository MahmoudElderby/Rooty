# Health profile and observation contract

The deterministic evaluator accepts two schema-version-1 JSON files.

Profile:

```json
{
  "schema_version": 1,
  "environment": "production",
  "confirmation": { "status": "CONFIRMED", "confirmed_by": "developer" },
  "components": [
    {
      "id": "orders-api",
      "name": "Orders API",
      "dependencies": ["orders-db"],
      "probes": [
        { "id": "orders-readiness", "read_only": true, "timeout_ms": 3000, "expected": "ready=true" }
      ]
    }
  ],
  "cloud_resources": { "required": false }
}
```

Observations:

```json
{
  "schema_version": 1,
  "environment": "production",
  "identity_verified": true,
  "components": [
    {
      "component_id": "orders-api",
      "probes": [
        { "probe_id": "orders-readiness", "status": "PASS", "evidence_refs": ["OBS-1"] }
      ],
      "log_indicators": [
        { "id": "orders-errors", "status": "OK", "evidence_refs": ["OBS-2"] }
      ]
    }
  ],
  "limitations": []
}
```

Probe status is exactly `PASS`, `FAIL`, or `UNAVAILABLE`. Log status `CONCERN` degrades a component only after all its required probes pass. An environment mismatch is critical because observations cannot satisfy the confirmed profile identity.

