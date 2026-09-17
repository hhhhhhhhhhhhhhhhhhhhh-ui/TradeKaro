// Throwaway probe: verify the Upstox v3 market-data feed works with our token.
// Usage: node scripts/feed-probe.mjs
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
const token =
  env.UPSTOX_FEED_TOKEN ||
  env.UPSTOX_ACCESS_TOKEN ||
  env.UPSTOX_ANALYTICS_TOKEN;
if (!token) {
  console.log("no token found");
  process.exit(1);
}

const UpstoxClient = (await import("upstox-js-sdk")).default;
const client = UpstoxClient.ApiClient.instance;
client.authentications["OAUTH2"].accessToken = token;

const streamer = new UpstoxClient.MarketDataStreamerV3(
  ["NSE_EQ|INE002A01018", "NSE_EQ|INE467B01029"],
  "full",
);
let count = 0;
streamer.on("open", () => console.log("WS OPEN"));
streamer.on("message", (data) => {
  count++;
  if (count <= 2) {
    try {
      const j = JSON.parse(String(data));
      const feeds = j.feeds ?? {};
      const firstKey = Object.keys(feeds)[0];
      const f = feeds[firstKey] ?? {};
      const ff = f.fullFeed ?? {};
      console.log("MSG#", count, "keys:", Object.keys(feeds).join(","));
      console.log("  raw sample:", JSON.stringify(f).slice(0, 500));
    } catch (e) {
      console.log("MSG (parse fail):", String(data).slice(0, 200));
    }
  }
});
streamer.on("error", (e) => console.log("WS ERROR:", e?.message || String(e)));
streamer.on("close", () => console.log("WS CLOSE"));
streamer.on("autoReconnectStopped", (d) =>
  console.log("RECONNECT STOPPED:", d),
);
streamer.connect();

setTimeout(() => {
  console.log("\nchecked 12s — messages received:", count);
  process.exit(count > 0 ? 0 : 2);
}, 12000);
