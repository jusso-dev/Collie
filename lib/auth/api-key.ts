import crypto from "node:crypto";

import { eq } from "drizzle-orm";

import { sealTotpSecret } from "@/lib/auth/totp";
import { db } from "@/lib/db/client";
import { organisations } from "@/lib/db/schema";

const KEY_PREFIX = "clk_live_";

export function generateApiKey(): string {
  return `${KEY_PREFIX}${crypto.randomBytes(28).toString("base64url")}`;
}

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key.trim()).digest("hex");
}

export function lastFourOfKey(key: string): string {
  const trimmed = key.trim();
  return trimmed.slice(-4);
}

export type ApiAuthResult =
  | { ok: true; organisationId: string; apiKeyLast4: string }
  | { ok: false; status: number; error: string };

function readBearer(authorisation: string | null): string | null {
  if (!authorisation) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorisation.trim());
  return match ? match[1].trim() : null;
}

export async function authoriseApiRequest(headers: Headers): Promise<ApiAuthResult> {
  const token = readBearer(headers.get("authorization"));
  if (!token) {
    return { ok: false, status: 401, error: "Missing bearer token in Authorization header." };
  }
  if (!token.startsWith(KEY_PREFIX)) {
    return { ok: false, status: 401, error: "Invalid API key format." };
  }
  const hash = hashApiKey(token);

  const [row] = await db
    .select({ id: organisations.id, last4: organisations.apiKeyLast4 })
    .from(organisations)
    .where(eq(organisations.apiKeyHash, hash))
    .limit(1);

  if (!row) {
    return { ok: false, status: 401, error: "API key is not recognised." };
  }

  return { ok: true, organisationId: row.id, apiKeyLast4: row.last4 ?? lastFourOfKey(token) };
}

export async function mintOrganisationApiKey(organisationId: string): Promise<{ key: string; last4: string }> {
  const key = generateApiKey();
  const hash = hashApiKey(key);
  const last4 = lastFourOfKey(key);
  const sealed = sealTotpSecret(key);

  await db
    .update(organisations)
    .set({
      apiKeyEncrypted: sealed,
      apiKeyHash: hash,
      apiKeyLast4: last4,
      apiKeyCreatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(organisations.id, organisationId));

  return { key, last4 };
}

export async function revokeOrganisationApiKey(organisationId: string): Promise<void> {
  await db
    .update(organisations)
    .set({
      apiKeyEncrypted: null,
      apiKeyHash: null,
      apiKeyLast4: null,
      apiKeyCreatedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(organisations.id, organisationId));
}
