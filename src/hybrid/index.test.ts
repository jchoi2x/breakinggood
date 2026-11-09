import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { hybridCaptureAndGenerate } from "./index.js";
import { hybridArtifactPaths } from "./types.js";

const fixtureRoot = path.resolve("src/hybrid/fixtures/react-spa");

test("hybridCaptureAndGenerate capture-only writes artifacts and kills dev server", async () => {
  const out = mkdtempSync(path.join(tmpdir(), "bg-hybrid-"));
  try {
    await hybridCaptureAndGenerate({
      dir: fixtureRoot,
      sourcePaths: ["src/**/*.tsx"],
      url: "http://localhost/",
      out,
      captureOnly: true,
      yes: true,
      userRun: { cmd: process.execPath, args: ["server.mjs"] },
      maxInteractions: 10,
      workflowDepth: 2,
      noNetworkMutations: true,
    });
    const paths = hybridArtifactPaths(out);
    assert.ok(existsSync(paths.interactionMap));
    assert.ok(existsSync(paths.workflowTrace));
    assert.ok(existsSync(paths.interactivityReport));
    const trace = JSON.parse(readFileSync(paths.workflowTrace, "utf8")) as { steps: unknown[] };
    assert.ok(trace.steps.length >= 1);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("hybridCaptureAndGenerate plan-only skips workflow capture", async () => {
  const out = mkdtempSync(path.join(tmpdir(), "bg-hybrid-plan-"));
  try {
    await hybridCaptureAndGenerate({
      dir: fixtureRoot,
      sourcePaths: ["src/**/*.tsx"],
      url: "http://localhost/",
      out,
      planOnly: true,
      yes: true,
      userRun: { cmd: process.execPath, args: ["server.mjs"] },
    });
    const paths = hybridArtifactPaths(out);
    assert.ok(existsSync(paths.interactionMap));
    assert.equal(existsSync(paths.workflowTrace), false);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
