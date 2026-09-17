import { NextResponse } from "next/server";

// GET /api/v1/auth/oauth/google — Google OAuth lived on the external
// worker. Self-hosted builds use email/password; point users back with
// a clear message instead of a dead redirect.
export function GET(req: Request) {
  return NextResponse.redirect(
    new URL("/login?error=oauth-unavailable", req.url),
  );
}
