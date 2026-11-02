# Store Tour Images under .tours/images and verify them at the MCP boundary

Tour generation may include local images in step Markdown, but only through a strict geographic split: images created for a Tour (Tour Images) live under `.tours/images/<tour-name>/`, where `<tour-name>` is the Tour's `fileName` without the `.tour` suffix (`project` and `changes` for the reserved Tours), while images that belong to the codebase (Project Images) stay wherever they are and may only be referenced, never created, by generation. The agent writes image files itself with its own tools; the MCP server verifies every local image reference in step Markdown by code — relative to the workspace root, confined to the workspace, PNG or JPEG by magic bytes (SVG is rejected as an XSS surface, unlike Mermaid which is sanitized upstream), at most 2 MB — and rejects the Tour when a reference fails these rules or the file does not exist. Local relative paths are opened for images only; ordinary links remain HTTPS-only per ADR 0003.

At read time the player inlines the referenced image bytes as a data URI through the description-renderer seam, the same mechanism as Mermaid rendering (ADR 0007), so the tour file stays portable and the webview CSP stays limited to `data` and `https`; a missing file renders a compact warning instead of failing the Tour. Images are read from the working tree only — a changes Tour's diff and persisted git snapshots (ADR 0010) cover code, never images — and files under `.tours/images/` are generation artifacts excluded from dirty-workspace detection alongside `.tour` files, otherwise every changes Tour would flag its own workspace as modified. Regenerating a Tour never deletes images: orphans stay on disk.

## Considered Options

- Having the MCP receive image bytes (base64) and write the files itself was rejected: it moves large payloads through tool calls without adding guarantees, since the agent already has file-writing tools.
- Serving image files to the webview via `webview.asWebviewUri` instead of data URIs was rejected: it would widen the CSP and add a resource mapping for no portability gain.
- A creation-timing rule ("only pre-existing files outside `.tours/`") cannot be enforced: the MCP cannot detect when a file was created, so the boundary is geographic plus existence, stated explicitly to the agent in the tool description.

## Consequences

- `toursDirectoryOnlyContainsGenerationArtifacts` and the untracked-`.tours` handling in `packages/mcp-server/src/git.ts` must accept `.tours/images/**` alongside `.tour` files.
- Orphaned images accumulate under `.tours/images/` across regenerations; pruning is deliberately out of scope for now.
