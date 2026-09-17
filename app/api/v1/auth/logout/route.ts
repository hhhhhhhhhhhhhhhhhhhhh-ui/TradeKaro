import { NextResponse } from "next/server";

// POST /api/v1/logout — clears the session cookies server-side.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  for (const name of ["token", "username", "email", "clientID"])
    res.cookies.set(name, "", { path: "/", maxAge: 0 });
  return res;
}
