import { Resend } from "resend";
import nodemailer from "nodemailer";

import { openTotpSecret } from "@/lib/auth/totp";
import { renderSimulationAttachments, type SimulationAttachmentPayload } from "@/lib/attachments/renderers";
import { renderCampaignEmail } from "@/lib/email/campaign-renderer";

export type SendingTransportName = "resend" | "smtp";

export type CampaignSendInput = {
  organisationName: string;
  template: {
    subject: string;
    htmlBody: string;
    textBody: string;
    category?: string | null;
  };
  employee: {
    email: string;
    firstName: string;
    lastName: string;
    department?: string | null;
  };
  token: string;
};

export type CampaignSendResult = {
  transport: SendingTransportName;
  messageId: string | null;
  subject: string;
  html: string;
  text: string;
  clickUrl: string;
  qrUrl: string;
  pixelUrl: string;
  reportUrl: string;
  replyAddress: string;
  headers: Record<string, string>;
  attachments?: Array<SimulationAttachmentPayload["metadata"]>;
};

export interface CampaignTransport {
  readonly name: SendingTransportName;
  send(input: CampaignSendInput): Promise<CampaignSendResult>;
  verify(): Promise<void>;
}

/**
 * Thrown when the remote MTA reports a transient failure (e.g. SMTP 421/451)
 * and the sender should back off and retry later. Callers — the campaign
 * dispatcher in particular — should treat this as "leave target unsent, retry
 * on the next tick" rather than a permanent error.
 */
export class TransientSendError extends Error {
  readonly transport: SendingTransportName;
  readonly code: string | number | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(input: {
    transport: SendingTransportName;
    message: string;
    code?: string | number;
    retryAfterMs?: number;
    cause?: unknown;
  }) {
    super(input.message);
    this.name = "TransientSendError";
    this.transport = input.transport;
    this.code = input.code;
    this.retryAfterMs = input.retryAfterMs;
    if (input.cause !== undefined) {
      (this as { cause?: unknown }).cause = input.cause;
    }
  }
}

type ResendTransportConfig = {
  apiKey: string;
  from: string;
  organisationName: string;
};

function attachmentMailParts(attachments: SimulationAttachmentPayload[]) {
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    content: attachment.content,
    contentType: attachment.contentType,
  }));
}

function attachmentMetadata(attachments: SimulationAttachmentPayload[]) {
  return attachments.map((attachment) => attachment.metadata);
}

class ResendTransport implements CampaignTransport {
  readonly name = "resend" as const;
  private readonly config: ResendTransportConfig;

  constructor(config: ResendTransportConfig) {
    this.config = config;
  }

  async send(input: CampaignSendInput): Promise<CampaignSendResult> {
    const rendered = renderCampaignEmail({
      organisationName: this.config.organisationName,
      template: input.template,
      employee: input.employee,
      token: input.token,
    });
    const attachments = renderSimulationAttachments({
      kind: input.template.category,
      organisationName: this.config.organisationName,
      subject: rendered.subject,
      employee: input.employee,
      token: input.token,
    });

    const resend = new Resend(this.config.apiKey);

    try {
      const response = await resend.emails.send({
        from: this.config.from,
        to: input.employee.email,
        replyTo: rendered.replyAddress,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        headers: rendered.headers,
        attachments: attachments.length ? attachmentMailParts(attachments) : undefined,
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      return {
        transport: this.name,
        messageId: response.data?.id ?? null,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        clickUrl: rendered.clickUrl,
        qrUrl: rendered.qrUrl,
        pixelUrl: rendered.pixelUrl,
        reportUrl: rendered.reportUrl,
        replyAddress: rendered.replyAddress,
        headers: rendered.headers,
        attachments: attachments.length ? attachmentMetadata(attachments) : undefined,
      };
    } catch (error) {
      if (isResendRateLimitError(error)) {
        throw new TransientSendError({
          transport: this.name,
          message: error instanceof Error ? error.message : "Resend rate limit hit",
          code: extractStatusCode(error),
          cause: error,
        });
      }
      throw error;
    }
  }

  async verify(): Promise<void> {
    if (!this.config.apiKey?.startsWith("re_")) {
      throw new Error("Resend API keys begin with `re_`.");
    }
  }
}

type SmtpTransportConfig = {
  host: string;
  port: number;
  secure: boolean; // when true, enforce TLS (STARTTLS upgrade required, fail closed on bad cert)
  username: string | null;
  password: string | null;
  from: string;
  organisationName: string;
};

const TRANSIENT_SMTP_CODES = new Set([421, 450, 451, 452, 471]);

class SmtpTransport implements CampaignTransport {
  readonly name = "smtp" as const;
  private readonly config: SmtpTransportConfig;

  constructor(config: SmtpTransportConfig) {
    this.config = config;
  }

  private buildTransporter(): nodemailer.Transporter {
    const secure = this.config.secure;
    const auth =
      this.config.username && this.config.password
        ? { user: this.config.username, pass: this.config.password }
        : undefined;

    return nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      // Use implicit TLS on the 465 wire, STARTTLS on every other port. Either
      // way, when the operator has flagged `smtpSecure`, we refuse to send
      // unless the channel is encrypted (fail closed on cert errors).
      secure: secure && this.config.port === 465,
      requireTLS: secure,
      auth,
      tls: secure
        ? {
            rejectUnauthorized: true,
            minVersion: "TLSv1.2",
          }
        : undefined,
    });
  }

  async send(input: CampaignSendInput): Promise<CampaignSendResult> {
    const rendered = renderCampaignEmail({
      organisationName: this.config.organisationName,
      template: input.template,
      employee: input.employee,
      token: input.token,
    });
    const attachments = renderSimulationAttachments({
      kind: input.template.category,
      organisationName: this.config.organisationName,
      subject: rendered.subject,
      employee: input.employee,
      token: input.token,
    });

    const transporter = this.buildTransporter();

    try {
      const info = await transporter.sendMail({
        from: this.config.from,
        to: input.employee.email,
        replyTo: rendered.replyAddress,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        headers: rendered.headers,
        attachments: attachments.length ? attachmentMailParts(attachments) : undefined,
      });

      return {
        transport: this.name,
        messageId: info.messageId ?? null,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        clickUrl: rendered.clickUrl,
        qrUrl: rendered.qrUrl,
        pixelUrl: rendered.pixelUrl,
        reportUrl: rendered.reportUrl,
        replyAddress: rendered.replyAddress,
        headers: rendered.headers,
        attachments: attachments.length ? attachmentMetadata(attachments) : undefined,
      };
    } catch (error) {
      const code = extractSmtpResponseCode(error);
      if (code !== undefined && TRANSIENT_SMTP_CODES.has(code)) {
        throw new TransientSendError({
          transport: this.name,
          message: error instanceof Error ? error.message : `SMTP ${code}`,
          code,
          cause: error,
        });
      }
      throw error;
    } finally {
      transporter.close();
    }
  }

  async verify(): Promise<void> {
    const transporter = this.buildTransporter();
    try {
      await transporter.verify();
    } finally {
      transporter.close();
    }
  }
}

export type OrganisationTransportConfig = {
  name: string;
  sendingTransport: SendingTransportName;
  senderFromAddress: string | null;
  resendApiKeyEncrypted: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUsernameEncrypted: string | null;
  smtpPasswordEncrypted: string | null;
  smtpSecure: boolean;
  smtpFromAddress: string | null;
};

function decryptIfSet(sealed: string | null): string | null {
  if (!sealed) return null;
  return openTotpSecret(sealed);
}

export function getTransportForOrganisation(org: OrganisationTransportConfig): CampaignTransport {
  if (org.sendingTransport === "smtp") {
    const host = org.smtpHost?.trim();
    const port = org.smtpPort;
    const from = org.smtpFromAddress?.trim() || org.senderFromAddress?.trim();
    if (!host || !port || !from) {
      throw new Error("Configure the SMTP host, port and From address in Settings before sending.");
    }
    return new SmtpTransport({
      host,
      port,
      secure: org.smtpSecure,
      username: decryptIfSet(org.smtpUsernameEncrypted),
      password: decryptIfSet(org.smtpPasswordEncrypted),
      from,
      organisationName: org.name,
    });
  }

  if (!org.resendApiKeyEncrypted || !org.senderFromAddress) {
    throw new Error("Add a Resend API key and sender From address in Settings before sending.");
  }
  return new ResendTransport({
    apiKey: org.resendApiKeyEncrypted,
    from: org.senderFromAddress,
    organisationName: org.name,
  });
}

/**
 * Back-compat wrapper kept so cron / Inngest call sites stay readable. New
 * code should grab a transport via {@link getTransportForOrganisation} and
 * call `.send()` directly.
 */
export async function sendCampaignEmail(
  input: CampaignSendInput & { transport: CampaignTransport },
): Promise<CampaignSendResult> {
  return input.transport.send(input);
}

/**
 * Build a "Test send" payload from Settings. The body is intentionally short
 * and clearly identifies itself so deliverability tooling can fingerprint it
 * without bouncing on it.
 */
export function renderTestEmailFor(input: { organisationName: string; recipient: string }): CampaignSendInput {
  const stamp = new Date().toISOString();
  return {
    organisationName: input.organisationName,
    template: {
      subject: `Collie deliverability test — ${input.organisationName}`,
      htmlBody:
        '<p>This is a Collie deliverability test from {{organisationName}}.</p>' +
        '<p>If you received it, your transport is wired up correctly.</p>' +
        `<p style="color:#666;font-size:12px">Sent at ${stamp}</p>`,
      textBody:
        `This is a Collie deliverability test from {{organisationName}}.\n` +
        `If you received it, your transport is wired up correctly.\n\n` +
        `Sent at ${stamp}`,
    },
    employee: {
      email: input.recipient,
      firstName: "Test",
      lastName: "Recipient",
      department: null,
    },
    // Use a deterministic, clearly-fake token so the test message never gets
    // matched against a real campaign target in webhooks.
    token: `test-${stamp.replace(/[^0-9]/g, "")}`,
  };
}

function extractSmtpResponseCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const maybe = error as { responseCode?: unknown; code?: unknown };
  if (typeof maybe.responseCode === "number") return maybe.responseCode;
  if (typeof maybe.code === "number") return maybe.code;
  if (typeof maybe.code === "string") {
    const parsed = Number.parseInt(maybe.code, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function extractStatusCode(error: unknown): number | string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const maybe = error as { status?: unknown; statusCode?: unknown; code?: unknown };
  if (typeof maybe.statusCode === "number") return maybe.statusCode;
  if (typeof maybe.status === "number") return maybe.status;
  if (typeof maybe.code === "number" || typeof maybe.code === "string") return maybe.code;
  return undefined;
}

function isResendRateLimitError(error: unknown): boolean {
  const status = extractStatusCode(error);
  if (status === 429) return true;
  if (status === "rate_limit_exceeded") return true;
  return false;
}
