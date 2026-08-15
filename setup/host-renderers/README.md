# Host renderers

The dependency-free renderers live in `src/lib/hosts.js`. They install one canonical skill and create Codex, Claude Code, or Cursor configuration without copying credential values. OAuth and bearer credentials are emitted only as environment-variable references, and the activation manifest retains the same references for `doctor`. Existing host files are never overwritten.
