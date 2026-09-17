import Link from "next/link";

// Branded 404 — Next's default page was the only unbranded route left.
export default function NotFound() {
  return (
    <div className="px-4 pb-24 pt-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-md text-center">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Error 404
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          This page doesn&apos;t exist
        </h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          The link may be broken, or the page may have moved. Your positions and
          orders are unaffected.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link
            href="/dashboard"
            className="pressable inline-flex h-10 items-center justify-center rounded-md bg-foreground px-4 text-[12px] font-semibold text-background"
          >
            GO TO DASHBOARD
          </Link>
          <Link
            href="/stocks"
            className="pressable inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-[12px] font-semibold text-foreground/80 transition-colors hover:bg-muted/50"
          >
            BROWSE STOCKS
          </Link>
        </div>
      </div>
    </div>
  );
}
