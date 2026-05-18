import { NextRequest } from "next/server";

import { renderLandingPageForToken } from "@/lib/tracking/render-landing-page";
import { recordTrackingEvent } from "@/lib/tracking/record-event";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const target = await recordTrackingEvent({
    token,
    eventType: "clicked",
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  });

  if (!target) {
    return new Response("This training link is no longer active.", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return new Response(await renderLandingPageForToken(token), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await request.formData().catch(() => null);

  const submitted = body
    ? Array.from(body.entries()).reduce<Record<string, string>>((metadata, [key, value]) => {
        if (key.toLowerCase().includes("password")) {
          metadata[key] = value ? "[provided]" : "";
          return metadata;
        }
        metadata[key] = typeof value === "string" ? value.slice(0, 200) : "[file]";
        return metadata;
      }, {})
    : {};

  await recordTrackingEvent({
    token,
    eventType: "submitted",
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
    metadata: {
      source: "landing_page_form",
      fields: submitted,
    },
  });

  return new Response(await renderLandingPageForToken(token), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
