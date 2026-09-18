import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { db } from "@/app/lib/db";
import {
  accountExists,
  ledgerKeyFor,
  tokenFromRequest,
  verifyToken,
} from "@/app/lib/authStore";
import {
  deriveAccount,
  ensureAccount,
  publicAccount,
} from "@/app/lib/tradingServer";

// Read surface for the trading book.
//
// `save` used to accept positions/trades straight from the browser, which made
// the whole ledger forgeable — a user could edit localStorage and the server
// would persist the fake P&L. It is gone. Fills are appended only by
// POST /api/trade/order, after server-side validation. See the header of
// app/lib/tradingServer.ts for the full trust model.

async function keyFor(req: NextRequest): Promise<string | null> {
  const token = await tokenFromRequest(req);
  if (!token) return null;
  const claims = await verifyToken(token);
  if (claims?.id) {
    // Signed AND still real. A deleted account must not keep a working key —
    // without this the request fell through to the hash-the-token branch and
    // quietly re-created an empty ledger under a brand-new id.
    return accountExists(claims.id) ? ledgerKeyFor(claims.id) : null;
  }
  return createHash("sha256").update(token).digest("hex").slice(0, 32);
}

export async function POST(req: NextRequest) {
  const key = await keyFor(req);
  if (!key) return NextResponse.json({ error: "no token" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action === "save") {
    // Refuse writes, and record the attempt: this is either a stale build or
    // someone poking the API directly. Either way the admin should see it.
    try {
      const token = await tokenFromRequest(req);
      const claims = token ? await verifyToken(token) : null;
      const n = Array.isArray(body?.book?.trades) ? body.book.trades.length : 0;
      db.prepare(
        "INSERT INTO audit (at, admin_id, email, action, detail, ip) VALUES (?,?,?,?,?,?)",
      ).run(
        Date.now(),
        claims?.id ?? null,
        claims?.email ?? null,
        "paper.write_rejected",
        `client tried to write ${n} trade(s) straight into the book`,
        req.headers.get("x-forwarded-for") || "local",
      );
    } catch {
      /* auditing is best-effort */
    }
    return NextResponse.json(
      {
        error:
          "Direct book writes are disabled. Fills must go through POST /api/trade/order.",
      },
      { status: 410 },
    );
  }

  if (action === "load") {
    await ensureAccount(key);
    const acct = deriveAccount(key);
    const token = await tokenFromRequest(req);
    const me = token ? await verifyToken(token) : null;
    // Hand back the ledger in the client's TradeEntry shape, so the tradebook
    // shows exactly what the server accepted — nothing more, nothing less.
    const trades = (
      db
        .prepare(
          "SELECT * FROM trade_fills WHERE user_id = ? ORDER BY ts ASC, id ASC LIMIT 2000",
        )
        .all(key) as any[]
    ).map((r) => {
      let meta: any = {};
      try {
        meta = r.meta ? JSON.parse(r.meta) : {};
      } catch {
        meta = {};
      }
      return {
        id: `srv-${r.id}`,
        scrip: r.symbol,
        side: r.side,
        qty: r.qty,
        price: r.price,
        value: r.value,
        at: r.ts,
        kind: r.kind,
        charges: r.charges,
        product: r.product ?? undefined,
        underlying: meta?.underlying,
        expiry: meta?.expiry,
        strike: meta?.strike,
        optionSide: meta?.optionSide,
        lotSize: meta?.lotSize,
      };
    });

    return NextResponse.json({
      book: { positions: acct.positions, trades, funds: [], verified: true },
      account: await publicAccount(key, me?.email),
    });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
