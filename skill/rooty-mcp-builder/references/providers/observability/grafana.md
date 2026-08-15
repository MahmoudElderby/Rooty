# Grafana official MCP server

Official references:

- https://grafana.com/docs/grafana/latest/developer-resources/mcp/set-up/
- https://grafana.com/docs/grafana/latest/developer-resources/mcp/configure/command-line-flags/

Use Grafana's official `mcp-grafana` server or Grafana Cloud MCP service. Current self-hosted options include `uvx`, Docker, a release binary, and Helm. Research and pin the approved execution method before configuration.

## Required controls

- Use a dedicated Grafana service account with Viewer-equivalent access scoped to the required organization and data sources.
- Declare the official Grafana URL and token bindings in the host entry; do not commit token values.
- Disable every mutation-capable tool using the current official tool-control flags. At minimum forbid annotation creation/update, snapshot creation/deletion, alerting changes, incident changes, and any investigation feature that creates provider state.
- Keep only dashboard, data-source metadata, metrics, logs, traces, and incident-reading tools required for Rooty.
- Configure organization or tenant headers explicitly when applicable, without literal secrets.

## Probe

Initialize, inspect the advertised tool list, list at most one folder or dashboard, and run a bounded metadata or datasource-health read. Classify `REVIEW_REQUIRED` until the exact installed server version's disable flags and resulting tool surface have been verified.
