import { and, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { campaignTargets, campaigns, events, organisations, smsOptOuts } from "@/lib/db/schema";
import { enqueueSimulationEventPush } from "@/lib/integrations/siem-soar";
import { firstSmsKeyword, normalizeSmsPhoneNumber, normalizeSmsSender } from "@/lib/sms/phone";
import {
  extractSmsToken,
  openTwilioSmsConfig,
  validateTwilioRequestSignature,
  type OpenTwilioSmsConfig,
} from "@/lib/sms/twilio";
import { publicAppUrl } from "@/lib/tracking/public-url";

type TwilioInboundPayload = {
  AccountSid?: string;
  MessagingServiceSid?: string;
  MessageSid?: string;
  SmsSid?: string;
  From?: string;
  To?: string;
  Body?: string;
  NumMedia?: string;
};

type OrganisationRow = {
  id: string;
  name: string;
  twilioAccountSidEncrypted: string | null;
  twilioAuthTokenEncrypted: string | null;
  twilioMessagingServiceSidEncrypted: string | null;
  twilioSenderPhonePool: string[];
  twilioOptOutKeywords: string[];
};

type MatchedOrganisation = {
  row: OrganisationRow;
  config: OpenTwilioSmsConfig;
};

function webhookValidationEnabled() {
  return process.env.TWILIO_WEBHOOK_VALIDATE_SIGNATURE !== "false";
}

async function parseTwilioPayload(request: NextRequest): Promise<Record<string, string> | null> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const json = await request.json().catch(() => null);
    if (!json || typeof json !== "object") return null;
    return Object.fromEntries(
      Object.entries(json)
        .filter((entry): entry is [string, string | number | boolean] =>
          ["string", "number", "boolean"].includes(typeof entry[1]),
        )
        .map(([key, value]) => [key, String(value)]),
    );
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) return null;

  const params: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") params[key] = value;
  }
  return params;
}

async function loadCandidateOrganisations() {
  return db
    .select({
      id: organisations.id,
      name: organisations.name,
      twilioAccountSidEncrypted: organisations.twilioAccountSidEncrypted,
      twilioAuthTokenEncrypted: organisations.twilioAuthTokenEncrypted,
      twilioMessagingServiceSidEncrypted: organisations.twilioMessagingServiceSidEncrypted,
      twilioSenderPhonePool: organisations.twilioSenderPhonePool,
      twilioOptOutKeywords: organisations.twilioOptOutKeywords,
    })
    .from(organisations)
    .where(
      sql`${organisations.twilioAccountSidEncrypted} is not null and ${organisations.twilioAuthTokenEncrypted} is not null`,
    );
}

function matchScore(payload: TwilioInboundPayload, config: OpenTwilioSmsConfig) {
  let score = 0;

  if (payload.AccountSid && payload.AccountSid === config.accountSid) score += 4;
  if (
    payload.MessagingServiceSid &&
    config.messagingServiceSid &&
    payload.MessagingServiceSid === config.messagingServiceSid
  ) {
    score += 3;
  }

  const inboundTo = normalizeSmsSender(payload.To);
  if (inboundTo && config.senderPool.includes(inboundTo)) score += 2;

  return score;
}

async function findOrganisation(payload: TwilioInboundPayload): Promise<MatchedOrganisation | null> {
  const rows = await loadCandidateOrganisations();
  const matches: Array<MatchedOrganisation & { score: number }> = [];

  for (const row of rows) {
    try {
      const config = openTwilioSmsConfig(row);
      const score = matchScore(payload, config);
      if (score >= 4) matches.push({ row, config, score });
    } catch (error) {
      console.warn("Skipping invalid Twilio organisation config", { organisationId: row.id, error });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches[0] ?? null;
}

function requestSignatureUrls(request: NextRequest) {
  const direct = new URL(request.url);
  const urls = new Set<string>([direct.toString()]);
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? direct.protocol.replace(":", "");

  if (forwardedHost) {
    urls.add(`${forwardedProto}://${forwardedHost}${direct.pathname}${direct.search}`);
  }

  const publicUrl = new URL(publicAppUrl());
  urls.add(`${publicUrl.origin}${direct.pathname}${direct.search}`);

  return Array.from(urls);
}

function isValidTwilioSignature(input: {
  request: NextRequest;
  authToken: string;
  params: Record<string, string>;
}) {
  const signature = input.request.headers.get("x-twilio-signature");
  return requestSignatureUrls(input.request).some((url) =>
    validateTwilioRequestSignature({
      authToken: input.authToken,
      url,
      params: input.params,
      signature,
    }),
  );
}

function optOutKeywordFor(body: string | undefined, keywords: string[]) {
  const keyword = firstSmsKeyword(body);
  const allowed = new Set((keywords.length ? keywords : ["STOP"]).map((value) => value.trim().toUpperCase()));
  return allowed.has(keyword) ? keyword : null;
}

async function recordOptOut(input: {
  organisationId: string;
  phoneNumber: string;
  keyword: string;
}) {
  await db
    .insert(smsOptOuts)
    .values({
      organisationId: input.organisationId,
      phoneNumber: input.phoneNumber,
      keyword: input.keyword,
    })
    .onConflictDoUpdate({
      target: [smsOptOuts.organisationId, smsOptOuts.phoneNumber],
      set: { keyword: input.keyword, createdAt: new Date() },
    });
}

async function recordSmsReport(input: {
  organisationId: string;
  token: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
}) {
  const [target] = await db
    .select({
      id: campaignTargets.id,
      reportedAt: campaignTargets.reportedAt,
    })
    .from(campaignTargets)
    .innerJoin(campaigns, eq(campaigns.id, campaignTargets.campaignId))
    .where(
      and(
        eq(campaignTargets.uniqueToken, input.token),
        eq(campaigns.organisationId, input.organisationId),
      ),
    )
    .limit(1);

  if (!target) return false;

  const now = new Date();
  const [event] = await db
    .insert(events)
    .values({
      campaignTargetId: target.id,
      eventType: "reported",
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      metadata: input.metadata,
      createdAt: now,
    })
    .returning({ id: events.id });
  await db
    .update(campaignTargets)
    .set({ reportedAt: target.reportedAt ?? now, updatedAt: now })
    .where(eq(campaignTargets.id, target.id));

  if (event) {
    try {
      await enqueueSimulationEventPush(event.id);
    } catch (error) {
      console.warn("SIEM/SOAR push could not be queued for SMS report", error);
    }
  }

  return true;
}

export async function POST(request: NextRequest) {
  const params = await parseTwilioPayload(request);

  if (!params) {
    return NextResponse.json({ error: "Invalid Twilio webhook payload." }, { status: 400 });
  }

  const payload = params as TwilioInboundPayload;
  const match = await findOrganisation(payload);

  if (!match) {
    return NextResponse.json({ error: "Twilio organisation was not found." }, { status: 404 });
  }

  if (
    webhookValidationEnabled() &&
    !isValidTwilioSignature({ request, authToken: match.config.authToken, params })
  ) {
    return NextResponse.json({ error: "Twilio signature is invalid." }, { status: 403 });
  }

  const from = normalizeSmsPhoneNumber(payload.From);
  const keyword = optOutKeywordFor(payload.Body, match.config.optOutKeywords);

  if (from && keyword) {
    await recordOptOut({
      organisationId: match.row.id,
      phoneNumber: from,
      keyword,
    });
  }

  const token = extractSmsToken(payload.Body);
  let reported = false;

  if (token) {
    reported = await recordSmsReport({
      organisationId: match.row.id,
      token,
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      metadata: {
        source: "twilio_sms_inbound",
        matchedBy: "token",
        from: payload.From ?? "",
        to: payload.To ?? "",
        messageSid: payload.MessageSid ?? payload.SmsSid ?? "",
        accountSid: payload.AccountSid ?? "",
        messagingServiceSid: payload.MessagingServiceSid ?? "",
        keyword,
        preview: payload.Body?.slice(0, 500) ?? "",
      },
    });
  }

  return NextResponse.json({
    ok: true,
    optOut: !!keyword,
    reported,
  });
}
