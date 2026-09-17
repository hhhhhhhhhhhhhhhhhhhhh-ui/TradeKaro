import type { NextRequest } from "next/server";

/**
 * Was this request actually served over HTTPS?
 *
 * Session cookies should only carry the `Secure` attribute when the browser
 * genuinely reached us over TLS. Deriving that from `NODE_ENV === "production"`
 * is a trap: a production build served over plain HTTP — an IP address, an
 * internal hostname, a proxy in front without TLS — then sets `Secure`, and the
 * browser silently discards the cookie. Login reports success and the session
 * simply never exists, which is painful to diagnose because nothing errors.
 *
 * Behind a reverse proxy the original scheme arrives in `X-Forwarded-Proto`,
 * which `deploy/nginx-tradekaro.conf` sets.
 */
export function isSecureRequest(req: NextRequest): boolean {
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0]!.trim().toLowerCase() === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}
