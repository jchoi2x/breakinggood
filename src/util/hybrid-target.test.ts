import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { parseHybridTarget } from "./hybrid-target.js";

const fixtureDir = path.resolve("src/hybrid/fixtures/run-docs/minimal-node");

test("parseHybridTarget resolves source paths under dir", () => {
  const t = parseHybridTarget({
    dir: fixtureDir,
    sourcePath: ["package.json", "README.md"],
    url: "https://example.com/app",
  });
  assert.equal(t.mode, "hybrid");
  assert.deepEqual(t.options.sourcePaths, ["package.json", "README.md"]);
  assert.equal(t.options.maxInteractions, 40);
  assert.equal(t.options.workflowDepth, 3);
  assert.equal(t.options.noNetworkMutations, true);
});

test("parseHybridTarget rejects source path outside dir", () => {
  assert.throws(
    () =>
      parseHybridTarget({
        dir: fixtureDir,
        sourcePath: ["../escape"],
        url: "https://example.com",
      }),
    /--source-path must resolve inside/,
  );
});

test("parseHybridTarget requires source-path", () => {
  assert.throws(
    () => parseHybridTarget({ dir: fixtureDir, sourcePath: [], url: "https://example.com" }),
    /requires at least one --source-path/,
  );
});

test("parseHybridTarget parses --run", () => {
  const t = parseHybridTarget({
    dir: fixtureDir,
    sourcePath: ["src"],
    url: "https://example.com",
    run: "npm run dev",
  });
  assert.deepEqual(t.options.userRun, { cmd: "npm", args: ["run", "dev"] });
});

test("parseHybridTarget rejects non-local capture-url", () => {
  assert.throws(
    () =>
      parseHybridTarget({
        dir: fixtureDir,
        sourcePath: ["src"],
        url: "https://example.com",
        captureUrl: "https://evil.test/",
      }),
    /--capture-url must be localhost/,
  );
});
