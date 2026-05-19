"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { recordAudit } from "@/lib/audit/record";
import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import {
  buildWatermarkedProvenanceMetadata,
  calculateDeepfakeAssetExpiry,
  loadDeepfakeLaunchGuardState,
} from "@/lib/deepfake/assets";
import { db } from "@/lib/db/client";
import { campaignApprovals, campaigns, deepfakeAssets, users } from "@/lib/db/schema";

function valueFromForm(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function requireDeepfakeAdmin(orgSlug: string) {
  const organisation = await requireOrganisationForSlug(orgSlug);
  const [currentUser] = await db
    .select({ role: users.role, active: users.active })
    .from(users)
    .where(and(eq(users.id, organisation.userId), eq(users.organisationId, organisation.id)))
    .limit(1);

  if (!currentUser?.active || !["owner", "admin"].includes(currentUser.role)) {
    throw new Error("Only owners and admins can manage deepfake campaign approvals.");
  }

  return organisation;
}

const assetSchema = z.object({
  orgSlug: z.string().min(1),
  campaignId: z.string().min(1),
  executiveName: z.string().trim().min(2).max(140),
  assetUrl: z.string().trim().url(),
  source: z.string().trim().max(500).optional(),
  contentSha256: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
});

export async function registerDeepfakeAsset(formData: FormData) {
  const data = assetSchema.parse({
    orgSlug: valueFromForm(formData, "orgSlug"),
    campaignId: valueFromForm(formData, "campaignId"),
    executiveName: valueFromForm(formData, "executiveName"),
    assetUrl: valueFromForm(formData, "assetUrl"),
    source: valueFromForm(formData, "source") || undefined,
    contentSha256: valueFromForm(formData, "contentSha256") || undefined,
  });
  const organisation = await requireDeepfakeAdmin(data.orgSlug);
  const [campaign] = await db
    .select({ id: campaigns.id, endAt: campaigns.endAt })
    .from(campaigns)
    .where(and(eq(campaigns.id, data.campaignId), eq(campaigns.organisationId, organisation.id)))
    .limit(1);

  if (!campaign) {
    throw new Error("Campaign is not available.");
  }

  const now = new Date();
  const expiresAt = calculateDeepfakeAssetExpiry({
    campaignEndAt: campaign.endAt,
    assetCreatedAt: now,
  });
  const { watermark, provenance } = buildWatermarkedProvenanceMetadata({
    organisationId: organisation.id,
    campaignId: campaign.id,
    executiveName: data.executiveName,
    assetUrl: data.assetUrl,
    createdByUserId: organisation.userId,
    createdAt: now,
    expiresAt,
    source: data.source,
    contentSha256: data.contentSha256,
  });

  const [asset] = await db.transaction(async (tx) => {
    const [createdAsset] = await tx
      .insert(deepfakeAssets)
      .values({
        campaignId: campaign.id,
        executiveName: data.executiveName,
        assetUrl: data.assetUrl,
        watermark,
        provenance,
        status: "pending_approval",
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: deepfakeAssets.id });

    await tx.delete(campaignApprovals).where(eq(campaignApprovals.campaignId, campaign.id));
    await tx
      .update(deepfakeAssets)
      .set({ status: "pending_approval", updatedAt: now })
      .where(and(eq(deepfakeAssets.campaignId, campaign.id), inArray(deepfakeAssets.status, ["approved", "rejected"])));

    return [createdAsset];
  });

  await recordAudit({
    organisationId: organisation.id,
    actorUserId: organisation.userId,
    action: "deepfake_asset.register",
    resourceType: "deepfake_asset",
    resourceId: asset.id,
    metadata: {
      campaignId: campaign.id,
      executiveName: data.executiveName,
      expiresAt: expiresAt.toISOString(),
      watermark,
    },
  });

  revalidatePath(`/${data.orgSlug}/campaigns`);
  revalidatePath(`/${data.orgSlug}/campaigns/${campaign.id}`);
}

const approvalSchema = z.object({
  orgSlug: z.string().min(1),
  campaignId: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().max(500).optional(),
});

export async function recordDeepfakeCampaignApproval(formData: FormData) {
  const data = approvalSchema.parse({
    orgSlug: valueFromForm(formData, "orgSlug"),
    campaignId: valueFromForm(formData, "campaignId"),
    decision: valueFromForm(formData, "decision"),
    reason: valueFromForm(formData, "reason") || undefined,
  });
  const organisation = await requireDeepfakeAdmin(data.orgSlug);
  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.id, data.campaignId), eq(campaigns.organisationId, organisation.id)))
    .limit(1);

  if (!campaign) {
    throw new Error("Campaign is not available.");
  }

  const now = new Date();
  await db
    .insert(campaignApprovals)
    .values({
      campaignId: campaign.id,
      approverUserId: organisation.userId,
      decision: data.decision,
      reason: data.reason ?? null,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [campaignApprovals.campaignId, campaignApprovals.approverUserId],
      set: {
        decision: data.decision,
        reason: data.reason ?? null,
        createdAt: now,
      },
    });

  const guardState = await loadDeepfakeLaunchGuardState({
    organisationId: organisation.id,
    campaignId: campaign.id,
    now,
  });

  if (data.decision === "rejected") {
    await db
      .update(deepfakeAssets)
      .set({ status: "rejected", updatedAt: now })
      .where(and(eq(deepfakeAssets.campaignId, campaign.id), eq(deepfakeAssets.status, "pending_approval")));
  } else if (guardState.approvedApproverIds.length >= 2) {
    await db
      .update(deepfakeAssets)
      .set({ status: "approved", updatedAt: now })
      .where(and(eq(deepfakeAssets.campaignId, campaign.id), eq(deepfakeAssets.status, "pending_approval")));
  }

  await recordAudit({
    organisationId: organisation.id,
    actorUserId: organisation.userId,
    action: "deepfake_campaign.approval",
    resourceType: "campaign",
    resourceId: campaign.id,
    metadata: {
      decision: data.decision,
      approvedApproverCount: guardState.approvedApproverIds.length,
      approvedAssetCount: guardState.approvedAssetCount,
    },
  });

  revalidatePath(`/${data.orgSlug}/campaigns`);
  revalidatePath(`/${data.orgSlug}/campaigns/${campaign.id}`);
}
