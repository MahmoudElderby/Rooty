# Doctor checks

`src/lib/doctor.js` verifies skill presence, source configuration safety, read-only connector recipes and tool annotations, bundled connector startup, independent replay fixtures, evidence location, and Git exclusions. For every entry in `.investigator/activated-connectors.json`, it verifies the referenced bearer or OAuth access-token environment variable, MCP initialization, the negotiated protocol header on later requests, `tools/list`, allowlist resolution, and a harmless bounded read probe.

Normal mode is a production-readiness gate: missing, unresolved or unactivated required capabilities, unavailable authentication, unreachable or unauthorized connectors, protocol errors, and failed probes are hard failures. `--package-only` downgrades missing project sources and activation to warnings so the npm package itself can be checked before setup.
