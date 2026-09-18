import { NextRequest, NextResponse } from "next/server";
import {
  getSettings,
  saveSettings,
  audit,
  readAudit,
} from "@/app/lib/adminStore";
import { normalizeMinDeposit } from "@/app/lib/kycGate";
import { bustRuntimeCache } from "@/app/lib/adminRuntime";
import { adminFrom, deny, needAdmin } from "../_guard";

/** `••••1234` — enough to identify a key, useless as one, and not re-writable. */
function mask(v: unknown): string {
  const s = String(v || "");
  return s ? `••••${s.slice(-4)}` : "";
}

export async function GET(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a) return deny();
  const [settings, auditLog] = await Promise.all([
    getSettings(),
    readAudit(100),
  ]);
  const safe = {
    ...settings,
    upstoxToken: settings.upstoxToken
      ? `••••${settings.upstoxToken.slice(-4)}`
      : "",
    feedToken: settings.feedToken ? `••••${settings.feedToken.slice(-4)}` : "",
    // Payment secrets never leave the server. The trailing four characters are
    // shown only so an operator can tell WHICH key is loaded; the value sent
    // back starts with `••••` and the writer treats that as "leave it alone".
    payments: {
      ...settings.payments,
      payinApiKey: mask(settings.payments?.payinApiKey),
      payinApiSecret: mask(settings.payments?.payinApiSecret),
      payoutApiKey: mask(settings.payments?.payoutApiKey),
      payoutApiSecret: mask(settings.payments?.payoutApiSecret),
    },
  };
  return NextResponse.json({
    settings: safe,
    audit: auditLog,
    role: a.user.role,
    email: a.user.email,
  });
}

export async function POST(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a || !needAdmin(a.user.role, "operator")) return deny();
  const body = await req.json().catch(() => ({}));
  const cur = await getSettings();
  const next = { ...cur };
  const allow: (keyof typeof cur)[] = [
    "providerOff",
    "maintenance",
    "banner",
    "ttl",
    "clientPollMs",
    "tradeEngineMs",
    "hiddenTabPause",
    "tape",
    "rail",
    "chartDefaults",
    "candleWindows",
    "marketHours",
    "trading",
    "orderDefaults",
    "alertLimits",
    "kyc",
  ];
  for (const k of allow) if (body[k] !== undefined) (next as any)[k] = body[k];
  // The KYC requirement is money: force it to a whole, non-negative number so a
  // stray string or negative cannot disable the gate from the settings form.
  if ((next as any).kyc) {
    (next as any).kyc = {
      minDeposit: normalizeMinDeposit((next as any).kyc.minDeposit),
    };
  }
  // Reject corrupted shapes: top-level switches must stay bare booleans.
  for (const k of ["providerOff", "maintenance", "hiddenTabPause"] as const) {
    if ((next as any)[k] !== undefined && typeof (next as any)[k] !== "boolean")
      (next as any)[k] = (cur as any)[k];
  }
  if (body.upstoxToken && body.upstoxToken !== "UNCHANGED") {
    if (!needAdmin(a.user.role, "superadmin")) return deny();
    next.upstoxToken = String(body.upstoxToken);
  }
  if (body.feedToken && body.feedToken !== "UNCHANGED") {
    if (!needAdmin(a.user.role, "superadmin")) return deny();
    next.feedToken = String(body.feedToken);
  }
  // ── Payment gateway ───────────────────────────────────────────────────────
  // Handled outside the `allow` list on purpose: a wholesale assignment would
  // write the masked placeholders straight back over the real secrets.
  //
  // Everything here is a superadmin action. `enabled` is the switch that lets
  // the platform accept real money, and the secrets are the only thing standing
  // between a stranger and a forged "this customer paid" callback, so neither
  // belongs to an operator-level session.
  if (body.payments !== undefined) {
    if (!needAdmin(a.user.role, "superadmin")) return deny();
    const cur2 = cur.payments;
    const inc = (body.payments || {}) as any;

    // A masked value means "unchanged". An empty string means the operator
    // cleared the field, which is also "unchanged" — there is no way to blank
    // a secret from this form, deliberately.
    const keepSecret = (incoming: unknown, stored: string) => {
      const v = typeof incoming === "string" ? incoming.trim() : "";
      if (!v || v.startsWith("••••")) return stored || "";
      return v.slice(0, 200);
    };
    const bool2 = (v: unknown, fb: boolean) =>
      typeof v === "boolean" ? v : fb;
    const amt = (v: unknown, fb: number) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : fb;
    };

    const pay = {
      enabled: bool2(inc.enabled, cur2.enabled),
      payoutsEnabled: bool2(inc.payoutsEnabled, cur2.payoutsEnabled),
      baseUrl:
        typeof inc.baseUrl === "string" && inc.baseUrl.trim()
          ? inc.baseUrl.trim().slice(0, 200)
          : cur2.baseUrl,
      minAmount: amt(inc.minAmount, cur2.minAmount),
      maxAmount: amt(inc.maxAmount, cur2.maxAmount),
      payinApiKey: keepSecret(inc.payinApiKey, cur2.payinApiKey),
      payinApiSecret: keepSecret(inc.payinApiSecret, cur2.payinApiSecret),
      payoutApiKey: keepSecret(inc.payoutApiKey, cur2.payoutApiKey),
      payoutApiSecret: keepSecret(inc.payoutApiSecret, cur2.payoutApiSecret),
    };
    // A max below the min would make every top-up impossible, and the failure
    // would present as "minimum exceeded" on an amount that looks fine.
    if (pay.maxAmount < pay.minAmount) pay.maxAmount = pay.minAmount;
    // Refuse to take real money without the credentials to verify it. Enabling
    // this with a half-filled key pair is the one state that looks healthy and
    // silently fails every callback.
    if (pay.enabled && (!pay.payinApiKey || !pay.payinApiSecret))
      return NextResponse.json(
        {
          error: "Set the pay-in API key and secret before enabling payments.",
        },
        { status: 400 },
      );
    if (pay.payoutsEnabled && (!pay.payoutApiKey || !pay.payoutApiSecret))
      return NextResponse.json(
        {
          error: "Set the payout API key and secret before enabling payouts.",
        },
        { status: 400 },
      );
    next.payments = pay;
  }
  next.updatedBy = a.user.email;
  await saveSettings(next);
  // Drop the read cache at once. Without this an operator's change stayed
  // invisible to the order path for up to CACHE_MS — including emergency
  // switches like "HALT all fills", which are the ones people expect to be
  // instant. `bustRuntimeCache` existed for exactly this and was never called.
  bustRuntimeCache();
  await audit({
    at: Date.now(),
    adminId: a.user.id,
    email: a.user.email,
    action: "settings.update",
    detail: Object.keys(body).join(","),
    ip: req.headers.get("x-forwarded-for") || "local",
  });
  return NextResponse.json({ ok: true });
}
