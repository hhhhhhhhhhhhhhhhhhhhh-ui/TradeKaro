// scripts/mock-capi.mjs — a stand-in for Meta's Graph API and GA4's Measurement
// Protocol, so the SENDING half of Phase 4 can be tested for real.
//
//   node scripts/mock-capi.mjs [port]
//
// Why this exists: the payload builders can be checked by eye, but "does a 500
// cause a retry, does a 2xx mark it sent, does the request carry a hashed email
// and never a raw one" cannot. The real Graph API needs live credentials and
// counts real conversions when you get it right, which makes it useless as a
// test target.
//
// Behaviour:
//   POST /v*/<pixel>/events     Meta. Records the request. Returns 2xx, unless
//                               the event id contains "retrytest" and this is
//                               the first time it has been seen — then 500 once,
//                               so the backoff path is exercised rather than
//                               assumed.
//   POST /mp/collect            GA4. Always 2xx.
//   GET  /__captured            Everything received, as JSON.
//   POST /__reset               Forgets everything.

import { createServer } from "node:http";

const PORT = Number(process.argv[2] || 4123);

/** Every request received, newest last. */
const captured = [];
/** event ids already failed once, for the retry test. */
const failedOnce = new Set();

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (path === "/__captured") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(captured));
    return;
  }
  if (path === "/__reset") {
    captured.length = 0;
    failedOnce.clear();
    res.writeHead(200).end("ok");
    return;
  }

  const raw = await readBody(req);
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* kept as raw so a malformed body is still visible */
  }

  const kind = path.startsWith("/mp/collect") ? "ga4" : "meta";
  captured.push({
    kind,
    path,
    query: url.search,
    auth: req.headers.authorization || "",
    contentType: req.headers["content-type"] || "",
    body: parsed,
    raw,
    at: Date.now(),
  });

  // One deliberate failure so the retry path runs at least once.
  if (kind === "meta") {
    const eventId = parsed?.data?.[0]?.event_id || "";
    if (eventId.includes("retrytest") && !failedOnce.has(eventId)) {
      failedOnce.add(eventId);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "mock upstream failure" } }));
      return;
    }
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(kind === "meta" ? JSON.stringify({ events_received: 1 }) : "");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock providers listening on http://127.0.0.1:${PORT}`);
});
