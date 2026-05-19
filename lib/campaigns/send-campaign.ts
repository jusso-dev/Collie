import { and, eq } from "drizzle-orm";

import {
  DEFAULT_WORKING_WINDOW,
  isInsideWorkingWindow,
  nextAllowedSendTime,
  type WorkingWindow,
} from "@/lib/campaigns/schedule";
import { db } from "@/lib/db/client";
import { campaignTargets, campaigns, emailTemplates, employees, events, organisations } from "@/lib/db/schema";
import { sendCampaignEmail } from "@/lib/email/campaign-sender";

type OrganisationSendConfig = {
  id: string;
  name: string;
  senderFromAddress: string | null;
  resendApiKeyEncrypted: string | null;
};

type LoadedCampaign = {
  id: string;
  name: string;
  status: string;
  templateId: string | null;
  templateSubject: string | null;
  templateHtml: string | null;
  templateText: string | null;
  workingHoursStart: number;
  workingHoursEnd: number;
  workingDays: number[];
  respectEmployeeTimezone: boolean;
};

type TargetRow = {
  id: string;
  token: string;
  sentAt: Date | null;
  scheduledAt: Date | null;
  employeeEmail: string;
  firstName: string;
  lastName: string;
  department?: string | null;
  employeeTimezone: string | null;
};

async function loadSendableCampaign(organisationId: string, campaignId: string) {
  return db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      templateId: campaigns.emailTemplateId,
      templateSubject: emailTemplates.subject,
      templateHtml: emailTemplates.htmlBody,
      templateText: emailTemplates.textBody,
      workingHoursStart: campaigns.workingHoursStart,
      workingHoursEnd: campaigns.workingHoursEnd,
      workingDays: campaigns.workingDays,
      respectEmployeeTimezone: campaigns.respectEmployeeTimezone,
    })
    .from(campaigns)
    .leftJoin(emailTemplates, eq(emailTemplates.id, campaigns.emailTemplateId))
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.organisationId, organisationId)))
    .limit(1);
}

function windowFor(campaign: LoadedCampaign): WorkingWindow {
  return {
    startMinute: campaign.workingHoursStart,
    endMinute: campaign.workingHoursEnd,
    allowedIsoDays: campaign.workingDays?.length ? campaign.workingDays : DEFAULT_WORKING_WINDOW.allowedIsoDays,
  };
}

function effectiveTimezone(campaign: LoadedCampaign, target: TargetRow): string | null {
  if (!campaign.respectEmployeeTimezone) return null;
  return target.employeeTimezone ?? "Australia/Sydney";
}

async function sendTarget(input: {
  organisation: OrganisationSendConfig;
  campaign: LoadedCampaign;
  target: TargetRow;
  now?: Date;
}): Promise<"sent" | "deferred" | "skipped"> {
  const { campaign, organisation, target } = input;
  const now = input.now ?? new Date();

  if (!campaign.templateId || !campaign.templateSubject || !campaign.templateHtml || !campaign.templateText) {
    throw new Error("This campaign needs a valid template before it can be sent.");
  }

  if (target.sentAt) {
    return "skipped";
  }

  if (target.scheduledAt && target.scheduledAt.getTime() > now.getTime()) {
    return "deferred";
  }

  const timeZone = effectiveTimezone(campaign, target);
  const window = windowFor(campaign);
  if (timeZone && !isInsideWorkingWindow(now, timeZone, window)) {
    const nextSlot = nextAllowedSendTime(now, timeZone, window);
    if (nextSlot.getTime() !== target.scheduledAt?.getTime()) {
      await db
        .update(campaignTargets)
        .set({ scheduledAt: nextSlot, updatedAt: now })
        .where(eq(campaignTargets.id, target.id));
    }
    return "deferred";
  }

  const result = await sendCampaignEmail({
    apiKey: organisation.resendApiKeyEncrypted!,
    from: organisation.senderFromAddress!,
    organisationName: organisation.name,
    template: {
      subject: campaign.templateSubject,
      htmlBody: campaign.templateHtml,
      textBody: campaign.templateText,
    },
    employee: {
      email: target.employeeEmail,
      firstName: target.firstName,
      lastName: target.lastName,
      department: target.department,
    },
    token: target.token,
  });

  await db.update(campaignTargets).set({ sentAt: now, updatedAt: now }).where(eq(campaignTargets.id, target.id));
  await db.insert(events).values({
    campaignTargetId: target.id,
    eventType: "sent",
    metadata: {
      messageId: result.messageId,
      from: organisation.senderFromAddress,
      recipient: target.employeeEmail,
      clickUrl: result.clickUrl,
      pixelUrl: result.pixelUrl,
      replyAddress: result.replyAddress,
    },
    createdAt: now,
  });

  return "sent";
}

async function loadTargets(campaignId: string, organisationId: string): Promise<TargetRow[]> {
  return db
    .select({
      id: campaignTargets.id,
      token: campaignTargets.uniqueToken,
      sentAt: campaignTargets.sentAt,
      scheduledAt: campaignTargets.scheduledAt,
      employeeEmail: employees.email,
      firstName: employees.firstName,
      lastName: employees.lastName,
      department: employees.department,
      employeeTimezone: employees.timezone,
    })
    .from(campaignTargets)
    .innerJoin(employees, eq(employees.id, campaignTargets.employeeId))
    .where(and(eq(campaignTargets.campaignId, campaignId), eq(employees.organisationId, organisationId)));
}

export async function sendCampaignNow(input: { organisation: OrganisationSendConfig; campaignId: string }) {
  const { organisation } = input;

  if (!organisation.resendApiKeyEncrypted || !organisation.senderFromAddress) {
    throw new Error("Add a Resend API key and sender From address in Settings before sending.");
  }

  const [campaign] = await loadSendableCampaign(organisation.id, input.campaignId);

  if (!campaign?.templateId || !campaign.templateSubject || !campaign.templateHtml || !campaign.templateText) {
    throw new Error("This campaign needs a valid template before it can be sent.");
  }

  if (!["draft", "scheduled", "paused", "running"].includes(campaign.status)) {
    throw new Error("This campaign has already been launched.");
  }

  const targets = await loadTargets(campaign.id, organisation.id);
  const unsentTargets = targets.filter((target) => !target.sentAt);

  if (unsentTargets.length === 0) {
    throw new Error("There are no unsent targets in this campaign.");
  }

  await db.update(campaigns).set({ status: "running", updatedAt: new Date() }).where(eq(campaigns.id, campaign.id));

  const now = new Date();
  let sentCount = 0;
  let deferredCount = 0;

  for (const target of unsentTargets) {
    const outcome = await sendTarget({ organisation, campaign, target, now });
    if (outcome === "sent") sentCount += 1;
    if (outcome === "deferred") deferredCount += 1;
  }

  return { campaignId: campaign.id, sentCount, deferredCount };
}

export async function sendCampaignTargetNow(input: {
  organisation: OrganisationSendConfig;
  campaignId: string;
  targetId: string;
}) {
  const { organisation } = input;

  if (!organisation.resendApiKeyEncrypted || !organisation.senderFromAddress) {
    throw new Error("Add a Resend API key and sender From address in Settings before sending.");
  }

  const [campaign] = await loadSendableCampaign(organisation.id, input.campaignId);

  if (!campaign) {
    throw new Error("Campaign is not available.");
  }

  if (!["draft", "scheduled", "paused", "running"].includes(campaign.status)) {
    throw new Error("This campaign has already been launched.");
  }

  const [target] = await db
    .select({
      id: campaignTargets.id,
      token: campaignTargets.uniqueToken,
      sentAt: campaignTargets.sentAt,
      scheduledAt: campaignTargets.scheduledAt,
      employeeEmail: employees.email,
      firstName: employees.firstName,
      lastName: employees.lastName,
      department: employees.department,
      employeeTimezone: employees.timezone,
    })
    .from(campaignTargets)
    .innerJoin(employees, eq(employees.id, campaignTargets.employeeId))
    .where(
      and(
        eq(campaignTargets.id, input.targetId),
        eq(campaignTargets.campaignId, campaign.id),
        eq(employees.organisationId, organisation.id),
      ),
    )
    .limit(1);

  if (!target) {
    throw new Error("Campaign target is not available.");
  }

  await db.update(campaigns).set({ status: "running", updatedAt: new Date() }).where(eq(campaigns.id, campaign.id));
  const outcome = await sendTarget({ organisation, campaign, target });

  return { campaignId: campaign.id, sentCount: outcome === "sent" ? 1 : 0, deferred: outcome === "deferred" };
}

export async function sendCampaignById(input: { organisationId: string; campaignId: string }) {
  const [organisation] = await db
    .select({
      id: organisations.id,
      name: organisations.name,
      senderFromAddress: organisations.senderFromAddress,
      resendApiKeyEncrypted: organisations.resendApiKeyEncrypted,
    })
    .from(organisations)
    .where(eq(organisations.id, input.organisationId))
    .limit(1);

  if (!organisation) {
    throw new Error("Organisation is not available.");
  }

  return sendCampaignNow({ organisation, campaignId: input.campaignId });
}

export async function sendCampaignTargetById(input: { organisationId: string; campaignId: string; targetId: string }) {
  const [organisation] = await db
    .select({
      id: organisations.id,
      name: organisations.name,
      senderFromAddress: organisations.senderFromAddress,
      resendApiKeyEncrypted: organisations.resendApiKeyEncrypted,
    })
    .from(organisations)
    .where(eq(organisations.id, input.organisationId))
    .limit(1);

  if (!organisation) {
    throw new Error("Organisation is not available.");
  }

  return sendCampaignTargetNow({ organisation, campaignId: input.campaignId, targetId: input.targetId });
}
