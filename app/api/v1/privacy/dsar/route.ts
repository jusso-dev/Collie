import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { authoriseApiRequest } from "@/lib/auth/api-key";
import { scrubEmployeePiiForDsar } from "@/lib/compliance/event-retention";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const dsarSchema = z.object({
  email: z.string().trim().email("email must be a valid email address."),
});

export async function POST(request: NextRequest) {
  const auth = await authoriseApiRequest(request.headers);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const payload = await request.json().catch(() => null);
  const parsed = dsarSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid DSAR payload.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await scrubEmployeePiiForDsar({
    organisationId: auth.organisationId,
    email: parsed.data.email,
  });

  if (!result.matched) {
    return NextResponse.json({ ok: false, error: "Employee email was not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    employeeId: result.employeeId,
    redactedEmail: result.redactedEmail,
    employeeRowsUpdated: result.employeeRowsUpdated,
    eventsScrubbed: result.eventsScrubbed,
    realMailReportsScrubbed: result.realMailReportsScrubbed,
  });
}
