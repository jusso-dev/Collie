import { eq, sql } from "drizzle-orm";

import { sealTotpSecret } from "@/lib/auth/totp";
import { db } from "@/lib/db/client";
import { organisations } from "@/lib/db/schema";

/**
 * Resend API key prefix. New keys (`re_…`) are short enough that an
 * accidentally-plaintext value still fits inside the `text` column that
 * also stores AES-GCM ciphertext (base64). The pattern below matches the
 * complete plaintext shape so we never mistake a sealed value (random
 * base64) for a plaintext key.
 */
const RESEND_PLAINTEXT_PATTERN = /^re_[A-Za-z0-9_-]+$/;

export type ResendKeyBackfillResult = {
  scanned: number;
  sealed: number;
  errors: string[];
};

/**
 * Find any rows whose `resend_api_key_encrypted` column still holds a
 * plaintext Resend key (legacy data from before the AES-GCM wrapper
 * landed) and seal them at rest. Safe to run on every boot — idempotent
 * because rows that no longer match the plaintext pattern are skipped.
 */
export async function backfillSealedResendKeys(): Promise<ResendKeyBackfillResult> {
  const result: ResendKeyBackfillResult = { scanned: 0, sealed: 0, errors: [] };

  const candidates = await db
    .select({
      id: organisations.id,
      resendApiKeyEncrypted: organisations.resendApiKeyEncrypted,
    })
    .from(organisations)
    .where(sql`${organisations.resendApiKeyEncrypted} ~ '^re_[A-Za-z0-9_-]+$'`);

  result.scanned = candidates.length;

  for (const row of candidates) {
    if (!row.resendApiKeyEncrypted || !RESEND_PLAINTEXT_PATTERN.test(row.resendApiKeyEncrypted)) {
      continue;
    }
    try {
      const sealed = sealTotpSecret(row.resendApiKeyEncrypted);
      await db
        .update(organisations)
        .set({ resendApiKeyEncrypted: sealed })
        .where(eq(organisations.id, row.id));
      result.sealed += 1;
      console.log(`[secret-backfill] sealed plaintext resend key for org=${row.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`${row.id}: ${message}`);
      console.error(`[secret-backfill] failed to seal resend key org=${row.id}: ${message}`);
    }
  }

  return result;
}
