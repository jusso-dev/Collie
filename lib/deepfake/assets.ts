import crypto from "node:crypto";

import { and, eq, inArray, lte, ne, or } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  campaignApprovals,
  campaigns,
  deepfakeAssets,
  emailTemplates,
  landingPages,
  users,
} from "@/lib/db/schema";

export const DEEPFAKE_ASSET_RETENTION_DAYS = 30;

const ADMIN_ROLES = ["owner", "admin"] as const;

export type DeepfakeProvenanceInput = {
  organisationId: string;
  campaignId: string;
  executiveName: string;
  assetUrl: string;
  createdByUserId: string;
  createdAt?: Date;
  expiresAt?: Date;
  source?: string | null;
  contentSha256?: string | null;
};

export type DeepfakeLaunchGuardResult = {
  requiresApproval: boolean;
  approvedApproverIds: string[];
  approvedAssetCount: number;
  expiredAssetCount: number;
};

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function calculateDeepfakeAssetExpiry(input: {
  campaignEndAt?: Date | null;
  assetCreatedAt?: Date;
}) {
  return addDays(input.campaignEndAt ?? input.assetCreatedAt ?? new Date(), DEEPFAKE_ASSET_RETENTION_DAYS);
}

export function buildWatermarkedProvenanceMetadata(input: DeepfakeProvenanceInput) {
  const createdAt = input.createdAt ?? new Date();
  const expiresAt = input.expiresAt ?? calculateDeepfakeAssetExpiry({ assetCreatedAt: createdAt });
  const digest = crypto
    .createHash("sha256")
    .update(
      [
        input.organisationId,
        input.campaignId,
        input.executiveName,
        input.assetUrl,
        input.createdByUserId,
        createdAt.toISOString(),
      ].join(":"),
    )
    .digest("hex");
  const watermark = `collie-deepfake-simulation:${digest.slice(0, 24)}`;

  return {
    watermark,
    provenance: {
      type: "deepfake_executive_impersonation_simulation",
      watermark,
      organisationId: input.organisationId,
      campaignId: input.campaignId,
      executiveName: input.executiveName,
      assetUrl: input.assetUrl,
      createdByUserId: input.createdByUserId,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      retentionDays: DEEPFAKE_ASSET_RETENTION_DAYS,
      source: input.source?.trim() || null,
      contentSha256: input.contentSha256?.trim() || null,
      disclosure: "Generated or transformed media for an authorised Collie security awareness simulation.",
    } satisfies Record<string, unknown>,
  };
}

export async function expireDeepfakeAssetsForCampaign(input: {
  campaignId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const expiredRows = await db
    .update(deepfakeAssets)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(deepfakeAssets.campaignId, input.campaignId),
        lte(deepfakeAssets.expiresAt, now),
        ne(deepfakeAssets.status, "expired"),
      ),
    )
    .returning({ id: deepfakeAssets.id });

  return expiredRows.length;
}

export async function loadDeepfakeLaunchGuardState(input: {
  organisationId: string;
  campaignId: string;
  now?: Date;
}): Promise<DeepfakeLaunchGuardResult> {
  const now = input.now ?? new Date();
  const [campaign] = await db
    .select({
      id: campaigns.id,
      templateCategory: emailTemplates.category,
      landingPageType: landingPages.type,
    })
    .from(campaigns)
    .leftJoin(emailTemplates, eq(emailTemplates.id, campaigns.emailTemplateId))
    .leftJoin(landingPages, eq(landingPages.id, campaigns.landingPageId))
    .where(and(eq(campaigns.id, input.campaignId), eq(campaigns.organisationId, input.organisationId)))
    .limit(1);

  if (!campaign) {
    throw new Error("Campaign is not available.");
  }

  const assetRows = await db
    .select({
      id: deepfakeAssets.id,
      status: deepfakeAssets.status,
      expiresAt: deepfakeAssets.expiresAt,
    })
    .from(deepfakeAssets)
    .where(eq(deepfakeAssets.campaignId, campaign.id));

  const requiresApproval =
    campaign.templateCategory === "deepfake_exec" ||
    campaign.landingPageType === "deepfake_disclosure" ||
    assetRows.length > 0;

  if (!requiresApproval) {
    return {
      requiresApproval: false,
      approvedApproverIds: [],
      approvedAssetCount: 0,
      expiredAssetCount: 0,
    };
  }

  const expiredAssetIds = assetRows
    .filter((asset) => asset.status !== "expired" && asset.expiresAt.getTime() <= now.getTime())
    .map((asset) => asset.id);

  if (expiredAssetIds.length > 0) {
    await db
      .update(deepfakeAssets)
      .set({ status: "expired", updatedAt: now })
      .where(inArray(deepfakeAssets.id, expiredAssetIds));
  }

  const approvedAssetCount = assetRows.filter(
    (asset) => asset.status === "approved" && asset.expiresAt.getTime() > now.getTime(),
  ).length;

  const approvalRows = await db
    .select({
      approverUserId: campaignApprovals.approverUserId,
    })
    .from(campaignApprovals)
    .innerJoin(users, eq(users.id, campaignApprovals.approverUserId))
    .where(
      and(
        eq(campaignApprovals.campaignId, campaign.id),
        eq(campaignApprovals.decision, "approved"),
        eq(users.organisationId, input.organisationId),
        eq(users.active, true),
        or(...ADMIN_ROLES.map((role) => eq(users.role, role))),
      ),
    );

  return {
    requiresApproval: true,
    approvedApproverIds: Array.from(new Set(approvalRows.map((row) => row.approverUserId))),
    approvedAssetCount,
    expiredAssetCount: expiredAssetIds.length,
  };
}

export async function assertCampaignDeepfakeLaunchAllowed(input: {
  organisationId: string;
  campaignId: string;
  now?: Date;
}) {
  const state = await loadDeepfakeLaunchGuardState(input);

  if (!state.requiresApproval) {
    return state;
  }

  if (state.approvedAssetCount < 1) {
    throw new Error("Deepfake executive campaigns need an approved, unexpired asset before launch.");
  }

  if (state.approvedApproverIds.length < 2) {
    throw new Error("Deepfake executive campaigns need approvals from two distinct active owners or admins before launch.");
  }

  return state;
}
