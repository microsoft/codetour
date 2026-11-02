import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  StepChatAgentUnavailableError,
  type StepChatContext,
  type StepChatRequest,
  type StepChatResponder
} from "./stepChatContract";
import { StepConversations } from "./stepConversations";

// The Tour Step Conversation store shared by every playback surface above
// the StepChatResponder seam: one lifecycle, one history rule, one
// interruption, independently of how a surface paints the exchanges.

const stepContext: StepChatContext = { available: false, description: "Step" };

function grounding() {
  return { context: () => stepContext, workspaceRoot: "/tour" };
}

interface RecordedRequest {
  question: string;
  history: { question: string; answer: string }[];
}

/** A responder the tests control: records requests, streams, never times. */
function scripted(answer: string): { responder: StepChatResponder; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  return {
    requests,
    responder: {
      answer(request: StepChatRequest) {
        requests.push({ question: request.question, history: request.history });
        return answer;
      }
    }
  };
}

test("a question records its exchange and returns the completed answer", async () => {
  const agent = scripted("Réponse complète.");
  const conversations = new StepConversations(agent.responder);

  const view = await conversations.ask("tour::0", "Pourquoi ?", grounding());

  assert.equal(view.responding, false);
  assert.deepEqual(view.exchanges, [
    {
      question: "Pourquoi ?",
      answer: "Réponse complète.",
      activity: undefined,
      toolUses: [],
      pending: false,
      interrupted: false,
      failed: false
    }
  ]);
  assert.equal(agent.requests.length, 1);
  assert.equal(agent.requests[0].question, "Pourquoi ?");
  assert.deepEqual(agent.requests[0].history, []);
});

test("only completed exchanges feed the next question's history", async () => {
  const requests: { history: { question: string; answer: string }[] }[] = [];
  let call = 0;
  const conversations = new StepConversations({
    answer(request: StepChatRequest) {
      requests.push({ history: request.history });
      call++;
      if (call === 1) return "Première réponse.";
      if (call === 2) throw new Error("agent down");
      if (call === 3) return "";
      return "Dernière réponse.";
    }
  });

  await conversations.ask("tour::0", "réussie ?", grounding());
  await conversations.ask("tour::0", "qui échoue ?", grounding());
  const pending = conversations.ask("tour::0", "restée ouverte ?", grounding());
  // A third exchange stays in flight: it never feeds history either.
  const fourth = await conversations.ask("tour::1", "autre étape ?", grounding());

  assert.equal(fourth.exchanges.length, 1);
  void pending.then(() => undefined, () => undefined);
  // The failed exchange is excluded, the completed ones kept: history is
  // scoped to the asking conversation.
  assert.deepEqual(requests[1].history, [
    { question: "réussie ?", answer: "Première réponse." }
  ]);
  assert.deepEqual(requests[3].history, []);
});

test("a question is blocked while the conversation's answer is in progress", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const conversations = new StepConversations({
    answer: async () => {
      calls++;
      await gate;
      return "Réponse.";
    }
  });

  const first = conversations.ask("tour::0", "Première ?", grounding());
  const blocked = await conversations.ask("tour::0", "Trop pressé ?", grounding());
  const otherStep = conversations.ask("tour::1", "Autre étape ?", grounding());
  // Let both in-flight questions reach the responder.
  await new Promise(resolve => setTimeout(resolve, 0));

  // The blocked question never reaches the responder and never enters the
  // conversation; another step's conversation asks independently.
  assert.equal(calls, 2);
  assert.equal(blocked.exchanges.length, 1);
  assert.equal(blocked.exchanges[0].question, "Première ?");
  assert.equal(blocked.responding, true);
  assert.equal(conversations.view("tour::1").responding, true);
  assert.equal(conversations.view("tour::1").exchanges.length, 1);

  release();
  assert.deepEqual((await Promise.all([first, otherStep])).map(view => view.exchanges[0].answer),
    ["Réponse.", "Réponse."]);
});

test("the answer streams into the pending exchange, raw, with its events", async () => {
  const updates: number[] = [];
  let releaseTail!: () => void;
  const tailGate = new Promise<void>(resolve => {
    releaseTail = resolve;
  });
  const conversations = new StepConversations({
    answer: async (_request: StepChatRequest, events) => {
      events?.onActivity?.("Question envoyée");
      events?.onThoughtDelta?.("réflexion ");
      events?.onThoughtDelta?.("en cours");
      events?.onToolUse?.({ toolCallId: "read", kind: "read", status: "in_progress", forbidden: false });
      events?.onToolUse?.({ toolCallId: "edit", kind: "edit", title: "Edit anyway", forbidden: true });
      events?.onAnswerDelta?.("Premier morceau ");
      events?.onAnswerDelta?.("et le second.");
      await tailGate;
      return "Premier morceau et le second.";
    }
  });

  const streaming = conversations.ask("tour::0", "En flux ?", grounding(), () =>
    updates.push(conversations.view("tour::0").exchanges.length)
  );
  await new Promise(resolve => setTimeout(resolve, 0));
  const pending = conversations.view("tour::0");
  assert.equal(pending.responding, true);
  assert.equal(pending.exchanges[0].pending, true);
  assert.equal(pending.exchanges[0].answer, "Premier morceau et le second.");
  // The latest event wins the activity line: the allowed tool call, after
  // the streamed thoughts, is the last thing the agent did.
  assert.equal(pending.exchanges[0].activity, "read (in_progress)");
  assert.deepEqual(pending.exchanges[0].toolUses, [
    { toolCallId: "read", kind: "read", status: "in_progress", forbidden: false },
    { toolCallId: "edit", kind: "edit", title: "Edit anyway", forbidden: true }
  ]);
  assert.ok(updates.length > 0);

  releaseTail();
  const final = await streaming;
  assert.equal(final.responding, false);
  assert.equal(final.exchanges[0].answer, "Premier morceau et le second.");
  assert.equal(final.exchanges[0].pending, false);
});

test("the accumulated thoughts stay the activity line until a later event", async () => {
  let releaseTail!: () => void;
  const tailGate = new Promise<void>(resolve => {
    releaseTail = resolve;
  });
  const conversations = new StepConversations({
    answer: async (_request: StepChatRequest, events) => {
      events?.onActivity?.("Question envoyée");
      events?.onThoughtDelta?.("Analyse ");
      events?.onThoughtDelta?.("de la constante");
      await tailGate;
      return "Réponse finale.";
    }
  });

  const streaming = conversations.ask("tour::0", "Réfléchis ?", grounding());
  await new Promise(resolve => setTimeout(resolve, 0));
  const pending = conversations.view("tour::0");
  assert.equal(pending.exchanges[0].activity, "Analyse de la constante");
  assert.equal(pending.exchanges[0].answer, "");

  releaseTail();
  await streaming;
});

test("stop interrupts the in-flight answer and ignores its late completion", async () => {
  const settle: ((answer: string) => void)[] = [];
  let cancels = 0;
  const conversations = new StepConversations({
    answer: (_request: StepChatRequest, events) => {
      events?.onAnswerDelta?.("Un morceau ");
      return new Promise<string>(resolve => {
        settle.push(resolve);
      });
    },
    cancel: () => {
      cancels++;
    }
  });

  const first = conversations.ask("tour::0", "Longue réponse ?", grounding());
  await new Promise(resolve => setTimeout(resolve, 0));

  const stopped = conversations.stop("tour::0");
  assert.equal(cancels, 1);
  assert.equal(stopped.responding, false);
  assert.equal(stopped.exchanges[0].interrupted, true);
  assert.equal(stopped.exchanges[0].pending, false);
  assert.equal(stopped.exchanges[0].answer, "Un morceau ");

  // The late completion of the cancelled answer never overwrites the
  // interrupted state.
  settle[0]("Réponse tardive.");
  await new Promise(resolve => setTimeout(resolve, 0));
  const afterLate = conversations.view("tour::0");
  assert.equal(afterLate.exchanges[0].interrupted, true);
  assert.equal(afterLate.exchanges[0].answer, "Un morceau ");
  await first.then(view => {
    assert.equal(view.exchanges[0].interrupted, true);
    assert.equal(view.exchanges[0].answer, "Un morceau ");
  });

  // A new question is accepted immediately, and the interrupted exchange
  // never feeds its history.
  const requests: { history: unknown }[] = [];
  conversations.setResponder({
    answer(request: StepChatRequest) {
      requests.push(request);
      return "Nouvelle réponse.";
    }
  });
  const next = await conversations.ask("tour::0", "Nouvelle question ?", grounding());
  assert.equal(next.responding, false);
  assert.equal(next.exchanges.length, 2);
  assert.deepEqual(requests[0].history, []);
});

test("stopping with no answer in flight changes nothing", () => {
  let cancels = 0;
  const conversations = new StepConversations({
    answer: () => "Réponse.",
    cancel: () => {
      cancels++;
    }
  });

  const view = conversations.stop("tour::0");

  assert.equal(cancels, 0);
  assert.deepEqual(view.exchanges, []);
  assert.equal(view.responding, false);
});

test("a stop during the grounding capture is honored and never prompts", async () => {
  let calls = 0;
  let released: ((context: StepChatContext) => void) | undefined;
  const conversations = new StepConversations({
    answer: () => {
      calls++;
      return "Réponse.";
    }
  });

  const asked = conversations.ask("tour::0", "Pendant le grounding ?", {
    // The context capture stays open until the test releases it.
    context: () => new Promise<StepChatContext>(resolve => {
      released = resolve;
    }),
    workspaceRoot: "/tour"
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(conversations.view("tour::0").responding, true);

  // The reader stops while the displayed context is still captured: the
  // question never reaches the responder.
  const stopped = conversations.stop("tour::0");
  assert.equal(stopped.exchanges[0].interrupted, true);
  released!(stepContext);
  const settled = await asked;
  assert.equal(settled.exchanges[0].interrupted, true);
  assert.equal(settled.responding, false);
  assert.equal(calls, 0);
});

test("without a responder the exchange fails and the reading stays usable", async () => {
  const conversations = new StepConversations();

  const view = await conversations.ask("tour::0", "Qui répond ?", grounding());

  assert.equal(view.exchanges[0].failed, true);
  assert.equal(view.exchanges[0].pending, false);
  assert.match(view.exchanges[0].answer, /This step's responder is not available/);
});

test("an unavailable agent explains that a new question restarts it", async () => {
  const conversations = new StepConversations({
    answer: () => {
      throw new StepChatAgentUnavailableError("Impossible de lancer l'agent.");
    }
  });

  const view = await conversations.ask("tour::0", "Et si l'agent manque ?", grounding());

  assert.equal(view.exchanges[0].failed, true);
  assert.match(view.exchanges[0].answer, /Impossible de lancer l'agent\./);
  assert.match(view.exchanges[0].answer, /A new question will restart the agent/);
});

test("another failure lands as a failed exchange with its reason", async () => {
  const conversations = new StepConversations({
    answer: () => {
      throw new Error("agent down");
    }
  });

  const view = await conversations.ask("tour::0", "Et si ça casse ?", grounding());

  assert.equal(view.exchanges[0].failed, true);
  assert.match(view.exchanges[0].answer, /The answer to this question failed \(agent down\)/);
});

test("clear forgets the conversations and releases the responder", async () => {
  let disposed = 0;
  const conversations = new StepConversations({
    answer: () => "Réponse.",
    dispose: async () => {
      disposed++;
    }
  });
  await conversations.ask("tour::0", "Une question ?", grounding());

  conversations.clear();

  assert.equal(conversations.view("tour::0").exchanges.length, 0);
  assert.equal(disposed, 1);
  // The responder stays registered: a future question relaunches it lazily.
  const view = await conversations.ask("tour::0", "Encore ?", grounding());
  assert.equal(view.exchanges.length, 1);
  assert.equal(view.exchanges[0].failed, false);
});

test("replacing the responder releases the previous one", async () => {
  let firstDisposed = 0;
  const conversations = new StepConversations({
    answer: () => "première",
    dispose: async () => {
      firstDisposed++;
    }
  });

  conversations.setResponder({ answer: () => "seconde" });

  assert.equal(firstDisposed, 1);
  const view = await conversations.ask("tour::0", "Question ?", grounding());
  assert.equal(view.exchanges[0].answer, "seconde");
});
