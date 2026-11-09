import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hybridArtifactPaths,
  type EgressManifest,
  type HybridContext,
  type InteractionMap,
  type WorkflowTrace,
} from "./types.js";

test("hybridArtifactPaths places artifacts under .breakinggood/hybrid", () => {
  const paths = hybridArtifactPaths("/tmp/out");
  assert.match(paths.root, /\.breakinggood[/\\]hybrid$/);
  assert.match(paths.interactionMap, /interaction-map\.json$/);
  assert.match(paths.workflowTrace, /workflow-trace\.json$/);
  assert.match(paths.egressManifest, /egress-manifest\.json$/);
  assert.match(paths.interactivityReport, /interactivity-report\.md$/);
});

test("InteractionMap JSON roundtrip", () => {
  const map: InteractionMap = {
    version: 1,
    sourcePaths: ["src/App.tsx"],
    controls: [
      {
        file: "src/App.tsx",
        line: 12,
        handlerRef: "handleClick",
        label: "Submit",
        selectorHint: '[data-testid="submit"]',
      },
    ],
    unresolved: [{ file: "src/App.tsx", line: 40, reason: "dynamic handler" }],
  };
  const parsed = JSON.parse(JSON.stringify(map)) as InteractionMap;
  assert.deepEqual(parsed, map);
});

test("WorkflowTrace JSON roundtrip", () => {
  const trace: WorkflowTrace = {
    version: 1,
    captureUrl: "http://127.0.0.1:5173/",
    steps: [
      {
        index: 0,
        action: "goto",
        status: "verified",
        url: "http://127.0.0.1:5173/",
      },
    ],
  };
  const parsed = JSON.parse(JSON.stringify(trace)) as WorkflowTrace;
  assert.deepEqual(parsed, trace);
});

test("HybridContext and EgressManifest JSON roundtrip", () => {
  const ctx: HybridContext = {
    dir: "/repo",
    sourcePaths: ["src"],
    entryUrl: "http://127.0.0.1:5173/",
    egressManifest: {
      version: 1,
      allowEgress: false,
      sourceFiles: [{ path: "src/App.tsx", bytes: 120 }],
      imageCount: 2,
      networkBodyBytes: 0,
    },
  };
  const parsed = JSON.parse(JSON.stringify(ctx)) as HybridContext;
  assert.deepEqual(parsed, ctx);

  const manifest: EgressManifest = {
    version: 1,
    allowEgress: true,
    sourceFiles: [],
    imageCount: 0,
    networkBodyBytes: 512,
  };
  assert.deepEqual(JSON.parse(JSON.stringify(manifest)), manifest);
});
