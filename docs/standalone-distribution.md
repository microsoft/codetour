# Standalone CodeTour distribution

The standalone distribution is a single artifact with one launcher and two commands: `codetour` reads existing Tours (HTML or terminal) and `codetour mcp` starts the CodeTour MCP server for Tour creation. It includes the CodeTour CLI bundle with the embedded MCP server, the TermDOM and punycode dependency closures, the platform-specific Mermaid rasterizer, and the official Node.js 24.18.0 runtime. End users do not need to install Node.js, a VS Code extension, or have administrator privileges. Git must be available on PATH because CodeTour discovers the current Git worktree and reads historical snapshots through Git; Project Tours through `codetour mcp` also work before a workspace is a Git repository, but Changes Tours and historical snapshots always require Git.

## Build

Build on the target OS and architecture (Windows x64, macOS Intel, or macOS Apple Silicon), using the pinned development toolchain and the normal dependency installation described in the root README:

```sh
npm ci
npm ci --prefix packages/description-renderer
npm ci --prefix packages/mcp-server
npm run build
npm run package:standalone -- --output /path/to/new/codetour-distribution
npm run test:standalone
```

On Windows provide a Windows output path such as `C:\Users\you\codetour-distribution`. The output directory must not already exist. The build needs `curl` and `tar`. It downloads the official Node runtime for the host target and verifies its pinned SHA-256 before extraction. For offline builds, set `CODETOUR_NODE_ARCHIVE` to the matching official archive; the same checksum validation is applied. When updating the Node pin in ADR 0011, update the version and all three checksums in `scripts/package-standalone.js`.

Package the output directory as a zip with all files and permissions preserved for distribution. On macOS the executable bit on both `codetour` and `node` must remain set. The bundled `NODE-LICENSE`, `RESVG-LICENSE`, CLI notices and TermDOM package licenses are part of the distribution.

## Run

From any directory inside a Git worktree, run the packaged `codetour` launcher (`codetour.cmd` on Windows):

```sh
/path/to/codetour-distribution/codetour
/path/to/codetour-distribution/codetour "Tour title" --renderer terminal
```

The default renderer opens HTML. The terminal renderer opens a separate terminal window. Neither depends on a globally installed Node runtime. The distribution uses the current OS terminal application and Git; it does not install an application or alter system configuration.

### Start the MCP server with `codetour mcp`

The same launcher starts the CodeTour MCP server, so an agent outside VS Code
can create Project Tours and Changes Tours with the same two tools, validation
and workspace confinement as the extension and the `codetour-mcp` npm package:

```sh
cd /path/to/workspace
/path/to/codetour-distribution/codetour mcp
```

The server speaks MCP over stdio and serves exactly one workspace: the process
working directory by default. Set the working directory when your client can;
pass `--workspace-root` when it cannot:

```sh
/path/to/codetour-distribution/codetour mcp --workspace-root /path/to/workspace
```

`codetour mcp --help` describes the options and `codetour mcp --version`
reports the MCP server version. Invalid arguments and unusable workspaces fail
on stderr with a nonzero exit code before the protocol starts. The token `mcp`
is reserved: a Tour whose title is exactly `mcp` opens through the interactive
selection prompt instead of the command line.

An MCP client is configured with the packaged launcher, the `mcp` argument and
the Tour Workspace as working directory; no VS Code extension, network access
or globally installed Node.js is required:

```json
{
  "mcpServers": {
    "codetour": {
      "command": "/path/to/codetour-distribution/codetour",
      "args": ["mcp"],
      "cwd": "/path/to/workspace"
    }
  }
}
```

For a client that cannot set the working directory, omit `cwd` and pass
`"--workspace-root", "/path/to/workspace"` in `args` instead. `codetour mcp`
is the stable launch contract for future agent adapters, alongside the
existing `codetour-mcp` npm binary.

The MCP server is embedded once inside `dist/cli.js` and enforced by the
packager (see ADR 0030): the artifact never ships a second server entry.
Project Tours work before the workspace is a Git repository. Changes Tours,
merge-base resolution, head validation and historical snapshots still require
Git on PATH, exactly as the reader does.

Execution can be blocked by macOS Gatekeeper, Windows security controls, or an enterprise allowlist. Obtain approval through the organization's normal software-distribution process. This project does not bypass these controls. The executable and generated launchers are not signed by this build.

## Validation status

`npm run test:standalone` builds an artifact for the running host and tests Tour discovery and HTML output with the packaged runtime. It also launches `codetour mcp` through the packaged launcher with an MCP SDK client in a workspace that is not a Git repository, with a PATH that exposes no global Node executable on macOS: it performs the handshake, lists both tools, creates a Project Tour, verifies the produced files, and checks `--help`, `--version`, invalid arguments, inaccessible workspaces and stdin shutdown. The packager rejects an artifact whose CLI bundle exceeds the measured size budget or contains a second MCP server entry.

On macOS it also runs the packaged terminal reader in a pseudo-terminal and checks that a Tour Step appears and the reader exits. This does not prove the graphical terminal window works, validate Copilot, or replace testing on a fresh machine without a global runtime and without admin access. Windows and both macOS architectures each need their own actual artifact and graphical smoke test before the POC packaging acceptance criterion is complete.

On Windows, `codetour.cmd mcp` forwards every argument to `dist\cli.js` (`%*` in the launcher, covered by the launcher template test), but a real Windows launch of `codetour.cmd mcp` with an MCP client has not been executed on a build machine yet: it must be validated on Windows before release, together with spaced paths through `codetour.cmd`.
