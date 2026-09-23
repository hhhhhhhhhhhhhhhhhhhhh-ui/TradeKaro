/**
 * Runs once when a Next server instance boots (Node runtime only).
 *
 * The shutdown hook has to be installed here rather than lazily from a route:
 * nginx holds idle upstream keep-alive sockets open to the app, and those alone
 * pin `systemd`'s full `TimeoutStopSec` on every restart. If the handler were only
 * installed when an SSE client connected, a restart with no live client would go
 * back to a 30s outage. See app/lib/shutdown.ts for the whole story.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installShutdownHook } = await import("./app/lib/shutdown");
    installShutdownHook();
  }
}
