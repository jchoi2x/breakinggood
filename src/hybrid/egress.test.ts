import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEgressManifest, EgressNotAllowedError, redactForEgress, requireEgress } from "./egress.js";
import type { Capture } from "../site/capture.js";
import type { InteractionMap, WorkflowTrace } from "./types.js";

test("redactForEgress removes auth, cookies, jwt, and email", () => {
  const input = [
    "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "Cookie: session=abc123; user=jane@example.com",
    "Contact support@acme.co for help",
  ].join("\n");

  const out = redactForEgress(input);
  assert.match(out, /Authorization: \[redacted\]/);
  assert.doesNotMatch(out, /support@acme\.co/);
  assert.doesNotMatch(out, /jane@example\.com/);
  assert.doesNotMatch(out, /eyJhbGci/);
  assert.equal(out.includes("abc123"), false);
});

test("redactForEgress redacts mixed sensitive lines", () => {
  const sample =
    "Header Authorization: secret-token\nSet-Cookie: sid=1\nemail me at admin@corp.test\njwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig";
  const redacted = redactForEgress(sample);
  assert.equal(
    redacted,
    "Header Authorization: [redacted]\nSet-Cookie: [redacted]\nemail me at [redacted-email]\njwt [redacted-jwt]",
  );
});

test("requireEgress throws without --allow-egress", () => {
  assert.throws(() => requireEgress({ allowEgress: false }), EgressNotAllowedError);
  assert.throws(() => requireEgress({}), EgressNotAllowedError);
});

test("requireEgress allows when flagged and skips plan/capture-only", () => {
  assert.doesNotThrow(() => requireEgress({ allowEgress: true }));
  assert.doesNotThrow(() => requireEgress({ planOnly: true, allowEgress: false }));
  assert.doesNotThrow(() => requireEgress({ captureOnly: true, allowEgress: false }));
});

test("buildEgressManifest counts images and network bytes", () => {
  const baseline: Capture = {
    url: "http://127.0.0.1:1/",
    title: "t",
    description: "",
    lang: "en",
    viewport: { width: 1, height: 1 },
    pageHeight: 1,
    screenshotsDesktop: ["a", "b"],
    screenshotsMobile: ["c"],
    html: "<body/>",
    tokens: {
      fonts: [],
      colors: [],
      backgrounds: [],
      radii: [],
      fontSizes: [],
      maxWidth: null,
      darkMode: false,
    },
    outline: [],
    links: [],
    images: [],
    requests: [{ method: "GET", url: "http://x", path: "/a", status: 200, contentType: "json", body: '{"ok":1}' }],
    fingerprints: [],
  };
  const interactionMap: InteractionMap = {
    version: 1,
    sourcePaths: ["src/App.tsx"],
    controls: [{ file: "src/App.tsx", line: 1, handlerRef: "onClick", text: "Go" }],
    unresolved: [],
  };
  const trace: WorkflowTrace = { version: 1, captureUrl: "http://127.0.0.1:1/", steps: [] };
  const manifest = buildEgressManifest({
    allowEgress: true,
    repoRoot: process.cwd(),
    interactionMap,
    baseline,
    trace,
  });
  assert.equal(manifest.imageCount, 3);
  assert.equal(manifest.networkBodyBytes, Buffer.byteLength('{"ok":1}', "utf8"));
  assert.equal(manifest.allowEgress, true);
});
