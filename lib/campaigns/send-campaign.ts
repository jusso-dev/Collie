import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  DEFAULT_WORKING_WINDOW,
  isInsideWorkingWindow,
  nextAllowedSendTime,
  type WorkingWindow,
} from "@/lib/campaigns/schedule";
import { assertCampaignDeepfakeLaunchAllowed } from "@/lib/deepfake/assets";
import { db } from "@/lib/db/client";
import {
  campaignTargets,
  campaignVariants,
  campaigns,
  emailTemplates,
  employees,
  events,
  organisations,
  smsOptOuts,
} from "@/lib/db/schema";
import {
  getTransportForOrganisation,
  TransientSendError,
  type CampaignTransport,
  type OrganisationTransportConfig,
} from "@/lib/email/campaign-sender";
import { inngest } from "@/lib/inngest/client";
import { normalizeSmsPhoneNumber } from "@/lib/sms/phone";
import { buildUsbTrainingRedirectPayload } from "@/lib/usb/payload";
import {
  hasTwilioSmsConfig,
  isRetryableTwilioSmsError,
  sendTwilioSms,
  TwilioSmsConfigurationError,
  type TwilioSmsOrganisationConfig,
} from "@/lib/sms/twilio";
import {
  assertVoiceCampaignCanSend,
  mergeVoiceConfig,
  sendVoiceCampaignCall,
  type OrganisationVoiceConfig,
} from "@/lib/voice/twilio";

type DeliveryChannelName = "email" | "sms" | "voice" | "qr" | "attachment" | "usb";

type OrganisationSendConfig = OrganisationTransportConfig & TwilioSmsOrganisationConfig & OrganisationVoiceConfig & {
  id: string;
};

type LoadedCampaign = {
  id: string;
  name: string;
  status: string;
  deliveryChannel: DeliveryChannelName;
  templateId: string | null;
  templateSubject: string | null;
  templateHtml: string | null;
  templateText: string | null;
  templateCategory: string | null;
  templateRegion: string | null;
  scenario: string | null;
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
  campaignVariantId: string | null;
  variantTemplateId: string | null;
  variantTemplateSubject: string | null;
  variantTemplateHtml: string | null;
  variantTemplateText: string | null;
  variantTemplateCategory: string | null;
  variantTemplateRegion: string | null;
  employeeEmail: string;
  employeePhoneNumber: string | null;
  firstName: string;
  lastName: string;
  department?: string | null;
  employeeTimezone: string | null;
  deliveryChannel: DeliveryChannelName;
};

export type SendOutcome =
  | { status: "sent"; messageId: string | null }
  | {
      status: "skipped";
      reason:
        | "already_sent"
        | "no_template"
        | "voice_no_phone"
        | "voice_not_configured"
        | "sms_not_configured"
        | "sms_no_phone"
        | "sms_opted_out"
        | "unsupported_channel";
    }
  | { status: "deferred"; deferUntil: Date };

/**
 * Permanent (4xx) transport failure — treated as non-retriable by the Inngest
 * worker so we do not burn retries on bad addresses, invalid templates, or
 * revoked credentials.
 */
export class PermanentSendError extends Error {
  readonly statusCode: number | null;

  constructor(message: string, statusCode: number | null) {
    super(message);
    this.name = "PermanentSendError";
    this.statusCode = statusCode;
  }
}

async function loadSendableCampaign(organisationId: string, campaignId: string) {
  return db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      deliveryChannel: campaigns.deliveryChannel,
      templateId: campaigns.emailTemplateId,
      templateSubject: emailTemplates.subject,
      templateHtml: emailTemplates.htmlBody,
      templateText: emailTemplates.textBody,
      templateCategory: emailTemplates.category,
      templateRegion: emailTemplates.region,
      scenario: campaigns.scenario,
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

function senderAddressFor(org: OrganisationSendConfig): string | null {
  if (org.sendingTransport === "smtp") {
    return org.smtpFromAddress?.trim() || org.senderFromAddress?.trim() || null;
  }
  return org.senderFromAddress?.trim() || null;
}

function readStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const candidate =
    (error as { statusCode?: unknown }).statusCode ?? (error as { status?: unknown }).status;
  if (typeof candidate === "number") return candidate;
  const message = (error as { message?: unknown }).message;
  if (typeof message === "string") {
    const match = /"statusCode"\s*:\s*(\d{3})/.exec(message);
    if (match) return Number(match[1]);
  }
  return null;
}

function templateForTarget(campaign: LoadedCampaign, target: TargetRow) {
  if (
    target.variantTemplateId &&
    target.variantTemplateSubject &&
    target.variantTemplateHtml &&
    target.variantTemplateText
  ) {
    return {
      id: target.variantTemplateId,
      subject: target.variantTemplateSubject,
      htmlBody: target.variantTemplateHtml,
      textBody: target.variantTemplateText,
      category: target.variantTemplateCategory,
      region: target.variantTemplateRegion,
    };
  }

  if (!campaign.templateId || !campaign.templateSubject || !campaign.templateHtml || !campaign.templateText) {
    return null;
  }

  return {
    id: campaign.templateId,
    subject: campaign.templateSubject,
    htmlBody: campaign.templateHtml,
    textBody: campaign.templateText,
    category: campaign.templateCategory,
    region: campaign.templateRegion,
  };
}

function deliveryChannelFor(campaign: LoadedCampaign, target: TargetRow): DeliveryChannelName {
  if (target.deliveryChannel !== "email") return target.deliveryChannel;
  return campaign.deliveryChannel;
}

function transportForChannel(
  organisation: OrganisationSendConfig,
  channel: DeliveryChannelName,
): CampaignTransport | undefined {
  if (channel === "email" || channel === "qr" || channel === "attachment") {
    return getTransportForOrganisation(organisation);
  }
  return undefined;
}

async function isSmsOptedOut(organisationId: string, phoneNumber: string) {
  const [row] = await db
    .select({ id: smsOptOuts.id })
    .from(smsOptOuts)
    .where(and(eq(smsOptOuts.organisationId, organisationId), eq(smsOptOuts.phoneNumber, phoneNumber)))
    .limit(1);
  return !!row;
}

async function markTargetSkipped(input: {
  targetId: string;
  now: Date;
  reason: Exclude<Extract<SendOutcome, { status: "skipped" }>["reason"], "already_sent" | "no_template">;
  metadata?: Record<string, unknown>;
}) {
  await db
    .update(campaignTargets)
    .set({ sentAt: input.now, updatedAt: input.now })
    .where(eq(campaignTargets.id, input.targetId));
  await db.insert(events).values({
    campaignTargetId: input.targetId,
    eventType: "bounced",
    metadata: {
      source: "campaign_send",
      skipped: true,
      reason: input.reason,
      ...input.metadata,
    },
    createdAt: input.now,
  });
}

/**
 * Pure send routine. Performs working-hours/timezone clamping, dispatches via
 * the org's configured transport (Resend or SMTP), and writes the `sent` event
 * with idempotent `ON CONFLICT DO NOTHING` on `message_id`. Throws
 * `PermanentSendError` on permanent transport failures (do not retry). Other
 * errors bubble up so the Inngest worker can retry with exponential backoff.
 */
export async function runTargetSend(input: {
  organisation: OrganisationSendConfig;
  transport?: CampaignTransport;
  campaign: LoadedCampaign;
  target: TargetRow;
  now?: Date;
}): Promise<SendOutcome> {
  const { campaign, organisation, target } = input;
  const now = input.now ?? new Date();
  const template = templateForTarget(campaign, target);
  const channel = deliveryChannelFor(campaign, target);

  if (!template && !(channel === "voice" && campaign.scenario)) {
    return { status: "skipped", reason: "no_template" };
  }

  if (target.sentAt) {
    return { status: "skipped", reason: "already_sent" };
  }

  if (target.scheduledAt && target.scheduledAt.getTime() > now.getTime()) {
    return { status: "deferred", deferUntil: target.scheduledAt };
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
    return { status: "deferred", deferUntil: nextSlot };
  }

  if (channel === "voice") {
    const phoneNumber = target.employeePhoneNumber?.trim();
    if (!phoneNumber) {
      await markTargetSkipped({
        targetId: target.id,
        now,
        reason: "voice_no_phone",
        metadata: { recipient: target.employeeEmail },
      });
      return { status: "skipped", reason: "voice_no_phone" };
    }

    const voiceOrganisation = await mergeVoiceConfig(organisation);
    const outcome = await sendVoiceCampaignCall({
      organisation: voiceOrganisation,
      campaign: {
        id: campaign.id,
        name: campaign.name,
        scenario: campaign.scenario,
        templateText: template?.textBody ?? null,
        templateRegion: template?.region ?? campaign.templateRegion,
      },
      target: {
        id: target.id,
        token: target.token,
        phoneNumber,
        firstName: target.firstName,
        lastName: target.lastName,
        department: target.department,
      },
      now,
    });

    return outcome.status === "sent"
      ? { status: "sent", messageId: outcome.messageId }
      : { status: "skipped", reason: "voice_no_phone" };
  }

  if (channel !== "email" && channel !== "sms" && channel !== "attachment" && channel !== "usb") {
    await markTargetSkipped({
      targetId: target.id,
      now,
      reason: "unsupported_channel",
      metadata: { channel },
    });
    return { status: "skipped", reason: "unsupported_channel" };
  }

  if (!template) {
    return { status: "skipped", reason: "no_template" };
  }
  const selectedTemplate = template;

  if (channel === "usb") {
    const payload = buildUsbTrainingRedirectPayload({
      token: target.token,
      campaignName: campaign.name,
      organisationName: organisation.name,
      stampedAt: now,
    });

    await db.update(campaignTargets).set({ sentAt: now, updatedAt: now }).where(eq(campaignTargets.id, target.id));
    await db.insert(events).values({
      campaignTargetId: target.id,
      eventType: "sent",
      messageId: null,
      metadata: {
        transport: "manual_usb_drop",
        messageId: null,
        channel,
        campaignVariantId: target.campaignVariantId,
        templateId: selectedTemplate.id,
        recipient: target.employeeEmail,
        recipientEmail: target.employeeEmail,
        clickUrl: payload.metadata.trainingRedirectUrl,
        usbPayload: payload.metadata,
      },
      createdAt: now,
    });

    return { status: "sent", messageId: null };
  }

  let result;
  try {
    if (channel === "sms") {
      const phoneNumber = normalizeSmsPhoneNumber(target.employeePhoneNumber);

      if (!phoneNumber) {
        await markTargetSkipped({
          targetId: target.id,
          now,
          reason: "sms_no_phone",
          metadata: { recipient: target.employeeEmail },
        });
        return { status: "skipped", reason: "sms_no_phone" };
      }

      if (!hasTwilioSmsConfig(organisation)) {
        await markTargetSkipped({
          targetId: target.id,
          now,
          reason: "sms_not_configured",
          metadata: { recipient: target.employeeEmail, phoneNumber },
        });
        return { status: "skipped", reason: "sms_not_configured" };
      }

      if (await isSmsOptedOut(organisation.id, phoneNumber)) {
        await markTargetSkipped({
          targetId: target.id,
          now,
          reason: "sms_opted_out",
          metadata: { recipient: target.employeeEmail, phoneNumber },
        });
        return { status: "skipped", reason: "sms_opted_out" };
      }

      result = await sendTwilioSms({
        organisation,
        to: phoneNumber,
        textBody: selectedTemplate.textBody,
        employee: {
          email: target.employeeEmail,
          phoneNumber,
          firstName: target.firstName,
          lastName: target.lastName,
          department: target.department,
        },
        token: target.token,
      });
    } else {
      const transport = input.transport;
      if (!transport) {
        throw new Error("Email transport is not configured for this campaign.");
      }

      result = await transport.send({
        organisationName: organisation.name,
        template: {
          subject: selectedTemplate.subject,
          htmlBody: selectedTemplate.htmlBody,
          textBody: selectedTemplate.textBody,
          category: selectedTemplate.category,
        },
        employee: {
          email: target.employeeEmail,
          firstName: target.firstName,
          lastName: target.lastName,
          department: target.department,
        },
        token: target.token,
      });
    }
  } catch (error) {
    if (error instanceof TransientSendError || isRetryableTwilioSmsError(error)) {
      const retryAfterMs = error instanceof TransientSendError ? error.retryAfterMs ?? 60_000 : 60_000;
      const nextAttempt = new Date(now.getTime() + retryAfterMs);
      await db
        .update(campaignTargets)
        .set({ scheduledAt: nextAttempt, updatedAt: now })
        .where(eq(campaignTargets.id, target.id));
      return { status: "deferred", deferUntil: nextAttempt };
    }
    if (error instanceof TwilioSmsConfigurationError) {
      await markTargetSkipped({
        targetId: target.id,
        now,
        reason: "sms_not_configured",
        metadata: { message: error.message },
      });
      return { status: "skipped", reason: "sms_not_configured" };
    }
    const statusCode = readStatusCode(error);
    if (statusCode != null && statusCode >= 400 && statusCode < 500) {
      const message = error instanceof Error ? error.message : String(error);
      throw new PermanentSendError(message, statusCode);
    }
    throw error;
  }

  await db.update(campaignTargets).set({ sentAt: now, updatedAt: now }).where(eq(campaignTargets.id, target.id));
  await db
    .insert(events)
    .values({
      campaignTargetId: target.id,
      eventType: "sent",
      messageId: result.messageId,
      metadata: {
        transport: result.transport,
        messageId: result.messageId,
        channel,
        campaignVariantId: target.campaignVariantId,
        templateId: selectedTemplate.id,
        from: "from" in result ? result.from : senderAddressFor(organisation),
        messagingServiceSid: "messagingServiceSid" in result ? result.messagingServiceSid : undefined,
        recipient: channel === "sms" && "to" in result ? result.to : target.employeeEmail,
        recipientEmail: target.employeeEmail,
        clickUrl: result.clickUrl,
        qrUrl: "qrUrl" in result ? result.qrUrl : undefined,
        pixelUrl: "pixelUrl" in result ? result.pixelUrl : undefined,
        replyAddress: "replyAddress" in result ? result.replyAddress : undefined,
        attachments: "attachments" in result ? result.attachments : undefined,
        twilioStatus: "status" in result ? result.status : undefined,
      },
      createdAt: now,
    })
    .onConflictDoNothing({ target: events.messageId });

  return { status: "sent", messageId: result.messageId };
}

async function loadTargets(campaignId: string, organisationId: string): Promise<TargetRow[]> {
  const variantTemplates = alias(emailTemplates, "variant_template");

  return db
    .select({
      id: campaignTargets.id,
      token: campaignTargets.uniqueToken,
      sentAt: campaignTargets.sentAt,
      scheduledAt: campaignTargets.scheduledAt,
      campaignVariantId: campaignTargets.campaignVariantId,
      variantTemplateId: variantTemplates.id,
      variantTemplateSubject: variantTemplates.subject,
      variantTemplateHtml: variantTemplates.htmlBody,
      variantTemplateText: variantTemplates.textBody,
      variantTemplateCategory: variantTemplates.category,
      variantTemplateRegion: variantTemplates.region,
      deliveryChannel: campaignTargets.deliveryChannel,
      employeeEmail: employees.email,
      employeePhoneNumber: employees.phoneNumber,
      firstName: employees.firstName,
      lastName: employees.lastName,
      department: employees.department,
      employeeTimezone: employees.timezone,
    })
    .from(campaignTargets)
    .innerJoin(employees, eq(employees.id, campaignTargets.employeeId))
    .leftJoin(campaignVariants, eq(campaignVariants.id, campaignTargets.campaignVariantId))
    .leftJoin(variantTemplates, eq(variantTemplates.id, campaignVariants.templateId))
    .where(and(eq(campaignTargets.campaignId, campaignId), eq(employees.organisationId, organisationId)));
}

async function loadTargetById(campaignId: string, organisationId: string, targetId: string): Promise<TargetRow | null> {
  const variantTemplates = alias(emailTemplates, "variant_template");

  const [target] = await db
    .select({
      id: campaignTargets.id,
      token: campaignTargets.uniqueToken,
      sentAt: campaignTargets.sentAt,
      scheduledAt: campaignTargets.scheduledAt,
      campaignVariantId: campaignTargets.campaignVariantId,
      variantTemplateId: variantTemplates.id,
      variantTemplateSubject: variantTemplates.subject,
      variantTemplateHtml: variantTemplates.htmlBody,
      variantTemplateText: variantTemplates.textBody,
      variantTemplateCategory: variantTemplates.category,
      variantTemplateRegion: variantTemplates.region,
      deliveryChannel: campaignTargets.deliveryChannel,
      employeeEmail: employees.email,
      employeePhoneNumber: employees.phoneNumber,
      firstName: employees.firstName,
      lastName: employees.lastName,
      department: employees.department,
      employeeTimezone: employees.timezone,
    })
    .from(campaignTargets)
    .innerJoin(employees, eq(employees.id, campaignTargets.employeeId))
    .leftJoin(campaignVariants, eq(campaignVariants.id, campaignTargets.campaignVariantId))
    .leftJoin(variantTemplates, eq(variantTemplates.id, campaignVariants.templateId))
    .where(
      and(
        eq(campaignTargets.id, targetId),
        eq(campaignTargets.campaignId, campaignId),
        eq(employees.organisationId, organisationId),
      ),
    )
    .limit(1);
  return target ?? null;
}

async function loadUnsentTargetIds(campaignId: string, organisationId: string): Promise<string[]> {
  const rows = await db
    .select({ id: campaignTargets.id })
    .from(campaignTargets)
    .innerJoin(employees, eq(employees.id, campaignTargets.employeeId))
    .where(
      and(
        eq(campaignTargets.campaignId, campaignId),
        eq(employees.organisationId, organisationId),
        sql`${campaignTargets.sentAt} is null`,
      ),
    );
  return rows.map((row) => row.id);
}

/**
 * Async dispatch. Marks the campaign `running` and emits the Inngest launch
 * event. The dispatcher fans out one job per unsent target.
 */
export async function enqueueCampaignDispatch(input: {
  organisation: OrganisationSendConfig;
  campaignId: string;
}): Promise<{ campaignId: string; targetCount: number; eventIds: string[] }> {
  const { organisation } = input;

  const [campaign] = await loadSendableCampaign(organisation.id, input.campaignId);

  if (
    !campaign ||
    (campaign.deliveryChannel === "voice"
      ? !campaign.templateText && !campaign.scenario
      : !campaign.templateId || !campaign.templateSubject || !campaign.templateHtml || !campaign.templateText)
  ) {
    throw new Error("This campaign needs a valid template before it can be sent.");
  }

  if (campaign.deliveryChannel === "voice") {
    await assertVoiceCampaignCanSend({
      organisation,
      campaign: {
        id: campaign.id,
        name: campaign.name,
        scenario: campaign.scenario,
        templateText: campaign.templateText,
        templateRegion: campaign.templateRegion,
      },
    });
  } else if (campaign.deliveryChannel === "sms") {
    if (!hasTwilioSmsConfig(organisation)) {
      throw new Error("Configure Twilio SMS credentials before launching this campaign.");
    }
  } else if (campaign.deliveryChannel === "usb") {
    // USB-drop campaigns generate a stamped training redirect payload; no mail transport is required.
  } else {
    // Validate transport credentials exist; throws if not configured.
    getTransportForOrganisation(organisation);
  }

  if (!["draft", "scheduled", "paused", "running"].includes(campaign.status)) {
    throw new Error("This campaign has already been launched.");
  }

  await assertCampaignDeepfakeLaunchAllowed({
    organisationId: organisation.id,
    campaignId: campaign.id,
  });

  const unsentTargetIds = await loadUnsentTargetIds(campaign.id, organisation.id);

  if (unsentTargetIds.length === 0) {
    throw new Error("There are no unsent targets in this campaign.");
  }

  await db.update(campaigns).set({ status: "running", updatedAt: new Date() }).where(eq(campaigns.id, campaign.id));

  const result = await inngest.send({
    name: "campaign/launch.requested",
    data: {
      campaignId: campaign.id,
      organisationId: organisation.id,
    },
  });

  const eventIds = Array.isArray((result as { ids?: unknown }).ids)
    ? ((result as { ids: string[] }).ids)
    : [];

  return {
    campaignId: campaign.id,
    targetCount: unsentTargetIds.length,
    eventIds,
  };
}

/**
 * Synchronous, in-process dispatch. Retained for dev and the legacy
 * `node-cron` fallback. Production paths should use `enqueueCampaignDispatch`.
 */
export async function sendCampaignNow(input: { organisation: OrganisationSendConfig; campaignId: string }) {
  const { organisation } = input;

  const [campaign] = await loadSendableCampaign(organisation.id, input.campaignId);

  if (
    !campaign ||
    (campaign.deliveryChannel === "voice"
      ? !campaign.templateText && !campaign.scenario
      : !campaign.templateId || !campaign.templateSubject || !campaign.templateHtml || !campaign.templateText)
  ) {
    throw new Error("This campaign needs a valid template before it can be sent.");
  }

  if (!["draft", "scheduled", "paused", "running"].includes(campaign.status)) {
    throw new Error("This campaign has already been launched.");
  }

  await assertCampaignDeepfakeLaunchAllowed({
    organisationId: organisation.id,
    campaignId: campaign.id,
  });

  const transport = transportForChannel(organisation, campaign.deliveryChannel);

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
    const outcome = await runTargetSend({ organisation, transport, campaign, target, now });
    if (outcome.status === "sent") sentCount += 1;
    if (outcome.status === "deferred") deferredCount += 1;
  }

  return { campaignId: campaign.id, sentCount, deferredCount };
}

export async function sendCampaignTargetNow(input: {
  organisation: OrganisationSendConfig;
  campaignId: string;
  targetId: string;
}) {
  const { organisation } = input;

  const [campaign] = await loadSendableCampaign(organisation.id, input.campaignId);

  if (!campaign) {
    throw new Error("Campaign is not available.");
  }

  if (!["draft", "scheduled", "paused", "running"].includes(campaign.status)) {
    throw new Error("This campaign has already been launched.");
  }

  await assertCampaignDeepfakeLaunchAllowed({
    organisationId: organisation.id,
    campaignId: campaign.id,
  });

  const target = await loadTargetById(campaign.id, organisation.id, input.targetId);

  if (!target) {
    throw new Error("Campaign target is not available.");
  }

  const transport = transportForChannel(organisation, deliveryChannelFor(campaign, target));

  await db.update(campaigns).set({ status: "running", updatedAt: new Date() }).where(eq(campaigns.id, campaign.id));
  const outcome = await runTargetSend({ organisation, transport, campaign, target });

  return {
    campaignId: campaign.id,
    sentCount: outcome.status === "sent" ? 1 : 0,
    deferred: outcome.status === "deferred",
    outcome,
  };
}

async function loadOrganisationSendConfig(organisationId: string): Promise<OrganisationSendConfig | null> {
  const [organisation] = await db
    .select({
      id: organisations.id,
      name: organisations.name,
      dataRegion: organisations.dataRegion,
      senderFromAddress: organisations.senderFromAddress,
      resendApiKeyEncrypted: organisations.resendApiKeyEncrypted,
      sendingTransport: organisations.sendingTransport,
      smtpHost: organisations.smtpHost,
      smtpPort: organisations.smtpPort,
      smtpUsernameEncrypted: organisations.smtpUsernameEncrypted,
      smtpPasswordEncrypted: organisations.smtpPasswordEncrypted,
      smtpSecure: organisations.smtpSecure,
      smtpFromAddress: organisations.smtpFromAddress,
      twilioAccountSidEncrypted: organisations.twilioAccountSidEncrypted,
      twilioAuthTokenEncrypted: organisations.twilioAuthTokenEncrypted,
      twilioMessagingServiceSidEncrypted: organisations.twilioMessagingServiceSidEncrypted,
      twilioSenderPhonePool: organisations.twilioSenderPhonePool,
      twilioOptOutKeywords: organisations.twilioOptOutKeywords,
      twilioVoiceFromNumberEncrypted: organisations.twilioVoiceFromNumberEncrypted,
      voiceProvider: organisations.voiceProvider,
      ttsProvider: organisations.ttsProvider,
      voiceConsentRegions: organisations.voiceConsentRegions,
    })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);

  return organisation ?? null;
}

export async function sendCampaignById(input: { organisationId: string; campaignId: string }) {
  const organisation = await loadOrganisationSendConfig(input.organisationId);
  if (!organisation) {
    throw new Error("Organisation is not available.");
  }
  return sendCampaignNow({ organisation, campaignId: input.campaignId });
}

export async function sendCampaignTargetById(input: { organisationId: string; campaignId: string; targetId: string }) {
  const organisation = await loadOrganisationSendConfig(input.organisationId);
  if (!organisation) {
    throw new Error("Organisation is not available.");
  }
  return sendCampaignTargetNow({ organisation, campaignId: input.campaignId, targetId: input.targetId });
}

/**
 * Inngest job entry point. Loads org + campaign + target, runs the send via
 * the configured transport, returns the outcome so the dispatcher decides
 * whether to re-enqueue.
 */
export async function runCampaignTargetSend(input: {
  organisationId: string;
  campaignId: string;
  targetId: string;
}): Promise<SendOutcome & { campaignId: string; targetId: string }> {
  const organisation = await loadOrganisationSendConfig(input.organisationId);
  if (!organisation) {
    throw new Error("Organisation is not available.");
  }

  const [campaign] = await loadSendableCampaign(organisation.id, input.campaignId);
  if (!campaign) {
    throw new Error("Campaign is not available.");
  }

  await assertCampaignDeepfakeLaunchAllowed({
    organisationId: organisation.id,
    campaignId: campaign.id,
  });

  const target = await loadTargetById(campaign.id, organisation.id, input.targetId);
  if (!target) {
    throw new Error("Campaign target is not available.");
  }

  const transport = transportForChannel(organisation, deliveryChannelFor(campaign, target));
  const outcome = await runTargetSend({ organisation, transport, campaign, target });
  return { ...outcome, campaignId: campaign.id, targetId: target.id };
}

/**
 * Helper used by the Inngest dispatcher to enumerate the target ids that still
 * need to be processed for a campaign launch.
 */
export async function listDispatchTargetIds(input: {
  organisationId: string;
  campaignId: string;
}): Promise<string[]> {
  return loadUnsentTargetIds(input.campaignId, input.organisationId);
}
