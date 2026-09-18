"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  FiActivity,
  FiAlertTriangle,
  FiBarChart2,
  FiBell,
  FiCreditCard,
  FiEdit3,
  FiGrid,
  FiKey,
  FiList,
  FiMonitor,
  FiShield,
  FiTrendingUp,
  FiUsers,
} from "react-icons/fi";
import { money, moneySigned, num } from "@/app/lib/format";
import { ThemeToggle } from "@/app/components/theme/ThemeToggle";
import {
  KYC_DEPOSIT_PRESETS,
  kycGate,
  normalizeMinDeposit,
} from "@/app/lib/kycGate";
import { usePublicConfig } from "@/app/hooks/usePublicConfig";
import FinanceSection from "./sections/FinanceSection";
import {
  Card,
  Kpi,
  Field,
  Badge,
  Callout,
  ConfirmDialog,
  Group,
  StatusPill,
  Switch,
  TableWrap,
  thCls,
  tdCls,
  trCls,
  FilterBar,
  SearchBox,
  EmptyState,
  Pagination,
  PageHead,
  inputCls,
  selectCls,
  btnPrimary,
  btnGhost,
  btnDanger,
  btnDark,
  type ConfirmSpec,
} from "./_ui";

type Settings = Record<string, any>;

// The KYC deposit dropdown offers presets, but an operator may also type an
// exact amount in the field beside it. Without this the select would show no
// matching option for a hand-typed value and silently imply a preset.
function customPresetOption(current: number) {
  const v = normalizeMinDeposit(current);
  if (KYC_DEPOSIT_PRESETS.includes(v)) return [];
  return [
    { value: String(v), label: `Custom — ₹${v.toLocaleString("en-IN")}` },
  ];
}

// Platform-wide kill-switches. Each one asks for confirmation before it
// flips, and high-risk switches require typing a phrase to unlock.
type EmergencyControl = {
  path: string;
  label: string;
  desc: string;
  consequences: string[];
  requireText?: string;
  highRisk?: boolean;
};

const EMERGENCY: EmergencyControl[] = [
  {
    path: "maintenance",
    label: "Maintenance mode",
    desc: "Blocks the public site for every user and serves the maintenance page.",
    consequences: [
      "Every visitor sees the maintenance screen instead of the app",
      "Charting, quotes and trading become unreachable from the UI",
      "Only this admin console stays accessible",
    ],
    requireText: "MAINTENANCE",
    highRisk: true,
  },
  {
    path: "providerOff",
    label: "Provider kill-switch",
    desc: "Stops all Upstox REST and WebSocket calls; the app serves last known values.",
    consequences: [
      "No live quotes, candles, market depth or option chain",
      "Tickers and watchlists freeze on the last snapshot",
      "Upstox quota usage drops to zero until resumed",
    ],
    requireText: "HALT",
    highRisk: true,
  },
  {
    path: "trading.haltFills",
    label: "Halt trading",
    desc: "Rejects new orders while existing positions keep marking to market.",
    consequences: [
      "New BUY / SELL orders are rejected by the engine",
      "Existing positions keep tracking live prices",
      "Queued pending orders stay queued until fills resume",
    ],
  },
];

type NavItem = { id: string; icon: ReactNode; desc: string };
type NavGroup = { group: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    group: "General",
    items: [
      {
        id: "Overview",
        icon: <FiGrid size={15} aria-hidden />,
        desc: "Health + kill switches",
      },
      {
        id: "Analytics",
        icon: <FiTrendingUp size={15} aria-hidden />,
        desc: "Funnel + activity",
      },
      {
        id: "Content",
        icon: <FiEdit3 size={15} aria-hidden />,
        desc: "Banner + notice",
      },
    ],
  },
  {
    group: "Management",
    items: [
      {
        id: "Finance",
        icon: <FiCreditCard size={15} aria-hidden />,
        desc: "Payments, pay-outs, callbacks",
      },
      {
        id: "Users & KYC",
        icon: <FiUsers size={15} aria-hidden />,
        desc: "Clients + operators",
      },
      {
        id: "Sessions",
        icon: <FiMonitor size={15} aria-hidden />,
        desc: "Active sign-ins",
      },
      {
        id: "Keys & Access",
        icon: <FiKey size={15} aria-hidden />,
        desc: "Tokens + roles",
      },
    ],
  },
  {
    group: "Market data",
    items: [
      {
        id: "Polling & Cache",
        icon: <FiActivity size={15} aria-hidden />,
        desc: "TTL + intervals",
      },
      {
        id: "Scrips & Lists",
        icon: <FiList size={15} aria-hidden />,
        desc: "Tape + watchlist",
      },
      {
        id: "Charts & Market",
        icon: <FiBarChart2 size={15} aria-hidden />,
        desc: "Defaults + hours",
      },
    ],
  },
  {
    group: "Trading",
    items: [
      {
        id: "Trading & Risk",
        icon: <FiShield size={15} aria-hidden />,
        desc: "Funds + limits",
      },
      {
        id: "Orders & Alerts",
        icon: <FiBell size={15} aria-hidden />,
        desc: "Qty + caps",
      },
    ],
  },
  {
    group: "System",
    items: [
      {
        id: "Logs",
        icon: <FiActivity size={15} aria-hidden />,
        desc: "Audit trail",
      },
    ],
  },
];

const NAV: (NavItem & { group: string })[] = NAV_GROUPS.flatMap((g) =>
  g.items.map((n) => ({ ...n, group: g.group })),
);

type Tab = string;

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("Overview");
  const [s, setS] = useState<Settings | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState("");
  const [busyAction, setBusyAction] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [confirmTyped, setConfirmTyped] = useState("");
  const [tokenDraft, setTokenDraft] = useState("");
  const [feedDraft, setFeedDraft] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [navQ, setNavQ] = useState("");
  const router = useRouter();
  const canEdit = role === "superadmin" || role === "operator";

  async function load() {
    try {
      const r = await fetch("/api/admin/settings");
      if (r.status === 403) {
        router.push("/admin/login");
        return;
      }
      const j = await r.json();
      setS(j.settings);
      setAudit(j.audit || []);
      setRole(j.role);
      setEmail(j.email);
      const st = await fetch("/api/admin/stats").then((x) => x.json());
      setStats(st);
    } catch (e: any) {
      setErr(e?.message || "Load failed");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save(patch: Settings) {
    if (!canEdit) return;
    setSaved("");
    setErr("");
    try {
      const r = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error || "Save failed");
        return;
      }
      setSaved("Saved ✓");
      load();
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    }
  }

  async function logout() {
    await fetch("/api/admin/login", { method: "DELETE" });
    router.push("/admin/login");
  }

  if (!s)
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <div className="broker-card flex flex-col items-center gap-3 px-10 py-8">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-border border-t-brand" />
          <div className="text-xs font-semibold tracking-[0.18em] text-muted-foreground">
            OPENING CONSOLE…
          </div>
        </div>
      </div>
    );

  const set = (path: string, v: any) => {
    const next = structuredClone(s);
    const parts = path.split(".");
    let o = next;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = v;
    setS(next);
  };

  const num = (label: string, path: string) => (
    <Field label={label}>
      <input
        type="number"
        value={get(s, path)}
        disabled={!canEdit}
        onChange={(e) => set(path, Number(e.target.value))}
        onBlur={() => save({ [root(path)]: get(s, root(path)) } as Settings)}
        className={inputCls}
      />
    </Field>
  );

  // Commits a switch value with the correct patch shape: top-level switches
  // (maintenance, providerOff) must save as a bare boolean, nested ones as
  // {...parent, leaf: v} — nesting a top-level key corrupts it into a truthy
  // object that can never be turned off again.
  const patchFor = (path: string, v: any) =>
    path.indexOf(".") === -1
      ? { [path]: v }
      : { [root(path)]: { ...get(s, root(path)), [leaf(path)]: v } };

  const commitToggle = (path: string, v: any) => {
    set(path, v);
    save(patchFor(path, v) as Settings);
  };

  // Emergency controls confirm first and show their blast radius; ordinary
  // switches apply instantly.
  const requestToggle = (path: string, label: string) => {
    const on = Boolean(get(s, path));
    const v = !on;
    const meta = EMERGENCY.find((e) => e.path === path);
    if (!meta) {
      commitToggle(path, v);
      return;
    }
    setConfirmTyped("");
    setConfirm({
      title: `${v ? "Activate" : "Release"} ${label.toLowerCase()}`,
      change: `${label}: ${on ? "ON" : "OFF"} → ${v ? "ON" : "OFF"}`,
      consequences: v
        ? meta.consequences
        : [
            "Normal operation resumes for every user immediately",
            "Any blocked page or rejected order starts working again",
          ],
      confirmLabel: v ? `Activate ${label}` : `Release ${label}`,
      tone: v && meta.highRisk ? "danger" : "primary",
      requireText: v ? meta.requireText : undefined,
      onConfirm: () => {
        commitToggle(path, v);
        setConfirm(null);
      },
    });
  };

  const toggle = (label: string, path: string, hint?: string) => {
    const on = Boolean(get(s, path));
    return (
      <button
        disabled={!canEdit}
        onClick={() => requestToggle(path, label)}
        className={`flex min-h-[44px] items-center justify-between gap-3 rounded-lg border px-3 text-left disabled:opacity-50 ${
          on ? "border-brand/30 bg-brand/10" : "border-border bg-card"
        }`}
      >
        <span>
          <span className="block text-[13px] font-semibold text-foreground">
            {label}
          </span>
          {hint ? (
            <span className="block text-[12px] font-normal text-muted-foreground">
              {hint}
            </span>
          ) : null}
        </span>
        <span
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-brand" : "bg-muted-foreground/40"}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`}
          />
        </span>
      </button>
    );
  };

  /** One-shot action (as opposed to a setting): runs server-side and reports. */
  const action = (label: string, hint: string, url: string) => (
    <button
      disabled={!canEdit || busyAction}
      onClick={async () => {
        setBusyAction(true);
        setSaved("");
        setErr("");
        try {
          const r = await fetch(url, { method: "POST" });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) setErr(j.error || "Action failed");
          else
            setSaved(`${label}: ${j.swept ?? 0} closed — ${j.why || "done"}`);
        } catch (e: any) {
          setErr(e?.message || "Action failed");
        } finally {
          setBusyAction(false);
          load();
        }
      }}
      className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 text-left hover:bg-muted disabled:opacity-50"
    >
      <span>
        <span className="block text-[13px] font-semibold text-foreground">
          {label}
        </span>
        <span className="block text-[12px] font-normal text-muted-foreground">
          {hint}
        </span>
      </span>
      <span className="shrink-0 text-[11px] font-mono text-muted-foreground">
        {busyAction ? "…" : "RUN"}
      </span>
    </button>
  );

  const text = (label: string, path: string) => (
    <Field label={label}>
      <input
        value={get(s, path) ?? ""}
        disabled={!canEdit}
        onChange={(e) => set(path, e.target.value)}
        onBlur={() => save({ [root(path)]: get(s, root(path)) } as Settings)}
        className={inputCls}
      />
    </Field>
  );

  // Plain select bound to a settings path. Commits on change (there is no blur
  // to wait for) using the same nested-patch shape as the other fields.
  const select = (
    label: string,
    path: string,
    options: { value: string; label: string }[],
  ) => (
    <Field label={label}>
      <select
        value={String(get(s, path) ?? "")}
        disabled={!canEdit}
        onChange={(e) => {
          const v = Number(e.target.value);
          set(path, v);
          save(patchFor(path, v) as Settings);
        }}
        className={inputCls}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );

  const live = stats?.upstox ? true : false;
  const emergencyActive = [
    s.maintenance,
    s.providerOff,
    s.trading?.haltFills,
  ].filter(Boolean).length;
  const tabMeta = NAV.find((n) => n.id === tab);
  const navGroups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter(
      (n) =>
        !navQ.trim() ||
        n.id.toLowerCase().includes(navQ.toLowerCase()) ||
        n.desc.toLowerCase().includes(navQ.toLowerCase()),
    ),
  })).filter((g) => g.items.length > 0);

  const sideNav = (onPick?: () => void) => (
    <nav className="flex-1 overflow-y-auto p-3">
      {navGroups.map((g) => (
        <div key={g.group} className="mb-3">
          <div className="px-3 pb-1.5 text-[10px] font-bold tracking-[0.12em] text-muted-foreground/70">
            {g.group.toUpperCase()}
          </div>
          {g.items.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                setTab(n.id);
                // Clear the menu filter: leaving it applied made the sidebar
                // collapse to a single entry (or nothing) after navigating,
                // which looked like the menu had vanished.
                setNavQ("");
                onPick?.();
              }}
              className={`mb-0.5 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition ${
                tab === n.id
                  ? "bg-brand text-brand-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[14px] ${
                  tab === n.id
                    ? "bg-brand-foreground/20 text-brand-foreground"
                    : "bg-muted/60 text-muted-foreground"
                }`}
              >
                {n.icon}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold">
                  {n.id}
                </span>
                <span
                  className={`block truncate text-[11px] ${
                    tab === n.id
                      ? "text-brand-foreground/90"
                      : "text-muted-foreground/70"
                  }`}
                >
                  {n.desc}
                </span>
              </span>
            </button>
          ))}
        </div>
      ))}
      {navGroups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
          <div className="text-[12px] text-muted-foreground/70">
            No menu matches “{navQ}”.
          </div>
          <button
            onClick={() => setNavQ("")}
            className="rounded-md border border-border bg-card px-2.5 py-1 text-[11.5px] font-semibold text-foreground/80 transition-colors hover:bg-muted/60"
          >
            Clear filter
          </button>
        </div>
      ) : null}
    </nav>
  );

  return (
    <div className="min-h-dvh bg-background text-foreground lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-[264px] shrink-0 flex-col border-r border-border bg-card lg:flex">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-lg font-black text-brand-foreground">
            T
          </div>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-bold tracking-tight text-foreground">
              TradeKaro Admin
            </div>
            <div className="text-[11px] text-muted-foreground">
              Operations · Risk · Access
            </div>
          </div>
        </div>
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Badge tone={role === "superadmin" ? "indigo" : "slate"}>
              {role.toUpperCase() || "—"}
            </Badge>
            <Badge tone={live ? "green" : "red"}>
              <span
                className={`h-1.5 w-1.5 rounded-full ${live ? "bg-positive" : "bg-negative"}`}
              />
              {live ? "UPSTOX LIVE" : "UPSTOX OFF"}
            </Badge>
          </div>
          <div className="mt-1.5 truncate text-[12px] text-muted-foreground">
            {email}
          </div>
          {emergencyActive ? (
            <button
              onClick={() => setTab("Overview")}
              className="mt-2 flex w-full items-center gap-2 rounded-md border border-negative/30 bg-negative/10 px-2.5 py-1.5 text-left transition-colors hover:bg-negative/15"
            >
              <FiAlertTriangle
                size={14}
                aria-hidden
                className="text-negative"
              />
              <span className="text-[11.5px] font-semibold text-negative">
                {emergencyActive} emergency control
                {emergencyActive > 1 ? "s" : ""} active
              </span>
            </button>
          ) : null}
          <div className="relative mt-2">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground/70">
              ⌕
            </span>
            <input
              value={navQ}
              onChange={(e) => setNavQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setNavQ("");
              }}
              placeholder="Filter menu…"
              aria-label="Filter menu"
              className={`${inputCls} pl-8 ${navQ ? "pr-9" : ""}`}
              style={{ minHeight: 36 }}
            />
            {navQ ? (
              <button
                onClick={() => setNavQ("")}
                aria-label="Clear menu filter"
                className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                ✕
              </button>
            ) : null}
          </div>
        </div>
        {sideNav()}
        <div className="flex gap-2 border-t border-border p-3">
          <button onClick={load} className={`${btnGhost} flex-1`}>
            Refresh
          </button>
          <button onClick={logout} className={`${btnDanger} flex-1`}>
            Sign out
          </button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
            <button
              onClick={() => setDrawer(true)}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground lg:hidden"
              aria-label="Open menu"
            >
              <FiList size={17} aria-hidden />
            </button>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-lg font-black text-brand-foreground lg:hidden">
              T
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground/70">
                <span>Home</span>
                <span>/</span>
                <span className="font-semibold text-foreground/80">{tab}</span>
              </div>
              <div className="truncate text-[15px] font-bold tracking-tight text-foreground">
                {tab}
                <span className="ml-2 hidden font-normal text-muted-foreground/70 sm:inline">
                  · {tabMeta?.desc}
                </span>
              </div>
            </div>
            <div className="hidden items-center gap-2 md:flex">
              {emergencyActive ? (
                <Badge tone="red">
                  <FiAlertTriangle size={12} aria-hidden /> EMERGENCY
                </Badge>
              ) : null}
              <Badge tone={live ? "green" : "red"}>
                {live ? "● LIVE" : "● OFF"}
              </Badge>
              <Badge tone="slate">
                calls {stats?.upstoxCalls ?? "—"} · hits {stats?.hits ?? "—"}
              </Badge>
            </div>
            {/* The console already inherits the app's theme tokens (see
                admin/layout.tsx) and ThemeProvider wraps it from the root
                layout, so the storefront's toggle works here unchanged. It
                was simply never mounted, which meant an operator had to go
                out to the public site to flip the theme. */}
            <ThemeToggle />
            <div className="hidden items-center gap-2 sm:flex">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/15 text-[13px] font-bold text-brand">
                {(email || "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden max-w-[140px] truncate text-[12px] font-medium text-muted-foreground xl:block">
                {email}
              </span>
            </div>
            <button
              onClick={logout}
              className="hidden min-h-[36px] rounded-md bg-negative px-3 text-[12px] font-semibold text-negative-foreground sm:block lg:hidden"
            >
              Sign out
            </button>
          </div>
          <nav className="flex gap-2 overflow-x-auto px-4 pb-2.5 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => setTab(n.id)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-semibold ${
                  tab === n.id
                    ? "border-brand bg-brand text-brand-foreground"
                    : "border-border bg-card text-muted-foreground"
                }`}
              >
                {n.id}
              </button>
            ))}
          </nav>
        </header>
        {s.maintenance ? (
          <div className="bg-negative px-4 py-2 text-[12px] font-semibold text-negative-foreground">
            MAINTENANCE MODE ON — users see blocked page
          </div>
        ) : null}
        {s.providerOff ? (
          <div className="border-b border-accent/30 bg-accent/10 px-4 py-2 text-[12px] font-semibold text-accent">
            PROVIDER KILL-SWITCH ON — Upstox calls halted
          </div>
        ) : null}
        {confirm ? (
          <ConfirmDialog
            spec={confirm}
            typed={confirmTyped}
            onTyped={setConfirmTyped}
            onCancel={() => setConfirm(null)}
          />
        ) : null}
        <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4 pb-24 sm:p-5">
          {err ? (
            <div className="rounded-lg border border-negative/30 bg-negative/10 px-3 py-2 text-[12px] font-semibold text-negative">
              {err}
            </div>
          ) : null}
          {saved ? (
            <div className="w-fit rounded-full bg-positive px-3 py-1 text-[11px] font-semibold text-positive-foreground">
              {saved} ✓
            </div>
          ) : null}

          {tab === "Overview" && (
            <>
              <PageHead
                title="Dashboard"
                sub="Platform health, quota usage and emergency controls."
                action={
                  <button onClick={load} className={btnGhost}>
                    ⟳ Refresh data
                  </button>
                }
              />
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <Kpi
                  label="UPSTOX FEED"
                  value={
                    stats?.feed?.connected ? "LIVE" : live ? "POLLING" : "OFF"
                  }
                  tone={stats?.feed?.connected ? "up" : "down"}
                  sub={
                    stats?.feed?.connected
                      ? `WS · ${stats.feed.subscribed} keys · ${stats.feed.messages} msgs`
                      : live
                        ? "Stream down — REST polling covers"
                        : "Kill-switch or no token"
                  }
                />
                <Kpi
                  label="UPSTOX CALLS"
                  value={String(stats?.upstoxCalls ?? "—")}
                  sub="This window"
                />
                <Kpi
                  label="CACHE HITS"
                  value={String(stats?.hits ?? "—")}
                  sub="Saved provider calls"
                />
                <Kpi
                  label="CACHE KEYS"
                  value={String(stats?.keys ?? "—")}
                  sub="Active entries"
                />
              </div>
              <Card
                title="Emergency controls"
                sub="Platform-wide kill-switches. Each one asks for confirmation and is written to the audit trail."
                action={
                  <div className="flex flex-wrap gap-1.5">
                    <StatusPill tone={s.maintenance ? "warn" : "ok"}>
                      {s.maintenance ? "SITE BLOCKED" : "SITE LIVE"}
                    </StatusPill>
                    <StatusPill tone={s.providerOff ? "warn" : "ok"}>
                      {s.providerOff ? "DATA HALTED" : "DATA LIVE"}
                    </StatusPill>
                    <StatusPill tone={s.trading.haltFills ? "warn" : "ok"}>
                      {s.trading.haltFills ? "FILLS HALTED" : "FILLS OPEN"}
                    </StatusPill>
                  </div>
                }
              >
                {s.maintenance || s.providerOff || s.trading.haltFills ? (
                  <Callout tone="warn" title="Platform is in a degraded state">
                    At least one emergency control is active. Users may see a
                    blocked page, frozen prices or rejected orders until it is
                    released.
                  </Callout>
                ) : (
                  <Callout tone="success" title="All systems normal">
                    Maintenance off · provider live · orders accepting
                  </Callout>
                )}

                <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border">
                  {EMERGENCY.map((e) => {
                    const on = Boolean(get(s, e.path));
                    return (
                      <div
                        key={e.path}
                        className={`flex items-start gap-3 p-3 transition-colors ${on ? "bg-negative/[0.06]" : ""}`}
                      >
                        <span
                          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${
                            on
                              ? "border-negative/30 bg-negative/10 text-negative"
                              : "border-border bg-muted/50 text-muted-foreground"
                          }`}
                        >
                          {on ? (
                            <FiAlertTriangle size={15} aria-hidden />
                          ) : (
                            <FiShield size={15} aria-hidden />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[13px] font-semibold text-foreground">
                              {e.label}
                            </span>
                            <Badge tone={on ? "red" : "green"}>
                              {on ? "ACTIVE" : "NORMAL"}
                            </Badge>
                            {e.highRisk ? (
                              <Badge tone="amber">CONFIRM REQUIRED</Badge>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                            {e.desc}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 pt-0.5">
                          <span className="hidden text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:block">
                            {on ? "On" : "Off"}
                          </span>
                          <Switch
                            label={e.label}
                            checked={on}
                            disabled={!canEdit}
                            tone={e.highRisk ? "danger" : "normal"}
                            onChange={() => requestToggle(e.path, e.label)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                {!canEdit ? (
                  <Callout tone="info">
                    Your role is read-only — ask a superadmin to change
                    emergency controls.
                  </Callout>
                ) : null}
              </Card>
              <Card
                title="System snapshot"
                sub="What the storefront is obeying right now."
                action={
                  <button onClick={load} className={btnGhost}>
                    Refresh
                  </button>
                }
              >
                <div className="grid gap-2 text-[12px] sm:grid-cols-2">
                  <SnapshotRow
                    k="Client poll"
                    v={`${s.clientPollMs} ms · hidden-pause ${s.hiddenTabPause ? "on" : "off"}`}
                  />
                  <SnapshotRow
                    k="Trade engine"
                    v={`${s.tradeEngineMs} ms · halt ${s.trading.haltFills ? "yes" : "no"}`}
                  />
                  <SnapshotRow
                    k="Market hours"
                    v={`${s.marketHours.open}–${s.marketHours.close} IST`}
                  />
                  <SnapshotRow
                    k="Chart default"
                    v={`${s.chartDefaults.tf} · ${s.chartDefaults.type}`}
                  />
                  <SnapshotRow
                    k="Trading"
                    v={`₹${Number(s.trading.startCash).toLocaleString("en-IN")} · max ${s.trading.maxQty}`}
                  />
                </div>
              </Card>
              <InstrumentMaster />
            </>
          )}

          {tab === "Keys & Access" && (
            <>
              <PageHead
                title="Keys & Access"
                sub="Provider credentials and console operators."
              />
              <Card
                title="Upstox token"
                sub="Superadmin only. Masked everywhere except the last 4."
              >
                <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
                  Current:{" "}
                  <span className="font-mono font-semibold text-foreground">
                    {s.upstoxToken || "env fallback"}
                  </span>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={tokenDraft}
                    onChange={(e) => setTokenDraft(e.target.value)}
                    placeholder="paste new token, then ROTATE"
                    disabled={role !== "superadmin"}
                    type="password"
                    className={inputCls}
                  />
                  <button
                    disabled={role !== "superadmin" || !tokenDraft}
                    onClick={() => {
                      save({ upstoxToken: tokenDraft });
                      setTokenDraft("");
                    }}
                    className={btnPrimary}
                  >
                    ROTATE
                  </button>
                </div>
                <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
                  Feed token:{" "}
                  <span className="font-mono font-semibold text-foreground">
                    {s.feedToken || "same as API token"}
                  </span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    Used by the live WebSocket stream. Leave empty to reuse the
                    API token above. Paste a fresh one daily if yours expires.
                  </span>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={feedDraft}
                    onChange={(e) => setFeedDraft(e.target.value)}
                    placeholder="paste feed token, then ROTATE"
                    disabled={role !== "superadmin"}
                    type="password"
                    className={inputCls}
                  />
                  <button
                    disabled={role !== "superadmin" || !feedDraft}
                    onClick={() => {
                      save({ feedToken: feedDraft });
                      setFeedDraft("");
                    }}
                    className={btnPrimary}
                  >
                    ROTATE
                  </button>
                </div>
                {toggle(
                  "Provider kill-switch",
                  "providerOff",
                  "halts all Upstox calls",
                )}
                <AdminUsers canEdit={canEdit} />
              </Card>
              <ChangePassword />
            </>
          )}

          {tab === "Polling & Cache" && (
            <>
              <PageHead
                title="Polling & Cache"
                sub="Higher TTL = fewer Upstox calls. Client poll drives every live price."
              />
              <Card title="Cache TTL (ms)" sub="Per-endpoint cache windows.">
                <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                  {num("Quote", "ttl.quote")}
                  {num("Chain", "ttl.chain")}
                  {num("Candles", "ttl.candles")}
                  {num("Expiries", "ttl.expiries")}
                </div>
              </Card>
              <Card title="Poll intervals" sub="How often clients refresh.">
                <div className="grid grid-cols-2 gap-2">
                  {num("Client poll ms", "clientPollMs")}
                  {num("TradeEngine ms", "tradeEngineMs")}
                </div>
                {toggle("Hidden-tab pause", "hiddenTabPause")}
                <div>
                  <button
                    disabled={!canEdit}
                    onClick={() =>
                      save({
                        ttl: s.ttl,
                        clientPollMs: s.clientPollMs,
                        tradeEngineMs: s.tradeEngineMs,
                        hiddenTabPause: s.hiddenTabPause,
                      })
                    }
                    className={btnPrimary}
                  >
                    SAVE POLLING
                  </button>
                </div>
              </Card>
            </>
          )}

          {tab === "Scrips & Lists" && (
            <>
              <PageHead
                title="Scrips & Lists"
                sub="Controls ticker tape and watchlist defaults everywhere."
              />
              <Card
                title="Ticker tape"
                sub={`${(s.tape || []).length} symbols · comma separated`}
              >
                <ScripFilter
                  label="Ticker tape symbols"
                  value={(s.tape || []).join(", ")}
                  disabled={!canEdit}
                  onSave={(v) =>
                    save({
                      tape: v
                        .split(",")
                        .map((x: string) => x.trim().toUpperCase())
                        .filter(Boolean),
                    })
                  }
                />
              </Card>
              <Card
                title="Watchlist rail"
                sub={`${(s.rail || []).length} symbols · comma separated`}
              >
                <ScripFilter
                  label="Watchlist rail defaults"
                  value={(s.rail || []).join(", ")}
                  disabled={!canEdit}
                  onSave={(v) =>
                    save({
                      rail: v
                        .split(",")
                        .map((x: string) => x.trim().toUpperCase())
                        .filter(Boolean),
                    })
                  }
                />
              </Card>
            </>
          )}

          {tab === "Charts & Market" && (
            <>
              <PageHead
                title="Charts & Market"
                sub="New-visitor defaults, candle history depth, market hours."
              />
              <Card
                title="Chart defaults"
                sub="Applied to first-time visitors."
              >
                <div className="text-[12px] font-semibold text-muted-foreground">
                  DEFAULT TIMEFRAME
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["day", "1m", "5m", "15m", "week"] as string[]).map((t) => (
                    <button
                      key={t}
                      disabled={!canEdit}
                      onClick={() =>
                        save({ chartDefaults: { ...s.chartDefaults, tf: t } })
                      }
                      className={`min-h-[36px] rounded-md border px-3 text-[12px] font-semibold ${s.chartDefaults.tf === t ? "border-brand bg-brand text-brand-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted/50"}`}
                    >
                      {t.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div className="text-[12px] font-semibold text-muted-foreground">
                  DEFAULT INDICATORS
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["sma", "ema", "vwap", "rsi", "compare"] as const).map(
                    (k) => (
                      <button
                        key={k}
                        disabled={!canEdit}
                        onClick={() =>
                          save({
                            chartDefaults: {
                              ...s.chartDefaults,
                              [k]: !s.chartDefaults[k],
                            },
                          })
                        }
                        className={`min-h-[36px] rounded-md border px-3 text-[12px] font-semibold ${s.chartDefaults[k] ? "border-brand/30 bg-brand/10 text-brand" : "border-border bg-card text-muted-foreground hover:bg-muted/50"}`}
                      >
                        {k.toUpperCase()}
                      </button>
                    ),
                  )}
                </div>
              </Card>
              <Card
                title="Candle windows"
                sub="History depth per timeframe (days)."
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  {Object.keys(s.candleWindows || {}).map((k) => (
                    <div
                      key={k}
                      className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px]"
                    >
                      <span className="w-10 font-bold text-foreground">
                        {k}
                      </span>
                      <input
                        type="number"
                        value={s.candleWindows[k].days}
                        disabled={!canEdit}
                        onChange={(e) => {
                          const n = {
                            ...s.candleWindows,
                            [k]: {
                              ...s.candleWindows[k],
                              days: Number(e.target.value),
                            },
                          };
                          setS({ ...s, candleWindows: n });
                        }}
                        onBlur={() => save({ candleWindows: s.candleWindows })}
                        className={`${inputCls} min-h-[38px]`}
                      />
                      <span className="text-muted-foreground/70">
                        {s.candleWindows[k].bucketMin}m
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
              <Card
                title="Market hours (IST)"
                sub="Fallback window, used only when the exchange calendar is unavailable."
              >
                <div className="grid grid-cols-2 gap-2">
                  {text("Open HH:MM", "marketHours.open")}
                  {text("Close HH:MM", "marketHours.close")}
                </div>
                <Callout tone="info">
                  Live sessions come from the exchange, per segment: NSE
                  09:15–15:30, NFO until 15:40, MCX and NSE commodities until
                  23:30. These two fields are only the fallback for when that
                  feed is unreachable.
                </Callout>
                <ExchangeHolidays />
              </Card>
            </>
          )}

          {tab === "Trading & Risk" && (
            <>
              <PageHead
                title="Trading & Risk"
                sub="Funds, order guards, brokerage, KYC deposit gate."
                action={
                  <button
                    disabled={!canEdit}
                    onClick={() => save({ trading: s.trading })}
                    className={btnPrimary}
                  >
                    SAVE TRADING RULES
                  </button>
                }
              />
              <Card title="Funds & limits" sub="Caps applied to every order.">
                <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
                  {num("Starting capital ₹", "trading.startCash")}
                  {num("Max qty/order", "trading.maxQty")}
                  {num("Max positions", "trading.maxPositions")}
                  {num("Brokerage flat ₹", "trading.brokerageFlat")}
                  {num("Brokerage %", "trading.brokeragePct")}
                  {num("Margin % (5 = 20x)", "trading.marginPct")}
                </div>
                <Callout tone="info">
                  Margin is the deposit required to open a position:{" "}
                  {Number(s.trading?.marginPct) || 5}% of trade value ⇒ up to{" "}
                  {Math.round(
                    (100 / (Number(s.trading?.marginPct) || 5)) * 10,
                  ) / 10}
                  x leverage. Lower % = bigger positions = faster blow-ups.
                  Override it for one client in Users &amp; KYC → OPEN.
                </Callout>
              </Card>
              <Card title="Risk switches" sub="Instant guards.">
                {toggle("Allow short-sell", "trading.allowShort")}
                {toggle("HALT all fills", "trading.haltFills", "kill switch")}
                {toggle(
                  "Allow orders after hours",
                  "trading.allowAfterHours",
                  `orders are refused outside ${s.marketHours.open}–${s.marketHours.close} unless this is on`,
                )}
                {toggle(
                  "Auto square-off MIS",
                  "trading.autoSquareOff",
                  "closes intraday positions at the cutoff",
                )}
                {text("MIS square-off time (IST)", "trading.squareOffTime")}
                {toggle(
                  "Fractional commodity lots",
                  "trading.fractionalLots",
                  "allows orders down to one quoted unit (0.01 of a 100-unit gold lot)",
                )}
                <Callout tone="info">
                  On: a customer can buy 1 unit of gold (10 g) instead of a
                  whole 1 kg lot. A whole MCX gold lot is about ₹1.53 crore, so
                  whole-lot-only puts most commodities out of reach on a
                  practice balance. Off: the paper book mirrors the exchange
                  exactly and accepts whole lots only. Fractions of a{" "}
                  <em>unit</em> are always refused either way.
                </Callout>
                {action(
                  "Square off intraday legs now",
                  "Runs the risk sweep immediately. Does nothing before the cutoff — it never closes a leg the customer is still entitled to hold.",
                  "/api/admin/mis-sweep",
                )}
              </Card>
              <Card
                title="KYC eligibility"
                sub="How much a user must deposit before KYC unlocks for them."
              >
                <div className="grid grid-cols-2 gap-2">
                  {select("Deposit required", "kyc.minDeposit", [
                    ...KYC_DEPOSIT_PRESETS.map((v) => ({
                      value: String(v),
                      label:
                        v === 0
                          ? "Off — KYC open to everyone"
                          : `₹${v.toLocaleString("en-IN")}`,
                    })),
                    // Keep a hand-typed amount selectable instead of the
                    // control silently snapping back to a preset.
                    ...customPresetOption(Number(s.kyc?.minDeposit)),
                  ])}
                  {num("Or exact ₹", "kyc.minDeposit")}
                </div>
                <Callout tone={Number(s.kyc?.minDeposit) > 0 ? "info" : "warn"}>
                  {Number(s.kyc?.minDeposit) > 0 ? (
                    <>
                      A user can complete KYC only once their total deposits
                      reach{" "}
                      <span className="font-semibold">
                        ₹{Number(s.kyc.minDeposit).toLocaleString("en-IN")}
                      </span>
                      . They see their own progress on the KYC page — for
                      example “₹500 deposited · ₹24,500 left” — and the form
                      stays locked until the goal is met. Deposits are recorded
                      server-side, either from the Funds panel or by you in
                      Users &amp; KYC → <code>OPEN</code> →{" "}
                      <em>Credit deposit</em>, and they also raise that
                      user&apos;s trading capital.
                    </>
                  ) : (
                    <>
                      The gate is OFF: every user can complete KYC immediately,
                      whatever they have deposited. Set an amount to require
                      funding first.
                    </>
                  )}
                </Callout>
              </Card>
              <Card
                title="Online payments"
                sub="Moved to Finance — the gateway, the orders, the pay-outs and every callback now live on one page."
              >
                <Callout tone={s.payments?.enabled ? "warn" : "info"}>
                  {s.payments?.enabled ? (
                    <>
                      Online payments are <strong>ON</strong> and this platform
                      is taking real money. Keys, limits and the callback log
                      are all under <strong>Finance</strong>.
                    </>
                  ) : (
                    <>
                      Off — no gateway call is made and the Funds panel keeps
                      its existing self-service funding button. Configure and
                      switch it on under <strong>Finance</strong>.
                    </>
                  )}
                </Callout>
              </Card>
            </>
          )}

          {tab === "Orders & Alerts" && (
            <>
              <PageHead
                title="Orders & Alerts"
                sub="Ticket defaults and per-user alert caps."
                action={
                  <button
                    disabled={!canEdit}
                    onClick={() =>
                      save({
                        orderDefaults: s.orderDefaults,
                        alertLimits: s.alertLimits,
                      })
                    }
                    className={btnPrimary}
                  >
                    SAVE
                  </button>
                }
              />
              <Card title="Ticket defaults" sub="Applied to new order tickets.">
                <div className="grid grid-cols-2 gap-2">
                  {num("Default qty", "orderDefaults.defaultQty")}
                  {num("Max alerts/user", "alertLimits.maxPerUser")}
                </div>
                {toggle(
                  "Confirm orders default",
                  "orderDefaults.confirmOrders",
                )}
              </Card>
            </>
          )}

          {tab === "Analytics" && <AnalyticsSection />}
          {/* Money has its own page: an operator asked "did this payment land?"
              needs the order, the callback and the ledger on one screen. */}
          {tab === "Finance" && (
            <FinanceSection s={s} save={save} canEdit={canEdit} role={role} />
          )}
          {tab === "Users & KYC" && <UsersSection canEdit={canEdit} />}
          {tab === "Sessions" && (
            <SessionsSection canEdit={canEdit} selfEmail={email} />
          )}

          {tab === "Content" && (
            <>
              <PageHead
                title="Content"
                sub="Maintenance page + announcement banner for all users."
                action={
                  <button
                    disabled={!canEdit}
                    onClick={() =>
                      save({ maintenance: s.maintenance, banner: s.banner })
                    }
                    className={btnPrimary}
                  >
                    SAVE CONTENT
                  </button>
                }
              />
              <Card title="Site state" sub="Global visibility controls.">
                {toggle(
                  "Maintenance mode",
                  "maintenance",
                  "blocks app with notice",
                )}
                <Field label="Announcement banner (empty = hidden)">
                  <textarea
                    value={s.banner || ""}
                    disabled={!canEdit}
                    rows={2}
                    onChange={(e) => set("banner", e.target.value)}
                    onBlur={() => save({ banner: s.banner })}
                    className={`${inputCls} min-h-[72px] py-2`}
                  />
                </Field>
              </Card>
            </>
          )}

          {tab === "Logs" && <LogsSection audit={audit} />}
        </main>
      </div>
      {drawer ? (
        <div className="fixed inset-0 z-30 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setDrawer(false)}
          />
          <div className="absolute left-0 top-0 flex h-full w-[280px] flex-col border-r border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-black text-brand-foreground">
                  T
                </div>
                <div className="text-[14px] font-bold text-foreground">
                  TradeKaro Admin
                </div>
              </div>
              <button
                onClick={() => setDrawer(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground"
              >
                ✕
              </button>
            </div>
            {sideNav(() => setDrawer(false))}
            <div className="border-t border-border p-3 text-[11px] text-muted-foreground">
              {email} · {role}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SnapshotRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
      <span className="text-[11px] font-semibold tracking-wide text-muted-foreground">
        {k.toUpperCase()}
      </span>
      <span className="truncate text-[12px] font-semibold text-foreground">
        {v}
      </span>
    </div>
  );
}

function get(o: any, path: string) {
  return path.split(".").reduce((a, k) => a?.[k], o);
}
function root(path: string) {
  return path.split(".")[0];
}
function leaf(path: string) {
  const p = path.split(".");
  return p[p.length - 1];
}

function CsvEdit({
  label,
  value,
  onSave,
  disabled,
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
  disabled?: boolean;
}) {
  const [v, setV] = useState(value);
  useEffect(() => {
    setV(value);
  }, [value]);
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <input
          value={v}
          disabled={disabled}
          onChange={(e) => setV(e.target.value)}
          className={inputCls}
        />
        <button
          disabled={disabled}
          onClick={() => onSave(v)}
          className={btnPrimary}
        >
          SAVE
        </button>
      </div>
    </Field>
  );
}

function ScripFilter({
  label,
  value,
  onSave,
  disabled,
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
  disabled?: boolean;
}) {
  const [v, setV] = useState(value);
  useEffect(() => {
    setV(value);
  }, [value]);
  const list = useMemo(
    () =>
      v
        .split(",")
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean),
    [v],
  );
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <input
          value={v}
          disabled={disabled}
          onChange={(e) => setV(e.target.value.toUpperCase())}
          placeholder="RELIANCE, TCS, NIFTY…"
          className={`${inputCls} font-mono`}
        />
        <button
          disabled={disabled}
          onClick={() => onSave(v)}
          className={btnDark}
        >
          SAVE
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {list.slice(0, 12).map((s: string) => (
          <button
            key={s}
            disabled={disabled}
            onClick={() => {
              const next = list.filter((x: string) => x !== s).join(", ");
              setV(next);
              onSave(next);
            }}
            title="Remove"
            className="rounded-md bg-muted px-2 py-0.5 font-mono text-[11px] font-semibold text-foreground/80 hover:bg-negative/10 hover:text-negative"
          >
            {s} ✕
          </button>
        ))}
        <span className="text-[11px] text-muted-foreground/70">
          {list.length} scrip{list.length === 1 ? "" : "s"} · comma separated
        </span>
      </div>
    </Field>
  );
}

// Friendly names for the validator's reason codes.
const REJECT_LABEL: Record<string, string> = {
  maintenance: "Maintenance mode",
  provider_off: "Provider halted",
  halt_fills: "Fills halted (kill switch)",
  market_closed: "Order placed outside market hours",
  mis_window_closed: "New intraday leg after square-off cutoff",
  symbol_missing: "Missing symbol",
  bad_qty: "Invalid quantity",
  bad_price: "Invalid price",
  qty_cap: "Quantity cap",
  no_ref_price: "No live price to verify against",
  price_moved: "Price moved (stale ticket)",
  short_disabled: "Shorting disabled",
  position_cap: "Position limit reached",
  insufficient_margin: "Insufficient margin",
};

function BarRow({
  label,
  value,
  max,
  note,
  tone = "bg-brand",
}: {
  label: string;
  value: number;
  max: number;
  note?: string;
  tone?: string;
}) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3 text-[12px]">
      <span className="w-28 shrink-0 truncate font-medium text-foreground/80">
        {label}
      </span>
      <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <span
          className={`block h-full rounded-full ${tone}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="w-14 shrink-0 text-right font-mono tabular-nums text-foreground">
        {num(value)}
      </span>
      {note ? (
        <span className="hidden w-28 shrink-0 text-right text-muted-foreground sm:block">
          {note}
        </span>
      ) : null}
    </div>
  );
}

/** Retention heat cell. `future` marks a week that has not happened yet. */
function Cel({ pct, n, future }: { pct: number; n: number; future?: boolean }) {
  if (future)
    return (
      <span className="font-mono text-[11.5px] text-muted-foreground/40">
        ·
      </span>
    );
  const tone =
    pct >= 60
      ? "bg-positive/15 text-positive"
      : pct >= 30
        ? "bg-accent/15 text-accent"
        : "bg-muted/60 text-muted-foreground";
  return (
    <span
      className={`inline-flex min-w-[44px] justify-center rounded px-1.5 py-0.5 font-mono text-[11.5px] tabular-nums ${tone}`}
      title={`${n} of the cohort traded that week`}
    >
      {pct.toFixed(0)}%
    </span>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-0.5 font-mono text-[15px] font-bold tabular-nums ${tone || "text-foreground"}`}
      >
        {value}
      </div>
    </div>
  );
}

function AnalyticsSection() {
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");

  async function load() {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/admin/analytics", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed to load analytics");
      setD(j);
    } catch (e: any) {
      setErr(e?.message || "Failed to load analytics");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (busy && !d)
    return (
      <Card title="Analytics" sub="Loading platform metrics…">
        <span className="text-[12px] text-muted-foreground">Loading…</span>
      </Card>
    );
  if (err && !d)
    return (
      <Card title="Analytics">
        <Callout tone="danger" title="Error">
          {err}
        </Callout>
      </Card>
    );
  if (!d) return null;

  const a = d.accounts;
  const act = d.activity;
  const f = d.funnel;
  const t = d.trading;

  const funnelStages = [
    { label: "Registered", n: f.registered, hint: "accounts created" },
    { label: "Activated", n: f.activated, hint: "placed ≥1 trade" },
    { label: "Retained", n: f.retained, hint: "traded last 7 days" },
    { label: "Active", n: f.heavy, hint: "5+ lifetime fills" },
  ];
  const maxFunnel = Math.max(1, f.registered);

  const daily = d.daily || [];
  const maxDaily = Math.max(1, ...daily.map((x: any) => x.fills || 0));

  const hourMap = new Map<number, number>(
    (d.hours || []).map((h: any) => [Number(h.hour), Number(h.fills)]),
  );
  const hours = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    fills: hourMap.get(i) || 0,
  }));
  const maxHour = Math.max(1, ...hours.map((h) => h.fills));

  const syms = d.topSymbols || [];
  const maxSym = Math.max(1, ...syms.map((s: any) => s.fills || 0));
  const mix = d.productMix || [];
  const maxMix = Math.max(1, ...mix.map((m: any) => m.fills || 0));

  const slip = d.slippage;
  const maxBucket = Math.max(1, ...slip.buckets.map((b: any) => b.n || 0));
  const rej = d.rejects;
  const maxRej = Math.max(1, ...(rej.byReason || []).map((r: any) => r.n || 0));

  const risk = d.risk || {};
  const rt = risk.totals || {};
  const cohorts = d.cohorts || [];
  const bySymbol = risk.bySymbol || [];
  const topClients = risk.topClients || [];
  const weekAge = (ws: number) =>
    Math.floor((Date.now() - ws) / (7 * 86_400_000));

  return (
    <>
      <PageHead
        title="Analytics"
        sub="Read-only aggregates over the fill ledger and the client registry. Nothing here writes."
        action={
          <button onClick={load} className={btnGhost} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      {/* ── activity ── */}
      <Group title="Who is on the platform">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi
            label="Live now"
            value={num(act.liveNow)}
            sub="heartbeat in last 5 min"
            tone={act.liveNow > 0 ? "up" : "muted"}
          />
          <Kpi label="DAU" value={num(act.dau)} sub="heartbeat today (IST)" />
          <Kpi label="WAU" value={num(act.wau)} sub="heartbeat, last 7 days" />
          <Kpi label="MAU" value={num(act.mau)} sub="heartbeat, last 30 days" />
        </div>
        <Callout tone="info" title="How these are measured">
          Activity comes from the browser heartbeat, so it only counts accounts
          that have actually loaded the app. Trading numbers below come from the
          server-side fill ledger and include API-placed orders.
        </Callout>
        <Card
          title="Accounts"
          sub="Registration is the identity source; sign-in state comes from the heartbeat registry."
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat label="Registered" value={num(a.total)} />
            <Stat label="Signed in" value={num(a.signedIn)} />
            <Stat
              label="Never signed in"
              value={num(a.neverSignedIn)}
              tone={a.neverSignedIn > 0 ? "text-accent" : undefined}
            />
            <Stat label="New today" value={num(a.newToday)} />
            <Stat label="New 30d" value={num(a.new30d)} />
          </div>
          <div className="text-[11.5px] text-muted-foreground">
            {num(act.logins)} total logins across {num(a.signedIn)} accounts
            that have signed in · {num(a.new7d)} new in the last 7 days.
          </div>
        </Card>
      </Group>

      {/* ── funnel ── */}
      <Group title="Activation funnel">
        <Card
          title="Registered → Activated → Retained → Active"
          sub="Every step is already recorded, so this needs no extra instrumentation."
        >
          <div className="flex flex-col gap-2.5">
            {funnelStages.map((s) => (
              <BarRow
                key={s.label}
                label={s.label}
                value={s.n}
                max={maxFunnel}
                note={`${f.registered > 0 ? ((s.n / f.registered) * 100).toFixed(0) : 0}% · ${s.hint}`}
              />
            ))}
          </div>
          {f.neverTraded > 0 ? (
            <Callout
              tone="warn"
              title={`${f.neverTraded} registered, never traded`}
            >
              These accounts signed up but never placed a fill — usually the
              place to look first when activation is the problem.
            </Callout>
          ) : null}
        </Card>
      </Group>

      {/* ── trading ── */}
      <Group title="Trading activity">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi
            label="Fills today"
            value={num(t.fillsToday)}
            sub={`of ${num(t.fills)} all time`}
          />
          <Kpi
            label="Traded today"
            value={num(t.tradersToday)}
            sub={`of ${num(t.traders)} accounts ever`}
          />
          <Kpi
            label="Turnover today"
            value={money(t.turnoverToday)}
            sub={`of ${money(t.turnover)} all time`}
          />
          <Kpi
            label="Charges today"
            value={money(t.chargesToday)}
            sub={`avg ticket ${money(t.avgTicket)}`}
          />
        </div>

        <Card title="Last 14 days" sub="Fills per IST day, with turnover.">
          {daily.length === 0 ? (
            <span className="text-[12px] text-muted-foreground">
              No fills in the last 14 days.
            </span>
          ) : (
            <div className="flex flex-col gap-2">
              {daily.map((x: any) => (
                <BarRow
                  key={x.day}
                  label={x.day}
                  value={x.fills}
                  max={maxDaily}
                  note={`${money(x.turnover)} · ${x.traders} trader${x.traders === 1 ? "" : "s"}`}
                />
              ))}
            </div>
          )}
        </Card>

        <div className="grid gap-3 lg:grid-cols-2">
          <Card title="Most traded" sub="Last 30 days by fill count.">
            {syms.length === 0 ? (
              <span className="text-[12px] text-muted-foreground">
                No fills in the last 30 days.
              </span>
            ) : (
              <div className="flex flex-col gap-2">
                {syms.map((s: any) => (
                  <BarRow
                    key={s.symbol}
                    label={s.symbol}
                    value={s.fills}
                    max={maxSym}
                    note={`${money(s.value)} · ${s.traders} acct${s.traders === 1 ? "" : "s"}`}
                  />
                ))}
              </div>
            )}
          </Card>

          <Card
            title="Peak trading hours"
            sub="Fills by IST hour over the last 30 days."
          >
            <div className="flex h-24 items-end gap-[2px]">
              {hours.map((h) => {
                const active = h.fills > 0;
                return (
                  <div
                    key={h.hour}
                    className={`min-w-0 flex-1 rounded-t ${active ? "bg-brand" : "bg-border/50"}`}
                    style={{
                      // Inactive hours keep a thin stub so the row reads as a
                      // baseline instead of a dotted line; busy hours get a floor
                      // so a single fill is still visible.
                      height: active
                        ? `${Math.max(8, Math.round((h.fills / maxHour) * 100))}%`
                        : "2px",
                    }}
                    title={`${String(h.hour).padStart(2, "0")}:00 IST — ${h.fills} fill${h.fills === 1 ? "" : "s"}`}
                  />
                );
              })}
            </div>
            <div className="flex justify-between font-mono text-[10.5px] text-muted-foreground">
              <span>00</span>
              <span>06</span>
              <span>09:15 open</span>
              <span>15:30 close</span>
              <span>23</span>
            </div>
            <div className="flex flex-col gap-2 pt-1">
              {mix.map((m: any) => (
                <BarRow
                  key={m.product}
                  label={m.product === "MIS" ? "MIS (intraday)" : "CNC (carry)"}
                  value={m.fills}
                  max={maxMix}
                  note={money(m.value)}
                />
              ))}
            </div>
          </Card>
        </div>
      </Group>

      {/* ── execution quality ── */}
      <Group title="Execution quality">
        <Card
          title="Fill price vs validated reference"
          sub="Every fill is checked within 3% of the server's own live price, and that reference is stored next to it. Positive = adverse (paid above / sold below the benchmark)."
        >
          {slip.samples === 0 ? (
            <span className="text-[12px] text-muted-foreground">
              No fills with a stored reference price yet.
            </span>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-4">
                <Stat
                  label="Avg deviation"
                  value={`${slip.avgBps >= 0 ? "+" : ""}${slip.avgBps.toFixed(1)} bps`}
                  tone={slip.avgBps > 0 ? "text-negative" : "text-positive"}
                />
                <Stat
                  label="Worst"
                  value={`${slip.worstBps > 0 ? "+" : ""}${slip.worstBps.toFixed(0)} bps`}
                  tone={
                    slip.worstBps > 0
                      ? "text-negative"
                      : "text-muted-foreground"
                  }
                />
                <Stat
                  label="Best"
                  value={`${slip.bestBps.toFixed(0)} bps`}
                  tone="text-positive"
                />
              </div>
              <div className="flex flex-col gap-2 pt-1">
                {slip.buckets.map((b: any) => (
                  <BarRow
                    key={b.label}
                    label={b.label}
                    value={b.n}
                    max={maxBucket}
                    note={`${slip.samples > 0 ? ((b.n / slip.samples) * 100).toFixed(0) : 0}%`}
                    tone={
                      b.tone === "up"
                        ? "bg-positive"
                        : b.tone === "down"
                          ? "bg-negative"
                          : b.tone === "warn"
                            ? "bg-accent"
                            : "bg-border"
                    }
                  />
                ))}
              </div>
              <div className="text-[11.5px] text-muted-foreground">
                Based on {num(slip.samples)} fills. A cluster in the high
                buckets means users are firing stale tickets — the ticket
                refresh window is the thing to tune.
              </div>
            </>
          )}
        </Card>
      </Group>

      {/* ── rejections ── */}
      <Group title="Rejected orders">
        <div className="grid grid-cols-3 gap-3">
          <Kpi
            label="Total"
            value={num(rej.total)}
            sub="all time"
            tone="muted"
          />
          <Kpi label="Last 7 days" value={num(rej.last7)} />
          <Kpi label="Today" value={num(rej.today)} />
        </div>

        <Card
          title="Why orders fail"
          sub="Each rejection is now persisted with a reason code — previously the reason was returned to the browser and discarded."
        >
          {(rej.byReason || []).length === 0 ? (
            <span className="text-[12px] text-muted-foreground">
              No rejections recorded yet.
            </span>
          ) : (
            <div className="flex flex-col gap-2">
              {rej.byReason.map((r: any) => (
                <BarRow
                  key={r.reason}
                  label={REJECT_LABEL[r.reason] || r.reason}
                  value={r.n}
                  max={maxRej}
                  note={
                    r.last
                      ? new Date(r.last).toLocaleString("en-IN", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : ""
                  }
                  tone="bg-negative"
                />
              ))}
            </div>
          )}
        </Card>

        {(rej.recent || []).length > 0 ? (
          <Card title="Recent refusals" sub="Newest first.">
            <TableWrap>
              <thead>
                <tr>
                  <th className={thCls}>When</th>
                  <th className={thCls}>Reason</th>
                  <th className={thCls}>Order</th>
                  <th className={thCls}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rej.recent.map((r: any, i: number) => (
                  <tr key={i} className={trCls}>
                    <td className={tdCls}>
                      <span className="font-mono text-[11.5px] text-muted-foreground">
                        {new Date(r.at).toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                    </td>
                    <td className={tdCls}>
                      <Badge tone="red">
                        {REJECT_LABEL[r.reason] || r.reason}
                      </Badge>
                    </td>
                    <td className={tdCls}>
                      <span className="font-mono text-[12px]">
                        {r.side} {num(r.qty)} {r.symbol} @ {money(r.price, 2)}
                      </span>
                    </td>
                    <td className={tdCls}>
                      <span className="font-mono text-[12px] text-muted-foreground">
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
        ) : null}
      </Group>

      {/* ── risk & exposure (phase 2) ── */}
      <Group title="Risk & exposure">
        {risk.truncated ? (
          <Callout tone="warn" title="Ledger truncated">
            There are more fills than this panel reads in one pass, so the
            per-client figures below are incomplete. Close the period being
            analysed or raise the cap.
          </Callout>
        ) : null}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi
            label="Open exposure"
            value={money(rt.exposure || 0)}
            sub={`${num(rt.openPositions || 0)} legs · ${num(rt.openClients || 0)} clients`}
          />
          <Kpi
            label="Margin used"
            value={money(rt.marginUsed || 0)}
            sub={`at ${num(risk.defaultPct || 100)}% default margin`}
          />
          <Kpi
            label="Free margin"
            value={money(rt.freeMargin || 0)}
            sub="summed across clients"
            tone={(rt.freeMargin || 0) >= 0 ? "up" : "down"}
          />
          <Kpi
            label="Open MTM"
            value={moneySigned(rt.mtm || 0)}
            sub="marked at last validated price"
            tone={(rt.mtm || 0) >= 0 ? "up" : "down"}
          />
        </div>

        <Card
          title="Platform book"
          sub="Open notional, long versus short. A large NET figure means the whole platform is leaning one way."
        >
          <div className="grid grid-cols-3 gap-4">
            <Stat
              label="Long"
              value={money(rt.longNotional || 0)}
              tone="text-positive"
            />
            <Stat
              label="Short"
              value={money(rt.shortNotional || 0)}
              tone="text-negative"
            />
            <Stat
              label="Net"
              value={moneySigned(rt.netNotional || 0)}
              tone={
                (rt.netNotional || 0) >= 0 ? "text-positive" : "text-negative"
              }
            />
          </div>
        </Card>

        <Card
          title="Concentration by symbol"
          sub="Share of total open notional. A single dominant row is the one position that would hurt platform-wide."
        >
          {bySymbol.length === 0 ? (
            <span className="text-[12px] text-muted-foreground">
              No open positions on the book.
            </span>
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className={thCls}>Symbol</th>
                  <th className={thCls}>Accounts</th>
                  <th className={thCls}>Long</th>
                  <th className={thCls}>Short</th>
                  <th className={thCls}>Net</th>
                  <th className={thCls}>Notional</th>
                  <th className={thCls}>Share</th>
                </tr>
              </thead>
              <tbody>
                {bySymbol.map((s: any) => (
                  <tr key={s.symbol} className={trCls}>
                    <td className={tdCls}>
                      <span className="font-mono text-[12px] font-semibold">
                        {s.symbol}
                      </span>
                    </td>
                    <td className={tdCls}>{num(s.accounts)}</td>
                    <td className={`${tdCls} text-positive`}>
                      {s.longQty ? num(s.longQty) : "—"}
                    </td>
                    <td className={`${tdCls} text-negative`}>
                      {s.shortQty ? num(s.shortQty) : "—"}
                    </td>
                    <td className={tdCls}>
                      <span className="font-mono tabular-nums">
                        {num(s.netQty)}
                      </span>
                    </td>
                    <td className={tdCls}>
                      <span className="font-mono tabular-nums">
                        {money(s.notional)}
                      </span>
                    </td>
                    <td className={tdCls}>
                      <div className="flex items-center gap-2">
                        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full bg-brand"
                            style={{
                              width: `${Math.max(2, Math.round(s.sharePct))}%`,
                            }}
                          />
                        </span>
                        <span className="font-mono text-[11.5px]">
                          {s.sharePct.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>

        <Card
          title="Client risk"
          sub="Top accounts by open exposure. Util = margin used as a share of that client's ledger, so a high figure means little room left."
        >
          {" "}
          {topClients.length === 0 ? (
            <span className="text-[12px] text-muted-foreground">
              No client activity yet.
            </span>
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className={thCls}>Client</th>
                  <th className={thCls}>Legs</th>
                  <th className={thCls}>Exposure</th>
                  <th className={thCls}>Margin</th>
                  <th className={thCls}>Free</th>
                  <th className={thCls}>Util</th>
                  <th className={thCls}>MTM</th>
                  <th className={thCls}>Realised today</th>
                </tr>
              </thead>
              <tbody>
                {topClients.map((c: any) => (
                  <tr key={c.id} className={trCls}>
                    <td className={tdCls}>
                      <span className="text-[12.5px] font-medium">
                        {c.name}
                      </span>
                    </td>
                    <td className={tdCls}>{num(c.positions)}</td>
                    <td className={tdCls}>
                      <span className="font-mono tabular-nums">
                        {money(c.exposure)}
                      </span>
                    </td>
                    <td className={tdCls}>
                      <span className="font-mono tabular-nums">
                        {money(c.marginUsed)}
                      </span>
                    </td>
                    <td
                      className={`${tdCls} ${c.freeMargin < 0 ? "text-negative" : ""}`}
                    >
                      <span className="font-mono tabular-nums">
                        {money(c.freeMargin)}
                      </span>
                    </td>
                    <td className={tdCls}>
                      <Badge
                        tone={
                          c.utilPct >= 80
                            ? "red"
                            : c.utilPct >= 50
                              ? "amber"
                              : "slate"
                        }
                      >
                        {c.utilPct.toFixed(0)}%
                      </Badge>
                    </td>
                    <td className={tdCls}>
                      <span
                        className={`font-mono tabular-nums ${c.mtm >= 0 ? "text-positive" : "text-negative"}`}
                      >
                        {moneySigned(c.mtm)}
                      </span>
                    </td>
                    <td className={tdCls}>
                      <span
                        className={`font-mono tabular-nums ${c.realizedToday >= 0 ? "text-positive" : "text-negative"}`}
                      >
                        {moneySigned(c.realizedToday)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
          <Callout
            tone="warn"
            title="Free margin here can exceed the client's Funds tab"
          >
            <code className="text-[11px]">deriveAccount</code> counts realised
            P&L only for scrips that are flat right now, so a scrip that was
            closed and later reopened loses its banked P&L. This panel banks
            realised the moment a scrip goes flat, which is why the two can
            differ by the completed round-trips sitting inside currently-open
            scrips. Exposure and margin match exactly. The client's figure is
            the one used to size orders, so treat it as the binding one.
          </Callout>
        </Card>
      </Group>

      {/* ── cohorts (phase 2) ── */}
      <Group title="Cohort retention">
        <Card
          title="Retention by signup week"
          sub="Share of each signup cohort that placed at least one fill N weeks after signing up. W0 is the week they registered."
        >
          {cohorts.length === 0 ? (
            <span className="text-[12px] text-muted-foreground">
              No cohorts to show yet.
            </span>
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className={thCls}>Week of</th>
                  <th className={thCls}>Size</th>
                  <th className={thCls}>W0</th>
                  <th className={thCls}>W1</th>
                  <th className={thCls}>W2</th>
                  <th className={thCls}>W3</th>
                  <th className={thCls}>W4</th>
                </tr>
              </thead>
              <tbody>
                {cohorts.map((c: any) => (
                  <tr key={c.weekStart} className={trCls}>
                    <td className={tdCls}>
                      <span className="text-[12.5px] font-medium">
                        {c.label}
                      </span>
                    </td>
                    <td className={tdCls}>
                      <span className="font-mono tabular-nums">{c.size}</span>
                    </td>
                    {c.offsets.map((o: any) => (
                      <td key={o.offset} className={tdCls}>
                        <Cel
                          pct={o.pct}
                          n={o.n}
                          future={o.offset > weekAge(c.weekStart)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
          <div className="text-[11.5px] text-muted-foreground">
            A cohort is only N weeks old once N weeks have passed, so recent
            cohorts show blanks for the future.
          </div>
        </Card>
      </Group>

      <div className="text-[11px] text-muted-foreground">
        Generated{" "}
        {new Date(d.at).toLocaleString("en-IN", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}
      </div>
    </>
  );
}

function LogsSection({ audit }: { audit: any[] }) {
  const [q, setQ] = useState("");
  const [action, setAction] = useState("ALL");
  const [page, setPage] = useState(0);
  const actions = useMemo(
    () => ["ALL", ...Array.from(new Set(audit.map((a) => a.action)))],
    [audit],
  );
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return audit.filter(
      (a) =>
        (action === "ALL" || a.action === action) &&
        (!needle ||
          `${a.email} ${a.action} ${a.detail || ""}`
            .toLowerCase()
            .includes(needle)),
    );
  }, [audit, q, action]);
  const per = 15;
  const slice = rows.slice(page * per, page * per + per);
  return (
    <>
      <PageHead
        title="Audit log"
        sub={`Every login, token rotate, and settings change · ${rows.length} of ${audit.length}`}
      />
      <Card title="Filters" sub="Narrow by action or free text.">
        <FilterBar>
          <select
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(0);
            }}
            className={selectCls}
          >
            {actions.map((a: string) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <SearchBox
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(0);
            }}
            onGo={() => setPage(0)}
            placeholder="Search email, action, detail…"
          />
        </FilterBar>
      </Card>
      <Card title={`Latest entries · ${rows.length}`} sub="Newest first.">
        <TableWrap>
          <table className="w-full min-w-[640px] text-left text-[12px]">
            <thead>
              <tr>
                <th className={thCls}>TIME</th>
                <th className={thCls}>ACTOR</th>
                <th className={thCls}>ACTION</th>
                <th className={thCls}>DETAIL</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((a: any, i: number) => (
                <tr key={i} className={trCls}>
                  <td
                    className={`${tdCls} whitespace-nowrap text-muted-foreground`}
                  >
                    {new Date(a.at).toLocaleString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className={`${tdCls} font-medium text-foreground`}>
                    {a.email}
                  </td>
                  <td className={tdCls}>
                    <Badge tone="indigo">{a.action}</Badge>
                  </td>
                  <td
                    className={`${tdCls} max-w-[320px] truncate font-mono text-[11px] text-muted-foreground`}
                  >
                    {a.detail || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        {!rows.length ? (
          <EmptyState
            title="No entries match"
            hint="Clear the filters to see the full log."
          />
        ) : null}
        <Pagination
          page={page}
          pages={Math.max(1, Math.ceil(rows.length / per))}
          total={rows.length}
          onPage={setPage}
        />
      </Card>
    </>
  );
}

function fmtDate(ms: number) {
  return new Date(ms).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtTtl(min: number) {
  if (min <= 0) return "expired";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m`;
}

// ── Sessions ──────────────────────────────────────────────────────────────
// Live admin sign-ins. Revoking someone else's session signs that browser out
// on its next request; revoking your own returns you to the login screen.
function SessionsSection({
  canEdit,
  selfEmail,
}: {
  canEdit: boolean;
  selfEmail: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [confirmTyped, setConfirmTyped] = useState("");

  async function load() {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/admin/sessions", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed to load sessions");
      setRows(j.sessions || []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load sessions");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function revoke(id: string) {
    setNote("");
    setErr("");
    const r = await fetch(`/api/admin/sessions?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr(j.error || "Revoke failed");
      return;
    }
    if (j.self) {
      router.push("/admin/login");
      return;
    }
    setNote("Session revoked");
    load();
  }

  async function revokeAll() {
    setNote("");
    setErr("");
    const r = await fetch("/api/admin/sessions?all=1", { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr(j.error || "Revoke failed");
      return;
    }
    setNote(`${j.revoked} session(s) revoked — this device stays signed in`);
    load();
  }

  function askRevoke(row: any) {
    setConfirmTyped("");
    setConfirm({
      title: row.current ? "Sign out this device" : "Revoke session",
      change: `${row.email} · ${row.ip} · started ${fmtDate(row.createdAt)}`,
      consequences: row.current
        ? ["You will be signed out of this console immediately"]
        : [
            "That browser loses console access on its next request",
            "Anything half-filled in that tab is lost",
          ],
      confirmLabel: row.current ? "Sign me out" : "Revoke session",
      tone: "danger",
      onConfirm: () => {
        setConfirm(null);
        revoke(row.id);
      },
    });
  }

  const operators = new Set(rows.map((r) => r.email)).size;
  const expiring = rows.filter((r) => r.ttlMin <= 30).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title="Sessions"
        sub="Every live console sign-in. Revoke any of them — changes are audit-logged."
        action={
          <>
            <button onClick={load} className={btnGhost}>
              {busy ? "…" : "↻ Refresh"}
            </button>
            <button
              disabled={!canEdit || rows.length <= 1}
              onClick={() => {
                setConfirmTyped("");
                setConfirm({
                  title: "Revoke all other sessions",
                  change: `${Math.max(0, rows.length - 1)} session(s) will be signed out`,
                  consequences: [
                    "Every other operator is signed out immediately",
                    "This device stays signed in",
                    "New sign-ins are still allowed",
                  ],
                  confirmLabel: "Revoke all others",
                  tone: "danger",
                  requireText: "REVOKE",
                  onConfirm: () => {
                    setConfirm(null);
                    revokeAll();
                  },
                });
              }}
              className={btnDanger}
            >
              Revoke all others
            </button>
          </>
        }
      />

      {err ? (
        <Callout tone="danger" title="Error">
          {err}
        </Callout>
      ) : null}
      {note ? <Callout tone="success">{note}</Callout> : null}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi
          label="ACTIVE SESSIONS"
          value={String(rows.length)}
          sub="live tokens"
        />
        <Kpi
          label="OPERATORS"
          value={String(operators)}
          sub="distinct accounts"
        />
        <Kpi
          label="EXPIRING ≤30M"
          value={String(expiring)}
          tone={expiring ? "down" : "muted"}
          sub="renew before they drop"
        />
        <Kpi
          label="ROLE"
          value={canEdit ? "WRITE" : "READ"}
          sub={canEdit ? "operator+" : "viewer — revoke disabled"}
        />
      </div>

      <Card
        title="Active sessions"
        sub="Tokens are never shown in full — only a short prefix for identification."
      >
        {busy && !rows.length ? (
          <div className="skeleton h-24" />
        ) : rows.length ? (
          <TableWrap>
            <table className="w-full min-w-[820px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className={thCls}>OPERATOR</th>
                  <th className={thCls}>ROLE</th>
                  <th className={thCls}>IP</th>
                  <th className={thCls}>STARTED</th>
                  <th className={thCls}>EXPIRES IN</th>
                  <th className={thCls}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={`${trCls} ${r.current ? "bg-brand/[0.06]" : ""}`}
                  >
                    <td className={tdCls}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-foreground">
                          {r.email}
                        </span>
                        {r.current ? (
                          <Badge tone="blue">THIS DEVICE</Badge>
                        ) : null}
                        {r.email === selfEmail && !r.current ? (
                          <Badge tone="slate">YOU</Badge>
                        ) : null}
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground/70">
                        {r.id}…
                      </div>
                    </td>
                    <td className={tdCls}>
                      <Badge
                        tone={r.role === "superadmin" ? "indigo" : "slate"}
                      >
                        {String(r.role || "").toUpperCase()}
                      </Badge>
                    </td>
                    <td className={`${tdCls} font-mono text-muted-foreground`}>
                      {r.ip}
                    </td>
                    <td
                      className={`${tdCls} whitespace-nowrap text-muted-foreground`}
                    >
                      {fmtDate(r.createdAt)}
                    </td>
                    <td className={`${tdCls} whitespace-nowrap`}>
                      <span
                        className={
                          r.ttlMin <= 30
                            ? "font-semibold text-accent"
                            : "text-muted-foreground"
                        }
                      >
                        {fmtTtl(r.ttlMin)}
                      </span>
                    </td>
                    <td className={`${tdCls} text-right`}>
                      <button
                        disabled={!canEdit}
                        onClick={() => askRevoke(r)}
                        className={btnGhost}
                      >
                        REVOKE
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <EmptyState
            title="No active sessions"
            hint="Sign in from the console login to create one."
          />
        )}
      </Card>

      {confirm ? (
        <ConfirmDialog
          spec={confirm}
          typed={confirmTyped}
          onTyped={setConfirmTyped}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </div>
  );
}

function UsersSection({ canEdit }: { canEdit: boolean }) {
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState("ALL");
  const [kycF, setKycF] = useState("ALL");
  const [sort, setSort] = useState("seen");
  const [page, setPage] = useState(0);
  const [users, setUsers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [note, setNote] = useState("");
  // Dev/smoke accounts are hidden by default so a real student list stays
  // readable — this deployment had ~45 of them.
  const [includeTest, setIncludeTest] = useState(false);
  const [hiddenTest, setHiddenTest] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<any | null>(null);
  const [selBusy, setSelBusy] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [marginDraft, setMarginDraft] = useState("");
  const [depositDraft, setDepositDraft] = useState("");
  const [depositLog, setDepositLog] = useState<any[]>([]);
  // Bulk selection: keyed by client id, cleared on every reload.
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNote, setBulkNote] = useState("");
  const [bulkConfirm, setBulkConfirm] = useState<ConfirmSpec | null>(null);
  const [bulkTyped, setBulkTyped] = useState("");
  // Deposits gate KYC; the threshold is published so this column can show who
  // is close to qualifying without an extra authenticated fetch.
  const cfg = usePublicConfig();
  const minDeposit = normalizeMinDeposit(cfg.kyc?.minDeposit);
  async function fetchDir(query = "", showTest = includeTest) {
    setBusy(true);
    try {
      const r = await fetch(
        `/api/admin/directory?q=${encodeURIComponent(query)}&includeTest=${showTest ? "1" : "0"}`,
        { cache: "no-store" },
      );
      const j = await r.json();
      setUsers(j.users || []);
      setTotal(j.total ?? (j.users || []).length);
      setNote(j.note || "");
      setHiddenTest(j.hiddenTest ?? 0);
      setPicked({});
    } catch {
      setUsers([]);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    fetchDir("");
  }, []);
  // Escape closes the client panel, and the page behind it is scroll-locked
  // while it is open — like any other drawer.
  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSel(null);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [sel]);
  async function openUser(id: string) {
    setSelBusy(true);
    try {
      const r = await fetch(`/api/admin/clients?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (r.ok) {
        setSel(j.user);
        setNoteDraft(j.user?.note || "");
        setMarginDraft(
          j.user?.marginPct != null ? String(j.user.marginPct) : "",
        );
        setDepositDraft("");
        setDepositLog(Array.isArray(j.deposits) ? j.deposits : []);
      }
    } finally {
      setSelBusy(false);
    }
  }
  async function act(id: string, patch: Record<string, string | number>) {
    if (!canEdit) return;
    setSelBusy(true);
    try {
      const r = await fetch("/api/admin/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      const j = await r.json();
      if (r.ok) {
        setSel(j.user);
        if (Array.isArray(j.deposits)) setDepositLog(j.deposits);
        if (patch.deposit !== undefined) setDepositDraft("");
        fetchDir(q);
      }
    } finally {
      setSelBusy(false);
    }
  }

  // ── Bulk actions ────────────────────────────────────────────────────────
  const pickedIds = Object.keys(picked).filter((k) => picked[k]);
  const pickedCount = pickedIds.length;

  async function runBulk(
    patch: { status?: string; kyc?: string },
    label: string,
  ) {
    if (!canEdit || !pickedIds.length) return;
    setBulkBusy(true);
    setBulkNote("");
    try {
      const r = await fetch("/api/admin/clients/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: pickedIds, ...patch }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setBulkNote(j.error || `${label} failed`);
        return;
      }
      setBulkNote(
        `${label}: ${j.updated} updated${j.failed ? ` · ${j.failed} skipped` : ""}`,
      );
      await fetchDir(q);
    } catch (e: any) {
      setBulkNote(e?.message || `${label} failed`);
    } finally {
      setBulkBusy(false);
    }
  }

  function askBulk(status: "ACTIVE" | "FROZEN") {
    const freeze = status === "FROZEN";
    setBulkTyped("");
    setBulkConfirm({
      title: freeze
        ? `Freeze ${pickedCount} client(s)`
        : `Unfreeze ${pickedCount} client(s)`,
      change: `${pickedCount} account(s): ${freeze ? "ACTIVE → FROZEN" : "FROZEN → ACTIVE"}`,
      consequences: freeze
        ? [
            "Those users are blocked at their next sign-in",
            "Existing sessions stop being refreshed",
            "Every change is written to the audit trail",
          ]
        : [
            "Those users can sign in again immediately",
            "Trading wallets and positions are untouched",
          ],
      confirmLabel: freeze
        ? `Freeze ${pickedCount}`
        : `Unfreeze ${pickedCount}`,
      tone: freeze ? "danger" : "primary",
      requireText: freeze && pickedCount > 4 ? "FREEZE" : undefined,
      onConfirm: () => {
        setBulkConfirm(null);
        runBulk({ status }, freeze ? "Freeze" : "Unfreeze");
      },
    });
  }
  const frozen = users.filter((u) => u.status === "FROZEN").length;
  const pendingKyc = users.filter((u) => u.kyc === "PENDING").length;
  const verified = users.filter((u) => u.kyc === "VERIFIED").length;
  const queue = users.filter(
    (u) => u.kyc === "PENDING" || u.kyc === "REJECTED" || u.status === "FROZEN",
  );
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = users.filter(
      (u) =>
        (statusF === "ALL" || (u.status || "ACTIVE") === statusF) &&
        (kycF === "ALL" || (u.kyc || "UNKNOWN") === kycF) &&
        (!needle ||
          // Must include phone: the server matches on it, so dropping it here
          // threw away every row a mobile-number search returned.
          `${u.username || ""} ${u.email || ""} ${u.phone || ""} ${u.clientID || ""} ${u.clientCode || ""} ${u.id}`
            .toLowerCase()
            .includes(needle)),
    );
    rows.sort((a, b) => {
      if (sort === "cash") return (b.cash || 0) - (a.cash || 0);
      if (sort === "name")
        return String(a.username || a.email || "").localeCompare(
          String(b.username || b.email || ""),
        );
      return (
        new Date(b.lastSeen || 0).getTime() -
        new Date(a.lastSeen || 0).getTime()
      );
    });
    return rows;
  }, [users, q, statusF, kycF, sort]);
  const per = 12;
  const slice = filtered.slice(page * per, page * per + per);
  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title="Users & KYC"
        sub="Live client directory + KYC queue + panel operators."
        action={
          <button onClick={() => fetchDir(q)} className={btnGhost}>
            {busy ? "…" : "↻ Refresh"}
          </button>
        }
      />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi
          label="TOTAL CLIENTS"
          value={String(total)}
          sub="registered accounts"
        />
        <Kpi
          label="FROZEN"
          value={String(frozen)}
          tone={frozen ? "down" : "muted"}
          sub="blocked at login"
        />
        <Kpi
          label="KYC PENDING"
          value={String(pendingKyc)}
          tone={pendingKyc ? "down" : "up"}
          sub="needs review"
        />
        <Kpi
          label="VERIFIED"
          value={String(verified)}
          tone="up"
          sub="KYC clear"
        />
      </div>
      <Card
        title="Client directory"
        sub="Every registered account, enriched with activity from its last sign-in. Search by name, email, mobile or client ID."
      >
        <FilterBar>
          <SearchBox
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(0);
            }}
            onGo={() => fetchDir(q)}
            placeholder="Search name, email or mobile…"
          />
          <select
            value={statusF}
            onChange={(e) => {
              setStatusF(e.target.value);
              setPage(0);
            }}
            className={selectCls}
          >
            <option value="ALL">Status: all</option>
            <option value="ACTIVE">Active</option>
            <option value="FROZEN">Frozen</option>
          </select>
          <select
            value={kycF}
            onChange={(e) => {
              setKycF(e.target.value);
              setPage(0);
            }}
            className={selectCls}
          >
            <option value="ALL">KYC: all</option>
            <option value="VERIFIED">Verified</option>
            <option value="PENDING">Pending</option>
            <option value="REJECTED">Rejected</option>
            <option value="UNKNOWN">Unknown</option>
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className={selectCls}
          >
            <option value="seen">Sort: last seen</option>
            <option value="cash">Sort: cash</option>
            <option value="name">Sort: name</option>
          </select>
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted-foreground">
            <input
              type="checkbox"
              checked={includeTest}
              onChange={(e) => {
                setIncludeTest(e.target.checked);
                setPage(0);
                fetchDir(q, e.target.checked);
              }}
              className="h-3.5 w-3.5 accent-[rgb(var(--brand))]"
            />
            Show test accounts
            {!includeTest && hiddenTest > 0 ? (
              <span className="text-muted-foreground/60">
                ({hiddenTest} hidden)
              </span>
            ) : null}
          </label>
          <button onClick={() => fetchDir(q)} className={btnDark}>
            GO
          </button>
        </FilterBar>
        {note ? (
          <div className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-[11px] font-medium text-accent">
            {note}
          </div>
        ) : null}
        {pickedCount > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand/[0.07] p-2.5">
            <span className="text-[12.5px] font-semibold text-foreground">
              {pickedCount} selected
            </span>
            <span className="text-[11.5px] text-muted-foreground">
              of {filtered.length} matching
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              <button
                disabled={!canEdit || bulkBusy}
                onClick={() => askBulk("FROZEN")}
                className={btnDanger}
              >
                {bulkBusy ? "…" : "Freeze"}
              </button>
              <button
                disabled={!canEdit || bulkBusy}
                onClick={() => askBulk("ACTIVE")}
                className={btnPrimary}
              >
                {bulkBusy ? "…" : "Unfreeze"}
              </button>
              <button onClick={() => setPicked({})} className={btnGhost}>
                Clear
              </button>
            </div>
          </div>
        ) : null}
        {bulkNote ? <Callout tone="success">{bulkNote}</Callout> : null}
        <TableWrap>
          <table className="w-full min-w-[720px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className={thCls} style={{ width: 34 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    disabled={!canEdit || !slice.length}
                    checked={
                      slice.length > 0 && slice.every((u: any) => picked[u.id])
                    }
                    onChange={(e) => {
                      const on = e.target.checked;
                      setPicked((prev) => {
                        const next = { ...prev };
                        for (const u of slice) {
                          if (on) next[u.id] = true;
                          else delete next[u.id];
                        }
                        return next;
                      });
                    }}
                    className="h-4 w-4 accent-[rgb(var(--brand))]"
                  />
                </th>
                <th className={thCls}>USER</th>
                <th className={thCls}>CLIENT ID</th>
                <th className={thCls}>CASH</th>
                <th className={thCls}>DEPOSITED</th>
                <th className={thCls}>STATUS</th>
                <th className={thCls}>LAST SEEN</th>
                <th className={thCls}></th>
              </tr>
            </thead>
            <tbody>
              {slice.map((u: any) => (
                <tr
                  key={u.id}
                  className={`${trCls} ${picked[u.id] ? "bg-brand/[0.05]" : ""}`}
                >
                  <td className={tdCls}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${u.username || u.email || u.id}`}
                      disabled={!canEdit}
                      checked={Boolean(picked[u.id])}
                      onChange={(e) =>
                        setPicked((prev) => {
                          const next = { ...prev };
                          if (e.target.checked) next[u.id] = true;
                          else delete next[u.id];
                          return next;
                        })
                      }
                      className="h-4 w-4 accent-[rgb(var(--brand))]"
                    />
                  </td>
                  <td className={tdCls}>
                    <div className="font-semibold text-foreground">
                      {u.username || u.email || u.id}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {u.email || "—"}
                    </div>
                    {u.phone ? (
                      <div className="font-mono text-[11px] text-muted-foreground/70">
                        +91 {u.phone}
                      </div>
                    ) : null}
                    {u.panLast4 ? (
                      <div className="font-mono text-[11px] text-muted-foreground/70">
                        PAN ••••{u.panLast4}
                      </div>
                    ) : null}
                    {u.neverLoggedIn ? (
                      <div className="mt-1">
                        <Badge tone="amber">NEVER SIGNED IN</Badge>
                      </div>
                    ) : null}
                  </td>
                  <td className={`${tdCls} font-mono text-foreground/80`}>
                    {/* The code is what the customer quotes; the raw id stays
                        underneath so an operator can still match a log line. */}
                    <div className="font-semibold text-foreground">
                      {u.clientCode || "—"}
                    </div>
                    <div className="text-[10.5px] text-muted-foreground/60">
                      {u.clientCode ? u.clientID : ""}
                    </div>
                    <div className="text-[11px] text-muted-foreground/70">
                      {u.logins ? `${u.logins} visits` : ""}
                    </div>
                  </td>
                  <td className={`${tdCls} font-semibold text-foreground`}>
                    {typeof u.cash === "number"
                      ? `₹${Number(u.cash).toLocaleString("en-IN")}`
                      : "—"}
                  </td>
                  <td className={`${tdCls} font-mono text-foreground/80`}>
                    {Number(u.deposited) > 0
                      ? `₹${Number(u.deposited).toLocaleString("en-IN")}`
                      : "—"}
                    {minDeposit > 0 ? (
                      <div
                        className={`font-sans text-[11px] ${Number(u.deposited) >= minDeposit ? "text-positive" : "text-muted-foreground/70"}`}
                      >
                        {Number(u.deposited) >= minDeposit
                          ? "KYC eligible"
                          : `₹${Math.ceil(minDeposit - (Number(u.deposited) || 0)).toLocaleString("en-IN")} to KYC`}
                      </div>
                    ) : null}
                  </td>
                  <td className={tdCls}>
                    <Badge tone={u.status === "FROZEN" ? "red" : "green"}>
                      {u.status || "ACTIVE"}
                    </Badge>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      KYC{" "}
                      <Badge
                        tone={
                          u.kyc === "VERIFIED"
                            ? "green"
                            : u.kyc === "PENDING"
                              ? "amber"
                              : u.kyc === "REJECTED"
                                ? "red"
                                : "slate"
                        }
                      >
                        {u.kyc || "UNKNOWN"}
                      </Badge>
                    </div>
                  </td>
                  <td
                    className={`${tdCls} whitespace-nowrap text-muted-foreground`}
                  >
                    {u.lastSeen
                      ? new Date(u.lastSeen).toLocaleString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </td>
                  <td className={`${tdCls} text-right`}>
                    <button onClick={() => openUser(u.id)} className={btnGhost}>
                      OPEN
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        {!filtered.length && !busy ? (
          <EmptyState
            title="No clients yet"
            hint="Accounts appear here as soon as someone registers."
          />
        ) : null}
        <Pagination
          page={page}
          pages={Math.max(1, Math.ceil(filtered.length / per))}
          total={filtered.length}
          onPage={setPage}
        />
        {bulkConfirm ? (
          <ConfirmDialog
            spec={bulkConfirm}
            typed={bulkTyped}
            onTyped={setBulkTyped}
            onCancel={() => setBulkConfirm(null)}
          />
        ) : null}
      </Card>
      <Card
        title={`KYC & risk queue · ${queue.length}`}
        sub="Pending KYC, rejected docs, and frozen accounts. Actions apply instantly and are audit-logged."
      >
        {!queue.length ? (
          <EmptyState
            title="Queue empty"
            hint="Nothing needs review right now."
          />
        ) : (
          <div className="flex flex-col">
            {queue.slice(0, 20).map((u: any) => (
              <div
                key={u.id}
                className="flex items-center justify-between gap-2 border-b border-border/60 py-2 text-[12px] last:border-0"
              >
                <span className="min-w-0">
                  <b className="text-foreground">
                    {u.username || u.email || u.id}
                  </b>{" "}
                  <span className="text-muted-foreground">
                    {u.clientID || ""} · KYC {u.kyc} · {u.status}
                    {u.panLast4 ? ` · PAN ••••${u.panLast4}` : ""}
                  </span>
                </span>
                <button onClick={() => openUser(u.id)} className={btnGhost}>
                  REVIEW
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
      {sel && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[70] flex justify-end"
              role="dialog"
              aria-modal="true"
              aria-label={`Client ${sel.username || sel.email || sel.id}`}
            >
              <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={() => setSel(null)}
                aria-hidden
              />
              <aside className="relative flex h-full w-full max-w-[480px] flex-col border-l border-border bg-card shadow-2xl">
                <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-semibold tracking-tight text-foreground">
                      {sel.username || sel.email || sel.id}
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                      {sel.email || "—"} · {sel.clientCode || "no client ID"} ·{" "}
                      {sel.logins || 1} visits
                    </div>
                  </div>
                  <button
                    onClick={() => setSel(null)}
                    aria-label="Close client panel"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5">
                  <div className="grid gap-2 text-[12px] sm:grid-cols-2">
                    <SnapshotRow k="Status" v={sel.status} />
                    <SnapshotRow k="KYC" v={sel.kyc} />
                    <SnapshotRow
                      k="Mobile"
                      v={sel.phone ? `+91 ${sel.phone}` : "—"}
                    />
                    <SnapshotRow
                      k="PAN"
                      v={sel.panLast4 ? `••••${sel.panLast4}` : "—"}
                    />
                    <SnapshotRow
                      k="Cash"
                      v={
                        typeof sel.cash === "number"
                          ? `₹${Number(sel.cash).toLocaleString("en-IN")}`
                          : "—"
                      }
                    />
                    <SnapshotRow
                      k="First seen"
                      v={
                        sel.firstSeen
                          ? new Date(sel.firstSeen).toLocaleString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"
                      }
                    />
                    <SnapshotRow
                      k="Last seen"
                      v={
                        sel.lastSeen
                          ? new Date(sel.lastSeen).toLocaleString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"
                      }
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      disabled={!canEdit || selBusy}
                      onClick={() =>
                        act(sel.id, {
                          status: sel.status === "FROZEN" ? "ACTIVE" : "FROZEN",
                        })
                      }
                      className={
                        sel.status === "FROZEN" ? btnPrimary : btnDanger
                      }
                    >
                      {sel.status === "FROZEN" ? "UNFREEZE" : "FREEZE"}
                    </button>
                    <button
                      disabled={!canEdit || selBusy}
                      onClick={() => act(sel.id, { kyc: "VERIFIED" })}
                      className={btnGhost}
                    >
                      KYC ✓
                    </button>
                    <button
                      disabled={!canEdit || selBusy}
                      onClick={() => act(sel.id, { kyc: "PENDING" })}
                      className={btnGhost}
                    >
                      KYC PENDING
                    </button>
                    <button
                      disabled={!canEdit || selBusy}
                      onClick={() => act(sel.id, { kyc: "REJECTED" })}
                      className={btnGhost}
                    >
                      KYC ✕
                    </button>
                  </div>
                  <Field label="Operator note (visible to panel only)">
                    <div className="flex gap-2">
                      <input
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        placeholder="e.g. called client, docs re-uploaded"
                        className={inputCls}
                      />
                      <button
                        disabled={!canEdit || selBusy}
                        onClick={() => act(sel.id, { note: noteDraft })}
                        className={btnPrimary}
                      >
                        SAVE
                      </button>
                    </div>
                  </Field>
                  {sel.note ? (
                    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[12px] text-foreground/80">
                      {sel.note}
                    </div>
                  ) : null}
                  <Field
                    label={`Trading margin % — ${
                      sel.marginPct != null
                        ? `${sel.marginPct}% (up to ${Math.round((100 / Number(sel.marginPct)) * 10) / 10}x)`
                        : "using platform default"
                    }`}
                  >
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="1"
                        max="100"
                        step="1"
                        value={marginDraft}
                        onChange={(e) => setMarginDraft(e.target.value)}
                        placeholder="5"
                        className={inputCls}
                      />
                      <button
                        disabled={!canEdit || selBusy || !marginDraft}
                        onClick={() =>
                          act(sel.id, { marginPct: Number(marginDraft) })
                        }
                        className={btnPrimary}
                      >
                        SET
                      </button>
                    </div>
                  </Field>
                  <div className="text-[11px] leading-relaxed text-muted-foreground">
                    The deposit needed to open a position. 5% ⇒ up to 20x
                    leverage, 20% ⇒ 5x, 100% ⇒ no leverage. Applies to this user
                    only, and is enforced server-side on every fill.
                  </div>
                  {(() => {
                    // One place for the deposit picture: what they have funded,
                    // where that leaves the KYC gate, and the credit control.
                    const funded = Number(sel.deposited) || 0;
                    const gate = kycGate(funded, minDeposit);
                    return (
                      <>
                        <Field
                          label={`Credit a deposit — ₹${funded.toLocaleString("en-IN")} funded so far`}
                        >
                          <div className="flex gap-2">
                            <input
                              type="number"
                              min="1"
                              value={depositDraft}
                              onChange={(e) => setDepositDraft(e.target.value)}
                              placeholder="10000"
                              className={inputCls}
                            />
                            <button
                              disabled={
                                !canEdit ||
                                selBusy ||
                                !(Number(depositDraft) > 0)
                              }
                              onClick={() =>
                                act(sel.id, { deposit: Number(depositDraft) })
                              }
                              className={btnPrimary}
                            >
                              CREDIT
                            </button>
                          </div>
                        </Field>
                        <div
                          className={`rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${
                            gate.open
                              ? "border-border bg-muted/40 text-muted-foreground"
                              : gate.eligible
                                ? "border-positive/30 bg-positive/10 text-positive"
                                : "border-border bg-muted/40 text-foreground/80"
                          }`}
                        >
                          {gate.open ? (
                            <>
                              No KYC deposit is required right now, so this user
                              can complete KYC immediately. Deposits still raise
                              their trading capital.
                            </>
                          ) : gate.eligible ? (
                            <>
                              KYC unlocked — funded ₹
                              {funded.toLocaleString("en-IN")} of the ₹
                              {gate.required.toLocaleString("en-IN")} required.
                            </>
                          ) : (
                            <>
                              KYC locked. They still need ₹
                              {Math.ceil(gate.remaining).toLocaleString(
                                "en-IN",
                              )}{" "}
                              to reach the ₹
                              {gate.required.toLocaleString("en-IN")}{" "}
                              requirement.
                            </>
                          )}
                        </div>
                        {gate.required > 0 && !gate.open ? (
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={
                                gate.eligible
                                  ? "h-full bg-positive"
                                  : "h-full bg-brand"
                              }
                              style={{ width: `${gate.progress * 100}%` }}
                            />
                          </div>
                        ) : null}
                        {depositLog.length ? (
                          <div className="rounded-lg border border-border">
                            <div className="border-b border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Deposit history
                            </div>
                            <div className="max-h-40 divide-y divide-border overflow-y-auto">
                              {depositLog.map((d) => (
                                <div
                                  key={d.id}
                                  className="flex items-center justify-between gap-2 px-3 py-1.5 text-[11px]"
                                >
                                  <span className="text-muted-foreground">
                                    {new Date(d.ts).toLocaleString("en-IN", {
                                      day: "2-digit",
                                      month: "short",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                    {d.method === "admin"
                                      ? " · by you"
                                      : " · self"}
                                  </span>
                                  <span className="font-mono tabular-nums text-positive">
                                    +{money(Number(d.amount) || 0)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        <div className="text-[11px] leading-relaxed text-muted-foreground">
                          Deposits are what the KYC requirement is measured
                          against, and they also add to this user&apos;s trading
                          capital. The user can fund themselves from the Funds
                          panel; this control is for crediting them manually.
                        </div>
                      </>
                    );
                  })()}
                </div>
              </aside>
            </div>,
            document.body,
          )
        : null}
      <AdminUsers canEdit={canEdit} />
    </div>
  );
}

function AdminUsers({ canEdit }: { canEdit: boolean }) {
  const [users, setUsers] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [em, setEm] = useState("");
  const [pw, setPw] = useState("");
  const [rl, setRl] = useState("viewer");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = () =>
    fetch("/api/admin/users", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setUsers(j.users || []))
      .catch(() => {});
  useEffect(() => {
    reload();
  }, []);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users.filter(
      (u) => !needle || `${u.email} ${u.role}`.toLowerCase().includes(needle),
    );
  }, [users, q]);
  return (
    <Card
      title={`Panel operators · ${rows.length}`}
      sub="Separate console logins. Superadmin can add viewer / operator / superadmin."
    >
      <FilterBar>
        <SearchBox
          value={q}
          onChange={setQ}
          onGo={() => {}}
          placeholder="Search operators…"
        />
      </FilterBar>
      <TableWrap>
        <table className="w-full min-w-[520px] text-left text-[12px]">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className={thCls}>EMAIL</th>
              <th className={thCls}>ROLE</th>
              <th className={thCls}>2FA</th>
              <th className={thCls}>JOINED</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u: any) => (
              <tr key={u.id} className={trCls}>
                <td className={`${tdCls} font-medium text-foreground`}>
                  {u.email}
                  {u.lockedUntil > Date.now() ? (
                    <Badge tone="red">LOCKED</Badge>
                  ) : null}
                </td>
                <td className={tdCls}>
                  <Badge
                    tone={
                      u.role === "superadmin"
                        ? "indigo"
                        : u.role === "operator"
                          ? "blue"
                          : "slate"
                    }
                  >
                    {u.role}
                  </Badge>
                </td>
                <td className={`${tdCls} text-muted-foreground`}>
                  {u.totp ? "ON" : "—"}
                </td>
                <td className={`${tdCls} text-muted-foreground`}>
                  {new Date(u.createdAt).toLocaleDateString("en-IN")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {!rows.length ? (
        <EmptyState
          title="No operators match"
          hint="Clear the search or add a new operator below."
        />
      ) : null}
      {msg ? (
        <div
          className={`rounded-lg border px-3 py-2 text-[12px] font-semibold ${
            msg.startsWith("Added")
              ? "border-positive/30 bg-positive/10 text-positive"
              : "border-negative/30 bg-negative/10 text-negative"
          }`}
        >
          {msg}
        </div>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_140px_100px]">
        <input
          value={em}
          onChange={(e) => setEm(e.target.value)}
          placeholder="email"
          className={inputCls}
        />
        <input
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="password 8+ chars"
          type="password"
          className={inputCls}
        />
        <select
          value={rl}
          onChange={(e) => setRl(e.target.value)}
          className={inputCls}
        >
          <option value="viewer">viewer</option>
          <option value="operator">operator</option>
          <option value="superadmin">superadmin</option>
        </select>
        <button
          disabled={!canEdit || busy}
          onClick={async () => {
            setMsg("");
            if (!em.trim()) return setMsg("Enter an email address.");
            if (pw.length < 8)
              return setMsg("Password must be at least 8 characters.");
            setBusy(true);
            try {
              const r = await fetch("/api/admin/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  email: em.trim(),
                  password: pw,
                  role: rl,
                }),
              });
              const j = await r.json().catch(() => ({}));
              if (!r.ok) {
                setMsg(j.error || `Could not add operator (${r.status})`);
                return;
              }
              setMsg(`Added ${em.trim()} as ${rl}`);
              setEm("");
              setPw("");
              reload();
            } catch (e: any) {
              setMsg(e?.message || "Could not add operator");
            } finally {
              setBusy(false);
            }
          }}
          className={btnPrimary}
        >
          {busy ? "ADDING…" : "ADD"}
        </button>
      </div>
    </Card>
  );
}

// Rotate the credential you are currently signed in with. Every role can do
// this for their own account — no superadmin gate, since locking someone out
// of their own password would just push them back to the env bootstrap value.
function ChangePassword() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setMsg("");
    setOk(false);
    if (!cur || !next || !again) return setMsg("Fill in all three fields.");
    if (next.length < 8) return setMsg("New password must be 8+ characters.");
    if (next !== again) return setMsg("New passwords don't match.");
    if (next === cur) return setMsg("New password matches the current one.");

    setBusy(true);
    try {
      const r = await fetch("/api/admin/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current: cur, next }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(j.error || `Could not change password (${r.status})`);
        return;
      }
      setCur("");
      setNext("");
      setAgain("");
      setOk(true);
      setMsg(
        j.revoked
          ? `Password changed. ${j.revoked} other session(s) signed out.`
          : "Password changed.",
      );
    } catch (e: any) {
      setMsg(e?.message || "Could not change password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Your console password"
      sub="Changes the credential you are signed in with. Minimum 8 characters."
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Current password">
          <input
            value={cur}
            onChange={(e) => setCur(e.target.value)}
            type="password"
            autoComplete="current-password"
            placeholder="current"
            className={inputCls}
          />
        </Field>
        <Field label="New password">
          <input
            value={next}
            onChange={(e) => setNext(e.target.value)}
            type="password"
            autoComplete="new-password"
            placeholder="8+ characters"
            className={inputCls}
          />
        </Field>
        <Field label="Confirm new password">
          <input
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            type="password"
            autoComplete="new-password"
            placeholder="repeat"
            className={inputCls}
          />
        </Field>
      </div>
      {msg ? (
        <div
          className={`rounded-lg border px-3 py-2 text-[12px] font-semibold ${
            ok
              ? "border-positive/30 bg-positive/10 text-positive"
              : "border-negative/30 bg-negative/10 text-negative"
          }`}
        >
          {msg}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={busy} onClick={submit} className={btnPrimary}>
          {busy ? "SAVING…" : "CHANGE PASSWORD"}
        </button>
        <span className="text-[11px] text-muted-foreground">
          Other browsers signed in as you get logged out.
        </span>
      </div>
      <Callout tone="warn" title="Rotate the bootstrap password soon">
        The first-boot <span className="font-mono">ADMIN_PASSWORD</span> in{" "}
        <span className="font-mono">.env.production</span> is only read while
        the admin table is empty. Editing the file after that has no effect —
        change it here instead.
      </Callout>
    </Card>
  );
}

// Instrument master health.
//
// The master is the single source for symbol -> instrument key, so when it fails
// to load, every quote, lot size and commodity lookup fails with it — and it
// fails SILENTLY, because an unloaded master and an empty market look identical
// from the storefront. `instrumentMasterInfo()` has reported its state on
// /api/market/stats for a while and nothing read it, so a stale or half-built
// commodity map was invisible from here.
function InstrumentMaster() {
  const [st, setSt] = useState<{
    loaded: boolean;
    eq?: number;
    idx?: number;
    com?: number;
    at?: number;
    loading?: boolean;
    error?: string | null;
  } | null>(null);
  const [outages, setOutages] = useState<{
    outages: number;
    last: string | null;
  } | null>(null);
  const [err, setErr] = useState("");

  function load() {
    setErr("");
    fetch("/api/market/stats", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        setSt(j?.instruments ?? null);
        setOutages(j?.segmentFallbacks ?? null);
      })
      .catch((e) => setErr(String(e?.message || e)));
  }
  useEffect(load, []);

  // Absent entirely: /api/market/stats reports `loaded: false` until something in
  // that route bundle has triggered a load, which is not itself a fault — the
  // counts below are what tell the truth.
  const ageMin = st?.at ? Math.round((Date.now() - st.at) / 60_000) : 0;
  const age = !st?.at
    ? "—"
    : ageMin < 60
      ? `${ageMin}m ago`
      : ageMin < 1440
        ? `${Math.round(ageMin / 60)}h ago`
        : `${Math.round(ageMin / 1440)}d ago`;
  const com = Number(st?.com ?? 0);
  const eq = Number(st?.eq ?? 0);

  return (
    <Card
      title="Instrument master"
      sub="Symbol resolution, lot sizes and commodity contracts all come from here."
      action={
        <button onClick={load} className={btnGhost}>
          Refresh
        </button>
      }
    >
      {err ? (
        <Callout tone="warn">{err}</Callout>
      ) : st === null ? (
        <div className="text-[12px] text-muted-foreground">Loading…</div>
      ) : (
        <>
          <div className="grid gap-2 text-[12px] sm:grid-cols-2">
            <SnapshotRow k="Loaded" v={st.loaded ? "yes" : "no"} />
            <SnapshotRow k="Built" v={age} />
            <SnapshotRow
              k="Equities"
              v={eq ? eq.toLocaleString("en-IN") : "—"}
            />
            <SnapshotRow
              k="Indices"
              v={st.idx ? st.idx.toLocaleString("en-IN") : "—"}
            />
            <SnapshotRow k="Commodities" v={com ? String(com) : "—"} />
          </div>
          {eq > 0 && com === 0 ? (
            <Callout tone="warn">
              The master built but carries no commodity contracts, so every MCX
              symbol will fail to resolve and /commodities will be empty. Bump{" "}
              <code>MASTER_VERSION</code> in <code>app/lib/instruments.ts</code>{" "}
              and refresh — the disk cache is trusted for a week.
            </Callout>
          ) : null}
          {eq === 0 ? (
            <Callout tone="warn">
              No instruments are loaded, so quoting and ordering will fail for
              every symbol. Check the provider reachability, then refresh.
            </Callout>
          ) : null}
          {st.error ? (
            <div className="mt-2">
              <div className="text-[11px] font-semibold text-muted-foreground">
                Last build error
              </div>
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-muted/40 p-2 text-[10.5px] leading-relaxed text-muted-foreground">
                {st.error}
              </pre>
            </div>
          ) : null}
          {outages && outages.outages > 0 ? (
            <Callout tone="warn">
              {outages.outages} symbol{outages.outages === 1 ? "" : "s"} could
              not be resolved to an exchange and fell back to NSE — which is
              wrong for any commodity, whose session and square-off cutoff are
              eight hours later. Orders still refuse safely (the guessed key
              returns no price), and the MIS sweep now SKIPS an unresolved leg
              rather than closing it on a guess. Last:{" "}
              <code>{outages.last}</code>
            </Callout>
          ) : null}
        </>
      )}
    </Card>
  );
}

// Holiday list, read-only.
//
// This was a hand-editable CSV until the exchange calendar replaced it. A
// manual list is wrong in the quiet direction: an unlisted holiday let orders
// through and let the MIS square-off fire on a day the exchange was shut. The
// provider also knows something a flat list cannot express — holidays are
// per-exchange, so on some dates NSE is shut while MCX trades normally.
function ExchangeHolidays() {
  const [rows, setRows] = useState<
    { date: string; closed: string[]; description?: string }[] | null
  >(null);

  useEffect(() => {
    fetch("/api/admin/public", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setRows(j.holidays || []))
      .catch(() => setRows([]));
  }, []);

  const today = new Date(Date.now() + 5.5 * 3600_000)
    .toISOString()
    .slice(0, 10);
  const upcoming = (rows || []).filter((h) => h.date >= today).slice(0, 8);

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-semibold text-foreground">
          Trading holidays
        </div>
        <Badge tone="slate">exchange calendar</Badge>
      </div>
      {rows === null ? (
        <div className="mt-1.5 text-[12px] text-muted-foreground">Loading…</div>
      ) : !rows.length ? (
        <div className="mt-1.5 text-[12px] text-muted-foreground">
          No calendar available — the fallback window above is in charge.
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-1">
          {upcoming.map((h) => (
            <div
              key={h.date}
              className="flex items-baseline justify-between gap-3 text-[12px]"
            >
              <span className="font-mono tabular-nums text-foreground/80">
                {h.date}
              </span>
              <span className="min-w-0 flex-1 truncate text-right text-muted-foreground">
                {h.description || "—"}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">
                {h.closed.length === 1
                  ? h.closed[0]
                  : `${h.closed.length} closed`}
              </span>
            </div>
          ))}
          {!upcoming.length ? (
            <div className="text-[12px] text-muted-foreground">
              None remaining this year.
            </div>
          ) : null}
        </div>
      )}
      <div className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80">
        Read-only. Sessions and closures are fetched from the exchange daily;
        edits here would be overwritten.
      </div>
    </div>
  );
}
