"use server";

import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";

import {
  authoriseApiRequest,
  mintOrganisationApiKey,
  revokeOrganisationApiKey,
} from "@/lib/auth/api-key";
import { requireOrganisationRoleForSlug } from "@/lib/auth/organisation";
import { openTotpSecret, sealTotpSecret } from "@/lib/auth/totp";
import { db } from "@/lib/db/client";
import { employeeSyncRuns, organisations, type OutboundEndpointConfig, outboundEndpoints } from "@/lib/db/schema";
import {
  ensureOrganisationSiemSoarSigningKey,
  rotateOrganisationSiemSoarSigningKey,
  SIEM_SOAR_EVENT_TYPES,
} from "@/lib/integrations/siem-soar";
import { pathWithToast } from "@/lib/navigation/toast";

const REVEAL_COOKIE_PREFIX = "collie-api-key-reveal:";
const REVEAL_TTL_SECONDS = 60;

const slugSchema = z.object({ orgSlug: z.string().min(1) });
const siemSoarConnectorSchema = z.enum(["sentinel", "splunk_soar", "cortex_xsoar", "servicenow_sir"]);
const siemSoarFormatSchema = z.enum(["json", "cef", "leef"]);
const siemSoarEventTypeSchema = z.enum(SIEM_SOAR_EVENT_TYPES);
const siemSoarEndpointSchema = z.object({
  orgSlug: z.string().min(1),
  endpointId: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().url().max(2048),
  connector: siemSoarConnectorSchema,
  format: siemSoarFormatSchema,
  maxAttempts: z.coerce.number().int().min(1).max(10).default(5),
  enabled: z.boolean(),
  eventTypes: z.array(siemSoarEventTypeSchema).min(1),
  sentinelAzureCloud: z.enum(["public", "usgov", "china"]).default("public"),
  sentinelTenantId: z.string().trim().optional().default(""),
  sentinelClientId: z.string().trim().optional().default(""),
  sentinelClientSecret: z.string().optional().default(""),
  sentinelHasExistingClientSecret: z.boolean().default(false),
  sentinelDcrImmutableId: z.string().trim().optional().default(""),
  sentinelStreamName: z.string().trim().optional().default(""),
});

function stringFromForm(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function booleanFromForm(formData: FormData, key: string) {
  const value = formData.get(key);
  return value === "true" || value === "on" || value === "1";
}

function eventTypesFromForm(formData: FormData) {
  return formData.getAll("eventTypes").filter((value): value is string => typeof value === "string");
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
  redirect(pathWithToast(`/${orgSlug}/settings?tab=integrations`, "api-key-dismissed"), RedirectType.replace);
}

export async function mintIngestApiKey(formData: FormData) {
  const { orgSlug } = slugSchema.parse({ orgSlug: stringFromForm(formData, "orgSlug") });
  const organisation = await requireOrganisationRoleForSlug(orgSlug, ["owner", "admin"]);
  const { key } = await mintOrganisationApiKey(organisation.id);
  await stashRevealCookie(orgSlug, key);
  revalidatePath(`/${orgSlug}/settings`);
  redirect(pathWithToast(`/${orgSlug}/settings?tab=integrations`, "api-key-minted"), RedirectType.replace);
}

export async function rotateIngestApiKey(formData: FormData) {
  const { orgSlug } = slugSchema.parse({ orgSlug: stringFromForm(formData, "orgSlug") });
  const organisation = await requireOrganisationRoleForSlug(orgSlug, ["owner", "admin"]);
  const { key } = await mintOrganisationApiKey(organisation.id);
  await stashRevealCookie(orgSlug, key);
  revalidatePath(`/${orgSlug}/settings`);
  redirect(pathWithToast(`/${orgSlug}/settings?tab=integrations`, "api-key-rotated"), RedirectType.replace);
}

export async function revealIngestApiKey(formData: FormData) {
  const { orgSlug } = slugSchema.parse({ orgSlug: stringFromForm(formData, "orgSlug") });
  const organisation = await requireOrganisationRoleForSlug(orgSlug, ["owner", "admin"]);

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
  redirect(pathWithToast(`/${orgSlug}/settings?tab=integrations`, "api-key-revealed"), RedirectType.replace);
}

export async function revokeIngestApiKey(formData: FormData) {
  const { orgSlug } = slugSchema.parse({ orgSlug: stringFromForm(formData, "orgSlug") });
  const organisation = await requireOrganisationRoleForSlug(orgSlug, ["owner", "admin"]);
  await revokeOrganisationApiKey(organisation.id);
  const cookieStore = await cookies();
  cookieStore.delete(`${REVEAL_COOKIE_PREFIX}${orgSlug}`);
  revalidatePath(`/${orgSlug}/settings`);
  redirect(pathWithToast(`/${orgSlug}/settings?tab=integrations`, "api-key-revoked"), RedirectType.replace);
}

export async function recordTestSyncRun(formData: FormData) {
  const { orgSlug } = slugSchema.parse({ orgSlug: stringFromForm(formData, "orgSlug") });
  const organisation = await requireOrganisationRoleForSlug(orgSlug, ["owner", "admin"]);

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
  redirect(pathWithToast(`/${orgSlug}/settings?tab=integrations`, "sync-test"), RedirectType.replace);
}

export async function saveSiemSoarEndpoint(formData: FormData) {
  const data = siemSoarEndpointSchema.parse({
    orgSlug: stringFromForm(formData, "orgSlug"),
    endpointId: stringFromForm(formData, "endpointId") || undefined,
    name: stringFromForm(formData, "name"),
    url: stringFromForm(formData, "url"),
    connector: stringFromForm(formData, "connector"),
    format: stringFromForm(formData, "format") || "json",
    maxAttempts: stringFromForm(formData, "maxAttempts") || "5",
    enabled: booleanFromForm(formData, "enabled"),
    eventTypes: eventTypesFromForm(formData),
    sentinelAzureCloud: stringFromForm(formData, "sentinelAzureCloud") || "public",
    sentinelTenantId: stringFromForm(formData, "sentinelTenantId"),
    sentinelClientId: stringFromForm(formData, "sentinelClientId"),
    sentinelClientSecret: formData.get("sentinelClientSecret")?.toString() ?? "",
    sentinelHasExistingClientSecret: booleanFromForm(formData, "sentinelHasExistingClientSecret"),
    sentinelDcrImmutableId: stringFromForm(formData, "sentinelDcrImmutableId"),
    sentinelStreamName: stringFromForm(formData, "sentinelStreamName"),
  });
  const organisation = await requireOrganisationRoleForSlug(data.orgSlug, ["owner", "admin"]);

  let existingConfig: OutboundEndpointConfig | null = null;
  if (data.endpointId) {
    const [existing] = await db
      .select({ config: outboundEndpoints.config })
      .from(outboundEndpoints)
      .where(and(eq(outboundEndpoints.id, data.endpointId), eq(outboundEndpoints.organisationId, organisation.id)))
      .limit(1);
    existingConfig = existing?.config ?? null;
  }

  const config =
    data.connector === "sentinel"
      ? {
          sentinel: {
            azureCloud: data.sentinelAzureCloud,
            tenantId: requiredSentinelValue(data.sentinelTenantId, "Microsoft Entra tenant ID"),
            clientId: requiredSentinelValue(data.sentinelClientId, "Microsoft Entra client ID"),
            clientSecretEncrypted: sentinelClientSecretForSave(data, existingConfig),
            dcrImmutableId: requiredSentinelValue(data.sentinelDcrImmutableId, "DCR immutable ID"),
            streamName: requiredSentinelValue(data.sentinelStreamName, "DCR stream name"),
          },
        }
      : {};

  if (data.connector !== "sentinel") {
    await ensureOrganisationSiemSoarSigningKey(organisation.id);
  }

  if (data.endpointId) {
    await db
      .update(outboundEndpoints)
      .set({
        name: data.name,
        url: data.url,
        connector: data.connector,
        format: data.format,
        config,
        enabled: data.enabled,
        eventTypes: data.eventTypes,
        maxAttempts: data.maxAttempts,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(outboundEndpoints.id, data.endpointId),
          eq(outboundEndpoints.organisationId, organisation.id),
        ),
      );
  } else {
    await db.insert(outboundEndpoints).values({
      organisationId: organisation.id,
      name: data.name,
      url: data.url,
      connector: data.connector,
      format: data.format,
      config,
      enabled: data.enabled,
      eventTypes: data.eventTypes,
      maxAttempts: data.maxAttempts,
    });
  }

  revalidatePath(`/${data.orgSlug}/settings`);
  redirect(pathWithToast(`/${data.orgSlug}/settings?tab=integrations`, "siem-saved"), RedirectType.replace);
}

function requiredSentinelValue(value: string, label: string) {
  if (value.length === 0) {
    throw new Error(`${label} is required for Microsoft Sentinel endpoints.`);
  }
  return value;
}

function sentinelClientSecretForSave(
  data: z.infer<typeof siemSoarEndpointSchema>,
  existingConfig: OutboundEndpointConfig | null,
) {
  if (data.sentinelClientSecret.length > 0) {
    return sealTotpSecret(data.sentinelClientSecret);
  }
  if (data.sentinelHasExistingClientSecret && existingConfig?.sentinel?.clientSecretEncrypted) {
    return existingConfig.sentinel.clientSecretEncrypted;
  }
  throw new Error("Microsoft Entra client secret is required for Microsoft Sentinel endpoints.");
}

export async function deleteSiemSoarEndpoint(formData: FormData) {
  const { orgSlug } = slugSchema.parse({ orgSlug: stringFromForm(formData, "orgSlug") });
  const endpointId = stringFromForm(formData, "endpointId");
  if (!endpointId) throw new Error("Endpoint id is required.");

  const organisation = await requireOrganisationRoleForSlug(orgSlug, ["owner", "admin"]);
  await db
    .delete(outboundEndpoints)
    .where(and(eq(outboundEndpoints.id, endpointId), eq(outboundEndpoints.organisationId, organisation.id)));

  revalidatePath(`/${orgSlug}/settings`);
  redirect(pathWithToast(`/${orgSlug}/settings?tab=integrations`, "siem-deleted"), RedirectType.replace);
}

export async function rotateSiemSoarSigningKey(formData: FormData) {
  const { orgSlug } = slugSchema.parse({ orgSlug: stringFromForm(formData, "orgSlug") });
  const organisation = await requireOrganisationRoleForSlug(orgSlug, ["owner", "admin"]);
  await rotateOrganisationSiemSoarSigningKey(organisation.id);
  revalidatePath(`/${orgSlug}/settings`);
  redirect(pathWithToast(`/${orgSlug}/settings?tab=integrations`, "siem-key-rotated"), RedirectType.replace);
}
