import type { ChildProcess } from "node:child_process";
import type { Command, RunPlan } from "./detect-stack.js";
import { killTree, spawnLongRunning } from "../util/shell.js";
import { waitForLocalUrl } from "./wait-local-url.js";

export interface StartDevServerOptions {
  knownPorts?: number[];
  timeoutMs?: number;
  /** Override `plan.run` when the caller already resolved a command. */
  run?: Command;
}

export interface BackgroundServer {
  url: string;
  kill(): void;
  stderrTail(): string;
}

type InternalServer = BackgroundServer & { child: ChildProcess };

export async function startDevServer(
  dir: string,
  plan: RunPlan,
  opts: StartDevServerOptions = {},
): Promise<BackgroundServer> {
  const cmd = opts.run ?? plan.run;
  if (!cmd) throw new Error("RunPlan has no run command");
  const knownPorts = opts.knownPorts ?? plan.ports;
  const timeoutMs = opts.timeoutMs ?? 90_000;

  let stderrBuffer = "";
  const child = spawnLongRunning(cmd.cmd, cmd.args, dir);

  const url = await waitForLocalUrl({
    child,
    knownPorts,
    timeoutMs,
    onOutput: (chunk, stream) => {
      if (stream === "stderr") stderrBuffer = (stderrBuffer + chunk).slice(-4000);
    },
  });

  const server: InternalServer = {
    url,
    child,
    kill() {
      killTree(child);
    },
    stderrTail() {
      return stderrBuffer;
    },
  };

  return server;
}
