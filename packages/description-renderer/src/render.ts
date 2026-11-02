import { ensureDomEnvironment, measureContentBounds } from "./dom";
import { rasterizeSvg } from "./rasterize";
import { sanitizeSvg } from "./sanitize";
import { diagramKindOf, isAllowedDiagramKind } from "./rules";

export type DescriptionTheme = "light" | "dark";

export interface RenderedDiagram {
  svg: string;
  png: Buffer;
}

/**
 * Bump this when the renderer's output contract changes. The value is part of
 * the in-memory cache key so a long-lived extension host never reuses output
 * produced by an older renderer implementation.
 */
export const DESCRIPTION_RENDERER_VERSION = "0.1.5";

interface MermaidRenderResult {
  svg: string;
}

interface MermaidApi {
  initialize(config: unknown): void;
  parse(text: string): Promise<unknown>;
  render(id: string, text: string): Promise<MermaidRenderResult>;
}

const MERMAID_THEMES: Record<DescriptionTheme, "default" | "dark"> = {
  light: "default",
  dark: "dark"
};

const MERMAID_RENDER_OPTIONS = Object.freeze({
  securityLevel: "strict",
  htmlLabels: false,
  flowchartHtmlLabels: false,
  rasterizer: "@resvg/resvg-js@2.6.2",
  maxRasterizedWidth: 900,
  viewBoxPadding: 24
} as const);

let mermaid: MermaidApi | undefined;
let mermaidLoad: Promise<MermaidApi> | undefined;
let diagramCounter = 0;
const renderedDiagramCache = new Map<string, Promise<RenderedDiagram>>();
let renderQueue = Promise.resolve();

async function loadMermaid(): Promise<MermaidApi> {
  const imported = await import("mermaid");
  return imported.default as unknown as MermaidApi;
}

async function getMermaid(): Promise<MermaidApi> {
  if (mermaid) {
    return mermaid;
  }

  const load = (mermaidLoad ??= loadMermaid());
  try {
    mermaid = await load;
    return mermaid;
  } catch (error) {
    if (mermaidLoad === load) {
      mermaidLoad = undefined;
    }
    throw error;
  }
}

function mermaidConfiguration(theme: DescriptionTheme) {
  return {
    startOnLoad: false,
    securityLevel: MERMAID_RENDER_OPTIONS.securityLevel as "strict",
    theme: MERMAID_THEMES[theme],
    htmlLabels: MERMAID_RENDER_OPTIONS.htmlLabels,
    flowchart: {
      htmlLabels: MERMAID_RENDER_OPTIONS.flowchartHtmlLabels
    }
  };
}

function normalizeSvgSize(
  svg: string,
  viewBoxPadding: number
): { svg: string; width: number } {
  const window = ensureDomEnvironment();
  const document = new window.DOMParser().parseFromString(svg, "image/svg+xml");
  const root = document.documentElement;

  const viewBox = (root.getAttribute("viewBox") || "")
    .split(/[\s,]+/)
    .map(part => Number(part))
    .filter(part => !isNaN(part));

  let bounds = {
    x: 0,
    y: 0,
    width: 0,
    height: 0
  };

  if (viewBox.length === 4) {
    bounds = { x: viewBox[0], y: viewBox[1], width: viewBox[2], height: viewBox[3] };
  } else {
    bounds.width = Number(root.getAttribute("width")) || 800;
    bounds.height = Number(root.getAttribute("height")) || 600;
  }

  const content = measureContentBounds(root);
  bounds = {
    x: Math.min(bounds.x, content.x - viewBoxPadding),
    y: Math.min(bounds.y, content.y - viewBoxPadding),
    width: 0,
    height: 0
  };
  bounds.width = Math.max(
    viewBox.length === 4 ? viewBox[0] + viewBox[2] : bounds.width,
    content.x + content.width + viewBoxPadding
  ) - bounds.x;
  bounds.height = Math.max(
    viewBox.length === 4 ? viewBox[1] + viewBox[3] : bounds.height,
    content.y + content.height + viewBoxPadding
  ) - bounds.y;

  root.setAttribute(
    "viewBox",
    `${bounds.x} ${bounds.y} ${Math.ceil(bounds.width)} ${Math.ceil(bounds.height)}`
  );
  root.setAttribute("width", String(Math.ceil(bounds.width)));
  root.setAttribute("height", String(Math.ceil(bounds.height)));
  root.removeAttribute("style");

  const normalized = new window.XMLSerializer().serializeToString(root);
  return { svg: normalized, width: bounds.width };
}

async function renderMermaidDiagramUncached(
  source: string,
  theme: DescriptionTheme
): Promise<RenderedDiagram> {
  const render = async () => {
    const kind = diagramKindOf(source);
    if (!kind || !isAllowedDiagramKind(kind)) {
      throw new Error(
        `Unsupported Mermaid diagram kind: ${kind ?? "(none detected)"}`
      );
    }

    ensureDomEnvironment();

    const renderer = await getMermaid();
    renderer.initialize(mermaidConfiguration(theme));
    await renderer.parse(source);
    const { svg } = await renderer.render(
      `codetour-diagram-${++diagramCounter}`,
      source
    );

    const sanitized = sanitizeSvg(svg);
    const normalized = normalizeSvgSize(
      sanitized,
      MERMAID_RENDER_OPTIONS.viewBoxPadding
    );
    const png = rasterizeSvg(
      normalized.svg,
      normalized.width,
      MERMAID_RENDER_OPTIONS.maxRasterizedWidth
    );

    return { svg: normalized.svg, png };
  };

  const queued = renderQueue.then(render, render);
  renderQueue = queued.then(
    () => undefined,
    () => undefined
  );
  return queued;
}

function renderCacheKey(source: string, theme: DescriptionTheme): string {
  return JSON.stringify({
    source,
    theme,
    rendererVersion: DESCRIPTION_RENDERER_VERSION,
    options: MERMAID_RENDER_OPTIONS
  });
}

/** Clear all in-memory output, normally after VS Code changes its theme. */
export function clearMermaidRenderCache(): void {
  renderedDiagramCache.clear();
}

export const invalidateMermaidRenderCache = clearMermaidRenderCache;

export function renderMermaidDiagram(
  source: string,
  theme: DescriptionTheme
): Promise<RenderedDiagram> {
  const key = renderCacheKey(source, theme);
  const cached = renderedDiagramCache.get(key);
  if (cached) {
    return cached;
  }

  const rendered = renderMermaidDiagramUncached(source, theme);
  renderedDiagramCache.set(key, rendered);
  void rendered.catch(() => {
    if (renderedDiagramCache.get(key) === rendered) {
      renderedDiagramCache.delete(key);
    }
  });

  return rendered;
}
