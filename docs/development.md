# Development baseline

Rooty supports Node.js 20 or newer. The baseline verification commands are platform-neutral:

```console
npm test
npm run doctor
npm run eval
```

CI on Windows, macOS, and Linux is expected to run these commands without shell glob expansion. Child-process failures must include the failing process or protocol phase so product failures can be distinguished from an execution policy or sandbox restriction.

Version-1 CLI, source-registry, host-file, and doctor contracts are recorded under `tests/fixtures` and remain supported while automatic MCP setup is introduced.
