import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnLongRunning, killTree } from "../util/shell.js";
import type { RunPlan } from "./detect-stack.js";
import { startDevServer } from "./run-background.js";
import { waitForLocalUrl } from "./wait-local-url.js";

const FAKE_SERVER = `
const http = require("http");
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("ok");
});
server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  console.log("Local: http://localhost:" + port);
});
`;

test("waitForLocalUrl resolves when child prints localhost URL", async () => {
  const child = spawnLongRunning(process.execPath, ["-e", FAKE_SERVER], process.cwd());
  try {
    const url = await waitForLocalUrl({ child, timeoutMs: 15_000 });
    assert.match(url, /^http:\/\/localhost:\d+/);
    const r = await fetch(url);
    assert.equal(r.status, 200);
  } finally {
    killTree(child);
  }
});

test("startDevServer returns url and kill() stops the process tree", async () => {
  const plan: RunPlan = {
    stack: "node",
    install: [],
    run: { cmd: process.execPath, args: ["-e", FAKE_SERVER], label: "fake dev" },
    ports: [],
    reasons: [],
    confident: true,
  };
  const server = await startDevServer(process.cwd(), plan, { timeoutMs: 15_000 });
  const url = server.url;
  try {
    assert.match(url, /^http:\/\/localhost:\d+/);
    const r = await fetch(url);
    assert.equal(r.status, 200);
    server.kill();
    await new Promise((r) => setTimeout(r, 500));
    await assert.rejects(() => fetch(url, { signal: AbortSignal.timeout(1000) }));
  } finally {
    server.kill();
  }
});

test("knownPorts poll discovers silent server", async () => {
  const plan: RunPlan = {
    stack: "node",
    install: [],
    run: {
      cmd: process.execPath,
      args: [
        "-e",
        `const http=require("http");http.createServer((q,r)=>r.end("ok")).listen(34567,"127.0.0.1");`,
      ],
      label: "silent",
    },
    ports: [34567],
    reasons: [],
    confident: true,
  };
  const server = await startDevServer(process.cwd(), plan, { timeoutMs: 15_000, knownPorts: [34567] });
  try {
    assert.equal(server.url, "http://localhost:34567");
  } finally {
    server.kill();
  }
});
