import { test } from "node:test";
import * as assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AcpProvider } from "../agent/acpProviders";
import { createAcpStepChatResponder } from "../agent/stepChatAgent";
import {
  buildStepChatContext,
  commandExists,
  openTerminalChat,
  StepConversations
} from "./stepChatSupport";

const fakeAgent = path.join(__dirname, "../agent/fakeAcpAgent.js");

function provider(name: string, command: string): AcpProvider {
  return { name, entry: { command, cwd: process.cwd() } };
}

test("only an installed provider answers Step questions", async () => {
  const providers = [provider("Vibe", "vibe-acp"), provider("Copilot", "copilot")];
  let disposed = 0;
  const session = openTerminalChat(process.cwd(), {
    providers,
    exists: command => command === "copilot",
    createResponder: () => ({
      answer: () => "answer",
      dispose: async () => { disposed += 1; }
    })
  });
  assert.equal(session.provider?.name, "Copilot");
  assert.equal(await session.responder?.answer({
    question: "q", context: { available: false, description: "" }, history: [],
    workspaceRoot: process.cwd()
  }), "answer");
  await session.dispose();
  assert.equal(disposed, 1);

  const none = openTerminalChat(process.cwd(), {
    providers, exists: () => false
  });
  assert.equal(none.responder, undefined);
  await none.dispose();
});

test("an explicit ACP command overrides the installed providers", () => {
  const session = openTerminalChat(process.cwd(), {
    env: { CODETOUR_ACP_COMMAND: "/opt/agent", CODETOUR_ACP_ARGS: "--stdio --flag" },
    exists: () => true,
    createResponder: () => ({ answer: () => "ok" })
  });
  assert.equal(session.provider?.name, "custom");
  assert.equal(session.provider?.entry.command, "/opt/agent");
  assert.deepEqual(session.provider?.entry.args, ["--stdio", "--flag"]);
});

test("a command is found only when it is an executable on PATH", {
  skip: process.platform === "win32"
}, () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "codetour-path-"));
  try {
    const executable = path.join(directory, "codetour-agent");
    writeFileSync(executable, "#!/bin/sh\nexit 0\n");
    chmodSync(executable, 0o755);
    assert.equal(commandExists("codetour-agent", { PATH: directory }), true);
    assert.equal(commandExists("codetour-agent", { PATH: "/nonexistent" }), false);
    assert.equal(commandExists(executable, { PATH: "" }), true);
    assert.equal(commandExists("codetour-missing-agent", { PATH: directory }), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("conversations keep completed answers as the next question's history", () => {
  const conversations = new StepConversations();
  const first = conversations.begin(0, "first");
  conversations.append(0, first, "part ");
  conversations.append(0, first, "two");
  conversations.complete(0, first, "part one");
  const failed = conversations.begin(0, "failed");
  conversations.fail(0, failed, "unavailable");
  const pending = conversations.begin(0, "pending");

  assert.deepEqual(conversations.history(0),
    [{ question: "first", answer: "part one" }]);
  assert.equal(conversations.exchanges(0).length, 3);
  assert.equal(conversations.exchanges(0)[2], pending);
  assert.deepEqual(conversations.exchanges(1), []);
});

test("a question is grounded in the code or the two diff snapshots on screen", () => {
  const code = buildStepChatContext(
    { id: "t", title: "T", steps: [] },
    { title: "Step", description: "Explains", file: "src/a.ts" },
    { kind: "code", label: "src/a.ts", text: "const a = 1;" }
  );
  assert.deepEqual(code, {
    available: true, path: "src/a.ts", code: "const a = 1;", description: "Explains"
  });

  const diff = buildStepChatContext(
    { id: "t", title: "T", baseRef: "a".repeat(40), ref: "b".repeat(40), steps: [] },
    { title: "Step", description: "Explains", file: "src/a.ts", display: "diff" },
    { kind: "diff", label: "src/a.ts", text: "@@ -1 +1 @@" },
    (ref, file) => ref[0] + ":" + file
  );
  assert.deepEqual(diff, {
    available: true,
    path: "src/a.ts",
    diff: {
      original: { path: "src/a.ts", ref: "a".repeat(40), code: "a:src/a.ts" },
      modified: { path: "src/a.ts", ref: "b".repeat(40), code: "b:src/a.ts" }
    },
    description: "Explains"
  });

  const unavailable = buildStepChatContext(
    { id: "t", title: "T", steps: [] },
    { title: "Step", description: "Explains", directory: "src" },
    { kind: "directory", label: "src" }
  );
  assert.deepEqual(unavailable,
    { available: false, path: undefined, description: "Explains" });
});

test("a restored path answers through the real ACP responder", { timeout: 60_000 }, async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "codetour-cli-acp-"));
  try {
    const responder = createAcpStepChatResponder(() => ({
      command: process.execPath,
      args: [fakeAgent, path.join(directory, "agent.log")],
      cwd: directory
    }));
    const answer = await responder.answer({
      question: "Why?",
      context: { available: true, path: "a.ts", code: "const a = 1;", description: "Step" },
      history: [],
      workspaceRoot: directory
    });
    assert.match(answer, /Tour answer/);
    await responder.dispose();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
