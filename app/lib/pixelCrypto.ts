// Encryption for partner-supplied credentials.
//
// A partner's Meta Conversions API access token is a credential *they* own,
// handed to us to act on their behalf. It is not ours, we do not want it, and
// storing it in plain text would mean a single database read — a backup, a
// support export, a stolen copy — hands an attacker the ability to spend
// somebody else's advertising budget and inject conversions into their
// account.
//
// AES-256-GCM, which is authenticated: a tampered ciphertext fails to decrypt
// rather than yielding garbage that gets sent somewhere as a bearer token.
//
// FAILS CLOSED. With no key configured this refuses to encrypt, and the caller
// refuses to store the token, and the partner is told. The alternative —
// falling back to plaintext, or to a hardcoded default — would be a silent
// downgrade of exactly the thing this module exists to prevent.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

const PREFIX = "v1";

/**
 * 32 bytes, from `TRACKING_ENC_KEY` as base64 or hex.
 *
 * A short or non-key value is rejected rather than stretched: silently
 * stretching a 4-character secret into something that looks like a key is how
 * a deployment ends up encrypting with "test".
 */
function key(): Buffer | null {
  const raw = String(process.env.TRACKING_ENC_KEY || "").trim();
  if (!raw) return null;

  let buf: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, "hex");
  else {
    try {
      const b = Buffer.from(raw, "base64");
      if (b.length === 32) buf = b;
    } catch {
      /* not base64 */
    }
  }
  if (buf && buf.length === 32) return buf;

  // A passphrase is allowed, but it is hashed to a key rather than used as one,
  // so length is no longer a cryptographic problem.
  if (raw.length >= 16) return createHash("sha256").update(raw).digest();
  return null;
}

/** Can we store a credential right now? */
export function encryptionAvailable(): boolean {
  return key() !== null;
}

/**
 * `v1:<iv>:<tag>:<ciphertext>`, all base64. Null when no key is configured —
 * the caller must treat that as "cannot store this", not "store it anyway".
 */
export function encryptSecret(plain: string): string | null {
  const k = key();
  if (!k) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

/** Null on a missing key, a malformed blob, or a tampered one. */
export function decryptSecret(blob: string | null | undefined): string | null {
  const k = key();
  if (!k || !blob) return null;
  const parts = String(blob).split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  try {
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const ct = Buffer.from(parts[3], "base64");
    const d = createDecipheriv("aes-256-gcm", k, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch {
    // Wrong key or altered ciphertext. Either way: no credential.
    return null;
  }
}

/** Show the last four characters, for a partner to recognise their own token. */
export function secretHint(blob: string | null | undefined): string | null {
  const plain = decryptSecret(blob);
  if (!plain) return null;
  return plain.length <= 4 ? "••••" : `••••${plain.slice(-4)}`;
}
