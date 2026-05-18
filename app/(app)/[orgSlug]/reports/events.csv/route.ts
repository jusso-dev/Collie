import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { campaignTargets, campaigns, employees, events } from "@/lib/db/schema";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const { orgSlug } = await params;
  const organisation = await requireOrganisationForSlug(orgSlug);
  const rows = await db
    .select({
      campaignName: campaigns.name,
      employeeEmail: employees.email,
      firstName: employees.firstName,
      lastName: employees.lastName,
      eventType: events.eventType,
      metadata: events.metadata,
      createdAt: events.createdAt,
    })
    .from(events)
    .innerJoin(campaignTargets, eq(campaignTargets.id, events.campaignTargetId))
    .innerJoin(campaigns, eq(campaigns.id, campaignTargets.campaignId))
    .innerJoin(employees, eq(employees.id, campaignTargets.employeeId))
    .where(eq(campaigns.organisationId, organisation.id));

  const csvRows = [
    ["campaign", "employee", "employee_email", "event_type", "metadata", "created_at"],
    ...rows.map((row) => [
      row.campaignName,
      `${row.firstName} ${row.lastName}`,
      row.employeeEmail,
      row.eventType,
      JSON.stringify(row.metadata ?? {}),
      row.createdAt.toISOString(),
    ]),
  ];
  const csv = csvRows
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${orgSlug}-raw-events.csv"`,
    },
  });
}
