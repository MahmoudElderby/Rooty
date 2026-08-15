# Rooty documentation

Use this index to choose the shortest path for your role.

## I want to try Rooty

Start with [Getting started](getting-started.md) for installation, the offline demo, package doctor, and the distinction between live host investigations and the frozen-snapshot case runner.

## I administer Rooty

1. [Project and connector setup](setup.md)
2. [Security and threat model](security.md)
3. [Troubleshooting](troubleshooting.md)

The setup guide covers discovery, direct MCP endpoints, authentication references, host rendering, and strict doctor checks. Complete the production checklist in the security guide before activating real evidence providers.

## I investigate incidents

1. [Investigating an incident](investigation.md)
2. [Evidence and reporting](evidence-and-reporting.md)
3. [Memory and learning](memory-and-learning.md)

These guides cover the end-user journey, under-the-hood state machine, evidence classifications, stopping rule, report format, and reviewed learning lifecycle.

## I extend or maintain Rooty

1. [Architecture and integrations](architecture.md)
2. [Automatic MCP setup requirements](automatic-mcp-setup-requirements.md)
3. [Automatic MCP setup implementation plan](automatic-mcp-setup-implementation-plan.md)
4. [CLI reference](cli-reference.md)
5. [Troubleshooting](troubleshooting.md)

The architecture guide explains current component boundaries, host adapters, connector recipes, doctor, the snapshot pipeline, and extension principles. The automatic MCP setup documents define the approved requirements and phased plan for the next implementation; they do not describe current CLI behavior yet.

## Core principle

Rooty finds an evidence-backed causal chain and stops. It does not implement fixes, mutate systems, or use historical memory as proof for the current incident.

[Back to the project README](../README.md)
