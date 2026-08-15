# Documentation-first discovery

## Purpose

Use project documentation as a navigation aid. Documentation can identify likely services, flows, stores, dashboards, index patterns, correlation IDs, and source folders. It is not proof of current behavior or configuration.

## Locate entry points

When `.rooty/project-context.json` has no confirmed path, perform only a bounded entry-point search in the project root and common documentation folders. Prefer:

- `README*`, `docs/`, `documentation/`, `architecture/`, `adr/`, and `design/`;
- explicitly linked files from those entry points;
- a documentation path supplied by the developer, including an external local folder.

Do not recursively open the project root. Do not scan filesystem roots, dependency caches, build output, `.git`, host-generated skill folders, or secret-named files. Present likely paths and ask for confirmation before treating them as Rooty context.

## Read selectively

Start with overview, architecture, operations, observability, and data sections relevant to setup. Follow links only when they answer a current question. Extract provisional statements about:

- component ownership and communication paths;
- data technology, database names, and safe schema locations;
- logging, tracing, metrics, dashboards, and index or tenant conventions;
- environments and correlation identifiers;
- provider-specific setup already adopted by the project.

Do not persist extracted statements. Keep only confirmed documentation paths in `.rooty/project-context.json`.

## Verify current state

Verify material provider decisions against current, non-secret source or configuration. Prefer package manifests, deployment descriptors, safe config templates, instrumentation setup, client initialization, and connection-variable names. Never interpret documentation alone as proof that a provider is deployed, reachable, current, or correctly permissioned.

If documentation conflicts with source or runtime evidence, show the conflict and use the current evidence for setup. Ask the developer only when the conflict changes provider, environment, access scope, or safety.
