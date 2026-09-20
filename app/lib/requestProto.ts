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

/**
 * The public base URL this app is reachable at, for building links that leave
 * the server.
 *
 * DO NOT build a public URL from the request's own origin. Behind the nginx
 * proxy `req.nextUrl.origin` resolved to the app's internal listen address, so
 * every generated link came out as `https://localhost:3000/...` — the affiliate
 * short links, the landing-page URLs, and every QR code. It looked perfect in
 * local development, where the internal address IS the public one, and was
 * broken for everybody else the moment it was deployed.
 *
 * `PUBLIC_BASE_URL` is the configured truth. The request origin remains the
 * fallback so local development needs no configuration.
 */
export function publicBaseUrl(req: NextRequest): string {
  const configured = String(process.env.PUBLIC_BASE_URL || "").trim();
  return (configured || req.nextUrl.origin).replace(/\/+$/, "");
}
