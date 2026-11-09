import type { ChildProcess } from "node:child_process";

export const LOCAL_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d{2,5})?[^\s'"`)\]]*/i;
export const PORT_LOG_RE = /(?:port|listening on|running on|started on|available at)\D{0,20}(\d{4,5})/i;

/** Parse the newest localhost URL from accumulated dev-server log output. */
export function parseLocalUrlFromLog(buffer: string): string | null {
  const u = buffer.match(LOCAL_URL_RE);
  if (u) return u[0].replace("0.0.0.0", "localhost");
  const p = buffer.match(PORT_LOG_RE);
  if (p) return `http://localhost:${p[1]}`;
  return null;
}

export async function probeLocalhostPort(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(800) });
    return r.status < 500;
  } catch {
    return false;
  }
}

export interface PollKnownPortsOptions {
  ports: number[];
  intervalMs?: number;
  timeoutMs?: number;
  shouldStop?: () => boolean;
}

/** Poll expected ports until one responds or timeout. */
export async function pollKnownPorts(opts: PollKnownPortsOptions): Promise<string | null> {
  const intervalMs = opts.intervalMs ?? 1500;
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (opts.shouldStop?.()) return null;
    for (const port of opts.ports) {
      if (await probeLocalhostPort(port)) return `http://localhost:${port}`;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

export interface WaitForLocalUrlOptions {
  child: ChildProcess;
  knownPorts?: number[];
  timeoutMs?: number;
  pollIntervalMs?: number;
  onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
}

/**
 * Wait until dev-server output or port polling reveals a localhost URL.
 */
export function waitForLocalUrl(opts: WaitForLocalUrlOptions): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 1500;
  const knownPorts = opts.knownPorts ?? [];

  return new Promise((resolve, reject) => {
    let buffer = "";
    let settled = false;

    const cleanup = () => {
      clearInterval(poll);
      clearTimeout(timer);
    };

    const finish = (url: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(url);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onData = (b: Buffer, stream: "stdout" | "stderr") => {
      const s = b.toString();
      opts.onOutput?.(s, stream);
      buffer = (buffer + s).slice(-4000);
      const url = parseLocalUrlFromLog(buffer);
      if (url) finish(url);
    };

    opts.child.stdout?.on("data", (b) => onData(b, "stdout"));
    opts.child.stderr?.on("data", (b) => onData(b, "stderr"));

    opts.child.on("close", (code) => {
      fail(new Error(`Dev server exited with code ${code ?? "unknown"} before a local URL was detected`));
    });

    opts.child.on("error", (err) => {
      fail(err);
    });

    const poll = setInterval(async () => {
      if (settled) return;
      for (const port of knownPorts) {
        if (await probeLocalhostPort(port)) {
          finish(`http://localhost:${port}`);
          return;
        }
      }
    }, pollIntervalMs);

    const timer = setTimeout(() => {
      fail(new Error(`Timed out after ${timeoutMs}ms waiting for dev server URL`));
    }, timeoutMs);
  });
}
