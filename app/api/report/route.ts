import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { recordTrackingEvent } from "@/lib/tracking/record-event";

const reportSchema = z.object({
  token: z.string().min(12),
  messageId: z.string().optional(),
  source: z.enum(["outlook", "gmail", "manual"]).default("manual"),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = reportSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Report token is invalid." }, { status: 400 });
  }

  const target = await recordTrackingEvent({
    token: parsed.data.token,
    eventType: "reported",
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
    metadata: {
      messageId: parsed.data.messageId,
      source: parsed.data.source,
    },
  });

  if (!target) {
    return NextResponse.json({ error: "Report token is unknown." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    message: "Thanks. This report has been received for review.",
  });
}
