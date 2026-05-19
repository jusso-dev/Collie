"use server";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  authoriseApiRequest,
  mintOrganisationApiKey,
  revokeOrganisationApiKey,
} from "@/lib/auth/api-key";
import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { openTotpSecret } from "@/lib/auth/totp";
import { db } from "@/lib/db/client";
import { employeeSyncRuns, organisations } from "@/lib/db/schema";

const REVEAL_COOKIE_PREFIX = "collie-api-key-reveal:";
const REVEAL_TTL_SECONDS = 60;

const slugSchema = z.object({ orgSlug: z.string().min(1) });

function stringFromForm(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function stashRevealCookie(orgSlug: string, key: string) {
  const cookieStore = await cookies();
  cookieStore.set({
    name: `${REVEAL_COOKIE_PREFIX}${orgSlug}`,
    value: key,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: REVEAL_TTL_SECONDS,
    path: `/${orgSlug}`,
  });
}

export async function readPendingApiKeyReveal(orgSlug: string): Promise<string | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(`${REVEAL_COOKIE_PREFIX}${orgSlug}`);
  return cookie?.value ?? null;
}

export async function dismissPendingApiKeyReveal(formData: FormData) {
  const { orgSlug } = slugSchema.parse({ orgSlug: stringFromForm(formData, "orgSlug") });
  const cookieStore = await cookies();
  cookieStore.delete(`${REVEAL_COOKIE_PREFIX}${orgSlug}`);
  revalidatePath(`/${orgSlug}/settings`);
}

export async function mintIngestApiKey(formData: FormData) {
  const { orgSlug } = slugSchema.parse({ orgSlug: stringFromForm(formData, "orgSlug") });
  const organisation = await requireOrganisationForSlug(orgSlug);
  const { key } = await mintOrganisationApiKey(organisation.id);
  await stashRevealCookie(orgSlug, key);
  revalidatePath(`/${orgSlug}/settings`);
}

export async function rotateIngestApiKey(formData: FormData) {
  const { orgSlug } = slugSchema.parse({ orgSlug: stringFromForm(formData, "orgSlug") });
  const organisation = await requireOrganisationForSlug(orgSlug);
  const { key } = await mintOrganisationApiKey(organisation.id);
  await stashRevealCookie(orgSlug, key);
  revalidatePath(`/${orgSlug}/settings`);
}

export async function revealIngestApiKey(formData: FormData) {
  const { orgSlug } = slugSchema.parse({ orgSlug: stringFromForm(formData, "orgSlug") });
  const organisation = await requireOrganisationForSlug(orgSlug);

  const [row] = await db
    .select({ apiKeyEncrypted: organisations.apiKeyEncrypted })
    .from(organisations)
    .where(eq(organisations.id, organisation.id))
    .limit(1);

  if (!row?.apiKeyEncrypted) {
    throw new Error("Mint an API key before trying to reveal it.");
  }

  const key = openTotpSecret(row.apiKeyEncrypted);
  await stashRevealCookie(orgSlug, key);
  revalidatePath(`/${orgSlug}/settings`);
}

export async function revokeIngestApiKey(formData: FormData) {
  const { orgSlug } = slugSchema.parse({ orgSlug: stringFromForm(formData, "orgSlug") });
  const organisation = await requireOrganisationForSlug(orgSlug);
  await revokeOrganisationApiKey(organisation.id);
  const cookieStore = await cookies();
  cookieStore.delete(`${REVEAL_COOKIE_PREFIX}${orgSlug}`);
  revalidatePath(`/${orgSlug}/settings`);
}

export async function recordTestSyncRun(formData: FormData) {
  const { orgSlug } = slugSchema.parse({ orgSlug: stringFromForm(formData, "orgSlug") });
  const organisation = await requireOrganisationForSlug(orgSlug);

  // Read the key (if minted) to validate it round-trips via the same Bearer path the API uses.
  const [row] = await db
    .select({
      apiKeyEncrypted: organisations.apiKeyEncrypted,
      apiKeyLast4: organisations.apiKeyLast4,
    })
    .from(organisations)
    .where(eq(organisations.id, organisation.id))
    .limit(1);

  if (!row?.apiKeyEncrypted) {
    throw new Error("Mint an API key before testing the webhook.");
  }

  const key = openTotpSecret(row.apiKeyEncrypted);
  const headers = new Headers({ authorization: `Bearer ${key}` });
  const result = await authoriseApiRequest(headers);

  if (!result.ok) {
    throw new Error(`Test failed: ${result.error}`);
  }

  await db.insert(employeeSyncRuns).values({
    organisationId: organisation.id,
    mode: "single",
    source: "test",
    actorKeyLast4: result.apiKeyLast4 ?? row.apiKeyLast4 ?? null,
    receivedCount: 0,
    addedCount: 0,
    updatedCount: 0,
    deactivatedCount: 0,
    skippedCount: 0,
    errors: [],
  });

  revalidatePath(`/${orgSlug}/settings`);
}
