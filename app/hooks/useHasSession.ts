"use client";
import { useEffect, useState } from "react";
import { getCookie } from "cookies-next";

/**
 * Is anyone signed in?
 *
 * The `token` cookie is deliberately non-HttpOnly (see
 * app/api/v1/auth/login/route.ts) because the client reads it directly.
 *
 * This still has to start `false`: the cookie is invisible during SSR, so the
 * first render must match the server's. Callers should therefore use it only to
 * HIDE private affordances — a brief `false` for a signed-in user is a flicker,
 * whereas rendering something private before knowing is a real bug.
 */
export default function useHasSession() {
  const [hasSession, setHasSession] = useState(false);
  useEffect(() => {
    setHasSession(Boolean(getCookie("token")));
  }, []);
  return hasSession;
}
