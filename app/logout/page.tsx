"use client";
import { useEffect } from "react";
import { deleteCookie, getCookie } from "cookies-next";

// Signing out has to clear every cookie the login route sets, not just the
// token: a stale `username` / `email` / `clientID` left behind is what the
// navbar reads to decide it should still show your initials.
const SESSION_COOKIES = [
  "token",
  "username",
  "email",
  "clientID",
  "clientCode",
];

export default function Logout() {
  useEffect(() => {
    for (const name of SESSION_COOKIES) {
      if (getCookie(name) !== undefined) deleteCookie(name, { path: "/" });
    }
    // Full load, not router.push(). Client-side navigation would keep every
    // in-memory store from the signed-in session (positions, funds, watchlist)
    // alive in the tab and could replay a cached authenticated page.
    //
    // This also runs when nobody is signed in — the old version sat on
    // "Logging out..." forever in that case, because the redirect lived inside
    // an `if (token)` branch.
    window.location.replace("/");
  }, []);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <p className="text-[13px] text-muted-foreground">Signing you out…</p>
    </div>
  );
}
