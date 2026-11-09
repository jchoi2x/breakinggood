import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashOutline,
  mergeInteractivityReport,
  type WorkflowReplayResult,
} from "./verify-replay.js";

test("hashOutline is stable for the same outline slice", () => {
  const lines = ["main: Home", "h1: Title"];
  assert.equal(hashOutline(lines), hashOutline([...lines]));
  assert.notEqual(hashOutline(lines), hashOutline(["h1: Other"]));
});

test("mergeInteractivityReport appends replay table and summary", () => {
  const base = `# Interactivity report\n\n| Metric | Count |\n| Attempted | 2 |\n`;
  const replay: WorkflowReplayResult = {
    ran: true,
    baseUrl: "http://127.0.0.1:5173/",
    steps: [
      {
        index: 0,
        action: "baseline",
        captureStatus: "verified",
        replayStatus: "partial",
        urlMatch: true,
        outlineMatch: false,
      },
    ],
    verified: 0,
    partial: 1,
    unverified: 0,
  };
  const merged = mergeInteractivityReport(base, replay);
  assert.match(merged, /## Replay verification/);
  assert.match(merged, /baseline/);
  assert.match(merged, /\*\*0\*\* verified, \*\*1\*\* partial/);
  assert.match(merged, /Attempted/);
});

test("mergeInteractivityReport records skip reason", () => {
  const merged = mergeInteractivityReport("# Report\n", {
    ran: false,
    skipReason: "no browser",
    steps: [],
    verified: 0,
    partial: 0,
    unverified: 0,
  });
  assert.match(merged, /Replay skipped: no browser/);
});
