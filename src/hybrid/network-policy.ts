import type { Page, Route } from "playwright-core";
import type { WorkflowNetworkRequest } from "./types.js";

const SENSITIVE_HEADERS = new Set([
  "cookie",
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "x-auth-token",
  "x-csrf-token",
  "set-cookie",
]);

export interface NetworkPolicyOptions {
  noNetworkMutations?: boolean;
}

function isLocalhostUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function isMutatingMethod(method: string): boolean {
  return !/^get$/i.test(method);
}

/** Block mutating requests to non-localhost when `noNetworkMutations` is true. */
export async function applyNetworkMutationGuard(
  page: Page,
  opts: NetworkPolicyOptions,
): Promise<() => void> {
  if (!opts.noNetworkMutations) {
    return () => {};
  }
  const handler = async (route: Route) => {
    const req = route.request();
    if (isMutatingMethod(req.method()) && !isLocalhostUrl(req.url())) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  };
  await page.route("**/*", handler);
  return async () => {
    await page.unroute("**/*", handler);
  };
}

export interface HarLikeRequest {
  method: string;
  url: string;
  status?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
}

/** Remove auth/session headers before writing artifacts or logs. */
export function stripSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(k.toLowerCase())) {
      out[k] = "[redacted]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function sanitizeHarLikeRequest(entry: HarLikeRequest): HarLikeRequest {
  return {
    ...entry,
    requestHeaders: entry.requestHeaders
      ? stripSensitiveHeaders(entry.requestHeaders)
      : undefined,
    responseHeaders: entry.responseHeaders
      ? stripSensitiveHeaders(entry.responseHeaders)
      : undefined,
  };
}

export function toWorkflowNetworkRequest(entry: HarLikeRequest): WorkflowNetworkRequest {
  const sanitized = sanitizeHarLikeRequest(entry);
  return {
    method: sanitized.method,
    url: sanitized.url,
    status: sanitized.status,
  };
}
