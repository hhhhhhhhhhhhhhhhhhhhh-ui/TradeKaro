"use client";
import { useId, useMemo } from "react";

// Tiny inline trend line with gradient fill + end dot for rows.
export default function Sparkline({
  data,
  width = 72,
  height = 22,
  positive = true,
  id,
}: {
  data: number[];
  width?: number;
  height?: number;
  positive?: boolean;
  id?: string;
}) {
  const { d, lastX, lastY } = useMemo(() => {
    if (!data.length) return { d: "", lastX: 0, lastY: 0 };
    const min = Math.min(...data),
      max = Math.max(...data);
    const span = max - min || 1;
    const pts = data.map((v, i) => {
      const x = (i / Math.max(1, data.length - 1)) * width;
      const y = height - 2 - ((v - min) / span) * (height - 4);
      return { x, y };
    });
    const path = pts
      .map(
        (p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`,
      )
      .join(" ");
    const last = pts[pts.length - 1];
    return { d: path, lastX: last.x, lastY: last.y };
  }, [data, width, height]);
  const stroke = positive ? "#34d399" : "#f87171";
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const gid = id || `spark-${uid}`;
  if (!data.length)
    return <span className="inline-block shrink-0" style={{ width, height }} />;
  return (
    <svg width={width} height={height} className="shrink-0 overflow-visible">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={`${d} L${width},${height} L0,${height} Z`}
        fill={`url(#${gid})`}
        stroke="none"
      />
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {data.length > 1 && (
        <circle
          cx={lastX}
          cy={lastY}
          r="2"
          fill={stroke}
          className="live-dot"
        />
      )}
    </svg>
  );
}
