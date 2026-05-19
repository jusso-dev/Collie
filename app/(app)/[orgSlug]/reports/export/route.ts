import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { campaignTargets, campaigns, employees } from "@/lib/db/schema";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const { orgSlug } = await params;
  const organisation = await requireOrganisationForSlug(orgSlug);
  const rows = await db
    .select({
      campaignName: campaigns.name,
      status: campaigns.status,
      employeeEmail: employees.email,
      firstName: employees.firstName,
      lastName: employees.lastName,
      sentAt: campaignTargets.sentAt,
      openedAt: campaignTargets.openedAt,
      clickedAt: campaignTargets.clickedAt,
      submittedAt: campaignTargets.submittedAt,
      reportedAt: campaignTargets.reportedAt,
      trainingCompletedAt: campaignTargets.trainingCompletedAt,
    })
    .from(campaigns)
    .leftJoin(campaignTargets, eq(campaignTargets.campaignId, campaigns.id))
    .leftJoin(employees, eq(employees.id, campaignTargets.employeeId))
    .where(eq(campaigns.organisationId, organisation.id));

  const csvRows = [
    [
      "campaign",
      "status",
      "employee",
      "employee_email",
      "sent_at",
      "opened_at",
      "clicked_at",
      "submitted_at",
      "reported_at",
      "training_completed_at",
    ],
    ...rows.map((row) => [
      row.campaignName,
      row.status,
      `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim(),
      row.employeeEmail ?? "",
      row.sentAt?.toISOString() ?? "",
      row.openedAt?.toISOString() ?? "",
      row.clickedAt?.toISOString() ?? "",
      row.submittedAt?.toISOString() ?? "",
      row.reportedAt?.toISOString() ?? "",
      row.trainingCompletedAt?.toISOString() ?? "",
    ]),
  ];
  const csv = csvRows
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${orgSlug}-campaign-report.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
