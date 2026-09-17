"use client";
import { useEffect, useRef } from "react";

// Lightweight canvas candles with volume + crosshair, no extra dep.
export default function ProChart({
  data,
  height = 360,
  desktopHeight,
}: {
  data: [number, number][];
  height?: number;
  desktopHeight?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const isDesktop =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(min-width: 768px)").matches;
  const effHeight = desktopHeight && isDesktop ? desktopHeight : height;
  useEffect(() => {
    const canvas = ref.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !data?.length) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = wrap.clientWidth;
    const H = effHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const closes = data.map((c) => c[1]);
    let min = Math.min(...closes),
      max = Math.max(...closes);
    if (max - min === 0) {
      max += 1;
      min -= 1;
    }
    const pad = (max - min) * 0.12;
    min -= pad;
    max += pad;
    const volH = H * 0.18;
    const priceH = H - volH - 8;
    const X = (i: number) => (i / Math.max(1, data.length - 1)) * (W - 8) + 4;
    const Y = (v: number) => priceH - ((v - min) / (max - min)) * priceH;

    ctx.clearRect(0, 0, W, H);
    // grid
    ctx.strokeStyle = "rgba(132,142,156,0.15)";
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const y = (priceH / 4) * g;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    // line path (close series)
    ctx.beginPath();
    data.forEach((c, i) => {
      const x = X(i),
        y = Y(c[1]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    const up = closes[closes.length - 1] >= closes[0];
    const upLine = "#2dd4bf";
    const upFill = "rgba(45,212,191,0.28)";
    const upFillEnd = "rgba(190,242,100,0.02)";
    const dnLine = "#f87171";
    const dnFill = "rgba(248,113,113,0.26)";
    ctx.strokeStyle = up ? upLine : dnLine;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    // soft glow under the line
    ctx.shadowColor = up ? "rgba(45,212,191,0.45)" : "rgba(248,113,113,0.4)";
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
    // area fill: teal -> lime fade (up) / red fade (down)
    const grad = ctx.createLinearGradient(0, 0, 0, priceH);
    grad.addColorStop(0, up ? upFill : dnFill);
    grad.addColorStop(1, up ? upFillEnd : "rgba(0,0,0,0)");
    ctx.lineTo(X(data.length - 1), priceH);
    ctx.lineTo(X(0), priceH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    // last-price dashed line
    const last = closes[closes.length - 1];
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = up ? "#2dd4bf" : "#f87171";
    ctx.beginPath();
    ctx.moveTo(0, Y(last));
    ctx.lineTo(W, Y(last));
    ctx.stroke();
    ctx.setLineDash([]);
    // volume bars
    const vols = data.map(
      (_, i) =>
        Math.abs(closes[i] - (closes[i - 1] ?? closes[i])) + (max - min) * 0.02,
    );
    const vmax = Math.max(...vols);
    data.forEach((_, i) => {
      const h = (vols[i] / vmax) * volH;
      ctx.fillStyle =
        closes[i] >= (closes[i - 1] ?? closes[i])
          ? "rgba(38,166,154,0.5)"
          : "rgba(239,83,80,0.5)";
      ctx.fillRect(X(i) - 1.5, H - h, 3, h);
    });
  }, [data, effHeight, isDesktop]);

  return (
    <div
      ref={wrapRef}
      className="relative w-full"
      style={{ height: effHeight }}
    >
      {!data?.length ? (
        <div className="absolute inset-0 flex items-center justify-center text-[12.5px] text-muted-foreground">
          No data
        </div>
      ) : null}
      <canvas ref={ref} className="cursor-crosshair" />
    </div>
  );
}
