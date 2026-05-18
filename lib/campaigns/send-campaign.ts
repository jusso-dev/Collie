import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { campaignTargets, campaigns, emailTemplates, employees, events, organisations } from "@/lib/db/schema";
import { sendCampaignEmail } from "@/lib/email/campaign-sender";

type OrganisationSendConfig = {
  id: string;
  name: string;
  senderFromAddress: string | null;
  resendApiKeyEncrypted: string | null;
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
    })
    .from(campaigns)
    .leftJoin(emailTemplates, eq(emailTemplates.id, campaigns.emailTemplateId))
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.organisationId, organisationId)))
    .limit(1);
}

async function sendTarget(input: {
  organisation: OrganisationSendConfig;
  campaign: {
    id: string;
    status: string;
    templateId: string | null;
    templateSubject: string | null;
    templateHtml: string | null;
    templateText: string | null;
  };
  target: {
    id: string;
    token: string;
    sentAt: Date | null;
    employeeEmail: string;
    firstName: string;
    lastName: string;
    department?: string | null;
  };
}) {
  const { campaign, organisation, target } = input;

  if (!campaign.templateId || !campaign.templateSubject || !campaign.templateHtml || !campaign.templateText) {
    throw new Error("This campaign needs a valid template before it can be sent.");
  }

  if (target.sentAt) {
    return false;
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

  const sentAt = new Date();
  await db.update(campaignTargets).set({ sentAt, updatedAt: sentAt }).where(eq(campaignTargets.id, target.id));
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
    createdAt: sentAt,
  });

  return true;
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

  const targets = await db
    .select({
      id: campaignTargets.id,
      token: campaignTargets.uniqueToken,
      sentAt: campaignTargets.sentAt,
      employeeEmail: employees.email,
      firstName: employees.firstName,
      lastName: employees.lastName,
      department: employees.department,
    })
    .from(campaignTargets)
    .innerJoin(employees, eq(employees.id, campaignTargets.employeeId))
    .where(and(eq(campaignTargets.campaignId, campaign.id), eq(employees.organisationId, organisation.id)));

  const unsentTargets = targets.filter((target) => !target.sentAt);

  if (unsentTargets.length === 0) {
    throw new Error("There are no unsent targets in this campaign.");
  }

  await db.update(campaigns).set({ status: "running", updatedAt: new Date() }).where(eq(campaigns.id, campaign.id));

  for (const target of unsentTargets) {
    await sendTarget({ organisation, campaign, target });
  }

  return { campaignId: campaign.id, sentCount: unsentTargets.length };
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
      employeeEmail: employees.email,
      firstName: employees.firstName,
      lastName: employees.lastName,
      department: employees.department,
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
  const sent = await sendTarget({ organisation, campaign, target });

  return { campaignId: campaign.id, sentCount: sent ? 1 : 0 };
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
