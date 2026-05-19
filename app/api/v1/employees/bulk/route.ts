import { NextResponse, type NextRequest } from "next/server";

import { authoriseApiRequest } from "@/lib/auth/api-key";
import { db } from "@/lib/db/client";
import { employeeSyncRuns } from "@/lib/db/schema";
import {
  type EmployeeIngestInput,
  type IngestError,
  type IngestMode,
  ingestEmployees,
  parseEmployeesCsv,
  parseEmployeesJsonl,
} from "@/lib/employees/ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB hard cap
const MAX_ROWS = 25_000;

function resolveMode(request: NextRequest): IngestMode {
  const mode = request.nextUrl.searchParams.get("mode")?.toLowerCase();
  if (mode === "full") return "bulk_full";
  return "bulk_incremental";
}

function resolveContentType(request: NextRequest): "csv" | "jsonl" | "json" | "unknown" {
  const raw = (request.headers.get("content-type") ?? "").toLowerCase();
  if (raw.includes("text/csv") || raw.includes("application/csv")) return "csv";
  if (raw.includes("application/jsonl") || raw.includes("application/x-ndjson") || raw.includes("application/x-jsonlines")) {
    return "jsonl";
  }
  if (raw.includes("application/json")) return "json";
  return "unknown";
}

async function readBoundedText(request: NextRequest): Promise<string | { error: string }> {
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader) {
    const declared = Number.parseInt(lengthHeader, 10);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return { error: `Body exceeds ${MAX_BODY_BYTES} bytes.` };
    }
  }
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return { error: `Body exceeds ${MAX_BODY_BYTES} bytes.` };
  }
  return body;
}

export async function POST(request: NextRequest) {
  const auth = await authoriseApiRequest(request.headers);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const mode = resolveMode(request);
  const contentType = resolveContentType(request);

  if (contentType === "unknown") {
    return NextResponse.json(
      {
        error:
          "Set Content-Type to one of: application/jsonl, application/x-ndjson, text/csv, application/json (array).",
      },
      { status: 415 },
    );
  }

  const bodyOrError = await readBoundedText(request);
  if (typeof bodyOrError !== "string") {
    return NextResponse.json({ error: bodyOrError.error }, { status: 413 });
  }
  const body = bodyOrError;

  let rows: EmployeeIngestInput[] = [];
  let parseErrors: IngestError[] = [];

  if (contentType === "csv") {
    const parsed = parseEmployeesCsv(body);
    rows = parsed.rows;
    parseErrors = parsed.errors;
  } else if (contentType === "jsonl") {
    const parsed = parseEmployeesJsonl(body);
    rows = parsed.rows;
    parseErrors = parsed.errors;
  } else {
    try {
      const value = JSON.parse(body) as unknown;
      if (!Array.isArray(value)) {
        return NextResponse.json(
          { error: "application/json bodies must be an array of employee objects." },
          { status: 400 },
        );
      }
      rows = value as EmployeeIngestInput[];
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Could not parse JSON body." },
        { status: 400 },
      );
    }
  }

  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `Bulk syncs are capped at ${MAX_ROWS} rows per request.` }, { status: 413 });
  }

  const result = await ingestEmployees({
    organisationId: auth.organisationId,
    mode,
    rows,
    parseErrors,
  });

  const [run] = await db
    .insert(employeeSyncRuns)
    .values({
      organisationId: auth.organisationId,
      mode,
      source: "api",
      actorKeyLast4: auth.apiKeyLast4,
      receivedCount: result.received,
      addedCount: result.added,
      updatedCount: result.updated,
      deactivatedCount: result.deactivated,
      skippedCount: result.skipped,
      errors: result.errors.slice(0, 50),
    })
    .returning({ id: employeeSyncRuns.id, createdAt: employeeSyncRuns.createdAt });

  return NextResponse.json({
    ok: true,
    runId: run?.id,
    syncedAt: run?.createdAt,
    mode,
    received: result.received,
    added: result.added,
    updated: result.updated,
    deactivated: result.deactivated,
    skipped: result.skipped,
    errors: result.errors,
  });
}
