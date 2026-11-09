import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLocalUrlFromLog } from "./wait-local-url.js";

test("parseLocalUrlFromLog reads explicit localhost URLs", () => {
  const url = parseLocalUrlFromLog("ready at http://localhost:5173/\n");
  assert.equal(url, "http://localhost:5173/");
});

test("parseLocalUrlFromLog maps 0.0.0.0 to localhost", () => {
  const url = parseLocalUrlFromLog("Local: http://0.0.0.0:3000");
  assert.equal(url, "http://localhost:3000");
});

test("parseLocalUrlFromLog infers port from listening messages", () => {
  const url = parseLocalUrlFromLog("webpack: listening on port 8080");
  assert.equal(url, "http://localhost:8080");
});
