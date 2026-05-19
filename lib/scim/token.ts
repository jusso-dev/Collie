import crypto from "node:crypto";

import { sealTotpSecret } from "@/lib/auth/totp";

const TOKEN_PREFIX = "collie_scim_";

/**
 * Mints a fresh SCIM bearer token. Returns the plaintext (caller must show once
 * to the operator), an AES-GCM sealed copy for at-rest storage, and a SHA-256
 * hex digest for indexed lookup at request time.
 */
export function mintScimToken(): {
  plaintext: string;
  sealed: string;
  hash: string;
} {
  const entropy = crypto.randomBytes(32).toString("base64url");
  const plaintext = `${TOKEN_PREFIX}${entropy}`;
  return {
    plaintext,
    sealed: sealTotpSecret(plaintext),
    hash: hashScimToken(plaintext),
  };
}

/**
 * Stable SHA-256 hash for SCIM bearer tokens. Used as a unique index lookup
 * key so we never need to decrypt to authenticate a request.
 */
export function hashScimToken(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Masks the sealed token for display in operator UI: shows the prefix and the
 * last 4 entropy chars so the operator can verify they pasted the right one.
 */
export function maskScimToken(plaintext: string): string {
  if (plaintext.length < 8) return "•••";
  return `${plaintext.slice(0, TOKEN_PREFIX.length + 4)}…${plaintext.slice(-4)}`;
}
