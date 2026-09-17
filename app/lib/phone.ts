// Indian mobile helpers, shared by the server store and both auth screens so a
// number normalises identically everywhere it is typed, stored or looked up.
//
// NOTE: this is a format check, NOT a verification. Nothing proves the person
// entering the number owns it until SMS OTP is added — so treat a stored phone
// as a convenience identifier, not proof of identity.

/** Strip +91 / leading 0 / spaces / dashes; keep at most 10 digits. */
export function normalisePhone(raw: unknown): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length > 10 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d.slice(0, 10);
}

/** Indian mobile: exactly 10 digits, starting 6-9. */
export function isPhone(v: unknown): boolean {
  return /^[6-9]\d{9}$/.test(normalisePhone(v));
}

/** 9876543210 -> "+91 98765 43210" (anything else is returned as-is). */
export function formatPhone(v: unknown): string {
  const d = normalisePhone(v);
  if (d.length !== 10) return d;
  return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
}
