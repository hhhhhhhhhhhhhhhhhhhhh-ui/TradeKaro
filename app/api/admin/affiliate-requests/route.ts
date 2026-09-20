import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/app/lib/adminStore";
import { decideRequest, listRequests } from "@/app/lib/affiliates";
import { adminFrom, deny, needAdmin } from "../_guard";

// Partner requests: the landing pages and creatives partners have asked for.
//
// GET  ?status=open|done|declined|all
// POST { id, status: "done" | "declined", note? }
//
// This is the other half of the form in the partner panel. Without it the form
// is a `mailto:` with extra steps — a request a partner sends has to arrive
// somewhere a person looks.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a) return deny();
  const status = new URL(req.url).searchParams.get("status") || "all";
  const requests = listRequests(status);
  return NextResponse.json({
    requests,
    openCount: listRequests("open").length,
  });
}

export async function POST(req: NextRequest) {
  const a = await adminFrom(req);
  if (!a || !needAdmin(a.user.role, "operator")) return deny();

  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || "");
  const status = String(body?.status || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!["done", "declined"].includes(status))
    return NextResponse.json({ error: "Unknown status" }, { status: 400 });

  const res = decideRequest({
    id,
    status: status as "done" | "declined",
    note: body?.note,
    actor: a.user.email,
  });
  if (!res.ok)
    return NextResponse.json({ error: res.error }, { status: res.status });

  await audit({
    at: Date.now(),
    adminId: a.user.id,
    email: a.user.email,
    action: "affiliate.request",
    detail: `${res.request.id} ${res.request.title} -> ${res.request.status}${
      res.request.note ? ` note="${res.request.note}"` : ""
    }`,
    ip: req.headers.get("x-forwarded-for") || "local",
  });

  return NextResponse.json({
    ok: true,
    request: res.request,
    requests: listRequests("all"),
    openCount: listRequests("open").length,
  });
}
