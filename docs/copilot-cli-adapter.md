# Copilot CLI adapter (experimental)

`/codetour` offers **Read** or **Generate**. Generate offers **Project Tour** or **Changes Tour**. A Changes Tour asks **Neutral or critical?** before the extension sends any analysis request to the agent. Cancelling any choice ends the command without generating a Tour. Project Tours never ask for a review mode.

Explicit invocations skip the choices already supplied:

```text
/codetour generate project
/codetour generate changes neutral
/codetour generate changes critical
/codetour My Existing Tour --renderer terminal
```

Existing title and renderer invocations still select and open a Tour using the standalone CLI, which owns selection through its resolution contract (`--internal-resolve-tour`): a requested title resolves by exact title or file name, and resolution errors (not found or ambiguous title, empty workspace) reach the user exactly as the CLI reports them. Without a title, a workspace holding a single Tour resolves directly; only several discovered Tours elicit a candidate choice before the same CLI resolution. `generate` is now a command word; quote an existing title that starts with it, for example `/codetour "generate"`. Bare `read` remains a Tour title. The default renderer remains HTML. If the host lacks interactive elicitation, supply an explicit generation command or an existing Tour title.

The project extension is `.github/extensions/codetour/`. Copy that directory into another repository or to `~/.copilot/extensions/codetour/` for user-wide installation. Start `copilot --experimental` from a trusted Git worktree, with extension mode set to Load Only or Load & Augment. GitHub's extension API remains experimental.

Make the standalone `codetour` command available on PATH or set `CODETOUR_CLI` to its absolute launcher path. A complete standalone distribution includes its runtime. For development, `CODETOUR_CLI` may point to `dist/cli.js` after a build, and **Node must be on PATH**. The extension cannot use `process.execPath` as a Node interpreter: the real Copilot host can run it under the native Copilot executable. Windows `.cmd` distributions resolve directly to their adjacent `node.exe` and `dist/cli.js`, without shell interpolation.

The extension registers the same standalone command as the session's `codetour` MCP server (`codetour mcp --workspace-root <worktree>`), retaining the existing two creation tools. The adapter handles choices and sends a generation request using `session.send` in immediate mode, so a completed command starts the requested run without waiting for another Enter; the host's agent analyzes the repository and calls `create_project_tour` or `create_changes_tour`. All validation, Git comparison, anchoring and persistence remain in the common MCP implementation. The adapter does not synthesize Tour steps or copy the review skill.

For every generation, after the choices and before sending the request, the adapter derives the prompt from the served MCP resource instead of carrying its own prose. It opens the shared server over stdio with a single minimal MCP client and reads `codetour://generate/project-tour` for a Project Tour, or `codetour://generate/changes-tour/{reviewMode}` — the resource parameterized by the chosen review mode — for a Changes Tour. The served prompt is sent as-is with `session.send`; the adapter adds nothing to it. The neutral prompt asks for a factual explanation of the changes; the critical prompt additionally embeds the shared review skill pack — the complete upstream skill, CodeTour adaptation, revision, attribution and license, the same pack as `codetour://review/critical-instructions` — so the skill reaches the Tour Generator offline, whether or not the Copilot model can browse MCP resources. An empty or unreachable resource is an explicit error that stops generation; the adapter never falls back to a hand-written prompt or to another mode.

The controlled adapter guarantees choice and instruction-transfer ordering. The host agent still decides which code to inspect and must obey the instructions and tool schemas. Direct calls from external MCP clients default to neutral when `reviewMode` is absent; MCP does not display a universal conversational question. Tour files keep their existing format.

Run `npm run build` and `node --test test/copilot-adapter.test.mjs`. Tests cover the real CLI playback, the served generation-prompt resources, a fake Copilot host's choices/order/cancellation/explicit modes, the CLI Tour resolution contract and unavailable dependencies. These tests establish boundary behavior, not a particular model's review quality. See [the recorded Copilot probe](copilot-generation-probe.md) for installed-host evidence and remaining limitations.

Primary API references: [GitHub SDK extensions](https://github.com/github/copilot-sdk/blob/main/nodejs/docs/extensions.md), [agent authoring](https://github.com/github/copilot-sdk/blob/main/nodejs/docs/agent-author.md). The installed CLI's bundled SDK declarations are the compatibility reference for the recorded probe.
