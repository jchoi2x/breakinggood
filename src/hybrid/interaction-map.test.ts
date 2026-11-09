import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildInteractionMap, resolveSourcePaths } from "./interaction-map.js";

const fixtureRoot = path.resolve("src/hybrid/fixtures/react-spa");

test("resolveSourcePaths expands default globs under fixture", () => {
  const paths = resolveSourcePaths(fixtureRoot, []);
  assert.ok(paths.some((p) => p.endsWith("HomePage.tsx")));
  assert.ok(paths.some((p) => p.endsWith("App.tsx")));
});

test("buildInteractionMap extracts controls with file:line and routes", () => {
  const map = buildInteractionMap(fixtureRoot, ["src/**/*.tsx"]);
  assert.equal(map.version, 1);
  assert.ok(map.controls.length >= 5, `expected >=5 controls, got ${map.controls.length}`);
  const goAbout = map.controls.find((c) => c.selectorHint === '[data-testid="go-about"]');
  assert.ok(goAbout, "expected data-testid control");
  assert.equal(goAbout?.file, "src/pages/HomePage.tsx");
  assert.ok(goAbout!.line > 0);
  assert.ok(
    map.controls.some((c) => c.networkHints?.some((h) => h.includes("fetch"))),
    "expected fetch network hint",
  );
  assert.ok(
    map.unresolved.some((u) => u.reason.includes("non-literal")),
    "expected unresolved dynamic handler",
  );
  const home = map.controls.find((c) => c.file === "src/pages/HomePage.tsx" && c.routeEffects?.length);
  assert.ok(home?.routeEffects?.includes("/"), "Home route linked from router config");
});
