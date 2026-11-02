import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The same command supplies playback, MCP tools and the offline review resource.
export function codeTourMcpServer(cwd = process.cwd()) {
  const [executable, ...prefix] = command();
  return {type: "stdio", command: executable, args: [...prefix, "mcp", "--workspace-root", cwd], tools: ["*"], workingDirectory: cwd};
}

async function criticalInstructions(cwd) {
  const config = codeTourMcpServer(cwd);
  return new Promise((resolve, reject) => {
    const child = spawn(config.command, config.args, {cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true});
    const lines = createInterface({input: child.stdout});
    let stderr = "";
    let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.end();
      child.kill();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error("CodeTour MCP review instructions timed out.")), 15000);
    const send = message => child.stdin.write(JSON.stringify({jsonrpc: "2.0", ...message}) + "\n");
    child.on("error", error => finish(error));
    child.stdin.on("error", error => finish(error));
    child.stderr.on("data", chunk => {stderr = (stderr + chunk).slice(-4096);});
    child.once("close", () => finish(new Error(stderr.trim() || "CodeTour MCP closed before providing review instructions.")));
    lines.on("line", line => {
      try {
        const message = JSON.parse(line);
        if (message.error) throw new Error(message.error.message);
        if (message.id === 1) {
          send({method: "notifications/initialized"});
          send({id: 2, method: "resources/read", params: {uri: "codetour://review/critical-instructions"}});
        } else if (message.id === 2) {
          const text = message.result?.contents?.map(item => item.text || "").join("\n");
          if (!text?.trim()) throw new Error("CodeTour MCP returned empty review instructions.");
          finish(null, text);
        }
      } catch (error) { finish(error); }
    });
    send({id: 1, method: "initialize", params: {protocolVersion: "2024-11-05", capabilities: {}, clientInfo: {name: "codetour-copilot", version: "1.0.0"}}});
  });
}

// The CLI remains the sole owner of discovery, selection and rendering.
function command() {
  const configured = process.env.CODETOUR_CLI;
  if (configured) return resolveCommand(configured);
  const projectCli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../dist/cli.js");
  if (existsSync(projectCli)) return ["node", projectCli];
  if (process.platform === "win32") {
    for (const directory of (process.env.PATH || "").split(path.delimiter)) {
      const launcher = path.join(directory || ".", "codetour.cmd");
      if (existsSync(launcher)) return resolveCommand(launcher);
    }
  }
  return ["codetour"];
}

// Copilot can host extensions in its own native executable; process.execPath
// is then the Copilot CLI, not a Node interpreter. Development .js entries
// require Node on PATH. Packaged launchers use their bundled runtime.
function resolveCommand(configured) {
  if (configured.toLowerCase().endsWith(".js")) return ["node", configured];
  if (configured.toLowerCase().endsWith(".cmd")) {
    // Distributions place the runtime and CLI beside codetour.cmd. Avoid a
    // shell entirely: paths and Tour titles remain individual arguments.
    const directory = path.dirname(path.resolve(configured));
    const runtime = path.join(directory, "node.exe");
    const cli = path.join(directory, "dist", "cli.js");
    if (!existsSync(runtime) || !existsSync(cli)) throw new Error("Configured .cmd is not a complete CodeTour distribution.");
    return [runtime, cli];
  }
  return [configured];
}

function parse(raw) {
  // The final token is the renderer flag when present; the remaining text is
  // the exact Tour title (including spaces), optionally enclosed in quotes.
  let text = (raw || "").trim();
  let renderer = "html";
  const match = text.match(/(?:^|\s)--renderer(?:=|\s+)([^\s]+)\s*$/);
  if (match) { renderer = match[1]; text = text.slice(0, match.index).trim(); }
  if (renderer !== "html" && renderer !== "terminal") throw new Error("Unknown renderer; use html or terminal.");
  if (/(?:^|\s)--/.test(text)) throw new Error("Unknown option. Use /codetour [tour] [--renderer html|terminal].");
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) text = text.slice(1, -1);
  return { title: text, renderer };
}

function runCli(args, cwd, { detached = false } = {}) {
  return new Promise((resolve, reject) => {
    const [executable, ...prefix] = command();
    const child = spawn(executable, [...prefix, ...args], {cwd, detached,
      stdio: detached ? "ignore" : ["ignore", "pipe", "pipe"], windowsHide: true});
    child.once("error", reject);
    if (detached) { child.once("spawn", () => { child.unref(); resolve(""); }); return; }
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("close", code => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `CodeTour exited ${code}`)));
  });
}

async function select(session, prompt, choices) {
  if (!session.capabilities?.ui?.elicitation) throw new Error("This choice requires an interactive Copilot session; use /codetour generate project or /codetour generate changes neutral|critical, or specify a Tour title.");
  const answer = await session.ui.select(prompt, choices);
  if (answer === null || answer === undefined) return null;
  if (!choices.includes(answer)) throw new Error("Invalid CodeTour selection.");
  return answer;
}

export async function runCodeTourCommand(session, raw, cwd = process.cwd()) {
  try {
    let input = (raw || "").trim();
    const explicit = input.match(/^generate(?:\s+(project|changes)(?:\s+(neutral|critical))?)?$/);
    if (input.startsWith("generate ") && !explicit) throw new Error("Use /codetour generate project or /codetour generate changes neutral|critical.");
    let action = explicit ? "Generate" : "Read";
    if (!input) {
      action = await select(session, "Read or generate a CodeTour?", ["Read", "Generate"]);
      if (!action) return;
    }
    if (action === "Generate") {
      let type = explicit?.[1];
      if (!type) {
        const answer = await select(session, "Which type of Tour?", ["Project Tour", "Changes Tour"]);
        if (!answer) return;
        type = answer === "Project Tour" ? "project" : "changes";
      }
      let reviewMode = explicit?.[2];
      if (type === "project" && reviewMode) throw new Error("Project Tours do not have a review mode.");
      if (type === "changes" && !reviewMode) {
        const answer = await select(session, "Neutral or critical?", ["Neutral", "Critical"]);
        if (!answer) return;
        reviewMode = answer.toLowerCase();
      }
      if (typeof session.send !== "function") throw new Error("This Copilot host cannot send a generation request to its agent.");
      let prompt = type === "project"
        ? "Generate a Project Tour of the current Tour Workspace using the registered CodeTour MCP create_project_tour tool."
        : `Generate a Changes Tour of committed changes on the current branch using the registered CodeTour MCP create_changes_tour tool with reviewMode: "${reviewMode}". Preserve the existing Git comparison, Tour Anchors, validation, destination and dryRun contracts. ${reviewMode === "neutral" ? "Explain changes factually, without adding quality judgments." : ""}`;
      if (reviewMode === "critical") {
        const instructions = await criticalInstructions(cwd);
        prompt += `\nBefore any analysis or drafting, follow these shared CodeTour review instructions, retrieved from codetour://review/critical-instructions:\n\n${instructions}`;
      }
      // The slash command has completed its choices; start the requested run now.
      // Enqueue leaves explicit commands waiting for another Enter on CLI 1.0.105.
      await session.send({prompt, mode: "immediate"});
      return;
    }
    const { title, renderer } = parse(input);
    const tours = JSON.parse(await runCli(["--internal-list-tours"], cwd));
    if (!tours.length) throw new Error("No existing Tours found in this Git worktree.");
    let selected;
    if (title) {
      const matches = tours.filter(tour => tour.title === title ||
        path.basename(fileURLToPath(tour.id), ".tour") === title);
      if (matches.length !== 1) throw new Error(`Tour '${title}' not found or ambiguous. Available: ${tours.map(t => t.title).join(", ")}`);
      selected = matches[0];
    } else if (tours.length === 1) selected = tours[0];
    else {
      if (!session.capabilities?.ui?.elicitation) throw new Error("Tour selection requires an interactive Copilot session; specify a Tour title.");
      const labels = tours.map((tour, i) => `${i + 1}. ${tour.title}`);
      const choice = await session.ui.select("Select a CodeTour", labels);
      if (choice === null || choice === undefined) return;
      selected = tours[labels.indexOf(choice)];
      if (!selected) throw new Error("Invalid Tour selection.");
    }
    await runCli(["--internal-tour-id", selected.id, "--renderer", renderer], cwd, {detached: true});
    await session.log(`Starting CodeTour: ${selected.title} (${renderer}).`, {level: "info"});
  } catch (error) {
    await session.log(`CodeTour: ${error instanceof Error ? error.message : String(error)}`, {level: "error"});
  }
}
