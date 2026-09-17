"use client";
import axios from "axios";
import { deleteCookie, getCookie } from "cookies-next";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiURL } from "@/app/components/apiURL";
import parseJwt from "@/app/components/navbar/utils/parseJwt";
import {
  AccountHeader,
  Badge,
  Dot,
  Field,
  Row,
  Section,
  btnDanger,
  btnPrimary,
  inputClass,
} from "@/app/components/ui/kit";
import { FiActivity, FiKey, FiLogOut, FiMonitor } from "react-icons/fi";
import { sileo } from "sileo";
var crypto = require("crypto");

function hashPw(pw: string) {
  try {
    return crypto.createHash("sha256").update(pw).digest("hex");
  } catch {
    return pw;
  }
}

export default function SecurityPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [tokenOk, setTokenOk] = useState<boolean | null>(null);
  const [tokenExp, setTokenExp] = useState<string>("");
  const [upstoxOk, setUpstoxOk] = useState<boolean | null>(null);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token = getCookie("token") as string | undefined;
    if (!token) {
      setChecking(false);
      setTokenOk(false);
      return;
    }
    try {
      const payload = parseJwt(token);
      if (payload?.exp) {
        setTokenExp(new Date(payload.exp * 1000).toLocaleString("en-IN"));
      }
    } catch {
      /* ignore */
    }
    let cancelled = false;
    (async () => {
      try {
        await axios({
          method: "post",
          url: apiURL + "/auth/verifyToken",
          headers: { Authorization: "Bearer " + token },
        });
        if (!cancelled) setTokenOk(true);
      } catch {
        if (!cancelled) setTokenOk(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
      try {
        const r = await fetch("/api/market/stats", { cache: "no-store" });
        const j = await r.json();
        if (!cancelled) setUpstoxOk(!!j?.upstox);
      } catch {
        if (!cancelled) setUpstoxOk(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    const token = getCookie("token") as string | undefined;
    if (!token) {
      sileo.error({ title: "Log in first" });
      return;
    }
    if (!cur || !next || !confirm) {
      sileo.error({ title: "Fill all password fields" });
      return;
    }
    if (next !== confirm) {
      sileo.error({ title: "New passwords don't match" });
      return;
    }
    if (next.length < 6) {
      sileo.error({ title: "Use at least 6 characters" });
      return;
    }
    setBusy(true);
    const payload = {
      oldPassword: hashPw(cur),
      newPassword: hashPw(next),
      password: hashPw(next),
      currentPassword: hashPw(cur),
    };
    const paths = [
      "/auth/changePassword",
      "/auth/updatePassword",
      "/changePassword",
    ];
    let done = false;
    for (const p of paths) {
      try {
        const r = await axios({
          method: "post",
          url: apiURL + p,
          headers: { Authorization: "Bearer " + token },
          data: payload,
        });
        if (r?.status === 200) {
          done = true;
          sileo.success({ title: "Password changed — log in again" });
          break;
        }
      } catch (err: any) {
        const status = err?.response?.status;
        // 404 = wrong guess, try next path. Anything else = real error, stop.
        if (status !== 404) {
          sileo.error({
            title: err?.response?.data?.message || "Password change failed",
          });
          setBusy(false);
          return;
        }
      }
    }
    setBusy(false);
    if (!done) {
      sileo.error({ title: "Password change not supported by backend yet" });
      return;
    }
    try {
      deleteCookie("token");
    } catch {
      /* ignore */
    }
    router.push("/login");
  }

  function signOutAll() {
    try {
      deleteCookie("token");
      deleteCookie("clientID");
      deleteCookie("username");
      deleteCookie("email");
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem("fs_pending_orders");
    } catch {
      /* ignore */
    }
    sileo.success({ title: "Signed out on this device" });
    router.push("/login");
  }

  const fields = [
    { label: "Current password", v: cur, s: setCur, ac: "current-password" },
    { label: "New password", v: next, s: setNext, ac: "new-password" },
    {
      label: "Confirm new password",
      v: confirm,
      s: setConfirm,
      ac: "new-password",
    },
  ];

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-6 sm:pt-10 pb-24 md:pb-16">
      <div className="mx-auto max-w-3xl">
        <AccountHeader
          title="Security"
          description="Password, session state and market-data connectivity for this device."
        />

        <div className="mt-6 space-y-6">
          <Section
            title="Password"
            description="Minimum 6 characters. Changing it signs you out everywhere."
          >
            <form onSubmit={changePassword} className="p-5">
              <div className="space-y-3">
                {fields.map((f) => (
                  <Field key={f.label} label={f.label}>
                    <input
                      type="password"
                      value={f.v}
                      onChange={(e) => f.s(e.target.value)}
                      autoComplete={f.ac}
                      className={inputClass}
                    />
                  </Field>
                ))}
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  type="submit"
                  disabled={busy}
                  className={`${btnPrimary} px-5`}
                >
                  {busy ? "UPDATING…" : "UPDATE PASSWORD"}
                </button>
              </div>
            </form>
          </Section>

          <Section
            title="This device"
            description="Where this account is currently signed in."
          >
            {checking ? (
              <div className="space-y-3 p-5">
                <div className="skeleton h-11" />
                <div className="skeleton h-11" />
              </div>
            ) : (
              <>
                <Row
                  icon={<FiMonitor size={17} aria-hidden />}
                  label="Current session"
                  sub={
                    tokenExp ? `Expires ${tokenExp}` : "No expiry information"
                  }
                  badge={
                    <Badge tone={tokenOk ? "positive" : "negative"}>
                      <Dot />
                      {tokenOk ? "Active" : "Expired"}
                    </Badge>
                  }
                />
                <Row
                  icon={<FiKey size={17} aria-hidden />}
                  label="Broker token"
                  sub="Upstox access token used for quotes and orders"
                  badge={
                    <Badge tone={tokenOk ? "positive" : "negative"}>
                      <Dot />
                      {tokenOk ? "Valid" : "Invalid"}
                    </Badge>
                  }
                />
                <Row
                  icon={<FiActivity size={17} aria-hidden />}
                  label="Market feed"
                  sub="Live tick stream and instrument master"
                  badge={
                    upstoxOk === null ? (
                      <Badge>…</Badge>
                    ) : (
                      <Badge tone={upstoxOk ? "positive" : "negative"}>
                        <Dot />
                        {upstoxOk ? "Live" : "Down"}
                      </Badge>
                    )
                  }
                />
              </>
            )}
          </Section>

          <Section
            title="Sign out"
            description="Clears the session and any queued orders on this device."
          >
            <div className="p-5">
              <button onClick={signOutAll} className={btnDanger}>
                <FiLogOut size={15} aria-hidden />
                SIGN OUT
              </button>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
