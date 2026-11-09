import type { Provider } from "../ai/provider.js";
import { FILE_FORMAT_INSTRUCTIONS, parseFileBlocks } from "../ai/files.js";
import { redactForEgress } from "../hybrid/egress.js";
import {
  HYBRID_OUTPUT_STACK_LABEL,
  HYBRID_UI_STACK_POLICY,
} from "../hybrid/stack-spec.js";
import type { InteractionMap, WorkflowTrace } from "../hybrid/types.js";
import type { Capture } from "./capture.js";

export interface HybridGenerationContext {
  entryUrl: string;
  interactionMap: InteractionMap;
  trace: WorkflowTrace;
  baseline: Capture;
  runCommand?: string;
  runReasons: string[];
  sourceExcerpts: string;
}

export interface GenerateHybridOptions {
  sanitize: boolean;
  onChunk?: (t: string) => void;
}

export const HYBRID_GENERATION_SYSTEM = `You are a senior front-end engineer rebuilding a local React app from:
- a static InteractionMap (source handlers and routes),
- a real-browser WorkflowTrace (observed UI steps),
- a baseline visual/DOM capture at the dev-server URL.

Scaffold a complete, runnable **frontend-only** ${HYBRID_OUTPUT_STACK_LABEL} project (same breakinggood greenfield stack as site mode, plus PrimeReact). Implement **observed workflows**; align behavior with source handlers where possible. Output **.jsx** files only — greenfield Vite scaffold, not a TypeScript port of the original repo.

## UI stack (order matters)
${HYBRID_UI_STACK_POLICY}

Hard requirements:
- Files to output: package.json, index.html, vite.config.js, src/main.jsx, src/index.css, src/App.jsx, one file per major section in src/components/, mock/db.json, mock/server.js, README.md.
- package.json: name from context, "type": "module", scripts: {"dev": "concurrently \\"vite\\" \\"node mock/server.js\\"", "build": "vite build", "preview": "vite preview", "mock": "node mock/server.js"}; dependencies react, react-dom, @primereact/ui, @primereact/core, primereact ^11, @primeuix/themes, @primeicons/react; devDependencies vite, @vitejs/plugin-react, tailwindcss, @tailwindcss/vite, concurrently. Use caret ranges and real current major versions (vite ^6, tailwindcss ^4, react ^18).
- vite.config.js uses @vitejs/plugin-react and @tailwindcss/vite, and proxies "/api" to http://localhost:8787.
- src/main.jsx: React 18 createRoot; PrimeReactProvider from @primereact/core with Aura from @primeuix/themes/aura; import @primeicons/react.
- src/index.css: start with @import "tailwindcss"; then an @theme block for captured palette/fonts as CSS variables. Tailwind utilities complement PrimeReact — do not replace PrimeReact widgets with unstyled Tailwind components.
- mock/server.js: dependency-free Node http on port 8787; serve captured API paths from mock/db.json with CORS; fall back to {"ok":true}.
- **Do not** generate backend/production server code — mocks only.
- README.md: list unverified/partial workflow steps under "## Unverified workflows".
- Fully responsive. No TypeScript in output. No lorem ipsum. Never leave TODOs. Stay compact (arrays + .map() for repeated UI).

${FILE_FORMAT_INSTRUCTIONS}`;

export function buildHybridPrompt(name: string, ctx: HybridGenerationContext, sanitize: boolean): string {
  const controls = ctx.interactionMap.controls
    .slice(0, 40)
    .map(
      (c) =>
        `- ${c.file}:${c.line} ${c.handlerRef} ${c.label ?? c.text ?? c.selectorHint ?? ""}`.trim(),
    )
    .join("\n");

  const steps = ctx.trace.steps
    .map((s) => {
      const reqs =
        s.requests?.map((r) => `${r.method} ${r.url} → ${r.status ?? "?"}`).join("; ") ?? "";
      return [
        `Step ${s.index}: ${s.action} [${s.status}]`,
        s.selector ? `  selector: ${s.selector}` : "",
        s.url ? `  url: ${s.url}` : "",
        s.error ? `  error: ${s.error}` : "",
        reqs ? `  network: ${reqs}` : "",
        s.outlineSlice?.length ? `  outline: ${s.outlineSlice.slice(0, 8).join(" | ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const apis = ctx.baseline.requests
    .filter((r) => r.body)
    .map((r) => `${r.method} ${r.path} → ${r.status}\n${r.body}`)
    .join("\n\n");
  const otherReqs = ctx.baseline.requests
    .filter((r) => !r.body)
    .map((r) => `${r.method} ${r.path} → ${r.status}`)
    .join("\n");

  return [
    `Project name: ${name}`,
    `Entry URL (context): ${ctx.entryUrl}`,
    `Baseline capture URL: ${ctx.baseline.url}`,
    `Title: ${ctx.baseline.title}`,
    `Description: ${ctx.baseline.description}`,
    ctx.runCommand ? `Dev server command: ${ctx.runCommand}` : "",
    ctx.runReasons.length ? `Run plan reasons:\n- ${ctx.runReasons.join("\n- ")}` : "",
    sanitize
      ? "SANITIZE: replace brand names with neutral placeholders; keep layout and interaction structure."
      : "",
    "",
    "## Output stack (mandatory)",
    `Stack: ${HYBRID_OUTPUT_STACK_LABEL}`,
    HYBRID_UI_STACK_POLICY,
    "",
    "## InteractionMap (controls excerpt)",
    `Source paths (analysis only — generate fresh JSX, do not copy .tsx verbatim): ${ctx.interactionMap.sourcePaths.join(", ") || "(default globs)"}`,
    `Unresolved: ${ctx.interactionMap.unresolved.length}`,
    controls || "(no controls)",
    "",
    "## WorkflowTrace (observed steps)",
    steps || "(empty trace)",
    "",
    "## Design tokens (baseline, most-used first)",
    `fonts: ${ctx.baseline.tokens.fonts.join(" | ")}`,
    `text colours: ${ctx.baseline.tokens.colors.join(" | ")}`,
    `backgrounds: ${ctx.baseline.tokens.backgrounds.join(" | ")}`,
    `border radii: ${ctx.baseline.tokens.radii.join(" | ")}`,
    `font sizes: ${ctx.baseline.tokens.fontSizes.join(" | ")}`,
    `content max-width: ${ctx.baseline.tokens.maxWidth ?? "none"}`,
    "",
    "## Semantic outline",
    ctx.baseline.outline.slice(0, 40).join("\n"),
    "",
    "## Captured API bodies (serve from mock/db.json)",
    apis || "(no JSON bodies captured)",
    otherReqs ? "\n## Other XHR/fetch\n" + otherReqs : "",
    "",
    "## Source excerpts (handler context — inform behavior, not a file copy)",
    ctx.sourceExcerpts || "(no excerpts)",
    "",
    "## Baseline DOM excerpt",
    ctx.baseline.html.slice(0, 8000),
    "",
    `Desktop screenshots attached: ${ctx.baseline.screenshotsDesktop.length}; mobile: ${ctx.baseline.screenshotsMobile.length}. Match layout using PrimeReact components with Tailwind spacing.`,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function buildWorkflowsJson(trace: WorkflowTrace): string {
  const payload = {
    version: 1,
    captureUrl: trace.captureUrl,
    steps: trace.steps.map((s) => ({
      index: s.index,
      action: s.action,
      selector: s.selector,
      status: s.status,
      url: s.url,
    })),
  };
  return JSON.stringify(payload, null, 2);
}

export const HYBRID_VERIFY_SCRIPT = `#!/usr/bin/env node
/**
 * Generated by breakinggood hybrid mode — replay workflow steps against a running dev server.
 * Usage: npm run dev (in another terminal), then node scripts/hybrid-verify.mjs
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const workflows = JSON.parse(readFileSync(new URL("../workflows.json", import.meta.url), "utf8"));
const baseUrl = process.env.HYBRID_VERIFY_URL ?? "http://127.0.0.1:5173";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
let failures = 0;

try {
  await page.goto(workflows.captureUrl.startsWith("http") ? workflows.captureUrl : baseUrl, {
    waitUntil: "domcontentloaded",
  });

  for (const step of workflows.steps) {
    if (step.action === "baseline") continue;
    if (!step.selector || step.status === "unverified") {
      console.warn("skip unverified:", step.action);
      continue;
    }
    try {
      const loc = step.selector.startsWith("text=")
        ? page.getByText(JSON.parse(step.selector.slice("text=".length)), { exact: true })
        : page.locator(step.selector);
      await loc.first().click({ timeout: 5000 });
      await page.waitForTimeout(400);
      if (step.url && page.url() !== step.url) {
        console.warn("url mismatch", step.action, "expected", step.url, "got", page.url());
        failures++;
      }
    } catch (e) {
      console.warn("step failed", step.action, (e && e.message) || e);
      failures++;
    }
  }
} finally {
  await browser.close();
}

process.exit(failures > 0 ? 1 : 0);
`;

export async function generateHybridProject(
  provider: Provider,
  name: string,
  ctx: HybridGenerationContext,
  opts: GenerateHybridOptions,
): Promise<Map<string, string>> {
  const rawPrompt = buildHybridPrompt(name, ctx, opts.sanitize);
  const prompt = redactForEgress(rawPrompt);
  const images = provider.supportsImages
    ? [...ctx.baseline.screenshotsDesktop, ...ctx.baseline.screenshotsMobile].map((b64) => ({
        mediaType: "image/jpeg" as const,
        base64: b64,
      }))
    : [];

  const text = await provider.complete({
    system: HYBRID_GENERATION_SYSTEM,
    prompt,
    images,
    maxTokens: 128000,
    onChunk: opts.onChunk,
  });
  const files = parseFileBlocks(text);
  if (!files.has("package.json") || !files.has("src/App.jsx")) {
    throw new Error(
      `The model returned ${files.size} file(s) but not a complete project. Try again or use a different --provider/--model.`,
    );
  }

  files.set("workflows.json", buildWorkflowsJson(ctx.trace));
  files.set("scripts/hybrid-verify.mjs", HYBRID_VERIFY_SCRIPT);
  return files;
}
