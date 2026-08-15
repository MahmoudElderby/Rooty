# Doctor checks

`src/lib/doctor.js` recognizes agent-led and legacy projects. For `agent-led-v3`, it validates `.rooty/install-manifest.json`, all installed skill fingerprints, documentation context, package skill presence, read-only connector recipes and tool annotations, bundled connector startup, independent replay fixtures, evidence location, and Git exclusions.

Legacy projects retain source-registry and activated-connector checks. For every entry in `.investigator/activated-connectors.json`, doctor verifies the referenced bearer or OAuth environment variable, MCP initialization, negotiated protocol header, `tools/list`, allowlist resolution, and a harmless bounded read probe. Package-only mode validates the distributed kit without requiring project activation.
