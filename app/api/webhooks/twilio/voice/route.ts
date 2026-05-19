import { eq, or } from "drizzle-orm";
import { type NextRequest } from "next/server";

import { db } from "@/lib/db/client";
import {
  campaignTargets,
  campaigns,
  emailTemplates,
  employees,
  organisations,
  voiceCallAttempts,
} from "@/lib/db/schema";
import { recordTrackingEvent } from "@/lib/tracking/record-event";
import { redactDtmfDigits, redactPii } from "@/lib/voice/redaction";
import { buildDtmfCompleteTwiML, buildVoiceScript, buildVoiceTwiML } from "@/lib/voice/twilio";

export const runtime = "nodejs";

type TwilioParams = {
  attemptId: string;
  token: string;
  phase: string;
  test: boolean;
  callSid: string;
  digits: string;
  recordingUrl: string;
  recordingSid: string;
  recordingStatus: string;
  recordingDuration: string;
  transcriptionText: string;
  consentCaptured: boolean;
  message: string;
};

function xmlResponse(body: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function paramsFrom(request: NextRequest): Promise<TwilioParams> {
  const url = new URL(request.url);
  const formData = request.method === "POST" ? await request.formData().catch(() => null) : null;

  const value = (key: string) => {
    const formValue = formData?.get(key);
    if (typeof formValue === "string") return formValue;
    return url.searchParams.get(key) ?? "";
  };

  return {
    attemptId: value("attemptId"),
    token: value("token"),
    phase: value("phase"),
    test: value("test") === "1" || value("test") === "true",
    callSid: value("CallSid"),
    digits: value("Digits"),
    recordingUrl: value("RecordingUrl"),
    recordingSid: value("RecordingSid"),
    recordingStatus: value("RecordingStatus"),
    recordingDuration: value("RecordingDuration"),
    transcriptionText: value("TranscriptionText") || value("RecordingTranscript"),
    consentCaptured: value("consent") === "1" || value("consent") === "true",
    message: value("message"),
  };
}

async function loadAttemptContext(input: { attemptId?: string; callSid?: string }) {
  const filters = [];
  if (input.attemptId) filters.push(eq(voiceCallAttempts.id, input.attemptId));
  if (input.callSid) filters.push(eq(voiceCallAttempts.providerCallSid, input.callSid));
  if (filters.length === 0) return null;

  const [row] = await db
    .select({
      attemptId: voiceCallAttempts.id,
      providerCallSid: voiceCallAttempts.providerCallSid,
      consentCaptured: voiceCallAttempts.consentCaptured,
      targetId: campaignTargets.id,
      token: campaignTargets.uniqueToken,
      firstName: employees.firstName,
      lastName: employees.lastName,
      department: employees.department,
      organisationName: organisations.name,
      ttsProvider: organisations.ttsProvider,
      campaignName: campaigns.name,
      scenario: campaigns.scenario,
      templateText: emailTemplates.textBody,
    })
    .from(voiceCallAttempts)
    .innerJoin(campaignTargets, eq(campaignTargets.id, voiceCallAttempts.campaignTargetId))
    .innerJoin(campaigns, eq(campaigns.id, campaignTargets.campaignId))
    .innerJoin(employees, eq(employees.id, campaignTargets.employeeId))
    .innerJoin(organisations, eq(organisations.id, campaigns.organisationId))
    .leftJoin(emailTemplates, eq(emailTemplates.id, campaigns.emailTemplateId))
    .where(filters.length === 1 ? filters[0] : or(filters[0], filters[1]))
    .limit(1);

  return row ?? null;
}

async function rememberCallSid(input: { attemptId: string; callSid: string; consentCaptured: boolean }) {
  if (!input.callSid) return;

  await db
    .update(voiceCallAttempts)
    .set(
      input.consentCaptured
        ? { providerCallSid: input.callSid, consentCaptured: true, updatedAt: new Date() }
        : { providerCallSid: input.callSid, updatedAt: new Date() },
    )
    .where(eq(voiceCallAttempts.id, input.attemptId));
}

async function handleRecording(params: TwilioParams) {
  const context = await loadAttemptContext({ attemptId: params.attemptId, callSid: params.callSid });
  if (!context) {
    return xmlResponse('<?xml version="1.0" encoding="UTF-8"?><Response />');
  }

  await db
    .update(voiceCallAttempts)
    .set({
      recordingUrl: redactPii(params.recordingUrl),
      redactedTranscript: redactPii(params.transcriptionText),
      consentCaptured: context.consentCaptured || params.consentCaptured,
      updatedAt: new Date(),
    })
    .where(eq(voiceCallAttempts.id, context.attemptId));

  return xmlResponse('<?xml version="1.0" encoding="UTF-8"?><Response />');
}

async function handleDtmf(params: TwilioParams) {
  const context = await loadAttemptContext({ attemptId: params.attemptId, callSid: params.callSid });
  if (!context) {
    return xmlResponse(buildDtmfCompleteTwiML({ message: "Thank you. This call is complete." }));
  }

  const redactedDigits = redactDtmfDigits(params.digits);
  const now = new Date();

  await db
    .update(voiceCallAttempts)
    .set({
      dtmfDigits: redactedDigits,
      consentCaptured: context.consentCaptured || params.consentCaptured,
      updatedAt: now,
    })
    .where(eq(voiceCallAttempts.id, context.attemptId));

  await recordTrackingEvent({
    token: context.token,
    eventType: "submitted",
    metadata: {
      source: "twilio_voice_dtmf",
      provider: "twilio",
      providerCallSid: params.callSid || context.providerCallSid,
      attemptId: context.attemptId,
      consentCaptured: context.consentCaptured || params.consentCaptured,
      fields: {
        dtmfDigits: redactedDigits,
        digitsLength: params.digits.length,
      },
    },
  });

  return xmlResponse(buildDtmfCompleteTwiML());
}

async function handleInitialTwiML(request: NextRequest, params: TwilioParams) {
  if (params.test) {
    return xmlResponse(
      buildVoiceTwiML({
        actionUrl: request.url,
        includeConsentNotice: false,
        script: {
          opening: params.message || "This is a Collie voice test call. Your Twilio voice transport is connected.",
          prompt: "Press any digit, then press pound, to complete the test.",
          noInput: "No input was received. This test call is complete.",
          completed: "This test call is complete.",
        },
      }),
    );
  }

  const context = await loadAttemptContext({ attemptId: params.attemptId, callSid: params.callSid });
  if (!context) {
    return xmlResponse(buildDtmfCompleteTwiML({ message: "This call is no longer active." }));
  }

  await rememberCallSid({
    attemptId: context.attemptId,
    callSid: params.callSid,
    consentCaptured: true,
  });

  const actionUrl = new URL(request.url);
  actionUrl.searchParams.set("attemptId", context.attemptId);
  actionUrl.searchParams.set("token", context.token);
  actionUrl.searchParams.set("phase", "gather");

  return xmlResponse(
    buildVoiceTwiML({
      actionUrl: actionUrl.toString(),
      includeConsentNotice: true,
      script: buildVoiceScript({
        organisationName: context.organisationName,
        campaignName: context.campaignName,
        scenario: context.scenario,
        templateText: context.templateText,
        target: {
          id: context.targetId,
          token: context.token,
          phoneNumber: null,
          firstName: context.firstName,
          lastName: context.lastName,
          department: context.department,
        },
      }),
    }),
  );
}

async function handleStatus(params: TwilioParams) {
  if (params.callSid && params.attemptId) {
    await rememberCallSid({
      attemptId: params.attemptId,
      callSid: params.callSid,
      consentCaptured: params.consentCaptured,
    });
  }

  return xmlResponse('<?xml version="1.0" encoding="UTF-8"?><Response />');
}

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const params = await paramsFrom(request);

  if (params.phase === "recording") {
    return handleRecording(params);
  }

  if (params.phase === "status") {
    return handleStatus(params);
  }

  if (params.phase === "gather" || params.digits) {
    return handleDtmf(params);
  }

  return handleInitialTwiML(request, params);
}
