import { db } from "./db";

export type ClientRecord = {
  id: string;
  username: string;
  email: string;
  clientID: string;
  panLast4: string;
  kyc: string;
  /**
   * Who last decided the KYC status. Set to "operator" by mutateClient.
   * Without this the client heartbeat — whose kyc value comes from a legacy
   * stub that always answers PENDING — silently reverted an operator's
   * VERIFIED on the user's next page load, which is what the connect-token
   * gate depends on.
   */
  kycBy?: "operator";
  status: "ACTIVE" | "FROZEN";
  note: string;
  firstSeen: number;
  lastSeen: number;
  loginCount: number;
  cash?: number;
  // Margin requirement for this user's trades, as a % of trade value.
  // 5% ⇒ up to 20x leverage. Unset = use the platform default from settings.
  marginPct?: number;
};

const MAX = 10000;

function clean(v: unknown, n: number) {
  return String(v || "")
    .slice(0, n)
    .trim();
}

function cleanPanLast4(v: unknown) {
  const d = String(v || "").replace(/\D/g, "");
  return d.slice(-4);
}

const KYC_OK = new Set(["VERIFIED", "PENDING", "REJECTED", "UNKNOWN"]);

export async function getClients(): Promise<ClientRecord[]> {
  const rows = db
    .prepare("SELECT json FROM blocks WHERE kind = 'client' ORDER BY at")
    .all() as any[];
  return rows.map((r) => JSON.parse(String(r.json)) as ClientRecord);
}

async function saveClients(c: ClientRecord[]) {
  const del = db.prepare("DELETE FROM blocks WHERE kind = 'client'");
  const ins = db.prepare(
    "INSERT INTO blocks (kind, id, json, at) VALUES ('client',?,?,?)",
  );
  db.exec("BEGIN");
  try {
    del.run();
    c.slice(0, MAX).forEach((item, i) =>
      ins.run(String(item.id), JSON.stringify(item), i),
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export async function heartbeat(input: {
  username?: unknown;
  email?: unknown;
  clientID?: unknown;
  panLast4?: unknown;
  kyc?: unknown;
  cash?: unknown;
}): Promise<ClientRecord | null> {
  const username = clean(input.username, 64);
  const email = clean(input.email, 128).toLowerCase();
  const clientID = clean(input.clientID, 64);
  const id = clientID || username || email;
  if (!id) return null;
  const panLast4 = cleanPanLast4(input.panLast4);
  const kycRaw = clean(input.kyc, 16).toUpperCase();
  const kyc = KYC_OK.has(kycRaw) ? kycRaw : "UNKNOWN";
  const cash =
    typeof input.cash === "number" && Number.isFinite(input.cash)
      ? input.cash
      : undefined;
  const now = Date.now();
  const all = await getClients();
  const i = all.findIndex((c) => c.id === id);
  if (i >= 0) {
    const prev = all[i];
    const returning = now - prev.lastSeen > 30 * 60 * 1000;
    // KYC is an operator decision: a browser may fill the field in, but it must
    // never overrule a verdict the panel already recorded.
    const kycWins = prev.kycBy !== "operator" && kyc !== "UNKNOWN";
    all[i] = {
      ...prev,
      username: username || prev.username,
      email: email || prev.email,
      clientID: clientID || prev.clientID,
      panLast4: panLast4 || prev.panLast4,
      kyc: kycWins ? kyc : prev.kyc,
      cash: cash ?? prev.cash,
      lastSeen: now,
      loginCount: prev.loginCount + (returning ? 1 : 0),
    };
    await saveClients(all);
    return all[i];
  }
  const rec: ClientRecord = {
    id,
    username,
    email,
    clientID,
    panLast4,
    kyc,
    status: "ACTIVE",
    note: "",
    firstSeen: now,
    lastSeen: now,
    loginCount: 1,
    cash,
  };
  all.unshift(rec);
  await saveClients(all);
  return rec;
}

export async function mutateClient(
  id: string,
  patch: Partial<Pick<ClientRecord, "status" | "kyc" | "note" | "marginPct">>,
  seed?: { username?: string; email?: string; clientID?: string },
): Promise<ClientRecord | null> {
  const all = await getClients();
  let i = all.findIndex((c) => c.id === String(id));
  if (i < 0) {
    // A registered account that has never checked in has no registry row yet.
    // Create a minimal one so an action like FREEZE has somewhere to live.
    // lastSeen stays 0, which the directory reads as "never logged in".
    // A later heartbeat resolves to the same id (clientID = users.id), so the
    // status and note set here survive it.
    if (!seed) return null;
    all.push({
      id: String(id),
      username: String(seed.username || ""),
      email: String(seed.email || ""),
      clientID: String(seed.clientID || id),
      panLast4: "",
      kyc: "UNKNOWN",
      status: "ACTIVE",
      note: "",
      firstSeen: Date.now(),
      lastSeen: 0,
      loginCount: 0,
    });
    i = all.length - 1;
  }
  if (patch.status && patch.status !== "ACTIVE" && patch.status !== "FROZEN")
    return null;
  const kyc = patch.kyc
    ? String(patch.kyc).toUpperCase().slice(0, 16)
    : undefined;
  if (kyc && !KYC_OK.has(kyc)) return null;
  let marginPct: number | undefined;
  if (patch.marginPct !== undefined && patch.marginPct !== null) {
    const n = Number(patch.marginPct);
    // 1% (100x) .. 100% (no leverage)
    if (!Number.isFinite(n) || n < 1 || n > 100) return null;
    marginPct = Math.round(n * 100) / 100;
  }
  all[i] = {
    ...all[i],
    ...(patch.status ? { status: patch.status } : {}),
    // Stamp the provenance so the heartbeat knows to leave this value alone.
    ...(kyc ? { kyc, kycBy: "operator" as const } : {}),
    ...(marginPct !== undefined ? { marginPct } : {}),
    ...(patch.note !== undefined
      ? { note: String(patch.note).slice(0, 500) }
      : {}),
  };
  await saveClients(all);
  return all[i];
}

/** Per-user margin override, looked up by email (the registry's stable link). */
export async function marginPctForEmail(email: string): Promise<number | null> {
  const want = String(email || "")
    .trim()
    .toLowerCase();
  if (!want) return null;
  const all = await getClients();
  const hit = all.find((c) => (c.email || "").toLowerCase() === want);
  const n = Number(hit?.marginPct);
  return Number.isFinite(n) && n >= 1 && n <= 100 ? n : null;
}
