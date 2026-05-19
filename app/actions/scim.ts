"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { organisations, users } from "@/lib/db/schema";
import { mintScimToken } from "@/lib/scim/token";

const schema = z.object({
  orgSlug: z.string().min(1),
});

function formValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function requireScimAdmin(orgSlug: string) {
  const organisation = await requireOrganisationForSlug(orgSlug);
  const [currentUser] = await db
    .select({ role: users.role, active: users.active })
    .from(users)
    .where(eq(users.id, organisation.userId))
    .limit(1);
  if (!currentUser?.active || !["owner", "admin"].includes(currentUser.role)) {
    throw new Error("Only owners and admins can manage SCIM provisioning.");
  }
  return organisation;
}

/**
 * Mints (or rotates) the SCIM bearer token for the supplied organisation.
 * Returns nothing — the freshly minted plaintext token is stashed in a
 * cookie-free, request-scoped way by persisting the sealed copy and surfacing
 * the plaintext through `revalidatePath` + a query string flag set by the
 * caller's redirect. Instead, we surface the plaintext via the form-result
 * page which is rendered server-side from the latest token issuance.
 *
 * Implementation note: rotating immediately invalidates the previous token
 * because authentication looks up `scim_token_hash` which is overwritten by
 * this update.
 */
export async function rotateScimToken(formData: FormData): Promise<{ plaintext: string }> {
  const data = schema.parse({ orgSlug: formValue(formData, "orgSlug") });
  const organisation = await requireScimAdmin(data.orgSlug);

  const { plaintext, sealed, hash } = mintScimToken();

  await db
    .update(organisations)
    .set({
      scimTokenEncrypted: sealed,
      scimTokenHash: hash,
      scimTokenIssuedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(organisations.id, organisation.id));

  revalidatePath(`/${data.orgSlug}/settings`);
  return { plaintext };
}

/**
 * Revokes the active SCIM token without issuing a replacement. Used when an
 * admin wants to disable provisioning entirely (e.g. before disconnecting the
 * Entra ID Enterprise App).
 */
export async function revokeScimToken(formData: FormData): Promise<void> {
  const data = schema.parse({ orgSlug: formValue(formData, "orgSlug") });
  const organisation = await requireScimAdmin(data.orgSlug);

  await db
    .update(organisations)
    .set({
      scimTokenEncrypted: null,
      scimTokenHash: null,
      scimTokenIssuedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(organisations.id, organisation.id));

  revalidatePath(`/${data.orgSlug}/settings`);
}
