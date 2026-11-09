import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHybridUrlTarget, parseTarget } from "./detect-url.js";
import path from "node:path";
import { parseFileBlocks } from "../ai/files.js";

test("github https url → repo", () => {
  const t = parseTarget("https://github.com/gxurav1710/YouPI-PG");
  assert.equal(t.mode, "repo");
  assert.equal(t.cloneUrl, "https://github.com/gxurav1710/YouPI-PG.git");
  assert.equal(t.name, "YouPI-PG");
});

test("github tree url keeps branch", () => {
  const t = parseTarget("github.com/owner/repo/tree/dev/apps/web");
  assert.equal(t.mode, "repo");
  assert.equal(t.branch, "dev");
});

test("ssh url → repo", () => {
  const t = parseTarget("git@github.com:owner/repo.git");
  assert.equal(t.mode, "repo");
  assert.equal(t.name, "repo");
});

test("website → site", () => {
  const t = parseTarget("stripe.com/pricing");
  assert.equal(t.mode, "site");
  assert.equal(t.name, "stripe-clone");
  assert.equal(t.url, "https://stripe.com/pricing");
});

test("parseHybridUrlTarget via detect-url: URL-only hybrid parse", () => {
  const dir = path.resolve("src/hybrid/fixtures/run-docs/minimal-node");
  const t = parseHybridUrlTarget("https://example.com/", dir);
  assert.equal(t.mode, "hybrid");
  assert.deepEqual(t.options.sourcePaths, []);
});

test("file blocks parse, with and without fences", () => {
  const text = `=== FILE: package.json ===
{"name":"x"}
=== END FILE ===
=== FILE: src/App.jsx ===
\`\`\`jsx
export default () => null
\`\`\`
=== END FILE ===`;
  const files = parseFileBlocks(text);
  assert.equal(files.size, 2);
  assert.equal(files.get("package.json"), '{"name":"x"}\n');
  assert.equal(files.get("src/App.jsx"), "export default () => null\n");
});

test("file blocks refuse path traversal", () => {
  assert.throws(() => parseFileBlocks("=== FILE: ../evil ===\nx\n=== END FILE ==="));
});
