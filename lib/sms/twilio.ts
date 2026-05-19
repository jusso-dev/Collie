import crypto from "node:crypto";

import { openTotpSecret } from "@/lib/auth/totp";
import { publicAppUrl } from "@/lib/tracking/public-url";
import { normalizeSmsPhoneNumber, normalizeSmsSender } from "@/lib/sms/phone";

export type TwilioSmsOrganisationConfig = {
  id?: string;
  name: string;
  twilioAccountSidEncrypted: string | null;
  twilioAuthTokenEncrypted: string | null;
  twilioMessagingServiceSidEncrypted: string | null;
  twilioSenderPhonePool: string[];
  twilioOptOutKeywords: string[];
};

export type OpenTwilioSmsConfig = {
  accountSid: string;
  authToken: string;
  messagingServiceSid: string | null;
  senderPool: string[];
  optOutKeywords: string[];
};

export type TwilioSmsSendResult = {
  transport: "twilio_sms";
  messageId: string | null;
  to: string;
  from: string | null;
  messagingServiceSid: string | null;
  body: string;
  clickUrl: string;
  status: string | null;
};

export class TwilioSmsConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwilioSmsConfigurationError";
  }
}

export class TwilioSmsSendError extends Error {
  readonly statusCode: number | null;
  readonly code: string | number | null;
  readonly retryable: boolean;

  constructor(input: {
    message: string;
    statusCode?: number | null;
    code?: string | number | null;
    retryable?: boolean;
  }) {
    super(input.message);
    this.name = "TwilioSmsSendError";
    this.statusCode = input.statusCode ?? null;
    this.code = input.code ?? null;
    this.retryable = input.retryable ?? false;
  }
}

type SmsEmployee = {
  email: string;
  phoneNumber: string;
  firstName: string;
  lastName: string;
  department?: string | null;
};

function decryptIfSet(sealed: string | null): string | null {
  if (!sealed) return null;
  return openTotpSecret(sealed);
}

export function openTwilioSmsConfig(org: TwilioSmsOrganisationConfig): OpenTwilioSmsConfig {
  const accountSid = decryptIfSet(org.twilioAccountSidEncrypted)?.trim();
  const authToken = decryptIfSet(org.twilioAuthTokenEncrypted)?.trim();
  const messagingServiceSid = decryptIfSet(org.twilioMessagingServiceSidEncrypted)?.trim() || null;
  const senderPool = (org.twilioSenderPhonePool ?? []).map(normalizeSmsSender).filter((value): value is string => !!value);
  const optOutKeywords = (org.twilioOptOutKeywords?.length ? org.twilioOptOutKeywords : ["STOP"])
    .map((keyword) => keyword.trim().toUpperCase())
    .filter(Boolean);

  if (!accountSid || !authToken) {
    throw new TwilioSmsConfigurationError("Configure the Twilio Account SID and Auth Token before sending SMS.");
  }

  if (!messagingServiceSid && senderPool.length === 0) {
    throw new TwilioSmsConfigurationError(
      "Configure a Twilio Messaging Service SID or sender phone/alphanumeric pool before sending SMS.",
    );
  }

  return {
    accountSid,
    authToken,
    messagingServiceSid,
    senderPool,
    optOutKeywords,
  };
}

export function hasTwilioSmsConfig(org: TwilioSmsOrganisationConfig): boolean {
  try {
    openTwilioSmsConfig(org);
    return true;
  } catch {
    return false;
  }
}

function replaceTokens(value: string, tokens: Record<string, string>) {
  return Object.entries(tokens).reduce(
    (output, [key, tokenValue]) => output.replaceAll(`{{${key}}}`, tokenValue),
    value,
  );
}

export function buildSmsTrackingUrl(token: string) {
  return `${publicAppUrl()}/c/${token}`;
}

export function renderCampaignSms(input: {
  organisationName: string;
  textBody: string;
  employee: SmsEmployee;
  token: string;
}) {
  const clickUrl = buildSmsTrackingUrl(input.token);
  const tokens = {
    organisationName: input.organisationName,
    firstName: input.employee.firstName,
    lastName: input.employee.lastName,
    fullName: `${input.employee.firstName} ${input.employee.lastName}`.trim(),
    recipientEmail: input.employee.email,
    recipientPhone: input.employee.phoneNumber,
    department: input.employee.department ?? "",
    trackingUrl: clickUrl,
    token: input.token,
  };

  const rendered = replaceTokens(input.textBody, tokens).trim();
  const body = rendered.includes(clickUrl) ? rendered : `${rendered}\n${clickUrl}`.trim();

  if (body.length > 1500) {
    throw new TwilioSmsConfigurationError("SMS template renders over Twilio's supported body length.");
  }

  return { body, clickUrl };
}

function chooseSender(config: OpenTwilioSmsConfig, to: string) {
  if (config.messagingServiceSid) {
    return { messagingServiceSid: config.messagingServiceSid, from: null };
  }

  const pool = config.senderPool;
  if (pool.length === 0) {
    throw new TwilioSmsConfigurationError("Configure a Twilio sender before sending SMS.");
  }

  const index = crypto.createHash("sha256").update(to).digest()[0] % pool.length;
  return { messagingServiceSid: null, from: pool[index] };
}

export async function sendTwilioSms(input: {
  organisation: TwilioSmsOrganisationConfig;
  to: string;
  textBody: string;
  employee: SmsEmployee;
  token: string;
}): Promise<TwilioSmsSendResult> {
  const config = openTwilioSmsConfig(input.organisation);
  const to = normalizeSmsPhoneNumber(input.to);

  if (!to) {
    throw new TwilioSmsConfigurationError("Employee phone number must be E.164 or a recognised AU mobile number.");
  }

  const rendered = renderCampaignSms({
    organisationName: input.organisation.name,
    textBody: input.textBody,
    employee: { ...input.employee, phoneNumber: to },
    token: input.token,
  });
  const sender = chooseSender(config, to);
  const params = new URLSearchParams({
    To: to,
    Body: rendered.body,
  });

  if (sender.messagingServiceSid) {
    params.set("MessagingServiceSid", sender.messagingServiceSid);
  } else if (sender.from) {
    params.set("From", sender.from);
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    },
  );

  const payload = (await response.json().catch(() => null)) as {
    sid?: string;
    status?: string;
    code?: string | number;
    message?: string;
  } | null;

  if (!response.ok) {
    throw new TwilioSmsSendError({
      message: payload?.message ?? `Twilio SMS send failed with HTTP ${response.status}.`,
      statusCode: response.status,
      code: payload?.code ?? null,
      retryable: response.status === 429 || response.status >= 500,
    });
  }

  return {
    transport: "twilio_sms",
    messageId: payload?.sid ?? null,
    to,
    from: sender.from,
    messagingServiceSid: sender.messagingServiceSid,
    body: rendered.body,
    clickUrl: rendered.clickUrl,
    status: payload?.status ?? null,
  };
}

export function isRetryableTwilioSmsError(error: unknown): error is TwilioSmsSendError {
  return error instanceof TwilioSmsSendError && error.retryable;
}

export function validateTwilioRequestSignature(input: {
  authToken: string;
  url: string;
  params: Record<string, string>;
  signature: string | null;
}) {
  if (!input.signature) return false;

  const data =
    input.url +
    Object.keys(input.params)
      .sort()
      .map((key) => `${key}${input.params[key]}`)
      .join("");
  const expected = crypto.createHmac("sha1", input.authToken).update(data).digest("base64");
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(input.signature);

  return (
    expectedBuffer.length === signatureBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
  );
}

export function extractSmsToken(...sources: Array<string | null | undefined>) {
  const haystack = sources.filter(Boolean).join("\n");
  const patterns = [
    /collie-token[:=\s]+([a-zA-Z0-9_-]{16,})/i,
    /\/c\/([a-zA-Z0-9_-]{16,})(?:$|[/?#\s])/i,
    /\btoken[:=\s]+([a-zA-Z0-9_-]{16,})/i,
  ];

  for (const pattern of patterns) {
    const match = haystack.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}
