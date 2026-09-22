/**
 * Cooperative shutdown for long-lived response streams.
 *
 * `next start` installs its own SIGTERM handler (see
 * `next/dist/server/lib/start-server.js`) that does:
 *
 *     await new Promise((res) => {
 *       server.close(() => res());
 *       if (isDev) server.closeAllConnections();   // dev only
 *     });
 *     ...
 *     process.exit(143);
 *
 * `server.close()` stops accepting new connections *immediately* but only calls
 * back once every existing connection has ended. The market SSE streams never
 * end on their own, and `closeAllConnections()` is dev-only — so in production
 * the callback never fired, `process.exit(143)` was never reached, and systemd
 * escalated to SIGKILL after the full 30s `TimeoutStopSec`.
 *
 * All 30 of those seconds were downtime, not a grace period: the listener was
 * already closed from the instant SIGTERM landed, so nginx got
 * `connect() failed (111: Connection refused)` on 127.0.0.1:3000 and returned
 * 502 to every visitor. Confirmed in `/var/log/nginx/error.log` during the
 * `678beea` deploy (11:04:15 refused, process killed 11:04:24).
 *
 * Routes that hold a response open register a closer here. On SIGTERM they are
 * all ended, `server.close()` completes, and Next's own `process.exit` runs. Our
 * listener is registered on first use, i.e. *after* Next's, which is the order we
 * want: the listener closes first, then the streams drain.
 *
 * Measured on the VPS with a live SSE client held open: SIGTERM to a stopped
 * unit went from 30.0s (timed out, SIGKILLed, connection-refused throughout) to
 * 0.06s, stopping and starting inside the same journal second.
 */
const closers = new Set<() => void>();
let hooked = false;

/**
 * Register a teardown to run when the process is asked to stop.
 * Returns a de-registration function; calling it is safe at any time.
 */
export function onShutdown(close: () => void): () => void {
  if (
    !hooked &&
    typeof process !== "undefined" &&
    typeof process.on === "function"
  ) {
    hooked = true;
    const endAll = () => {
      // Iterate a copy: a closer that de-registers itself mutates the set.
      for (const close of [...closers]) {
        try {
          close();
        } catch {
          /* already gone */
        }
      }
      closers.clear();
    };
    process.once("SIGTERM", endAll);
    process.once("SIGINT", endAll);
  }
  closers.add(close);
  return () => {
    closers.delete(close);
  };
}
