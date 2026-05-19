import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { authoriseApiRequest } from "@/lib/auth/api-key";
import { db } from "@/lib/db/client";
import { employeeSyncRuns } from "@/lib/db/schema";
import { ingestEmployees } from "@/lib/employees/ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const employeeSchema = z.object({
  email: z.string().email("email must be a valid email address."),
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  department: z.string().trim().optional().nullable(),
  managerEmail: z.string().trim().optional().nullable(),
  language: z.string().trim().optional().nullable(),
  timezone: z.string().trim().optional().nullable(),
});

export async function POST(request: NextRequest) {
  const auth = await authoriseApiRequest(request.headers);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const payload = await request.json().catch(() => null);
  const parsed = employeeSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid employee payload.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await ingestEmployees({
    organisationId: auth.organisationId,
    mode: "single",
    rows: [parsed.data],
  });

  await db.insert(employeeSyncRuns).values({
    organisationId: auth.organisationId,
    mode: "single",
    source: "api",
    actorKeyLast4: auth.apiKeyLast4,
    receivedCount: result.received,
    addedCount: result.added,
    updatedCount: result.updated,
    deactivatedCount: result.deactivated,
    skippedCount: result.skipped,
    errors: result.errors.slice(0, 25),
  });

  return NextResponse.json(
    {
      ok: true,
      email: parsed.data.email.toLowerCase(),
      added: result.added,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors,
    },
    { status: result.added > 0 ? 201 : 200 },
  );
}

export async function GET(request: NextRequest) {
  const auth = await authoriseApiRequest(request.headers);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  return NextResponse.json({
    ok: true,
    organisationId: auth.organisationId,
    actorKeyLast4: auth.apiKeyLast4,
    documentation: "POST { email, firstName?, lastName?, department?, managerEmail?, language?, timezone? }",
  });
}
