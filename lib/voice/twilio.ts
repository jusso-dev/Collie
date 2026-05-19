import { eq } from "drizzle-orm";

import { openTotpSecret } from "@/lib/auth/totp";
import { db } from "@/lib/db/client";
import { campaignTargets, events, organisations, voiceCallAttempts } from "@/lib/db/schema";
import { publicAppUrl } from "@/lib/tracking/public-url";

const DEFAULT_AI_VOICE = "Polly.Joanna-Generative";
const DEFAULT_VOICE_LANGUAGE = "en-US";

export type OrganisationVoiceConfig = {
  id: string;
  name: string;
  dataRegion?: string | null;
  voiceProvider?: string | null;
  ttsProvider?: string | null;
  voiceConsentRegions?: string[] | null;
  twilioAccountSidEncrypted?: string | null;
  twilioAuthTokenEncrypted?: string | null;
  twilioVoiceFromNumberEncrypted?: string | null;
};

export type VoiceCampaignConfig = {
  id: string;
  name: string;
  scenario: string | null;
  templateText: string | null;
  templateRegion: string | null;
};

export type VoiceTargetConfig = {
  id: string;
  token: string;
  phoneNumber: string | null;
  firstName: string;
  lastName: string;
  department?: string | null;
};

export type TwilioCallPayload = Record<string, string>;

type VoiceScript = {
  opening: string;
  prompt: string;
  noInput: string;
  completed: string;
};

function decryptRequired(value: string | null | undefined, label: string) {
  if (!value) {
    throw new Error(`Configure ${label} before sending voice calls.`);
  }

  return openTotpSecret(value);
}

function renderTokens(value: string, input: {
  organisationName: string;
  firstName: string;
  lastName: string;
  fullName: string;
  department: string;
  token: string;
}) {
  return Object.entries(input).reduce(
    (output, [key, tokenValue]) => output.replaceAll(`{{${key}}}`, tokenValue),
    value,
  );
}

function plainSpeech(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/https?:\/\/\S+/gi, "the link we sent you")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_200);
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function webhookUrl(params: Record<string, string>) {
  const url = new URL("/api/webhooks/twilio/voice", publicAppUrl());
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function consentRegionFor(input: {
  organisation: OrganisationVoiceConfig;
  campaign: VoiceCampaignConfig;
}) {
  return (input.campaign.templateRegion || input.organisation.dataRegion || "unknown").trim().toLowerCase();
}

export function requireConfiguredVoiceConsentRegion(input: {
  organisation: OrganisationVoiceConfig;
  region: string;
}) {
  const configured = (input.organisation.voiceConsentRegions ?? [])
    .map((region) => region.trim().toLowerCase())
    .filter(Boolean);
  const region = input.region.trim().toLowerCase();

  if (configured.length === 0) {
    throw new Error("Configure voice consent regions in Settings before sending real voice calls.");
  }

  if (!configured.includes(region)) {
    throw new Error(`Voice calls are not enabled for the ${region} consent region.`);
  }
}

export function buildVoiceScript(input: {
  organisationName: string;
  campaignName: string;
  scenario: string | null;
  templateText: string | null;
  target: VoiceTargetConfig;
}): VoiceScript {
  const fullName = `${input.target.firstName} ${input.target.lastName}`.trim();
  const scripted = plainSpeech(
    renderTokens(input.templateText ?? input.scenario ?? "", {
      organisationName: input.organisationName,
      firstName: input.target.firstName,
      lastName: input.target.lastName,
      fullName,
      department: input.target.department ?? "",
      token: input.target.token,
    }),
  );

  return {
    opening:
      scripted ||
      `Hello ${input.target.firstName}. This is an automated security verification call for ${input.organisationName}.`,
    prompt:
      "Please enter the verification code or requested digits now, then press pound.",
    noInput:
      "We did not receive any input. This call is now complete.",
    completed:
      "Thank you. This security awareness simulation is complete. You may hang up.",
  };
}

export function buildVoiceTwiML(input: {
  actionUrl: string;
  script: VoiceScript;
  voice?: string | null;
  language?: string | null;
  includeConsentNotice?: boolean;
}) {
  const voice = escapeXml(input.voice || DEFAULT_AI_VOICE);
  const language = escapeXml(input.language || DEFAULT_VOICE_LANGUAGE);
  const sayAttrs = `voice="${voice}" language="${language}"`;
  const consent = input.includeConsentNotice
    ? `<Say ${sayAttrs}>This call may be recorded for security awareness training.</Say>`
    : "";

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    consent,
    `<Say ${sayAttrs}>${escapeXml(input.script.opening)}</Say>`,
    `<Gather input="dtmf" action="${escapeXml(input.actionUrl)}" method="POST" timeout="8" finishOnKey="#" numDigits="6">`,
    `<Say ${sayAttrs}>${escapeXml(input.script.prompt)}</Say>`,
    "</Gather>",
    `<Say ${sayAttrs}>${escapeXml(input.script.noInput)}</Say>`,
    "</Response>",
  ].join("");
}

export function buildDtmfCompleteTwiML(input?: { message?: string; voice?: string | null; language?: string | null }) {
  const voice = escapeXml(input?.voice || DEFAULT_AI_VOICE);
  const language = escapeXml(input?.language || DEFAULT_VOICE_LANGUAGE);
  const message = escapeXml(input?.message ?? "Thank you. This security awareness simulation is complete.");

  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${voice}" language="${language}">${message}</Say></Response>`;
}

export function buildTwilioCallPayload(input: {
  to: string;
  from: string;
  attemptId: string;
  token: string;
}) {
  const baseParams = { attemptId: input.attemptId, token: input.token };
  const statusCallback = webhookUrl({ ...baseParams, phase: "status" });
  const recordingCallback = webhookUrl({ ...baseParams, phase: "recording", consent: "1" });

  return {
    To: input.to,
    From: input.from,
    Url: webhookUrl(baseParams),
    Method: "POST",
    StatusCallback: statusCallback,
    StatusCallbackMethod: "POST",
    StatusCallbackEvent: "initiated ringing answered completed",
    Record: "true",
    RecordingStatusCallback: recordingCallback,
    RecordingStatusCallbackMethod: "POST",
    RecordingStatusCallbackEvent: "completed",
  } satisfies TwilioCallPayload;
}

export function buildTwilioTestCallPayload(input: {
  to: string;
  from: string;
  message?: string;
}) {
  const params: Record<string, string> = { test: "1" };
  if (input.message) params.message = input.message;

  return {
    To: input.to,
    From: input.from,
    Url: webhookUrl(params),
    Method: "POST",
    Record: "false",
  } satisfies TwilioCallPayload;
}

async function postTwilioCall(input: {
  accountSid: string;
  authToken: string;
  payload: TwilioCallPayload;
}) {
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(input.accountSid)}/Calls.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${input.accountSid}:${input.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(input.payload),
    },
  );

  const body = (await response.json().catch(() => null)) as { sid?: string; status?: string; message?: string } | null;

  if (!response.ok) {
    throw new Error(body?.message ?? `Twilio call failed with HTTP ${response.status}`);
  }

  return {
    sid: body?.sid ?? null,
    status: body?.status ?? null,
  };
}

export async function sendVoiceCampaignCall(input: {
  organisation: OrganisationVoiceConfig;
  campaign: VoiceCampaignConfig;
  target: VoiceTargetConfig;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const region = consentRegionFor(input);

  if ((input.organisation.voiceProvider ?? "twilio") !== "twilio") {
    throw new Error("Only the Twilio voice provider is currently supported.");
  }

  requireConfiguredVoiceConsentRegion({ organisation: input.organisation, region });

  const to = input.target.phoneNumber?.trim();
  if (!to) {
    return { status: "skipped" as const, reason: "no_phone" as const };
  }

  const accountSid = decryptRequired(input.organisation.twilioAccountSidEncrypted, "Twilio Account SID");
  const authToken = decryptRequired(input.organisation.twilioAuthTokenEncrypted, "Twilio Auth Token");
  const from = decryptRequired(input.organisation.twilioVoiceFromNumberEncrypted, "Twilio voice From number");

  const [attempt] = await db
    .insert(voiceCallAttempts)
    .values({
      campaignTargetId: input.target.id,
      consentCaptured: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: voiceCallAttempts.id });

  const payload = buildTwilioCallPayload({
    to,
    from,
    attemptId: attempt.id,
    token: input.target.token,
  });
  const call = await postTwilioCall({ accountSid, authToken, payload });

  if (call.sid) {
    await db
      .update(voiceCallAttempts)
      .set({ providerCallSid: call.sid, updatedAt: now })
      .where(eq(voiceCallAttempts.id, attempt.id));
  }

  await db.update(campaignTargets).set({ sentAt: now, updatedAt: now }).where(eq(campaignTargets.id, input.target.id));
  await db
    .insert(events)
    .values({
      campaignTargetId: input.target.id,
      eventType: "sent",
      messageId: call.sid,
      metadata: {
        transport: "twilio_voice",
        provider: "twilio",
        providerCallSid: call.sid,
        recipient: to,
        voice: DEFAULT_AI_VOICE,
        consentRegion: region,
        consentCaptured: true,
        status: call.status,
      },
      createdAt: now,
    })
    .onConflictDoNothing({ target: events.messageId });

  return { status: "sent" as const, messageId: call.sid };
}

export async function loadOrganisationVoiceConfig(organisationId: string): Promise<OrganisationVoiceConfig | null> {
  const [organisation] = await db
    .select({
      id: organisations.id,
      name: organisations.name,
      dataRegion: organisations.dataRegion,
      voiceProvider: organisations.voiceProvider,
      ttsProvider: organisations.ttsProvider,
      voiceConsentRegions: organisations.voiceConsentRegions,
      twilioAccountSidEncrypted: organisations.twilioAccountSidEncrypted,
      twilioAuthTokenEncrypted: organisations.twilioAuthTokenEncrypted,
      twilioVoiceFromNumberEncrypted: organisations.twilioVoiceFromNumberEncrypted,
    })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);

  return organisation ?? null;
}

export async function mergeVoiceConfig(input: OrganisationVoiceConfig): Promise<OrganisationVoiceConfig> {
  if (
    input.voiceProvider !== undefined &&
    input.dataRegion !== undefined &&
    input.voiceConsentRegions !== undefined &&
    input.twilioAccountSidEncrypted !== undefined &&
    input.twilioAuthTokenEncrypted !== undefined &&
    input.twilioVoiceFromNumberEncrypted !== undefined
  ) {
    return input;
  }

  const loaded = await loadOrganisationVoiceConfig(input.id);
  if (!loaded) {
    throw new Error("Organisation voice settings are not available.");
  }

  return { ...input, ...loaded };
}

export async function assertVoiceCampaignCanSend(input: {
  organisation: OrganisationVoiceConfig;
  campaign: VoiceCampaignConfig;
}) {
  const organisation = await mergeVoiceConfig(input.organisation);
  requireConfiguredVoiceConsentRegion({
    organisation,
    region: consentRegionFor({ organisation, campaign: input.campaign }),
  });
}
