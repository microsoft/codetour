import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as vm from "node:vm";
import { createStandaloneTourHtml } from "./html";
import { palette } from "./palette";

test("standalone playback navigates and finishes entirely in memory", async () => {
  const html = await createStandaloneTourHtml({
    id: "file:///example/project.tour",
    title: "Example",
    steps: [
      { title: "First", description: "One **bold** description." },
      { title: "Second", description: "Two", file: "src/a.ts", line: 5 }
    ]
  });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);

  const elements: Record<string, any> = {};
  for (const id of ["title", "description", "code", "anchor", "position", "progress",
    "previous", "next", "finish", "article", "done"]) {
    elements[id] = {
      textContent: "", innerHTML: "", disabled: false, hidden: false, value: 0,
      listeners: {} as Record<string, () => void>,
      addEventListener(event: string, callback: () => void) {
        this.listeners[event] = callback;
      }
    };
  }
  const document = {
    getElementById: (id: string) => elements[id],
    addEventListener: (_event: string, _callback: () => void) => {}
  };

  vm.runInNewContext(script, { document });
  assert.equal(elements.title.textContent, "First");
  assert.equal(elements.position.textContent, "1 / 2");
  assert.equal(elements.previous.disabled, true);
  assert.match(elements.description.innerHTML, /<strong>bold<\/strong>/);

  elements.next.listeners.click();
  assert.equal(elements.title.textContent, "Second");
  assert.equal(elements.anchor.textContent, "src/a.ts : 5");
  assert.equal(elements.progress.value, 2);
  assert.equal(elements.next.disabled, true);

  elements.previous.listeners.click();
  assert.equal(elements.title.textContent, "First");
  elements.finish.listeners.click();
  assert.equal(elements.done.hidden, false);
  assert.equal(elements.article.hidden, true);
});

test("tour-provided text cannot escape the generated HTML script", async () => {
  const html = await createStandaloneTourHtml({
    id: "example",
    title: "<Unsafe>",
    steps: [{ title: "Script", description: "</script><script>alert(1)</script>" }]
  });
  assert.match(html, /&lt;Unsafe&gt;/);
  assert.equal((html.match(/<script>/g) ?? []).length, 1);
});

test("standalone HTML renders read-only code and Git diff without raw injection", async () => {
  const tour = {
    id: "changes",
    title: "Changes",
    steps: [{ title: "Context", description: "Read this", file: "src/a.ts", display: "diff" as const }]
  };
  const html = await createStandaloneTourHtml(tour, [{
    kind: "diff", label: "src/a.ts", text: "@@ -1 +1 @@\n-old\n+<script>bad</script>\n"
  }]);
  assert.match(html, /diff-add/);
  assert.match(html, /Read-only source/);
  // Each diff row is a block so its tint covers the whole line, and the
  // arrows of a diff stay readable against the tint (ADR 0027).
  assert.ok(html.includes("diff-line diff-add"));
  assert.ok(html.includes("diff-line diff-remove"));
  assert.ok(html.includes(palette.diffAddedBackground));
  assert.ok(!html.includes("+<script>bad</script>"));
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
});

test("the standalone document uses the shared dark palette", async () => {
  const html = await createStandaloneTourHtml({ id: "palette", title: "Palette", steps: [] });
  // The HTML reader and the terminal reader draw from one palette module.
  assert.ok(html.includes("background:" + palette.background));
  assert.ok(html.includes("color:" + palette.text));
  assert.ok(html.includes(palette.primary));
  assert.ok(html.includes(palette.accent));
  assert.ok(!html.includes("#161b22"));
});

test("step descriptions reach the browser through the shared render seam", async () => {
  const html = await createStandaloneTourHtml({
    id: "diagram",
    title: "Diagram",
    steps: [{ title: "Context", description: "```mermaid\nflowchart TD\nA-->B\n```" }]
  }, [], {
    // Stands in for renderDescription: the seam's job is to hand the raw
    // Markdown over before conversion, so the PNG data URI lands in the HTML.
    renderStepDescription: async description => {
      assert.match(description, /```mermaid/);
      return description.replace("```mermaid\nflowchart TD\nA-->B\n```",
        "![Diagram — Context](data:image/png;base64,AAAA)");
    }
  });
  // The description is serialized into the generated script, so the data URI
  // appears JSON-escaped there.
  assert.ok(html.includes("data:image/png;base64,AAAA"));
  assert.ok(!html.includes("```mermaid"));
  assert.ok(!html.includes("language-mermaid"));
});
