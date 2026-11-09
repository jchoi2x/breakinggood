import { test } from "node:test";
import assert from "node:assert/strict";
import type { Provider } from "../ai/provider.js";
import { HYBRID_OUTPUT_STACK_LABEL, HYBRID_UI_STACK_POLICY } from "../hybrid/stack-spec.js";
import type { InteractionMap, WorkflowTrace } from "../hybrid/types.js";
import type { Capture } from "./capture.js";
import {
  buildHybridPrompt,
  buildWorkflowsJson,
  generateHybridProject,
  HYBRID_GENERATION_SYSTEM,
  HYBRID_VERIFY_SCRIPT,
} from "./generate-hybrid.js";

function assertPrimeReactBeforeTailwind(text: string): void {
  const primeIdx = text.indexOf("PrimeReact");
  const tailwindIdx = text.indexOf("Tailwind");
  assert.ok(primeIdx >= 0, "expected PrimeReact in stack text");
  assert.ok(tailwindIdx >= 0, "expected Tailwind in stack text");
  assert.ok(primeIdx < tailwindIdx, "PrimeReact must appear before Tailwind in stack wording");
}

const minimalCapture = (): Capture => ({
  url: "http://127.0.0.1:5173/",
  title: "Fixture",
  description: "",
  lang: "en",
  viewport: { width: 1280, height: 800 },
  pageHeight: 800,
  screenshotsDesktop: [],
  screenshotsMobile: [],
  html: "<main><h1>Hi</h1></main>",
  tokens: {
    fonts: ["Inter"],
    colors: ["#111"],
    backgrounds: [],
    radii: [],
    fontSizes: [],
    maxWidth: null,
    darkMode: false,
  },
  outline: ["main", "h1"],
  links: [],
  images: [],
  requests: [],
  fingerprints: [],
});

const map: InteractionMap = {
  version: 1,
  sourcePaths: ["src/App.tsx"],
  controls: [{ file: "src/App.tsx", line: 10, handlerRef: "onClick", text: "About" }],
  unresolved: [],
};

const trace: WorkflowTrace = {
  version: 1,
  captureUrl: "http://127.0.0.1:5173/",
  steps: [
    { index: 0, action: "baseline", status: "verified", url: "http://127.0.0.1:5173/" },
    { index: 1, action: "click:About", status: "verified", selector: "text=About", url: "http://127.0.0.1:5173/about" },
  ],
};

test("HYBRID_GENERATION_SYSTEM is PrimeReact-first then Tailwind", () => {
  assertPrimeReactBeforeTailwind(HYBRID_GENERATION_SYSTEM);
  assert.match(HYBRID_GENERATION_SYSTEM, /PrimeReact-first/);
  assert.match(HYBRID_GENERATION_SYSTEM, /Tailwind second/);
  assert.match(HYBRID_GENERATION_SYSTEM, /@primereact\/core/);
  assert.match(HYBRID_GENERATION_SYSTEM, /@primeuix\/themes/);
  assert.match(HYBRID_GENERATION_SYSTEM, /@import "tailwindcss"/);
  assert.match(HYBRID_GENERATION_SYSTEM, /PrimeReactProvider/);
  assert.doesNotMatch(HYBRID_GENERATION_SYSTEM, /No external UI libraries/);
});

test("buildHybridPrompt includes map, trace, stack policy, and run provenance", () => {
  const prompt = buildHybridPrompt(
    "demo-hybrid",
    {
      entryUrl: "http://localhost/",
      interactionMap: map,
      trace,
      baseline: minimalCapture(),
      runCommand: "npm run dev",
      runReasons: ["package.json scripts.dev"],
      sourceExcerpts: "### src/App.tsx\nexport {}",
    },
    false,
  );
  assert.match(prompt, /InteractionMap/);
  assert.match(prompt, /WorkflowTrace/);
  assert.match(prompt, /npm run dev/);
  assert.match(prompt, /click:About/);
  assert.match(prompt, /Output stack \(mandatory\)/);
  assert.match(prompt, new RegExp(HYBRID_OUTPUT_STACK_LABEL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(prompt.includes(HYBRID_UI_STACK_POLICY));
  assertPrimeReactBeforeTailwind(prompt);
});

test("buildWorkflowsJson serializes trace steps", () => {
  const json = JSON.parse(buildWorkflowsJson(trace)) as { steps: unknown[] };
  assert.equal(json.steps.length, 2);
});

test("generateHybridProject parses model blocks and injects workflow artifacts", async () => {
  let capturedSystem = "";
  const fake: Provider = {
    name: "test",
    model: "noop",
    supportsImages: false,
    complete: async (req) => {
      capturedSystem = req.system;
      return `=== FILE: package.json ===
{"name":"x","dependencies":{"primereact":"^10","react":"^18","react-dom":"^18"},"devDependencies":{"tailwindcss":"^4","vite":"^6"}}
=== END FILE ===
=== FILE: src/App.jsx ===
import { Button } from "primereact/button";
export default () => <Button className="mt-4" label="Hi" />;
=== END FILE ===`;
    },
  };

  const files = await generateHybridProject(
    fake,
    "fixture",
    {
      entryUrl: "http://localhost/",
      interactionMap: map,
      trace,
      baseline: minimalCapture(),
      runReasons: [],
      sourceExcerpts: "",
    },
    { sanitize: false },
  );

  assertPrimeReactBeforeTailwind(capturedSystem);
  assert.match(capturedSystem, /PrimeReact-first/);

  assert.ok(files.has("package.json"));
  assert.ok(files.has("src/App.jsx"));
  assert.ok(files.has("workflows.json"));
  assert.ok(files.has("scripts/hybrid-verify.mjs"));
  assert.match(files.get("scripts/hybrid-verify.mjs")!, /playwright-core/);
  assert.equal(files.get("scripts/hybrid-verify.mjs"), HYBRID_VERIFY_SCRIPT);
});
