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
