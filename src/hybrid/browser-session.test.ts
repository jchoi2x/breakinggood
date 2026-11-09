import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { attachOverCDP, forbidStorageStateExport, openBrowserSession } from "./browser-session.js";
import type { Browser } from "playwright-core";

test("forbidStorageStateExport throws", () => {
  assert.throws(() => forbidStorageStateExport(), /forbidden/);
});

test("CDP session release does not call browser.close", async () => {
  let closeCalls = 0;
    const fakePage = {
      url: () => "http://localhost:5173/app",
      on: () => {},
      goto: async () => {},
      route: async () => {},
      unroute: async () => {},
      mainFrame: () => fakePage,
    };
    const fakeBrowser = {
      contexts: () => [
        {
          pages: () => [fakePage],
        },
      ],
      close: async () => {
        closeCalls++;
      },
    } as unknown as Browser;

  const originalConnect = (await import("playwright-core")).chromium.connectOverCDP;
  const chromium = (await import("playwright-core")).chromium;
  (chromium as { connectOverCDP: typeof originalConnect }).connectOverCDP = async () => fakeBrowser;

  try {
    const session = await openBrowserSession({
      mode: "cdp-attached",
      cdpEndpoint: "http://127.0.0.1:9222",
      attachUrlPrefix: "http://localhost:5173",
    });
    assert.equal(session.mode, "cdp-attached");
    await session.release();
    assert.equal(closeCalls, 0, "browser.close must not run for CDP sessions");
  } finally {
    (chromium as { connectOverCDP: typeof originalConnect }).connectOverCDP = originalConnect;
  }
});

test("attachOverCDP errors when no tab matches prefix", async () => {
  const fakeBrowser = {
    contexts: () => [{ pages: () => [{ url: () => "https://evil.test/secret" }] }],
    close: async () => {},
  } as unknown as Browser;
  const chromium = (await import("playwright-core")).chromium;
  const originalConnect = chromium.connectOverCDP;
  chromium.connectOverCDP = async () => fakeBrowser;
  try {
    await assert.rejects(
      () => attachOverCDP("http://127.0.0.1:9222", "http://localhost"),
      /No CDP tab matches/,
    );
  } finally {
    chromium.connectOverCDP = originalConnect;
  }
});

test("origin allowlist blocks external navigation", async () => {
  await assert.rejects(
    async () => {
      const session = await openBrowserSession({ headless: true, allowedOrigins: ["http://127.0.0.1"] });
      try {
        await session.page.goto("https://evil.test/");
      } finally {
        await session.release();
      }
    },
    /Navigation blocked/,
  );
});

test("auth-spa fixture shows dashboard after sessionStorage login (isolated)", async () => {
  const htmlPath = path.resolve("src/hybrid/fixtures/auth-spa/index.html");
  const url = pathToFileURL(htmlPath).href;
  const session = await openBrowserSession({
    headless: true,
    allowedOrigins: [new URL(url).origin],
  });
  try {
    await session.page.goto(url);
    await session.page.click("#login-btn");
    const welcome = await session.page.getByTestId("welcome").textContent();
    assert.equal(welcome, "Welcome back");
    const auth = await session.page.evaluate(() => sessionStorage.getItem("auth"));
    assert.equal(auth, "1");
  } finally {
    await session.release();
  }
});
