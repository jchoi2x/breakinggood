import { test } from "node:test";
import assert from "node:assert/strict";
import type { Provider } from "../ai/provider.js";
import type { InteractionMap, WorkflowTrace } from "../hybrid/types.js";
import type { Capture } from "./capture.js";
import {
  buildHybridPrompt,
  buildWorkflowsJson,
  generateHybridProject,
  HYBRID_VERIFY_SCRIPT,
} from "./generate-hybrid.js";

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

test("buildHybridPrompt includes map, trace, and run provenance", () => {
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
});

test("buildWorkflowsJson serializes trace steps", () => {
  const json = JSON.parse(buildWorkflowsJson(trace)) as { steps: unknown[] };
  assert.equal(json.steps.length, 2);
});

test("generateHybridProject parses model blocks and injects workflow artifacts", async () => {
  const fake: Provider = {
    name: "test",
    model: "noop",
    supportsImages: false,
    complete: async () =>
      `=== FILE: package.json ===
{"name":"x"}
=== END FILE ===
=== FILE: src/App.jsx ===
export default () => null;
=== END FILE ===`,
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

  assert.ok(files.has("package.json"));
  assert.ok(files.has("src/App.jsx"));
  assert.ok(files.has("workflows.json"));
  assert.ok(files.has("scripts/hybrid-verify.mjs"));
  assert.match(files.get("scripts/hybrid-verify.mjs")!, /playwright-core/);
  assert.equal(files.get("scripts/hybrid-verify.mjs"), HYBRID_VERIFY_SCRIPT);
});
