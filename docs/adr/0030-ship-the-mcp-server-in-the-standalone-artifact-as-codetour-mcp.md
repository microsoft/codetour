# Ship the MCP server in the standalone artifact as codetour mcp

The standalone distribution promised one runnable artifact with no global
Node.js and no VS Code extension, but it could only read Tours: the MCP server
that creates them was bundled, registered and discovered by the VS Code
extension (ADR 0006) or installed as the separate `codetour-mcp` npm package,
which reintroduces the global runtime the distribution exists to remove.

The obvious fix — building a second MCP server for the standalone launcher —
would duplicate the server, its validation, rendering and Git rules, and the
two copies would drift. Instead the MCP package now exposes one reusable
programmatic entry, `runMcpCli(argv, io)` in `packages/mcp-server/src/cli.ts`,
which parses arguments, reports diagnostics before the protocol starts and
connects the stdio server without reading `process.argv`. The `codetour-mcp`
binary becomes a thin wrapper (`src/main.ts`) and the CLI dispatches the
reserved `mcp` token to the same entry before Tour discovery, renderer parsing
and Git worktree detection. The CLI bundle embeds that entry exactly once
through a webpack alias; the extension keeps packaging its own server bundle
from the same source, and the npm binary keeps its own distribution. Those are
separate distributions of one server, not duplicates inside one artifact.

The standalone artifact therefore keeps a single launcher with two commands:
`codetour` reads and `codetour mcp` serves. The server is not emitted as a
second file; it travels inside `dist/cli.js`, which the packager enforces
rather than assumes: packaging fails if any `.js` file in the artifact other
than `dist/cli.js` carries the MCP entry marker, if the marker appears twice,
or if the bundle exceeds a measured size budget (8,000,000 bytes; the bundle
measured 5,948,925 bytes as reader-only and 6,855,754 bytes with the server
embedded). Embedding the server also pulled markdown-it's `punycode` require
onto every `codetour` start, so the bundle points it at the userland package,
which the packager ships as a small dependency closure next to `@b9g/termdom`.

Transport, tools, validation, Git policies, workspace confinement and the
reader contract are unchanged, and so are the workspace rules: the Tour
Workspace is the process working directory, `--workspace-root` overrides it,
and Git remains an external prerequisite for Changes Tours and historical
snapshots. `codetour mcp` is the stable launch contract for future agent
adapters. This extends ADR 0006's distribution model to the standalone
artifact without changing its confinement or transport decisions.
