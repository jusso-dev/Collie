"use server";

import { and, eq, or, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { cronPatternForDate, isValidCampaignCron, scheduledTargetTime } from "@/lib/campaigns/schedule";
import { sendCampaignNow } from "@/lib/campaigns/send-campaign";
import { db } from "@/lib/db/client";
import {
  campaignTargets,
  campaigns,
  emailTemplates,
  employeeGroups,
  employees,
  events,
  groups,
  landingPages,
} from "@/lib/db/schema";

const campaignSchema = z.object({
  orgSlug: z.string().min(1),
  name: z.string().trim().min(2).max(120),
  emailTemplateId: z.string().min(1),
  landingPageId: z.string().min(1),
  targetGroupId: z.string().default("all"),
  sendStrategy: z.enum(["immediate", "drip", "randomised_over_window"]),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
});

function valueFromForm(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function createCampaign(formData: FormData) {
  const data = campaignSchema.parse({
    orgSlug: valueFromForm(formData, "orgSlug"),
    name: valueFromForm(formData, "name"),
    emailTemplateId: valueFromForm(formData, "emailTemplateId"),
    landingPageId: valueFromForm(formData, "landingPageId"),
    targetGroupId: valueFromForm(formData, "targetGroupId") || "all",
    sendStrategy: valueFromForm(formData, "sendStrategy"),
    startAt: valueFromForm(formData, "startAt") || undefined,
    endAt: valueFromForm(formData, "endAt") || undefined,
  });
  const organisation = await requireOrganisationForSlug(data.orgSlug);

  const [template] = await db
    .select({ id: emailTemplates.id })
    .from(emailTemplates)
    .where(
      and(
        eq(emailTemplates.id, data.emailTemplateId),
        or(eq(emailTemplates.organisationId, organisation.id), sql`${emailTemplates.organisationId} is null`),
      ),
    )
    .limit(1);

  if (!template) {
    throw new Error("Choose a template before creating the campaign.");
  }

  const [landingPage] = await db
    .select({ id: landingPages.id })
    .from(landingPages)
    .where(
      and(
        eq(landingPages.id, data.landingPageId),
        or(eq(landingPages.organisationId, organisation.id), sql`${landingPages.organisationId} is null`),
      ),
    )
    .limit(1);

  if (!landingPage) {
    throw new Error("Choose a landing page before creating the campaign.");
  }

  let targetEmployees = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.organisationId, organisation.id), eq(employees.active, true)));

  const targetGroupIds = data.targetGroupId === "all" ? [] : [data.targetGroupId];

  if (data.targetGroupId !== "all") {
    const [group] = await db
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.id, data.targetGroupId), eq(groups.organisationId, organisation.id)))
      .limit(1);

    if (!group) {
      throw new Error("Choose a valid group.");
    }

    const groupMembers = await db
      .select({ id: employees.id })
      .from(employeeGroups)
      .innerJoin(employees, eq(employees.id, employeeGroups.employeeId))
      .where(
        and(
          eq(employeeGroups.groupId, group.id),
          eq(employees.organisationId, organisation.id),
          eq(employees.active, true),
        ),
      );
    targetEmployees = groupMembers;
  }

  if (targetEmployees.length === 0) {
    throw new Error("Add employees to the selected target before creating a campaign.");
  }

  const startAt = data.startAt ? new Date(data.startAt) : null;
  const endAt = data.endAt ? new Date(data.endAt) : null;
  if (startAt && Number.isNaN(startAt.getTime())) {
    throw new Error("Choose a valid send window start.");
  }
  if (endAt && Number.isNaN(endAt.getTime())) {
    throw new Error("Choose a valid send window end.");
  }
  if (startAt && endAt && endAt <= startAt) {
    throw new Error("Send window end must be after the start.");
  }
  const status = startAt && startAt.getTime() > Date.now() ? "scheduled" : "draft";
  const scheduleCron = startAt ? cronPatternForDate(startAt) : null;

  if (scheduleCron && !isValidCampaignCron(scheduleCron)) {
    throw new Error("The selected send window could not be converted to a valid cron pattern.");
  }

  const [campaign] = await db
    .insert(campaigns)
    .values({
      organisationId: organisation.id,
      name: data.name,
      emailTemplateId: template.id,
      landingPageId: landingPage.id,
      targetGroupIds,
      sendStrategy: data.sendStrategy,
      status,
      startAt,
      endAt,
      scheduleCron,
      createdBy: organisation.userId,
    })
    .returning({ id: campaigns.id });

  await db.insert(campaignTargets).values(
    targetEmployees.map((employee, index) => ({
      campaignId: campaign.id,
      employeeId: employee.id,
      uniqueToken: crypto.randomBytes(24).toString("base64url"),
      scheduledAt:
        status === "scheduled" && startAt
          ? scheduledTargetTime({
              index,
              total: targetEmployees.length,
              strategy: data.sendStrategy,
              startAt,
              endAt,
            })
          : null,
    })),
  );

  revalidatePath(`/${data.orgSlug}/campaigns`);
  revalidatePath(`/${data.orgSlug}/campaigns/${campaign.id}`);
  revalidatePath(`/${data.orgSlug}/dashboard`);

  if (status === "scheduled" && startAt) {
    redirect(`/${data.orgSlug}/campaigns?scheduled=1`);
  }

  redirect(`/${data.orgSlug}/campaigns?created=1`);
}

const launchCampaignSchema = z.object({
  orgSlug: z.string().min(1),
  campaignId: z.string().min(1),
});

export async function launchCampaign(formData: FormData) {
  const data = launchCampaignSchema.parse({
    orgSlug: valueFromForm(formData, "orgSlug"),
    campaignId: valueFromForm(formData, "campaignId"),
  });
  const organisation = await requireOrganisationForSlug(data.orgSlug);

  const result = await sendCampaignNow({ organisation, campaignId: data.campaignId });

  revalidatePath(`/${data.orgSlug}/campaigns`);
  revalidatePath(`/${data.orgSlug}/campaigns/${data.campaignId}`);
  revalidatePath(`/${data.orgSlug}/reports`);
  revalidatePath(`/${data.orgSlug}/dashboard`);
  redirect(`/${data.orgSlug}/campaigns?sent=${result.sentCount}`);
}

const campaignStateSchema = z.object({
  orgSlug: z.string().min(1),
  campaignId: z.string().min(1),
  status: z.enum(["completed", "cancelled", "paused"]),
});

export async function updateCampaignStatus(formData: FormData) {
  const data = campaignStateSchema.parse({
    orgSlug: valueFromForm(formData, "orgSlug"),
    campaignId: valueFromForm(formData, "campaignId"),
    status: valueFromForm(formData, "status"),
  });
  const organisation = await requireOrganisationForSlug(data.orgSlug);

  await db
    .update(campaigns)
    .set({ status: data.status, updatedAt: new Date() })
    .where(and(eq(campaigns.id, data.campaignId), eq(campaigns.organisationId, organisation.id)));

  revalidatePath(`/${data.orgSlug}/campaigns`);
  revalidatePath(`/${data.orgSlug}/campaigns/${data.campaignId}`);
  revalidatePath(`/${data.orgSlug}/reports`);
  revalidatePath(`/${data.orgSlug}/dashboard`);
}

export async function markTargetEvent(formData: FormData) {
  const orgSlug = valueFromForm(formData, "orgSlug");
  const token = valueFromForm(formData, "token");
  const eventType = valueFromForm(formData, "eventType");
  const organisation = await requireOrganisationForSlug(orgSlug);

  if (!["opened", "clicked", "submitted", "reported", "trained"].includes(eventType)) {
    throw new Error("Unsupported event type.");
  }

  const [target] = await db
    .select({ id: campaignTargets.id })
    .from(campaignTargets)
    .innerJoin(campaigns, eq(campaigns.id, campaignTargets.campaignId))
    .where(and(eq(campaignTargets.uniqueToken, token), eq(campaigns.organisationId, organisation.id)))
    .limit(1);

  if (!target) {
    throw new Error("Campaign target is not available.");
  }

  const now = new Date();
  const timestamp =
    eventType === "opened"
      ? { openedAt: now }
      : eventType === "clicked"
        ? { clickedAt: now }
        : eventType === "submitted"
          ? { submittedAt: now }
          : eventType === "reported"
            ? { reportedAt: now }
            : { trainingCompletedAt: now };

  await db.update(campaignTargets).set({ ...timestamp, updatedAt: now }).where(eq(campaignTargets.id, target.id));
  await db.insert(events).values({
    campaignTargetId: target.id,
    eventType: eventType as "opened" | "clicked" | "submitted" | "reported" | "trained",
    metadata: { source: "manual_admin" },
    createdAt: now,
  });

  revalidatePath(`/${orgSlug}/campaigns`);
  revalidatePath(`/${orgSlug}/reports`);
  revalidatePath(`/${orgSlug}/dashboard`);
}
