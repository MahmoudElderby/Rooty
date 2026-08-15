# Doctor checks

`src/lib/doctor.js` verifies skill presence, source configuration safety, read-only connector recipes and tool annotations, bundled connector startup, independent replay fixtures, evidence location, and Git exclusions. For every entry in `.investigator/activated-connectors.json`, it also verifies authentication availability, MCP initialization, `tools/list`, allowlist resolution, and a harmless bounded read probe. An unreachable, unauthorized, uninitializable, or unprobeable activated connector is a hard failure.
