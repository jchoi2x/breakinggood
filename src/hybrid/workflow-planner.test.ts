import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildInteractionMap } from "./interaction-map.js";
import { planWorkflow } from "./workflow-planner.js";

const fixtureRoot = path.resolve("src/hybrid/fixtures/react-spa");

test("planWorkflow ranks testid ahead of text and skips denylist", () => {
  const map = buildInteractionMap(fixtureRoot, ["src/**/*.tsx"]);
  const planned = planWorkflow(map, { maxInteractions: 10 });
  assert.ok(planned.length > 0);
  const active = planned.filter((p) => !p.skipped);
  assert.equal(active[0]?.quality, "testid");
  const denied = planned.find((p) => p.text?.toLowerCase().includes("log out"));
  assert.ok(denied?.skipped && denied.skipReason === "denylist");
});

test("planWorkflow respects maxInteractions budget", () => {
  const map = buildInteractionMap(fixtureRoot, ["src/**/*.tsx"]);
  const planned = planWorkflow(map, { maxInteractions: 2 });
  const active = planned.filter((p) => !p.skipped);
  assert.ok(active.length <= 2);
});
