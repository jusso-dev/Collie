import { and, eq, sql } from "drizzle-orm";

import {
  DEFAULT_WORKING_WINDOW,
  isInsideWorkingWindow,
  nextAllowedSendTime,
  type WorkingWindow,
} from "@/lib/campaigns/schedule";
import { db } from "@/lib/db/client";
import { campaignTargets, campaigns, emailTemplates, employees, events, organisations } from "@/lib/db/schema";
import {
  getTransportForOrganisation,
  TransientSendError,
  type CampaignTransport,
  type OrganisationTransportConfig,
} from "@/lib/email/campaign-sender";
import { inngest } from "@/lib/inngest/client";

type OrganisationSendConfig = OrganisationTransportConfig & {
  id: string;
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

export type SendOutcome =
  | { status: "sent"; messageId: string | null }
  | { status: "skipped"; reason: "already_sent" | "no_template" }
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

/**
 * Pure send routine. Performs working-hours/timezone clamping, dispatches via
 * the org's configured transport (Resend or SMTP), and writes the `sent` event
 * with idempotent `ON CONFLICT DO NOTHING` on `message_id`. Throws
 * `PermanentSendError` on permanent transport failures (do not retry). Other
 * errors bubble up so the Inngest worker can retry with exponential backoff.
 */
export async function runTargetSend(input: {
  organisation: OrganisationSendConfig;
  transport: CampaignTransport;
  campaign: LoadedCampaign;
  target: TargetRow;
  now?: Date;
}): Promise<SendOutcome> {
  const { campaign, organisation, transport, target } = input;
  const now = input.now ?? new Date();

  if (!campaign.templateId || !campaign.templateSubject || !campaign.templateHtml || !campaign.templateText) {
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

  let result;
  try {
    result = await transport.send({
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
  } catch (error) {
    if (error instanceof TransientSendError) {
      const retryAfterMs = error.retryAfterMs ?? 60_000;
      const nextAttempt = new Date(now.getTime() + retryAfterMs);
      await db
        .update(campaignTargets)
        .set({ scheduledAt: nextAttempt, updatedAt: now })
        .where(eq(campaignTargets.id, target.id));
      return { status: "deferred", deferUntil: nextAttempt };
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
        from: senderAddressFor(organisation),
        recipient: target.employeeEmail,
        clickUrl: result.clickUrl,
        pixelUrl: result.pixelUrl,
        replyAddress: result.replyAddress,
      },
      createdAt: now,
    })
    .onConflictDoNothing({ target: events.messageId });

  return { status: "sent", messageId: result.messageId };
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

async function loadTargetById(campaignId: string, organisationId: string, targetId: string): Promise<TargetRow | null> {
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
  // Validate transport credentials exist; throws if not configured.
  getTransportForOrganisation(organisation);

  const [campaign] = await loadSendableCampaign(organisation.id, input.campaignId);

  if (!campaign?.templateId || !campaign.templateSubject || !campaign.templateHtml || !campaign.templateText) {
    throw new Error("This campaign needs a valid template before it can be sent.");
  }

  if (!["draft", "scheduled", "paused", "running"].includes(campaign.status)) {
    throw new Error("This campaign has already been launched.");
  }

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
  const transport = getTransportForOrganisation(organisation);

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
  const transport = getTransportForOrganisation(organisation);

  const [campaign] = await loadSendableCampaign(organisation.id, input.campaignId);

  if (!campaign) {
    throw new Error("Campaign is not available.");
  }

  if (!["draft", "scheduled", "paused", "running"].includes(campaign.status)) {
    throw new Error("This campaign has already been launched.");
  }

  const target = await loadTargetById(campaign.id, organisation.id, input.targetId);

  if (!target) {
    throw new Error("Campaign target is not available.");
  }

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
      senderFromAddress: organisations.senderFromAddress,
      resendApiKeyEncrypted: organisations.resendApiKeyEncrypted,
      sendingTransport: organisations.sendingTransport,
      smtpHost: organisations.smtpHost,
      smtpPort: organisations.smtpPort,
      smtpUsernameEncrypted: organisations.smtpUsernameEncrypted,
      smtpPasswordEncrypted: organisations.smtpPasswordEncrypted,
      smtpSecure: organisations.smtpSecure,
      smtpFromAddress: organisations.smtpFromAddress,
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
  const transport = getTransportForOrganisation(organisation);

  const [campaign] = await loadSendableCampaign(organisation.id, input.campaignId);
  if (!campaign) {
    throw new Error("Campaign is not available.");
  }

  const target = await loadTargetById(campaign.id, organisation.id, input.targetId);
  if (!target) {
    throw new Error("Campaign target is not available.");
  }

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
