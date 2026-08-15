# Elasticsearch

Official references:

- https://www.elastic.co/docs/explore-analyze/ai-features
- https://github.com/elastic/mcp-server-elasticsearch

Choose by deployment version:

- Elasticsearch 9.2+ or Serverless: prefer Elastic Agent Builder's hosted MCP endpoint.
- Elasticsearch 8.x, including **8.19.15**: use Elastic's standalone `mcp-server-elasticsearch` compatibility server.

The standalone server is deprecated and receives critical security updates only. Its current official distribution is a Docker image and requires Docker or another approved container runtime. Do not install Docker, pull the image, or start a container without separate approval.

## Standalone 8.x controls

- Reference `ES_URL` and either `ES_API_KEY` or the reviewed username/password bindings in the host MCP entry.
- Prefer a scoped Elasticsearch API key with read and view-index-metadata privileges only on approved log, trace, or metric indices.
- Never enable `ES_SSL_SKIP_VERIFY` outside an explicitly approved local test.
- Expected read tools are `list_indices`, `get_mappings`, `search`, `esql`, and `get_shards`. Reject any unexpected mutation or administration tool.
- Bound searches by index, environment, event-time range, identifiers, result size, and timeout.

## Probe

Initialize and list tools, then list approved indices or run a size-zero/one bounded query against a non-sensitive test index. For HTTP mode, `/ping` may establish process health but does not prove Elasticsearch authorization; a harmless data read is still required.
