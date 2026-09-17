import { NextRequest } from "next/server";
import {
  feedAcquire,
  feedSnapshot,
  feedSubscribe,
  feedHealth,
} from "@/app/lib/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-Sent Events bridge: browser subscribes per tab, the server
// multiplexes into one shared Upstox WebSocket (see app/lib/feed.ts).
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const symbols = (url.searchParams.get("symbols") || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 200);
  if (!symbols.length) return new Response("no symbols", { status: 400 });

  const encoder = new TextEncoder();
  const mine = new Set(symbols);
  let release: (() => void) | null = null;
  let unsub: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch {
          cleanup();
        }
      };
      const cleanup = () => {
        if (closed) return;
        closed = true;
        unsub?.();
        release?.();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      release = feedAcquire(symbols);
      send("hello", { feed: feedHealth(), count: symbols.length });
      send("ticks", feedSnapshot(symbols));
      unsub = feedSubscribe((ticks) => {
        const mineTicks = ticks.filter((t) => mine.has(t.symbol));
        if (mineTicks.length) send("ticks", mineTicks);
      });
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          // Keep the browser's view of upstream health current: a socket that
          // dies mid-session must not keep reporting LIVE until a reconnect.
          send("feed", { feed: feedHealth() });
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 15000);
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      closed = true;
      unsub?.();
      release?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
