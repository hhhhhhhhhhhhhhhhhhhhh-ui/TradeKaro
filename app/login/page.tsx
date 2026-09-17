"use client";
import { usernameRegex, emailRegex } from "../components/regexHandlers";
import { useState, useEffect, Suspense } from "react";
import axios from "axios";
import { apiURL } from "../components/apiURL";
import { useRouter, useSearchParams } from "next/navigation";
var crypto = require("crypto");
import { NavTransition } from "../components/navbar/NavTransition";
import Loading from "../components/Loading";
import { sileo } from "sileo";
import { FiAlertCircle, FiEye, FiEyeOff } from "react-icons/fi";
import { isPhone, normalisePhone } from "../lib/phone";

const fieldCls = (bad?: boolean) =>
  `h-11 w-full rounded-lg border bg-background px-3.5 text-sm text-foreground transition-colors placeholder:text-muted-foreground/50 focus:outline-none focus-visible:ring-2 ${
    bad
      ? "border-negative focus-visible:ring-negative/30"
      : "border-border focus-visible:ring-brand/40"
  }`;

function ErrorLine({
  id,
  children,
}: {
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <p
      id={id}
      className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-negative"
    >
      <FiAlertCircle size={12} aria-hidden />
      {children}
    </p>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Where the proxy sent them from, so signing in returns them there.
  const next = searchParams?.get("next") || "/dashboard";

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [errors, setErrors] = useState<{
    identifier?: string;
    password?: string;
    form?: string;
  }>({});

  // A stale Google-OAuth bookmark can still arrive with ?error=…
  useEffect(() => {
    if (searchParams?.get("error"))
      sileo.error({
        title: "Google sign-in isn't available — use your email and password.",
      });
  }, [searchParams]);

  function validate(): boolean {
    const e: typeof errors = {};
    const id = identifier.trim();
    if (!id) e.identifier = "Enter your username or email";
    // The API accepts either. The old client-side check rejected anything
    // containing "@", which silently blocked email login entirely.
    else if (id.includes("@")) {
      if (!emailRegex(id))
        e.identifier = "That doesn't look like a valid email";
    } else if (!usernameRegex(id)) {
      e.identifier = "Enter a valid username";
    }
    if (!password) e.password = "Enter your password";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function loginHandler(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    const hashedPassword = crypto
      .createHash("sha256")
      .update(password)
      .digest("hex");
    try {
      const res = await axios.post(`${apiURL}/login`, {
        username: identifier.trim(),
        password: hashedPassword,
        remember,
      });
      if (res?.status === 200) {
        sileo.success({ title: "Signed in" });
        router.replace(next);
        return;
      }
      setLoading(false);
      setErrors({ form: "Something went wrong. Please try again." });
    } catch (err: any) {
      setLoading(false);
      const status = err?.response?.status;
      // Pass the server's own wording through — it explains the lockout
      // window, which the old generic message threw away.
      const msg = err?.response?.data?.error;
      if (status === 401)
        setErrors({ form: "Incorrect username or password." });
      else if (status === 429)
        setErrors({ form: msg || "Too many attempts — please wait a moment." });
      else if (status === 400)
        setErrors({ form: msg || "Please check your details." });
      else
        setErrors({ form: msg || "Could not sign you in. Please try again." });
    }
  }

  return (
    <div className="grid min-h-[78vh] lg:grid-cols-[1.05fr_1fr]">
      {/* ── Promo panel ── */}
      <aside className="relative hidden overflow-hidden border-r border-border bg-card lg:flex lg:flex-col lg:justify-center lg:px-14">
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-brand/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -right-16 h-80 w-80 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative max-w-md">
          <div className="flex items-center gap-2.5">
            <img
              src="/TradeKaroLogo.png"
              alt=""
              className="h-8 w-8 rounded-lg"
            />
            <span className="text-[15px] font-semibold tracking-tight">
              TradeKaro
            </span>
          </div>
          <h2 className="mt-8 text-[30px] font-bold leading-[1.15] tracking-tight">
            Welcome back to{" "}
            <span className="brand-gradient-text">your portfolio</span>
          </h2>
          <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">
            Your positions, P&amp;L and watchlists are exactly where you left
            them — marked against live NSE prices.
          </p>
        </div>
      </aside>

      {/* ── Form panel ── */}
      <div className="flex items-center justify-center px-5 py-10 sm:px-8 lg:py-14">
        <div className="w-full max-w-[380px]">
          {/* Compact brand block on small screens, where the promo panel is hidden */}
          <div className="mb-7 lg:hidden">
            <div className="flex items-center gap-2.5">
              <img
                src="/TradeKaroLogo.png"
                alt=""
                className="h-8 w-8 rounded-lg"
              />
              <span className="text-[15px] font-semibold tracking-tight">
                TradeKaro
              </span>
            </div>
          </div>

          <h1 className="text-[22px] font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Continue to your trading account.
          </p>

          <form
            onSubmit={loginHandler}
            className="mt-6 flex flex-col gap-4"
            noValidate
          >
            <div>
              <label
                htmlFor="username"
                className="mb-1.5 block text-[11.5px] font-medium text-foreground/80"
              >
                Username, email or mobile
              </label>
              <input
                id="username"
                name="username"
                type="text"
                required
                autoFocus
                autoComplete="username"
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value);
                  if (errors.identifier || errors.form)
                    setErrors((s) => ({
                      ...s,
                      identifier: undefined,
                      form: undefined,
                    }));
                }}
                aria-invalid={Boolean(errors.identifier)}
                aria-describedby={
                  errors.identifier ? "identifier-error" : undefined
                }
                placeholder="you@example.com or 98765 43210"
                className={fieldCls(Boolean(errors.identifier))}
              />
              {errors.identifier && (
                <ErrorLine id="identifier-error">{errors.identifier}</ErrorLine>
              )}
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-[11.5px] font-medium text-foreground/80"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPw ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errors.password || errors.form)
                      setErrors((s) => ({
                        ...s,
                        password: undefined,
                        form: undefined,
                      }));
                  }}
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={
                    errors.password ? "password-error" : undefined
                  }
                  placeholder="Your password"
                  className={`${fieldCls(Boolean(errors.password))} pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {showPw ? <FiEyeOff size={15} /> : <FiEye size={15} />}
                </button>
              </div>
              {errors.password && (
                <ErrorLine id="password-error">{errors.password}</ErrorLine>
              )}
            </div>

            <div className="flex items-center justify-between gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-3.5 w-3.5 accent-current"
                />
                Keep me signed in
              </label>
              <button
                type="button"
                onClick={() => setForgot((v) => !v)}
                className="text-[12.5px] font-medium text-brand hover:underline"
              >
                Forgot password?
              </button>
            </div>

            {forgot && (
              <div className="rounded-lg border border-border bg-muted/50 px-3.5 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
                Self-serve resets aren&apos;t available yet. Ask whoever runs
                your account — they can reset it from the console.
              </div>
            )}

            {errors.form && (
              <div
                role="alert"
                className="rounded-lg border border-negative/40 bg-negative/5 px-3.5 py-2.5 text-[12.5px] text-negative"
              >
                {errors.form}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="pressable flex h-11 w-full items-center justify-center rounded-lg bg-foreground text-[13px] font-semibold text-background transition-colors hover:bg-foreground/90 disabled:opacity-60"
            >
              {loading ? <Loading /> : "SIGN IN"}
            </button>
          </form>

          <p className="mt-6 text-center text-[13px] text-muted-foreground">
            Don&apos;t have an account?{" "}
            <NavTransition
              href="/signup"
              className="font-medium text-brand hover:underline"
            >
              Create one
            </NavTransition>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-grow flex items-center justify-center py-12">
          <Loading />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
