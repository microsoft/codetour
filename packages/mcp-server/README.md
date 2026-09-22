# codetour-mcp

A local MCP (Model Context Protocol) server that lets an AI agent create
[CodeTour](https://github.com/microsoft/codetour) tours deterministically.
The agent analyzes the code and writes the explanations; the server validates
the proposal, applies the Git and security rules, and atomically replaces the
reserved tour file.

## Features

- **Project Tour generation** — explain a codebase as a whole: its purpose,
  main entry points, important components, and main execution flows. The tour
  is written to `.tours/project.tour` and has no Git ref, so it stays usable
  as the project evolves.
- **Changes Tour generation** — explain the committed changes on a branch
  since it diverged from a base ref: the intent of the changes, the major
  modifications, their impact, and the relevant tests. The tour is written to
  `.tours/changes.tour` and records the exact analyzed head SHA as its Git
  ref, so it is reproducible. Uncommitted changes are excluded by default and
  reported as a warning.
- **Strict validation** — every proposal is checked against a deliberately
  stricter subset of the CodeTour schema: explanatory Markdown and
  workspace-internal locations only. CodeTour `commands`, root-level `when`
  expressions, external `uri` steps, and active Markdown schemes (`command:`,
  `file:`, `vscode:`, `vscode-insiders:`, `javascript:`) are rejected, and
  every anchor is validated against the real workspace state. All validation
  issues are aggregated into a single response, and the previous tour file is
  preserved on any failure.
- **Workspace confinement** — one server instance handles exactly one
  workspace root. Real paths are resolved before any read or write, symlinks
  that escape the root are rejected, and the server performs no network
  access.
- **Atomic persistence** — the reserved tour file is only replaced after a
  complete, successful validation, via an atomic rename. It is excluded from
  the dirty-workspace detection so a previous generation does not warn about
  itself.

## Requirements

- Node.js >= 18
- Git (only for Changes Tours)

## Installation and local validation

```bash
npm install
npm run build
npm test
```

Run the server locally:

```bash
node dist/src/cli.js --workspace-root /path/to/workspace
```

The `--workspace-root` argument is required. The package exposes the
`codetour-mcp` binary (available after `npm install` or `npm link`).

## MCP client configuration

```json
{
  "mcpServers": {
    "codetour": {
      "command": "node",
      "args": [
        "/path/to/codetour/packages/mcp-server/dist/src/cli.js",
        "--workspace-root",
        "/path/to/workspace"
      ]
    }
  }
}
```

The transport is `stdio` only.

## Development

```bash
npm run typecheck   # type-check only
npm run build       # compile to dist/
npm test            # build + integration tests over the stdio MCP seam
```

Integration tests launch the server as an MCP client would, over `stdio`,
against temporary workspaces and temporary Git repositories.
