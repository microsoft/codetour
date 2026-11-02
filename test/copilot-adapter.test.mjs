import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync, symlinkSync, cpSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCodeTourCommand, codeTourMcpServer } from "../.github/extensions/codetour/adapter.mjs";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

function writeTrackedReaderWrapper(file) {
  writeFileSync(file, [
    'const { spawnSync } = require("node:child_process");',
    'const { writeFileSync } = require("node:fs");',
    'const result = spawnSync(process.execPath, [process.env.CODETOUR_REAL_CLI, ...process.argv.slice(2)], { stdio: "inherit" });',
    'if (process.argv.includes("--internal-tour-id")) writeFileSync(process.env.CODETOUR_TEST_READER_PID, String(process.pid));',
    'const finish = () => process.exit(result.status ?? 1);',
    'if (process.argv.includes("--internal-tour-id")) setTimeout(finish, 500); else finish();'
  ].join("\n"));
}

test("Copilot selection forwards the selected Tour to the real standalone HTML CLI", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-copilot-adapter-"));
  const previousCli = process.env.CODETOUR_CLI;
  const previousRealCli = process.env.CODETOUR_REAL_CLI;
  const previousOutput = process.env.CODETOUR_TEST_HTML_OUTPUT;
  const previousReaderPid = process.env.CODETOUR_TEST_READER_PID;
  try {
    execFileSync("git", ["init", "-q", root]);
    mkdirSync(path.join(root, ".tours"));
    for (const [name, title] of [["a", "First Tour"], ["b", "Second Tour"]])
      writeFileSync(path.join(root, ".tours", `${name}.tour`), JSON.stringify({title, steps:[{description: `Content for ${title}`}]}));
    const wrapper = path.join(root, "reader-wrapper.js");
    const readerPid = path.join(root, "reader.pid");
    // Keep a process whose cwd is the temporary workspace alive after the
    // HTML file is written. Windows cannot remove that workspace until this
    // reader process has exited, so the test waits for the PID to disappear.
    writeTrackedReaderWrapper(wrapper);
    process.env.CODETOUR_CLI = wrapper;
    process.env.CODETOUR_REAL_CLI = path.resolve("dist/cli.js");
    const output = path.join(root, "result.html");
    process.env.CODETOUR_TEST_HTML_OUTPUT = output;
    process.env.CODETOUR_TEST_READER_PID = readerPid;
    const messages = [];
    const session = {capabilities:{ui:{elicitation:true}}, ui:{select: async (prompt, choices) => prompt === "Read or generate a CodeTour?" ? "Read" : choices[1]},
      log: async message => messages.push(message)};
    await runCodeTourCommand(session, "", root);
    for (let i = 0; i < 100 && (!existsSync(output) || !existsSync(readerPid)); i++) await delay(50);
    assert.ok(existsSync(output), messages.join("\n"));
    assert.ok(existsSync(readerPid), "the selected reader process should report its PID");
    const pid = Number(readFileSync(readerPid, "utf8"));
    assert.ok(Number.isSafeInteger(pid) && pid > 0, "the reader PID must be valid");
    assert.ok(processIsRunning(pid), "the fixture must keep the reader alive after writing HTML");
    const deadline = Date.now() + 5000;
    while (processIsRunning(pid)) {
      assert.ok(Date.now() < deadline, "the selected reader process must exit before workspace cleanup");
      await delay(25);
    }
    assert.match(readFileSync(output, "utf8"), /Second Tour/);
    assert.match(messages.join("\n"), /Starting CodeTour: Second Tour/);
  } finally {
    if (previousCli === undefined) delete process.env.CODETOUR_CLI; else process.env.CODETOUR_CLI = previousCli;
    if (previousRealCli === undefined) delete process.env.CODETOUR_REAL_CLI; else process.env.CODETOUR_REAL_CLI = previousRealCli;
    if (previousOutput === undefined) delete process.env.CODETOUR_TEST_HTML_OUTPUT; else process.env.CODETOUR_TEST_HTML_OUTPUT = previousOutput;
    if (previousReaderPid === undefined) delete process.env.CODETOUR_TEST_READER_PID; else process.env.CODETOUR_TEST_READER_PID = previousReaderPid;
    // On Windows the OS may release a just-exited reader's cwd handle just
    // after its PID disappears. Retry only transient filesystem-lock errors.
    rmSync(root, {recursive:true, force:true, maxRetries:50, retryDelay:100});
  }
});


test("missing UI capability is reported without launching a reader", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-copilot-no-ui-"));
  const previousCli = process.env.CODETOUR_CLI;
  try {
    execFileSync("git", ["init", "-q", root]);
    mkdirSync(path.join(root, ".tours"));
    for (const name of ["a", "b"]) writeFileSync(path.join(root, ".tours", `${name}.tour`), JSON.stringify({title:name,steps:[{description:"test"}]}));
    process.env.CODETOUR_CLI = path.resolve("dist/cli.js");
    const messages = [];
    await runCodeTourCommand({capabilities:{},log:async text => messages.push(text)}, "", root);
    assert.match(messages.join("\n"), /requires an interactive Copilot session/);
  } finally {
    if (previousCli === undefined) delete process.env.CODETOUR_CLI; else process.env.CODETOUR_CLI = previousCli;
    rmSync(root, {recursive:true, force:true});
  }
});


test("a packaged .cmd path uses its bundled runtime without shell interpretation", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "codetour-adapter-command-"));
  const previousCli = process.env.CODETOUR_CLI;
  const previousRealCli = process.env.CODETOUR_REAL_CLI;
  const previousOutput = process.env.CODETOUR_TEST_HTML_OUTPUT;
  const previousReaderPid = process.env.CODETOUR_TEST_READER_PID;
  try {
    execFileSync("git", ["init", "-q", root]);
    mkdirSync(path.join(root, ".tours"));
    writeFileSync(path.join(root, ".tours", "a.tour"), JSON.stringify({title:"Safe",steps:[{description:"Package works"}]}));
    const pkg = path.join(root, "package & data");
    mkdirSync(path.join(pkg, "dist"), {recursive:true});
    if (process.platform === "win32") copyFileSync(process.execPath, path.join(pkg, "node.exe"));
    else symlinkSync(process.execPath, path.join(pkg, "node.exe"));
    const realCli = path.join(pkg, "dist", "real-cli.js");
    copyFileSync(path.resolve("dist/cli.js"), realCli);
    writeTrackedReaderWrapper(path.join(pkg, "dist", "cli.js"));
    cpSync(path.resolve("dist/resvg-runtime"), path.join(pkg, "dist", "resvg-runtime"), {recursive:true});
    // The CLI bundle requires the userland punycode package instead of the
    // deprecated core module; a packaged layout ships it as a closure.
    mkdirSync(path.join(pkg, "dist", "node_modules"), {recursive:true});
    cpSync(path.resolve("node_modules/punycode"), path.join(pkg, "dist", "node_modules", "punycode"), {recursive:true});
    const cmd = path.join(pkg, "codetour.cmd");
    writeFileSync(cmd, "@echo off\r\nexit /b 12\r\n");
    const readerPid = path.join(root, "reader.pid");
    process.env.CODETOUR_CLI = cmd;
    process.env.CODETOUR_REAL_CLI = realCli;
    process.env.CODETOUR_TEST_HTML_OUTPUT = path.join(root, "result.html");
    process.env.CODETOUR_TEST_READER_PID = readerPid;
    const messages = [];
    await runCodeTourCommand({capabilities:{},log:async text => messages.push(text)}, "Safe", root);
    for (let i = 0; i < 100 && (!existsSync(process.env.CODETOUR_TEST_HTML_OUTPUT) || !existsSync(readerPid)); i++) await delay(50);
    assert.ok(existsSync(process.env.CODETOUR_TEST_HTML_OUTPUT), messages.join("\n"));
    assert.ok(existsSync(readerPid), "the packaged reader should report its PID before cleanup");
    const pid = Number(readFileSync(readerPid, "utf8"));
    assert.ok(Number.isSafeInteger(pid) && pid > 0, "the packaged reader PID must be valid");
    assert.ok(processIsRunning(pid), "the fixture must keep the packaged reader alive after writing HTML");
    const deadline = Date.now() + 5000;
    while (processIsRunning(pid)) {
      assert.ok(Date.now() < deadline, "the packaged reader must exit before workspace cleanup");
      await delay(25);
    }
    assert.match(readFileSync(process.env.CODETOUR_TEST_HTML_OUTPUT, "utf8"), /Package works/);
  } finally {
    if (previousCli === undefined) delete process.env.CODETOUR_CLI; else process.env.CODETOUR_CLI = previousCli;
    if (previousRealCli === undefined) delete process.env.CODETOUR_REAL_CLI; else process.env.CODETOUR_REAL_CLI = previousRealCli;
    if (previousOutput === undefined) delete process.env.CODETOUR_TEST_HTML_OUTPUT; else process.env.CODETOUR_TEST_HTML_OUTPUT = previousOutput;
    if (previousReaderPid === undefined) delete process.env.CODETOUR_TEST_READER_PID; else process.env.CODETOUR_TEST_READER_PID = previousReaderPid;
    rmSync(root, {recursive:true, force:true, maxRetries:50, retryDelay:100});
  }
});


test("generation chooses the review mode before handing analysis to the host", async () => {
  const events = [];
  const answers = ["Generate", "Changes Tour", "Neutral"];
  let sent;
  await runCodeTourCommand({
    capabilities: {ui: {elicitation: true}},
    ui: {select: async (prompt) => { events.push(prompt); return answers.shift(); }},
    send: async options => { events.push("send"); sent = options; },
    log: async message => { events.push(message); }
  }, "");
  assert.deepEqual(events, ["Read or generate a CodeTour?", "Which type of Tour?", "Neutral or critical?", "send"]);
  assert.equal(sent.mode, "immediate", "a completed command must start generation without an extra Enter");
  assert.match(sent.prompt, /create_changes_tour/);
  assert.match(sent.prompt, /reviewMode.*neutral/);
});


test("critical generation receives the real shared offline skill before analysis", async () => {
  const previousCli = process.env.CODETOUR_CLI;
  process.env.CODETOUR_CLI = path.resolve("dist/cli.js");
  try {
    let sent;
    const logs = [];
    await runCodeTourCommand({capabilities:{}, send: async options => {sent=options;}, log: async message => logs.push(message)}, "generate changes critical");
    assert.ok(sent, logs.join("\n"));
    assert.match(sent.prompt, /reviewMode: "critical"/);
    assert.match(sent.prompt, /Matt Pocock/);
    assert.match(sent.prompt, /Standards/);
    assert.match(sent.prompt, /Spec/);
    assert.match(sent.prompt, /MIT License/);
    assert.match(sent.prompt, /before.*analys/i);
  } finally {
    if (previousCli === undefined) delete process.env.CODETOUR_CLI; else process.env.CODETOUR_CLI = previousCli;
  }
});


test("an explicit Project Tour bypasses review choices and uses the existing tool", async () => {
  const prompts = [];
  await runCodeTourCommand({capabilities:{}, send: async ({prompt}) => prompts.push(prompt), log: async text => assert.fail(text)}, "generate project");
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /create_project_tour/);
  assert.doesNotMatch(prompts[0], /reviewMode|critical-instructions/);
});

for (const cancelAt of [0, 1, 2]) test(`cancelling generation choice ${cancelAt + 1} never starts analysis`, async () => {
  const choices = ["Generate", "Changes Tour", "Critical"];
  let count = 0;
  await runCodeTourCommand({capabilities:{ui:{elicitation:true}},
    ui:{select:async () => count++ === cancelAt ? null : choices[count - 1]},
    send: async () => assert.fail("Analysis started after cancellation"), log:async text => assert.fail(text)}, "");
  assert.equal(count, cancelAt + 1);
});

test("invalid and unavailable generation choices fail without silently creating Tours", async () => {
  for (const raw of ["generate changes invented", "generate project critical", "generate"]) {
    const errors = [];
    await runCodeTourCommand({capabilities:{}, send:async () => assert.fail("Unexpected generation"), log:async text => errors.push(text)}, raw);
    assert.equal(errors.length, 1);
  }
});

test("an unavailable shared skill prevents critical analysis", async () => {
  const previousCli = process.env.CODETOUR_CLI;
  process.env.CODETOUR_CLI = path.join(os.tmpdir(), "codetour-missing-executable");
  try {
    const errors = [];
    await runCodeTourCommand({send:async () => assert.fail("Critical generation without instructions"), log:async text => errors.push(text)}, "generate changes critical");
    assert.match(errors.join("\n"), /ENOENT/);
  } finally {
    if (previousCli === undefined) delete process.env.CODETOUR_CLI; else process.env.CODETOUR_CLI = previousCli;
  }
});

test("the Copilot host registers the shared standalone MCP with the selected workspace", () => {
  const previousCli = process.env.CODETOUR_CLI;
  process.env.CODETOUR_CLI = path.resolve("dist/cli.js");
  try {
    const server = codeTourMcpServer("/tmp/workspace with spaces");
    assert.equal(server.command, "node");
    assert.deepEqual(server.args, [process.env.CODETOUR_CLI, "mcp", "--workspace-root", "/tmp/workspace with spaces"]);
    assert.equal(server.workingDirectory, "/tmp/workspace with spaces");
  } finally {
    if (previousCli === undefined) delete process.env.CODETOUR_CLI; else process.env.CODETOUR_CLI = previousCli;
  }
});
