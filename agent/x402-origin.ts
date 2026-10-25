import { NextRequest } from "next/server";

const PRODUCTION_ORIGIN = "https://petops-u7si.onrender.com";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Keep the x402 review and HTTP 402 challenge on one trusted origin. */
export function petOpsOrigin(requestUrl: string, production = process.env.NODE_ENV === "production"): string {
  const url = new URL(requestUrl);
  if (!production) return url.origin;
  if (url.origin === PRODUCTION_ORIGIN) return PRODUCTION_ORIGIN;
  if (url.hostname === "0.0.0.0" && url.port === (process.env.PORT || "10000")) {
    return PRODUCTION_ORIGIN;
  }
  if (LOOPBACK_HOSTS.has(url.hostname)) return url.origin;
  throw new Error("Unrecognized PetOps request origin.");
}

/** Next/x402 must advertise the public URL even when Render passes its bind address. */
export function canonicalPremiumRequest(request: NextRequest,
  production = process.env.NODE_ENV === "production"): NextRequest {
  const url = new URL(request.url);
  const origin = petOpsOrigin(request.url, production);
  if (origin === url.origin) return request;
  const canonical = new URL(url.pathname + url.search, origin);
  return new NextRequest(canonical, { method: request.method, headers: request.headers });
}
