import { NextRequest, userAgent } from "next/server";

import { detectBotClick } from "@/lib/tracking/bot-detection";
import { clickMetadata, clickSourceFromSearchParams } from "@/lib/tracking/click-metadata";
import { renderLandingPageForToken } from "@/lib/tracking/render-landing-page";
import { recordTrackingEvent } from "@/lib/tracking/record-event";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const source = clickSourceFromSearchParams(request.nextUrl.searchParams);
  const agent = userAgent(request);
  const userAgentValue = request.headers.get("user-agent");

  const target = await recordTrackingEvent({
    token,
    eventType: "clicked",
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: userAgentValue,
    metadata: clickMetadata({
      source,
      headers: request.headers,
      device: {
        browser: agent.browser.name,
        browserVersion: agent.browser.version,
        deviceModel: agent.device.model,
        deviceType: agent.device.type,
        deviceVendor: agent.device.vendor,
        engine: agent.engine.name,
        os: agent.os.name,
        osVersion: agent.os.version,
        cpu: agent.cpu.architecture,
        isBot: agent.isBot,
      },
    }),
    suppressionDecision: (campaignTarget) => {
      const bot = detectBotClick({
        userAgent: userAgentValue,
        method: request.method,
        isBot: agent.isBot,
        sentAt: campaignTarget.sentAt,
      });
      if (!bot.bot) return { suppress: false };
      return {
        suppress: true,
        metadataPatch: { bot: true, suppressionReason: bot.reason },
      };
    },
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
  const scenario = body?.get("scenario");
  const mfaAction = body?.get("mfaAction");

  if (scenario === "mfa_fatigue") {
    const action = mfaAction === "approve" || mfaAction === "deny" || mfaAction === "report" ? mfaAction : "report";
    const approved = action === "approve";

    await recordTrackingEvent({
      token,
      eventType: approved ? "submitted" : "reported",
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      metadata: {
        scenario: "mfa_fatigue",
        action,
        source: "mfa_push_simulator",
      },
    });

    return new Response(await renderLandingPageForToken(token, { mfaOutcome: approved ? "approved" : "reported" }), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

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
  const isOAuthConsent = scenario === "oauth_consent";

  await recordTrackingEvent({
    token,
    eventType: "submitted",
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
    metadata: {
      source: "landing_page_form",
      ...(isOAuthConsent ? { scenario: "oauth_consent" } : {}),
      fields: submitted,
    },
  });

  return new Response(
    await renderLandingPageForToken(token, isOAuthConsent ? { submittedScenario: "oauth_consent" } : {}),
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}
