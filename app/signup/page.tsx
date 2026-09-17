"use client";
import { useMemo, useState } from "react";
import { usernameRegex, emailRegex } from "../components/regexHandlers";
import axios from "axios";
import { apiURL } from "../components/apiURL";
var crypto = require("crypto");
import { NavTransition } from "../components/navbar/NavTransition";
import Loading from "../components/Loading";
import { sileo } from "sileo";
import { FiAlertCircle, FiCheck, FiEye, FiEyeOff } from "react-icons/fi";
import { isPhone, normalisePhone } from "../lib/phone";

const MIN_PW = 8;

// Advisory only. The hard rule is the 8-character minimum — the server stores a
// client-side SHA-256, so it cannot measure the password length itself.
function strengthOf(pw: string): { score: number; label: string } {
  let s = 0;
  if (pw.length >= MIN_PW) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const label = s >= 4 ? "Strong" : s >= 3 ? "Good" : s >= 2 ? "Fair" : "Weak";
  return { score: s, label };
}

const barCls = (s: number) =>
  s >= 4
    ? "bg-positive"
    : s >= 3
      ? "bg-brand"
      : s >= 2
        ? "bg-accent"
        : "bg-negative";

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

export default function SignUpPage() {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [username, setUsername] = useState("");
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{
    email?: string;
    phone?: string;
    username?: string;
    password?: string;
    form?: string;
  }>({});

  const strength = useMemo(() => strengthOf(password), [password]);

  // Mirror the email's local part into the username so the common case needs no
  // typing at all — but stop once the user edits that field themselves.
  function onEmailChange(v: string) {
    setEmail(v);
    if (!usernameEdited) {
      const handle = v
        .split("@")[0]
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, "")
        .slice(0, 24);
      setUsername(handle.length >= 3 ? handle : "");
    }
    if (errors.email || errors.form)
      setErrors((e) => ({ ...e, email: undefined, form: undefined }));
  }

  function validate(): boolean {
    const e: typeof errors = {};
    const mail = email.trim();
    if (!mail) e.email = "Enter your email";
    else if (!emailRegex(mail))
      e.email = "That doesn't look like a valid email";

    if (!phone) e.phone = "Enter your mobile number";
    else if (!isPhone(phone)) e.phone = "Enter a valid 10-digit mobile number";

    const uname = username.trim();
    if (!uname) e.username = "Pick a username";
    else if (!usernameRegex(uname))
      e.username = "3+ characters — letters, numbers, . _ - only";

    if (!password) e.password = "Choose a password";
    else if (password.length < MIN_PW)
      e.password = `Use at least ${MIN_PW} characters`;

    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;

    const hashed = crypto.createHash("sha256").update(password).digest("hex");
    const mail = email.trim().toLowerCase();
    const uname = username.trim().toLowerCase();

    setLoading(true);
    try {
      await axios.post(`${apiURL}/register`, {
        username: uname,
        email: mail,
        password: hashed,
        phone,
      });
    } catch (err: any) {
      setLoading(false);
      const status = err?.response?.status;
      const msg = err?.response?.data?.error;
      setErrors({
        form:
          msg ||
          (status === 409
            ? "Those details are already registered — try signing in instead."
            : "Could not create your account. Please try again."),
      });
      return;
    }

    // Registered. Sign them straight in instead of making them retype their
    // credentials on the login screen — that second step was the biggest
    // drop-off in the old flow.
    try {
      const login = await axios.post(`${apiURL}/login`, {
        username: uname,
        password: hashed,
      });
      if (login?.status === 200) {
        sileo.success({ title: `Welcome to TradeKaro, ${uname}` });
        // Full load rather than router.replace(): the same router-cache
        // problem as the login page. A cached signed-out redirect would
        // bounce them straight back off /dashboard and leave them staring at
        // the form they just submitted.
        window.location.assign("/dashboard");
        return;
      }
    } catch {
      /* fall through to the manual sign-in screen */
    }
    setLoading(false);
    sileo.success({ title: "Account created — please sign in" });
    window.location.assign("/login");
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
            Start trading on{" "}
            <span className="brand-gradient-text">live NSE prices</span>
          </h2>
          <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">
            Place orders against live market data and track every result in real
            time.
          </p>

          <ul className="mt-8 flex flex-col gap-3.5">
            {(
              [
                ["₹1,00,000", "starting capital"],
                ["Up to 20x", "leverage on intraday positions"],
                ["Live data", "real NSE prices and charts"],
              ] as const
            ).map(([head, tail]) => (
              <li key={head} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-positive/15 text-positive">
                  <FiCheck size={12} aria-hidden />
                </span>
                <span className="text-[13px]">
                  <span className="font-semibold text-foreground">{head}</span>{" "}
                  <span className="text-muted-foreground">{tail}</span>
                </span>
              </li>
            ))}
          </ul>
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
            <p className="mt-2.5 text-[12.5px] text-muted-foreground">
              ₹1,00,000 starting capital · up to 20x leverage · live NSE data
            </p>
          </div>

          <h1 className="text-[22px] font-semibold tracking-tight">
            Create your account
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Takes about twenty seconds.
          </p>

          <form
            onSubmit={handleSubmit}
            className="mt-6 flex flex-col gap-4"
            noValidate
          >
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-[11.5px] font-medium text-foreground/80"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoFocus
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => onEmailChange(e.target.value)}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? "email-error" : undefined}
                placeholder="you@example.com"
                className={fieldCls(Boolean(errors.email))}
              />
              {errors.email && (
                <ErrorLine id="email-error">{errors.email}</ErrorLine>
              )}
            </div>

            <div>
              <label
                htmlFor="phone"
                className="mb-1.5 block text-[11.5px] font-medium text-foreground/80"
              >
                Mobile number
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  +91
                </span>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  required
                  autoComplete="tel"
                  inputMode="numeric"
                  // Not 10: the raw value must survive long enough to be
                  // normalised, or "+91 98765 43210" gets truncated to
                  // "9198765" before normalisePhone() ever sees it.
                  maxLength={16}
                  value={phone}
                  onChange={(e) => {
                    // Normalise as they type: +91, 0 and spaces all collapse.
                    setPhone(normalisePhone(e.target.value));
                    if (errors.phone || errors.form)
                      setErrors((s) => ({
                        ...s,
                        phone: undefined,
                        form: undefined,
                      }));
                  }}
                  aria-invalid={Boolean(errors.phone)}
                  aria-describedby={errors.phone ? "phone-error" : "phone-hint"}
                  placeholder="98765 43210"
                  className={`${fieldCls(Boolean(errors.phone))} pl-12`}
                />
              </div>
              {errors.phone ? (
                <ErrorLine id="phone-error">{errors.phone}</ErrorLine>
              ) : (
                <p
                  id="phone-hint"
                  className="mt-1.5 text-[11px] text-muted-foreground"
                >
                  Used to sign in. No SMS code yet — so double-check it.
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="username"
                className="mb-1.5 block text-[11.5px] font-medium text-foreground/80"
              >
                Username
              </label>
              <input
                id="username"
                name="username"
                type="text"
                required
                autoComplete="username"
                value={username}
                onChange={(e) => {
                  setUsernameEdited(true);
                  setUsername(e.target.value);
                  if (errors.username || errors.form)
                    setErrors((s) => ({
                      ...s,
                      username: undefined,
                      form: undefined,
                    }));
                }}
                aria-invalid={Boolean(errors.username)}
                aria-describedby={
                  errors.username ? "username-error" : "username-hint"
                }
                placeholder="Pick a name"
                className={fieldCls(Boolean(errors.username))}
              />
              {errors.username ? (
                <ErrorLine id="username-error">{errors.username}</ErrorLine>
              ) : (
                <p
                  id="username-hint"
                  className="mt-1.5 text-[11px] text-muted-foreground"
                >
                  This is the name on the leaderboard.
                </p>
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
                  autoComplete="new-password"
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
                  placeholder={`At least ${MIN_PW} characters`}
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

              {password ? (
                <div className="mt-2">
                  <div className="flex gap-1" aria-hidden>
                    {[0, 1, 2, 3].map((i) => (
                      <span
                        key={i}
                        className={`h-1 flex-1 rounded-full ${
                          i < strength.score
                            ? barCls(strength.score)
                            : "bg-border"
                        }`}
                      />
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {strength.label} · mix letters, numbers and a symbol
                  </p>
                </div>
              ) : (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Use a mix of letters, numbers and a symbol.
                </p>
              )}
              {errors.password && (
                <ErrorLine id="password-error">{errors.password}</ErrorLine>
              )}
            </div>

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
              {loading ? <Loading /> : "CREATE ACCOUNT"}
            </button>
          </form>

          <p className="mt-6 text-center text-[13px] text-muted-foreground">
            Already have an account?{" "}
            <NavTransition
              href="/login"
              className="font-medium text-brand hover:underline"
            >
              Sign in
            </NavTransition>
          </p>

          <p className="mt-3 text-center text-[11px] text-muted-foreground/70">
            No card required. Capital is provided on signup.
          </p>
        </div>
      </div>
    </div>
  );
}
