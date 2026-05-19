import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { campaignTargets, employees, realMailReports } from "@/lib/db/schema";
import { enqueueRealMailReportPush } from "@/lib/integrations/siem-soar";
import { recordTrackingEvent } from "@/lib/tracking/record-event";

const attachmentSchema = z.object({
  name: z.string().min(1).max(512),
  size: z.number().int().nonnegative().max(1024 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  contentType: z.string().max(255).optional(),
});

const reportSchema = z.object({
  subject: z.string().max(2048).default(""),
  fromAddress: z.string().max(512).default(""),
  headersRaw: z.string().max(200_000).default(""),
  bodyText: z.string().max(500_000).default(""),
  bodyHtml: z.string().max(2_000_000).default(""),
  attachmentsMeta: z.array(attachmentSchema).max(64).default([]),
  reporterEmail: z.string().email().max(320),
  messageId: z.string().max(512).optional(),
  source: z.enum(["outlook", "gmail", "teams", "manual"]).default("outlook"),
});

const COLLIE_TOKEN_PATTERNS = [
  /collie-token[:=\s]+([a-zA-Z0-9_-]{16,})/i,
  /X-Collie-Token[:\s]+([a-zA-Z0-9_-]{16,})/i,
  /report\+([a-zA-Z0-9_-]{16,})@/i,
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

function extractToken(...sources: string[]) {
  const haystack = sources.filter(Boolean).join("\n");
  for (const pattern of COLLIE_TOKEN_PATTERNS) {
    const match = haystack.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function extractUrls(...sources: string[]) {
  const haystack = sources.filter(Boolean).join("\n");
  const urls = new Set<string>();
  const urlPattern = /https?:\/\/[^\s"'<>)\]]+/gi;
  for (const match of haystack.matchAll(urlPattern)) {
    const cleaned = match[0].replace(/[.,;:!?)\]]+$/g, "");
    if (cleaned.length <= 2048) urls.add(cleaned);
    if (urls.size >= 100) break;
  }
  return Array.from(urls);
}

function bodyHash(...sources: string[]) {
  const haystack = sources.filter(Boolean).join("\n");
  return createHash("sha256").update(haystack).digest("hex");
}

function bodyPreview(bodyText: string, bodyHtml: string) {
  const text = bodyText || bodyHtml.replace(/<[^>]+>/g, " ");
  return text.replace(/\s+/g, " ").trim().slice(0, 1000);
}

function senderAddress(fromAddress: string) {
  const match = fromAddress.match(/<([^>]+)>/);
  return (match?.[1] ?? fromAddress).trim().toLowerCase();
}

async function reportersForEmail(email: string) {
  return db
    .select({
      id: employees.id,
      email: employees.email,
      organisationId: employees.organisationId,
    })
    .from(employees)
    .where(and(eq(employees.email, email.toLowerCase()), eq(employees.active, true)))
    .limit(2);
}

async function targetTenantForToken(token: string) {
  const [target] = await db
    .select({
      employeeId: campaignTargets.employeeId,
      organisationId: employees.organisationId,
    })
    .from(campaignTargets)
    .innerJoin(employees, eq(employees.id, campaignTargets.employeeId))
    .where(eq(campaignTargets.uniqueToken, token))
    .limit(1);

  return target ?? null;
}

export async function POST(request: NextRequest) {
  const json = await request.json().catch(() => null);
  const parsed = reportSchema.safeParse(json);

  if (!parsed.success) {
    return jsonResponse(
      { error: "Invalid report payload.", issues: parsed.error.flatten() },
      400,
    );
  }

  const {
    subject,
    fromAddress,
    headersRaw,
    bodyText,
    bodyHtml,
    attachmentsMeta,
    reporterEmail,
    messageId,
    source,
  } = parsed.data;

  const token = extractToken(headersRaw, subject, bodyText, bodyHtml, fromAddress);
  const reporterRows = await reportersForEmail(reporterEmail);

  if (token) {
    const targetTenant = await targetTenantForToken(token);
    const tokenReporter = targetTenant
      ? reporterRows.find((reporter) => reporter.organisationId === targetTenant.organisationId)
      : reporterRows.length === 1
        ? reporterRows[0]
        : null;

    if (targetTenant && !tokenReporter) {
      return jsonResponse(
        { error: "Reporter is not recognised for this simulation tenant." },
        404,
      );
    }

    const target = await recordTrackingEvent({
      token,
      eventType: "reported",
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      metadata: {
        source,
        matchedBy: "token",
        subject,
        from: fromAddress,
        messageId,
        reporterEmail: tokenReporter?.email ?? reporterEmail.toLowerCase(),
        reporterEmployeeId: tokenReporter?.id ?? null,
      },
    });

    if (target) {
      return jsonResponse({
        ok: true,
        matched: "simulation",
        message:
          "Nice work, this was a Collie phishing simulation and your report has been recorded.",
      });
    }
  }

  if (reporterRows.length === 0) {
    return jsonResponse(
      { error: "Reporter is not recognised. Contact your security administrator." },
      404,
    );
  }

  if (reporterRows.length > 1) {
    return jsonResponse(
      { error: "Reporter belongs to more than one tenant. Include the original Collie token in the report." },
      409,
    );
  }

  const reporter = reporterRows[0];

  const [inserted] = await db
    .insert(realMailReports)
    .values({
      organisationId: reporter.organisationId,
      reporterEmployeeId: reporter.id,
      reporterEmail: reporter.email,
      subject: subject || "(no subject)",
      sender: senderAddress(fromAddress) || "unknown",
      headersRaw: headersRaw || null,
      bodyHash: bodyHash(bodyText, bodyHtml),
      bodyPreview: bodyPreview(bodyText, bodyHtml),
      urls: extractUrls(bodyText, bodyHtml),
      attachmentsMeta,
      severity: "unknown",
      source,
    })
    .returning({ id: realMailReports.id });

  if (inserted) {
    try {
      await enqueueRealMailReportPush(inserted.id);
    } catch (error) {
      console.warn("SIEM/SOAR push could not be queued for real-mail report", error);
    }
  }

  return jsonResponse({
    ok: true,
    matched: "real_mail",
    reportId: inserted?.id,
    message: "Thanks. Your security team has been notified and will review the message.",
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
