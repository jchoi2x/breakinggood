import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { RunPlan } from "../repo/detect-stack.js";
import { startDevServer } from "../repo/run-background.js";
import { buildInteractionMap } from "./interaction-map.js";
import { planWorkflow } from "./workflow-planner.js";
import { runWorkflowCapture } from "./workflow-runner.js";
import { openBrowserSession } from "./browser-session.js";

const fixtureRoot = path.resolve("src/hybrid/fixtures/react-spa");

test("runWorkflowCapture records baseline and navigation on react-spa fixture", async () => {
  const plan: RunPlan = {
    stack: "node",
    install: [],
    run: { cmd: process.execPath, args: ["server.mjs"], label: "react-spa dev" },
    ports: [],
    reasons: [],
    confident: true,
  };
  const server = await startDevServer(fixtureRoot, plan, { timeoutMs: 20_000 });
  const session = await openBrowserSession({ headless: true });
  try {
    const map = buildInteractionMap(fixtureRoot, ["src/**/*.tsx"], undefined);
    const actions = planWorkflow(map, { maxInteractions: 10 });
    const { trace, baseline } = await runWorkflowCapture({
      page: session.page,
      captureUrl: server.url,
      actions,
      workflowDepth: 2,
      yes: true,
      screenshotsDir: undefined,
    });
    assert.equal(trace.version, 1);
    assert.ok(trace.steps.length >= 2);
    assert.equal(trace.steps[0]!.action, "baseline");
    assert.ok(baseline.title.length > 0);
    const navigated = trace.steps.some((s) => s.url?.includes("/about"));
    assert.ok(navigated, "expected navigation to /about");
  } finally {
    await session.release();
    server.kill();
  }
});

test("runWorkflowCapture drives auth-spa login (isolated)", async () => {
  const htmlPath = path.resolve("src/hybrid/fixtures/auth-spa/index.html");
  const url = pathToFileURL(htmlPath).href;
  const { trace } = await runWorkflowCapture({
    captureUrl: url,
    actions: [
      {
        index: 0,
        kind: "click",
        selector: "#login-btn",
        quality: "unknown",
        file: "index.html",
        line: 1,
        handlerRef: "click",
      },
    ],
    workflowDepth: 1,
    yes: true,
    allowedOrigins: [new URL(url).origin],
  });
  assert.ok(trace.steps.some((s) => s.status === "verified" && s.action.includes("click")));
});
