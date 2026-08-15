# Provider research

Use this process for an unknown provider, a custom provider, or any recipe whose version or authentication behavior may have changed.

1. Search only official vendor documentation and the vendor-owned source repository. Prefer release-specific documentation.
2. Confirm the server is vendor-maintained, its supported deployment/version range, transport, installation artifact, authentication, credential names, and current lifecycle status.
3. Inspect the complete advertised tool surface. Identify mutation, administration, file export, arbitrary query/execute, and workflow tools.
4. Find provider-side least-privilege guidance and an explicit server read-only mode. If neither exists, classify `REVIEW_REQUIRED` or `UNAVAILABLE` rather than guessing.
5. Confirm a harmless probe that cannot mutate state and can be bounded to a small result.
6. Record the official URLs and the date checked in the proposal. Do not copy credentials or secret-bearing examples.

Reject community forks presented as official, deprecated transports when a supported transport exists, floating packages when reproducibility requires a reviewed version, and configurations that expose all tools by default without a verified restriction layer.

When official documentation conflicts with a bundled Rooty reference, follow the official current documentation and flag the Rooty reference for update.
