import { eq } from "drizzle-orm";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { campaignTargets, campaigns, employees } from "@/lib/db/schema";

function rate(numerator: number, denominator: number) {
  if (denominator === 0) return "No data";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

export default async function ReportsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const organisation = await requireOrganisationForSlug(orgSlug);
  const rows = await db
    .select({
      campaignId: campaigns.id,
      targetId: campaignTargets.id,
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
  const campaignTargetRows = rows.filter((row) => row.targetId);
  const clicked = campaignTargetRows.filter((row) => row.clickedAt).length;
  const submitted = campaignTargetRows.filter((row) => row.submittedAt).length;
  const reported = campaignTargetRows.filter((row) => row.reportedAt).length;
  const trained = campaignTargetRows.filter((row) => row.trainingCompletedAt).length;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-[rgb(56_189_248_/_0.08)] p-5 md:flex md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Reports</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Review campaign outcomes from the event log and export a CSV for deeper analysis.
          </p>
        </div>
        <Link href={`/${orgSlug}/reports/export`} className={buttonVariants({ variant: "outline" })}>
          Export CSV
        </Link>
        <Link href={`/${orgSlug}/reports/events.csv`} className={buttonVariants({ variant: "outline" })}>
          Export events
        </Link>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardHeader>
            <CardTitle>Targets</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{campaignTargetRows.length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Click rate</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{rate(clicked, campaignTargetRows.length)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Submit rate</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{rate(submitted, campaignTargetRows.length)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Report rate</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{rate(reported, campaignTargetRows.length)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Training complete</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{rate(trained, campaignTargetRows.length)}</CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Campaign outcomes</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No campaigns have been created for this organisation yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-3 font-medium">Campaign</th>
                    <th className="py-3 font-medium">Employee</th>
                    <th className="py-3 font-medium">Sent</th>
                    <th className="py-3 font-medium">Opened</th>
                    <th className="py-3 font-medium">Clicked</th>
                    <th className="py-3 font-medium">Submitted</th>
                    <th className="py-3 font-medium">Reported</th>
                    <th className="py-3 font-medium">Training</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={`${row.campaignId}-${index}`} className="border-b last:border-b-0">
                      <td className="py-3">
                        <div className="font-medium">{row.campaignName}</div>
                        <div className="text-muted-foreground">{row.status}</div>
                      </td>
                      <td className="py-3">
                        {row.employeeEmail ? (
                          <>
                            <div className="font-medium">
                              {row.firstName} {row.lastName}
                            </div>
                            <div className="text-muted-foreground">{row.employeeEmail}</div>
                          </>
                        ) : (
                          "No targets"
                        )}
                      </td>
                      <td className="py-3">{row.sentAt ? "Yes" : "No"}</td>
                      <td className="py-3">{row.openedAt ? "Yes" : "No"}</td>
                      <td className="py-3">{row.clickedAt ? "Yes" : "No"}</td>
                      <td className="py-3">{row.submittedAt ? "Yes" : "No"}</td>
                      <td className="py-3">{row.reportedAt ? "Yes" : "No"}</td>
                      <td className="py-3">{row.trainingCompletedAt ? "Complete" : "Not complete"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
