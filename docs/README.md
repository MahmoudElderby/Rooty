# Rooty documentation

Use this index to choose the shortest path for your role.

## I want to try Rooty

Start with [Getting started](getting-started.md) for the one-command project install, agent-led setup, offline demo, and the distinction between live host investigations and the frozen-snapshot case runner.

## I administer Rooty

1. [Project and MCP setup](setup.md)
2. [Security and threat model](security.md)
3. [Troubleshooting](troubleshooting.md)

The setup guide covers documentation-first discovery, provider proposals, credential references, host rendering, approvals, and verification. Complete the production checklist in the security guide before activating real evidence providers.

## I investigate incidents

1. [Investigating an incident](investigation.md)
2. [Evidence and reporting](evidence-and-reporting.md)
3. [Memory and learning](memory-and-learning.md)

These guides cover the end-user journey, under-the-hood state machine, evidence classifications, stopping rule, report format, and reviewed learning lifecycle.

## I extend or maintain Rooty

1. [Architecture and integrations](architecture.md)
2. [CLI reference](cli-reference.md)
3. [Development](development.md)
4. [Troubleshooting](troubleshooting.md)

The architecture guide explains the mechanical installer, agent skills, host adapters, provider references, deterministic safety engine, doctor, and snapshot pipeline.

Implementation references:

- [Agent-led setup requirements](automatic-mcp-setup-requirements.md)
- [Agent-led setup implementation plan](automatic-mcp-setup-implementation-plan.md)

## Core principle

Rooty finds an evidence-backed causal chain and stops. It does not implement fixes, mutate systems, or use historical memory as proof for the current incident.

[Back to the project README](../README.md)
