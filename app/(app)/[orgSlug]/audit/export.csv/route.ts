import { and, desc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { auditLog, users } from "@/lib/db/schema";

const CSV_HEADER = [
  "id",
  "created_at",
  "actor_name",
  "actor_email",
  "actor_user_id",
  "action",
  "resource_type",
  "resource_id",
  "metadata",
  "ip_address",
  "user_agent",
];

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = typeof value === "string" ? value : String(value);
  return `"${str.replaceAll('"', '""')}"`;
}

function toDate(value: string | null, endOfDay = false): Date | null {
  if (!value) return null;
  const parsed = new Date(endOfDay ? `${value}T23:59:59.999` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const { orgSlug } = await params;
  const organisation = await requireOrganisationForSlug(orgSlug);
  const searchParams = request.nextUrl.searchParams;
  const actorFilter = searchParams.get("actor")?.trim() ?? "";
  const actionFilter = searchParams.get("action")?.trim() ?? "";
  const fromDate = toDate(searchParams.get("from"), false);
  const toDateValue = toDate(searchParams.get("to"), true);

  const filters = [eq(auditLog.organisationId, organisation.id)];
  if (actionFilter) {
    filters.push(ilike(auditLog.action, `%${actionFilter}%`));
  }
  if (fromDate) {
    filters.push(gte(auditLog.createdAt, fromDate));
  }
  if (toDateValue) {
    filters.push(lte(auditLog.createdAt, toDateValue));
  }

  const actorJoinCondition = actorFilter
    ? sql`(${users.email} ilike ${`%${actorFilter}%`} or ${users.name} ilike ${`%${actorFilter}%`})`
    : null;

  let query = db
    .select({
      id: auditLog.id,
      createdAt: auditLog.createdAt,
      action: auditLog.action,
      resourceType: auditLog.resourceType,
      resourceId: auditLog.resourceId,
      metadata: auditLog.metadata,
      ipAddress: auditLog.ipAddress,
      userAgent: auditLog.userAgent,
      actorUserId: auditLog.actorUserId,
      actorName: users.name,
      actorEmail: users.email,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .$dynamic();

  if (actorJoinCondition) {
    query = query.where(and(...filters, actorJoinCondition));
  } else {
    query = query.where(and(...filters));
  }

  const rows = await query.orderBy(desc(auditLog.createdAt));

  const csvLines = [
    CSV_HEADER.join(","),
    ...rows.map((row) =>
      [
        row.id,
        row.createdAt.toISOString(),
        row.actorName ?? "",
        row.actorEmail ?? "",
        row.actorUserId ?? "",
        row.action,
        row.resourceType,
        row.resourceId ?? "",
        row.metadata ? JSON.stringify(row.metadata) : "{}",
        row.ipAddress ?? "",
        row.userAgent ?? "",
      ]
        .map(escapeCsv)
        .join(","),
    ),
  ];
  const csv = csvLines.join("\n");
  const sha256 = crypto.createHash("sha256").update(csv, "utf8").digest("hex");
  const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\..+$/, "");
  const filename = `${orgSlug}-audit-${timestamp}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Audit-Sha256": sha256,
      "Cache-Control": "no-store",
    },
  });
}
