import type { CodeTour } from "../store";
import { escapeHtml, renderMarkdownToHtml } from "../player/markdown";
import { palette } from "./palette";
import type { ReadonlyStepContext } from "./stepContext";

export interface StandaloneHtmlOptions {
  /**
   * Renders one step description before Markdown conversion, so Mermaid
   * diagrams and local images become self-contained data URIs (ADR 0007).
   */
  renderStepDescription?: (description: string) => Promise<string>;
}

/** A read-only, self-contained HTML playback document: no extension, server or IPC. */
export async function createStandaloneTourHtml(
  tour: CodeTour,
  contexts: ReadonlyStepContext[] = [],
  options: StandaloneHtmlOptions = {}
): Promise<string> {
  const renderStepDescription = options.renderStepDescription ??
    ((description: string) => Promise.resolve(description));
  const steps = await Promise.all(tour.steps.map(async (step, index) => ({
    title: step.title || "Step " + (index + 1),
    descriptionHtml: renderMarkdownToHtml(
      await renderStepDescription(step.description || "")
    ),
    anchor: step.file || step.uri || step.directory || step.view || "",
    line: step.line,
    contextHtml: renderContextHtml(contexts[index])
  })));

  // Escape '<' so tour-authored text cannot end the embedded script tag.
  const serialized = JSON.stringify(steps).replace(/</g, "\\u003c");
  const style = [
    "*,*::before,*::after{box-sizing:border-box}",
    // The same OpenCode palette as the terminal reader (ADR 0027).
    `body{margin:0;background:${palette.background};color:${palette.text};font:16px/1.6 system-ui,sans-serif}`,
    `header{position:sticky;top:0;padding:16px 24px;border-bottom:1px solid ${palette.element};background:${palette.background}}`,
    "main{max-width:840px;margin:32px auto;padding:0 24px}",
    "nav{display:flex;gap:10px;align-items:center;flex-wrap:wrap}",
    "nav strong{flex:1 1 240px}",
    `button{padding:7px 14px;background:${palette.element};color:${palette.text};border:1px solid ${palette.borderStrong};border-radius:5px;cursor:pointer}`,
    "button:disabled{opacity:.45;cursor:default}",
    `progress{display:block;width:100%;margin-top:12px;accent-color:${palette.primary}}`,
    `h1{line-height:1.3;color:${palette.primary}}`,
    `h2{color:${palette.accent}}`,
    `#anchor{color:${palette.muted};font-family:ui-monospace,monospace;font-size:13px}`,
    `a{color:${palette.primary}}pre{overflow:auto;padding:14px;background:${palette.panel}}`,
    "img{max-width:100%}table{border-collapse:collapse;display:block;overflow-x:auto}",
    `td,th{border:1px solid ${palette.border};padding:6px 10px}`,
    `.code-context{margin-top:30px;border-top:1px solid ${palette.element};padding-top:12px}`,
    ".code-context pre{white-space:pre;overflow:auto}",
    ".diff-line{min-height:1.6em}",
    `.diff-context{color:${palette.faint}}`,
    `.diff-add{color:${palette.diffAdded};background:${palette.diffAddedBackground}}`,
    `.diff-remove{color:${palette.diffRemoved};background:${palette.diffRemovedBackground}}`,
    `.diff-hunk{color:${palette.diffHunk};background:${palette.element}}`,
    `#done{padding:24px;border:1px solid ${palette.borderStrong};border-radius:8px}`,
    "[hidden]{display:none!important}"
  ].join("");
  const script = [
    "(function(){",
    "const steps=" + serialized + ";",
    "let index=0;",
    "const $=id=>document.getElementById(id);",
    "function show(){",
    "const step=steps[index];",
    "$('title').textContent=step.title;",
    "$('anchor').textContent=step.anchor+(step.line?' : '+step.line:'');",
    "$('description').innerHTML=step.descriptionHtml;",
    "$('code').innerHTML=step.contextHtml;",
    "$('position').textContent=(index+1)+' / '+steps.length;",
    "$('progress').value=index+1;",
    "$('previous').disabled=index===0;",
    "$('next').disabled=index===steps.length-1;",
    "$('article').hidden=false;$('done').hidden=true;",
    "}",
    "$('previous').addEventListener('click',()=>{if(index>0){index--;show();}});",
    "$('next').addEventListener('click',()=>{if(index<steps.length-1){index++;show();}});",
    "$('finish').addEventListener('click',()=>{$('article').hidden=true;$('done').hidden=false;});",
    "document.addEventListener('keydown',e=>{",
    "if(e.key==='ArrowLeft'&&index>0){index--;show();}",
    "else if(e.key==='ArrowRight'&&index<steps.length-1){index++;show();}",
    "});",
    "if(steps.length){show();}else{$('article').hidden=true;$('done').hidden=false;}",
    "})();"
  ].join("\n");

  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(tour.title) + '</title><style>' + style +
    '</style></head><body><header><nav><strong>' + escapeHtml(tour.title) +
    '</strong><button id="previous">Previous</button>' +
    '<span id="position"></span><button id="next">Next</button>' +
    '<button id="finish">Finish</button></nav>' +
    '<progress id="progress" max="' + steps.length + '" value="1"></progress></header>' +
    '<main><article id="article"><h1 id="title"></h1><p id="anchor"></p>' +
    '<section id="description"></section><section id="code"></section></article>' +
    '<section id="done" hidden>Tour complete. You can close this window.</section></main>' +
    '<script>' + script + '</script></body></html>';
}

/** Render Git's authoritative unified diff without recomputing comparisons. */
function renderContextHtml(context?: ReadonlyStepContext): string {
  if (!context || context.kind === "none" || context.kind === "directory") return "";
  const label = escapeHtml(context.label || "Source context");
  if (context.kind === "unavailable") {
    return '<section class="code-context"><h2>' + label + '</h2><p>' +
      escapeHtml(context.diagnostic || "Target unavailable") + '</p></section>';
  }
  const body = context.kind === "diff"
    ? (context.text || "").split("\n").map(line => {
        const klass = line.startsWith("+") && !line.startsWith("+++") ? " diff-add" :
          line.startsWith("-") && !line.startsWith("---") ? " diff-remove" :
          line.startsWith("@@") ? " diff-hunk" : " diff-context";
        // One block per diff row so the tinted background covers the whole
        // line instead of only the glyphs of the line.
        return '<div class="diff-line' + klass + '">' +
          (escapeHtml(line) || " ") + '</div>';
      }).join("")
    : escapeHtml(context.text || "");
  return '<section class="code-context" aria-label="Read-only source"><h2>' +
    label + '</h2><pre><code>' + body + '</code></pre></section>';
}
