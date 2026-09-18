"use client";
import { useEffect } from "react";

// Route-level error boundary — previously a crash showed Next's raw overlay.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[tradestox] route error:", error);
  }, [error]);

  return (
    <div className="px-4 pb-24 pt-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-md text-center">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Something broke
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          This section failed to load
        </h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          {error?.message
            ? error.message.slice(0, 160)
            : "An unexpected error occurred while rendering this page."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={reset}
            className="pressable inline-flex h-10 items-center justify-center rounded-md bg-foreground px-4 text-[12px] font-semibold text-background"
          >
            TRY AGAIN
          </button>
          <a
            href="/dashboard"
            className="pressable inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-[12px] font-semibold text-foreground/80 transition-colors hover:bg-muted/50"
          >
            GO TO DASHBOARD
          </a>
        </div>
      </div>
    </div>
  );
}
