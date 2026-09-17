"use client";

export default function DepthHeader({
  title,
  live,
  updatedLabel,
  right,
}: {
  title: string;
  live: boolean;
  updatedLabel?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="px-4 md:px-6 py-3 border-b border-border flex flex-wrap items-center justify-between gap-2">
      <span className="flex items-center gap-2">
        <span
          className={`inline-block h-2 w-2 rounded-full ${live ? "bg-positive live-dot" : "bg-negative"}`}
        />
        <span className="eyebrow">{title}</span>
      </span>
      <span className="flex items-center gap-2">
        {right}
        {updatedLabel && (
          <span className="text-[10px] font-mono text-foreground/40">
            · {updatedLabel}
          </span>
        )}
      </span>
    </div>
  );
}
