import { eq, or, sql, type SQL } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

import { db } from "@/lib/db/client";
import { campaignTargets, events } from "@/lib/db/schema";
import { enqueueSimulationEventPush } from "@/lib/integrations/siem-soar";
import { recordTrackingEvent } from "@/lib/tracking/record-event";

type ResendInboundPayload = {
  type?: string;
  data?: {
    from?: string | { email?: string; name?: string };
    to?: Array<string | { email?: string }> | string;
    subject?: string;
    text?: string;
    html?: string;
    headers?: Array<{ name?: string; value?: string }> | Record<string, string>;
    email_id?: string;
    id?: string;
    message_id?: string;
    raw?: {
      download_url?: string;
      expires_at?: string;
    } | null;
    attachments?: Array<{
      id?: string;
      filename?: string | null;
      content_type?: string;
    }>;
    rawText?: string;
  };
};

type InboundHeaders = NonNullable<NonNullable<ResendInboundPayload["data"]>["headers"]>;

function emailFromAddress(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "email" in value && typeof value.email === "string") {
    return value.email;
  }
  return "";
}

function recipients(value: unknown) {
  if (Array.isArray(value)) return value.map(emailFromAddress).filter(Boolean);
  const address = emailFromAddress(value);
  return address ? [address] : [];
}

function headerValue(headers: InboundHeaders | undefined, name: string) {
  if (!headers) return "";
  if (Array.isArray(headers)) {
    return headers.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
  }
  return headers[name] ?? headers[name.toLowerCase()] ?? "";
}

function tokenFromPayload(payload: ResendInboundPayload) {
  const data = payload.data;
  const explicit = headerValue(data?.headers, "X-Collie-Token");
  if (explicit) return explicit;

  const addresses = recipients(data?.to);
  for (const address of addresses) {
    const match = address.match(/\+([a-zA-Z0-9_-]{16,})@/);
    if (match?.[1]) return match[1];
  }

  const text = `${data?.subject ?? ""}\n${data?.text ?? ""}\n${data?.html ?? ""}\n${data?.rawText ?? ""}`;
  return text.match(/collie-token[:=\s]+([a-zA-Z0-9_-]{16,})/i)?.[1] ?? "";
}

async function retrieveRawEmailText(rawUrl: string | undefined) {
  if (!rawUrl) return "";

  try {
    const response = await fetch(rawUrl);
    if (!response.ok) return "";
    return (await response.text()).slice(0, 500_000);
  } catch (error) {
    console.warn("Could not retrieve raw inbound email", error);
    return "";
  }
}

async function enrichPayload(payload: ResendInboundPayload) {
  const emailId = payload.data?.email_id ?? payload.data?.id;
  const apiKey = process.env.RESEND_API_KEY;

  if (!emailId || !apiKey || apiKey === "re_dev_placeholder") {
    return payload;
  }

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.receiving.get(emailId);
    const email = result.data as Partial<NonNullable<ResendInboundPayload["data"]>> | null;

    if (!email) return payload;
    const rawText = await retrieveRawEmailText(email.raw?.download_url);

    return {
      ...payload,
      data: {
        ...payload.data,
        ...email,
        rawText,
      },
    };
  } catch (error) {
    console.warn("Could not retrieve full inbound email content", error);
    return payload;
  }
}

export async function POST(request: NextRequest) {
  const receivedPayload = (await request.json().catch(() => null)) as ResendInboundPayload | null;

  if (!receivedPayload?.data) {
    return NextResponse.json({ error: "Invalid inbound email payload." }, { status: 400 });
  }

  const payload = await enrichPayload(receivedPayload);
  const data = payload.data;

  if (!data) {
    return NextResponse.json({ error: "Invalid inbound email payload." }, { status: 400 });
  }

  const token = tokenFromPayload(payload);
  const from = emailFromAddress(data.from);
  const subject = data.subject ?? "";
  const messageId = data.email_id ?? data.id ?? data.message_id ?? headerValue(data.headers, "Message-ID");

  if (token) {
    const target = await recordTrackingEvent({
      token,
      eventType: "reported",
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      metadata: {
        source: "resend_inbound",
        from,
        subject,
        messageId,
        preview: data.text?.slice(0, 500) ?? data.rawText?.slice(0, 500) ?? "",
        matchedBy: "token",
      },
    });

    if (target) {
      return NextResponse.json({ ok: true, matched: "token" });
    }
  }

  const inReplyTo = headerValue(data.headers, "In-Reply-To");
  const references = headerValue(data.headers, "References");
  const originalMessageId =
    data.rawText?.match(/^Message-ID:\s*(.+)$/im)?.[1]?.trim() ??
    data.rawText?.match(/^Message-Id:\s*(.+)$/im)?.[1]?.trim() ??
    "";

  const replyClauses: SQL[] = [];
  if (inReplyTo) replyClauses.push(sql`${events.metadata}->>'messageId' = ${inReplyTo}`);
  if (references) replyClauses.push(sql`${events.metadata}->>'messageId' = ${references}`);
  if (originalMessageId) replyClauses.push(sql`${events.metadata}->>'messageId' = ${originalMessageId}`);

  const [event] =
    replyClauses.length > 0
      ? await db
          .select({ targetId: events.campaignTargetId })
          .from(events)
          .where(or(...replyClauses))
          .limit(1)
      : [];

  if (event) {
    const [insertedEvent] = await db
      .insert(events)
      .values({
        campaignTargetId: event.targetId,
        eventType: "reported",
        metadata: {
          source: "resend_inbound_reply",
          from,
          subject,
          messageId,
          inReplyTo,
          originalMessageId,
          preview: data.text?.slice(0, 500) ?? data.rawText?.slice(0, 500) ?? "",
          matchedBy: "reply_headers",
        },
      })
      .returning({ id: events.id });
    await db.update(campaignTargets).set({ reportedAt: new Date(), updatedAt: new Date() }).where(eq(campaignTargets.id, event.targetId));

    if (insertedEvent) {
      try {
        await enqueueSimulationEventPush(insertedEvent.id);
      } catch (error) {
        console.warn("SIEM/SOAR push could not be queued for inbound report", error);
      }
    }

    return NextResponse.json({ ok: true, matched: "reply" });
  }

  return NextResponse.json({ ok: true, matched: "none" });
}
