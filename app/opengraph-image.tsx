import { ImageResponse } from "next/og";

// Social share card (WhatsApp / X / LinkedIn / Slack). Generated as a real PNG
// at build time from code — no design file needed. ASCII text only: the default
// font has no rupee glyph, which would render as a tofu box.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "TradeKaro — Indian market analysis and trading";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px",
        background:
          "linear-gradient(135deg, #0a0d10 0%, #10201f 55%, #0d2b27 100%)",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <div
          style={{
            width: 76,
            height: 76,
            borderRadius: 18,
            background: "#0f766e",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            fontSize: 40,
            fontWeight: 800,
          }}
        >
          T
        </div>
        <div
          style={{
            display: "flex",
            color: "#e6edf3",
            fontSize: 34,
            fontWeight: 700,
            letterSpacing: -0.5,
          }}
        >
          TradeKaro
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div
          style={{
            display: "flex",
            color: "#ffffff",
            fontSize: 74,
            fontWeight: 800,
            lineHeight: 1.08,
            letterSpacing: -2,
            maxWidth: 900,
          }}
        >
          Indian market analysis and trading
        </div>
        <div
          style={{
            display: "flex",
            color: "#8fb3ae",
            fontSize: 30,
            lineHeight: 1.4,
            maxWidth: 880,
          }}
        >
          Live NSE/BSE quotes, charts, options chain and a complete trading
          account.
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            width: 90,
            height: 6,
            borderRadius: 3,
            background: "#2dd4bf",
          }}
        />
        <div style={{ display: "flex", color: "#5f8b86", fontSize: 24 }}>
          Live market data · Simulated execution · Real charts
        </div>
      </div>
    </div>,
    size,
  );
}
