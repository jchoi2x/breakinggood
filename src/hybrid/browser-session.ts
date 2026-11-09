import { chromium, type Browser, type Page } from "playwright-core";
import { existsSync } from "node:fs";
import { applyNetworkMutationGuard, type NetworkPolicyOptions } from "./network-policy.js";

export type BrowserSessionMode = "isolated" | "cdp-attached";

export interface BrowserSession {
  mode: BrowserSessionMode;
  browser: Browser;
  page: Page;
  release: () => Promise<void>;
}

export interface OpenBrowserSessionOptions extends NetworkPolicyOptions {
  mode?: BrowserSessionMode;
  /** CDP WebSocket or HTTP endpoint (e.g. http://127.0.0.1:9222). */
  cdpEndpoint?: string;
  attachUrlPrefix?: string;
  allowedOrigins?: string[];
  headless?: boolean;
}

const DEFAULT_ALLOWED = ["http://localhost", "http://127.0.0.1"];

/** Disallow persisting cookies/tokens from hybrid capture paths. */
export function forbidStorageStateExport(): void {
  throw new Error("storageState() is forbidden in hybrid browser sessions");
}

function mergeAllowedOrigins(custom?: string[]): string[] {
  const set = new Set(DEFAULT_ALLOWED);
  for (const o of custom ?? []) {
    set.add(o.replace(/\/$/, ""));
  }
  return [...set];
}

function originAllowed(url: string, allowed: string[]): boolean {
  try {
    const origin = new URL(url).origin;
    return allowed.some((prefix) => {
      const p = prefix.replace(/\/$/, "");
      return origin === p || origin.startsWith(p) || url.startsWith(p);
    });
  } catch {
    return false;
  }
}

function installOriginGuards(page: Page, allowed: string[]): void {
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    const url = frame.url();
    if (url === "about:blank") return;
    if (!originAllowed(url, allowed)) {
      void frame.goto("about:blank").catch(() => undefined);
    }
  });
  const originalGoto = page.goto.bind(page);
  page.goto = async (url, options) => {
    if (!originAllowed(String(url), allowed)) {
      throw new Error(`Navigation blocked by origin allowlist: ${url}`);
    }
    return originalGoto(url, options);
  };
}

async function launchIsolated(headless = true): Promise<Browser> {
  const attempts: (() => Promise<Browser>)[] = [
    () => chromium.launch({ channel: "chrome", headless }),
    () => chromium.launch({ channel: "msedge", headless }),
    () => chromium.launch({ channel: "chromium", headless }),
    () => chromium.launch({ headless }),
  ];
  const envPath = process.env.BREAKINGGOOD_BROWSER;
  if (envPath && existsSync(envPath)) {
    attempts.unshift(() => chromium.launch({ executablePath: envPath, headless }));
  }
  let lastErr: unknown;
  for (const a of attempts) {
    try {
      return await a();
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `No Chromium-based browser found for isolated launch: ${String((lastErr as Error)?.message ?? "")}`,
  );
}

export async function attachOverCDP(
  endpoint: string,
  attachUrlPrefix?: string,
): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.connectOverCDP(endpoint);
  const contexts = browser.contexts();
  const pages = contexts.flatMap((c) => c.pages());
  const prefix = attachUrlPrefix ?? "http://localhost";
  const matches = pages.filter((p) => p.url().startsWith(prefix));
  if (matches.length === 0) {
    throw new Error(`No CDP tab matches prefix ${prefix}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple CDP tabs match prefix ${prefix} — disambiguate with --attach-url-prefix`,
    );
  }
  return { browser, page: matches[0]! };
}

export async function openBrowserSession(opts: OpenBrowserSessionOptions = {}): Promise<BrowserSession> {
  const allowed = mergeAllowedOrigins(opts.allowedOrigins);
  const headless = opts.headless ?? true;
  const network: NetworkPolicyOptions = { noNetworkMutations: opts.noNetworkMutations };

  if (opts.mode === "cdp-attached" || opts.cdpEndpoint) {
    if (!opts.cdpEndpoint) throw new Error("--attach-cdp endpoint required for CDP attach mode");
    const { browser, page } = await attachOverCDP(opts.cdpEndpoint, opts.attachUrlPrefix);
    installOriginGuards(page, allowed);
    const unroute = await applyNetworkMutationGuard(page, network);
    let released = false;
    return {
      mode: "cdp-attached",
      browser,
      page,
      release: async () => {
        if (released) return;
        released = true;
        await unroute();
        // Never close user browser on CDP attach.
      },
    };
  }

  const browser = await launchIsolated(headless);
  const context = await browser.newContext();
  const page = await context.newPage();
  installOriginGuards(page, allowed);
  const unroute = await applyNetworkMutationGuard(page, network);
  let released = false;
  return {
    mode: "isolated",
    browser,
    page,
    release: async () => {
      if (released) return;
      released = true;
      await unroute();
      await browser.close();
    },
  };
}
