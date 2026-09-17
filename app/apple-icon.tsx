import { ImageResponse } from "next/og";

// iOS home-screen icon (apple-touch-icon) — PNG required, so it is rendered
// from code rather than shipped as a binary.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  const square = (opacity: number) => (
    <div
      style={{
        width: 44,
        height: 44,
        borderRadius: 9,
        background: "#ffffff",
        opacity,
      }}
    />
  );
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0f766e",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          width: 96,
          height: 96,
          gap: 8,
        }}
      >
        {square(0.95)}
        {square(0.55)}
        {square(0.55)}
        {square(0.95)}
      </div>
    </div>,
    size,
  );
}
