"use client";
import axios from "axios";
import { getCookie } from "cookies-next";
import { useEffect, useState } from "react";
import { apiURL } from "@/app/components/apiURL";
import parseJwt from "@/app/components/navbar/utils/parseJwt";
import { NavTransition } from "@/app/components/navbar/NavTransition";
import {
  getBackendCash,
  getPositions,
  getWalletBalance,
  setBackendCash,
  useKycGate,
} from "@/app/lib/trading";
import { money } from "@/app/lib/format";
import { sileo } from "sileo";
import { Badge, Row, Section } from "@/app/components/ui/kit";
import {
  FiBookOpen,
  FiBriefcase,
  FiCheck,
  FiCopy,
  FiCreditCard,
  FiEdit2,
  FiLink,
  FiList,
  FiLock,
  FiLogOut,
  FiPieChart,
  FiSliders,
  FiUser,
  FiUserCheck,
} from "react-icons/fi";

const DISPLAY_KEY = "fs_display_name";

function maskPan(pan: string) {
  const clean = pan.replace(/\s/g, "");
  if (clean.length <= 4) return "•••• •••• ••••";
  return `•••• •••• ${clean.slice(-4)}`;
}

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState<any>({});
  const [loggedIn, setLoggedIn] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const [meta, setMeta] = useState({
    username: "",
    email: "",
    clientID: "",
    clientCode: "",
  });
  const [walletNow, setWalletNow] = useState(0);
  const [positionsCount, setPositionsCount] = useState(0);
  const [signedInAt, setSignedInAt] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const token = getCookie("token") as string | undefined;
    const username = (getCookie("username") as string | undefined) || "";
    const email = (getCookie("email") as string | undefined) || "";
    const clientID = (getCookie("clientID") as string | undefined) || "";
    const clientCode = (getCookie("clientCode") as string | undefined) || "";
    let jwtName = "";
    if (token) {
      try {
        jwtName = parseJwt(token)?.username || "";
      } catch {
        /* ignore */
      }
    }
    setMeta({ username: username || jwtName, email, clientID, clientCode });
    try {
      const saved = localStorage.getItem(DISPLAY_KEY) || "";
      setDisplayName(saved || username || jwtName);
      setDraft(saved || username || jwtName);
    } catch {
      setDisplayName(username || jwtName);
      setDraft(username || jwtName);
    }
    try {
      const raw = localStorage.getItem("fs_pending_orders");
      const arr = raw ? JSON.parse(raw) : [];
      setPendingCount(Array.isArray(arr) ? arr.length : 0);
    } catch {
      setPendingCount(0);
    }
    try {
      setPositionsCount(getPositions().length);
      setWalletNow(getWalletBalance(getBackendCash()));
    } catch {
      /* ignore */
    }
    try {
      const iat = token ? Number(parseJwt(token)?.iat) : 0;
      if (iat) {
        setSignedInAt(
          new Date(iat * 1000).toLocaleString("en-IN", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          }),
        );
      }
    } catch {
      /* ignore */
    }
    if (!token) {
      setLoading(false);
      return;
    }
    setLoggedIn(true);
    let cancelled = false;
    (async () => {
      try {
        const a = await axios({
          method: "post",
          url: apiURL + "/auth/getAccountDetails",
          headers: { Authorization: "Bearer " + token },
        });
        if (cancelled) return;
        setDetails(a.data || {});
        if (typeof a.data?.remainingCash === "number") {
          setBackendCash(a.data.remainingCash);
          setWalletNow(getWalletBalance(a.data.remainingCash));
        }
      } catch {
        /* profile shows local fallbacks */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function saveDisplayName() {
    const v = draft.trim();
    if (!v) {
      sileo.error({ title: "Display name can't be empty" });
      return;
    }
    try {
      localStorage.setItem(DISPLAY_KEY, v);
    } catch {
      /* ignore */
    }
    setDisplayName(v);
    setEditing(false);
    sileo.success({ title: "Display name updated" });
  }

  async function copyClientId() {
    try {
      await navigator.clipboard.writeText(
        details.clientCode || meta.clientCode || meta.clientID,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      sileo.error({ title: "Could not copy client ID" });
    }
  }

  const pan: string =
    details?.pan || details?.PAN || details?.panNumber || details?.Pan || "";
  const kycRaw =
    details?.kyc ?? details?.kycStatus ?? details?.KYC ?? details?.verified;
  const kycLabel =
    kycRaw === true || String(kycRaw).toUpperCase() === "VERIFIED"
      ? "VERIFIED"
      : kycRaw
        ? String(kycRaw).toUpperCase()
        : "PENDING";
  const kycOk = kycLabel === "VERIFIED";
  const initial = (displayName?.[0] || meta.username?.[0] || "U").toUpperCase();

  // KYC is gated on deposits (admin-set threshold). While the requirement is
  // unmet the row explains why instead of only offering the form.
  const kycGateInfo = useKycGate();
  const kycLocked = kycGateInfo.loaded && !kycGateInfo.eligible;

  // Whether the connection token is available. Read from the same endpoint the
  // Connect page uses — the backend's `details.kyc` and the operator's verdict
  // in the registry are different fields, and the row must not contradict the
  // page it links to. null = not asked yet / signed out.
  const [connectReady, setConnectReady] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/account/connect", { cache: "no-store" });
        if (cancelled || !r.ok) return;
        const j = await r.json();
        if (!cancelled) setConnectReady(Boolean(j?.unlocked));
      } catch {
        /* leave the row neutral rather than guessing */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Device-only counts for the KYC draft + payout preview. Read after mount:
  // reading localStorage during render made server and client markup differ.
  const [device, setDevice] = useState({
    bankCount: 0,
    upiCount: 0,
    kycDone: 0,
  });
  useEffect(() => {
    let bankCount = 0;
    let upiCount = 0;
    let kycDone = 0;
    try {
      bankCount = JSON.parse(
        localStorage.getItem("fs_bank_accounts") || "[]",
      ).length;
      upiCount = JSON.parse(localStorage.getItem("fs_upi_ids") || "[]").length;
    } catch {
      /* ignore */
    }
    try {
      const d = JSON.parse(localStorage.getItem("fs_kyc_draft") || "{}");
      if (d?.pan?.trim()?.length >= 10) kycDone += 2;
      if (d?.address?.trim()) kycDone += 1;
      if (d?.incomeSlab) kycDone += 1;
      if (d?.nominee?.trim()) kycDone += 1;
      if (d?.signature) kycDone += 1;
      kycDone = Math.min(kycDone, 6);
    } catch {
      /* ignore */
    }
    setDevice({ bankCount, upiCount, kycDone });
  }, []);
  const { bankCount, upiCount, kycDone } = device;

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-6 sm:pt-10 pb-24 md:pb-16">
      <div className="mx-auto max-w-5xl">
        <header>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Account
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Your identity, security and trading preferences.
          </p>
        </header>

        {!loading && !loggedIn ? (
          <section className="broker-card mx-auto mt-8 max-w-sm p-6 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted text-foreground/70">
              <FiUser size={20} aria-hidden />
            </span>
            <h2 className="mt-3 text-base font-semibold">
              Sign in to view your account
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Profile, KYC status and payout accounts sync across your devices.
            </p>
            <NavTransition
              href="/login"
              className="pressable mt-4 flex h-11 items-center justify-center rounded-lg bg-foreground text-[12px] font-semibold text-background"
            >
              SIGN IN
            </NavTransition>
          </section>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
            {/* Identity — the only module that repeats on every section */}
            <aside className="broker-card overflow-hidden lg:sticky lg:top-20">
              <div className="p-5">
                <div className="flex items-start gap-4">
                  <span className="relative shrink-0">
                    <span className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-muted text-lg font-semibold">
                      {initial}
                    </span>
                    <span
                      title={loggedIn ? "Signed in" : "Signed out"}
                      aria-hidden
                      className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card ${loggedIn ? "bg-positive" : "bg-muted-foreground"}`}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    {editing ? (
                      <div className="space-y-2">
                        <label className="block">
                          <span className="text-[11px] font-medium text-muted-foreground">
                            Display name
                          </span>
                          <input
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            placeholder="Display name"
                            className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                          />
                        </label>
                        <div className="flex gap-2">
                          <button
                            onClick={saveDisplayName}
                            className="pressable h-9 flex-1 rounded-md bg-foreground text-[11px] font-semibold text-background"
                          >
                            SAVE
                          </button>
                          <button
                            onClick={() => {
                              setDraft(displayName);
                              setEditing(false);
                            }}
                            className="pressable h-9 flex-1 rounded-md border border-border text-[11px] font-semibold text-muted-foreground"
                          >
                            CANCEL
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start gap-2">
                          <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
                            {displayName || meta.username || "Trader"}
                          </h2>
                          <button
                            onClick={() => setEditing(true)}
                            aria-label="Edit display name"
                            className="pressable shrink-0 rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <FiEdit2 size={14} aria-hidden />
                          </button>
                        </div>
                        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                          {meta.email || "No email on file"}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <Badge tone={kycOk ? "positive" : "neutral"}>
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            {kycOk
                              ? "KYC verified"
                              : `KYC ${kycLabel.toLowerCase()}`}
                          </Badge>
                          {pan ? <Badge>PAN {maskPan(pan)}</Badge> : null}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {meta.clientID ? (
                  <div className="mt-4 flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Client ID
                      </div>
                      <div className="truncate font-mono text-[13px] tabular-nums">
                        {/* The account API is authoritative and also covers
                            sessions opened before client codes existed; the
                            cookie is only there so the first paint is not
                            blank. Last resort is the raw id. */}
                        {details.clientCode || meta.clientCode || meta.clientID}
                      </div>
                    </div>
                    <button
                      onClick={copyClientId}
                      aria-label="Copy client ID"
                      className="pressable shrink-0 rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {copied ? (
                        <FiCheck
                          size={14}
                          aria-hidden
                          className="text-positive"
                        />
                      ) : (
                        <FiCopy size={14} aria-hidden />
                      )}
                    </button>
                  </div>
                ) : null}

                <div className="mt-4 rounded-lg border border-border/70 bg-muted/40 px-3 py-2.5">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Available balance
                  </div>
                  {loading ? (
                    <div className="skeleton mt-2 h-5 w-24" />
                  ) : (
                    <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums">
                      ₹{Math.round(walletNow).toLocaleString("en-IN")}
                    </div>
                  )}
                </div>
              </div>
              {loggedIn && signedInAt ? (
                <div className="border-t border-border/60 px-5 py-3 text-[11px] text-muted-foreground">
                  Signed in {signedInAt}
                </div>
              ) : null}
            </aside>

            {/* Settings column */}
            <div className="space-y-6">
              <Section
                title="Verification"
                description="Identity and payout details used for settlements."
              >
                <Row
                  href="/profile/kyc"
                  icon={<FiUserCheck size={17} aria-hidden />}
                  label="KYC verification"
                  sub={
                    kycLocked ? (
                      <>
                        Requires {money(kycGateInfo.required)} in deposits ·{" "}
                        {money(kycGateInfo.deposited)} so far
                      </>
                    ) : kycDone > 0 ? (
                      <>
                        <span>{kycDone} of 6 steps saved</span>
                        <span className="mt-1.5 block h-1 w-full max-w-[180px] overflow-hidden rounded-full bg-muted">
                          <span
                            className="brand-gradient block h-full"
                            style={{ width: `${(kycDone / 6) * 100}%` }}
                          />
                        </span>
                      </>
                    ) : (
                      "PAN, address and e-sign pending"
                    )
                  }
                  badge={
                    kycLocked ? (
                      <Badge>
                        <FiLock size={11} aria-hidden />
                        Locked
                      </Badge>
                    ) : (
                      <Badge tone={kycOk ? "positive" : "neutral"}>
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {kycOk ? "Verified" : kycLabel}
                      </Badge>
                    )
                  }
                />
                <Row
                  href="/profile/banks"
                  icon={<FiCreditCard size={17} aria-hidden />}
                  label="Banks & UPI"
                  sub={
                    bankCount + upiCount > 0
                      ? `${bankCount} bank · ${upiCount} UPI`
                      : "Add a payout account for withdrawals"
                  }
                  badge={
                    bankCount + upiCount > 0 ? (
                      <Badge>{bankCount + upiCount}</Badge>
                    ) : undefined
                  }
                />
              </Section>

              <Section
                title="Trading"
                description="Live state of your portfolio."
              >
                <Row
                  href="/positions"
                  icon={<FiPieChart size={17} aria-hidden />}
                  label="Positions"
                  sub={
                    positionsCount > 0
                      ? `${positionsCount} open position${positionsCount === 1 ? "" : "s"}`
                      : "No open positions"
                  }
                />
                <Row
                  href="/portfolio"
                  icon={<FiBriefcase size={17} aria-hidden />}
                  label="Portfolio"
                  sub="Holdings, allocation, orders and funds"
                />
                <Row
                  href="/portfolio/orders"
                  icon={<FiList size={17} aria-hidden />}
                  label="Pending orders"
                  sub={
                    pendingCount > 0
                      ? `${pendingCount} waiting for trigger`
                      : "Nothing pending"
                  }
                  badge={
                    pendingCount > 0 ? (
                      <Badge tone="negative">{pendingCount}</Badge>
                    ) : undefined
                  }
                />
              </Section>

              <Section
                title="Connecting"
                description="Link this account to an external trader or algo platform."
              >
                <Row
                  href="/connect"
                  icon={<FiLink size={17} aria-hidden />}
                  label="Connect account"
                  sub={
                    connectReady === null
                      ? "User ID and connection token"
                      : connectReady
                        ? "User ID and token ready"
                        : "Token unlocks once KYC is verified"
                  }
                  badge={
                    connectReady === true ? (
                      <Badge tone="positive">
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        Ready
                      </Badge>
                    ) : connectReady === false ? (
                      <Badge>
                        <FiLock size={11} aria-hidden />
                        KYC
                      </Badge>
                    ) : undefined
                  }
                />
              </Section>

              <Section
                title="Security"
                description="Protect your account and review where it is signed in."
              >
                <Row
                  href="/profile/security"
                  icon={<FiLock size={17} aria-hidden />}
                  label="Password & sessions"
                  sub="Change your password and review active sessions"
                />
              </Section>

              <Section
                title="Statements"
                description="Reports generated from your trading history."
              >
                <Row
                  href="/ledger"
                  icon={<FiBookOpen size={17} aria-hidden />}
                  label="Transaction ledger"
                  sub="Day-wise cash, holdings and charges"
                />
              </Section>

              <Section title="Preferences">
                <Row
                  href="/settings"
                  icon={<FiSliders size={17} aria-hidden />}
                  label="Settings"
                  sub="Theme, chart defaults and order settings"
                />
              </Section>

              <section className="pt-2">
                <NavTransition
                  href="/logout"
                  className="pressable flex h-11 items-center justify-center gap-2 rounded-lg border border-negative/40 text-[12px] font-semibold text-negative transition-colors hover:bg-negative/10"
                >
                  <FiLogOut size={15} aria-hidden />
                  LOG OUT
                </NavTransition>
                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                  Ends this session on this device.
                </p>
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
