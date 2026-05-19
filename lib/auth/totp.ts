import crypto from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(byteLength = 20): string {
  const buffer = crypto.randomBytes(byteLength);
  return encodeBase32(buffer);
}

export function buildOtpauthUrl(input: { secret: string; accountName: string; issuer: string }): string {
  const label = encodeURIComponent(`${input.issuer}:${input.accountName}`);
  const params = new URLSearchParams({ secret: input.secret, issuer: input.issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function verifyTotpCode(secret: string, code: string, options?: { drift?: number; nowSeconds?: number }): boolean {
  const cleaned = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  const drift = options?.drift ?? 1;
  const nowSeconds = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
  const counter = Math.floor(nowSeconds / 30);
  const key = decodeBase32(secret);

  for (let offset = -drift; offset <= drift; offset += 1) {
    const candidate = generateTotpAtCounter(key, counter + offset);
    if (timingSafeEqualStrings(candidate, cleaned)) return true;
  }
  return false;
}

function generateTotpAtCounter(key: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(counterBuffer).digest();
  const dynamicOffset = hmac[hmac.length - 1] & 0xf;
  const binary =
    ((hmac[dynamicOffset] & 0x7f) << 24) |
    ((hmac[dynamicOffset + 1] & 0xff) << 16) |
    ((hmac[dynamicOffset + 2] & 0xff) << 8) |
    (hmac[dynamicOffset + 3] & 0xff);
  const code = binary % 1_000_000;
  return code.toString().padStart(6, "0");
}

function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

function decodeBase32(input: string): Buffer {
  const cleaned = input.replace(/=+$/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

function deriveSecretKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET ?? "dev-only-collie-secret-change-me";
  return crypto.createHash("sha256").update(`collie:mfa-vault:${secret}`).digest();
}

export function sealTotpSecret(secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveSecretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function openTotpSecret(sealed: string): string {
  const buffer = Buffer.from(sealed, "base64");
  const iv = buffer.subarray(0, 12);
  const authTag = buffer.subarray(12, 28);
  const cipherText = buffer.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveSecretKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(cipherText), decipher.final()]).toString("utf8");
}
