import { test } from "node:test";
import assert from "node:assert/strict";
import { stripSensitiveHeaders, sanitizeHarLikeRequest } from "./network-policy.js";

test("stripSensitiveHeaders redacts cookie and authorization", () => {
  const out = stripSensitiveHeaders({
    Cookie: "sid=secret",
    Authorization: "Bearer tok",
    Accept: "application/json",
  });
  assert.equal(out.Cookie, "[redacted]");
  assert.equal(out.Authorization, "[redacted]");
  assert.equal(out.Accept, "application/json");
});

test("sanitizeHarLikeRequest strips auth from nested headers", () => {
  const sanitized = sanitizeHarLikeRequest({
    method: "GET",
    url: "https://api.example.com/x",
    requestHeaders: { Authorization: "Bearer x" },
    responseHeaders: { "set-cookie": "a=b" },
  });
  assert.equal(sanitized.requestHeaders?.Authorization, "[redacted]");
  assert.equal(sanitized.responseHeaders?.["set-cookie"], "[redacted]");
});
