import { eq } from "drizzle-orm";
import { CheckCircle2, Clock, Send } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { campaignTargets, campaigns, employees } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

function rate(numerator: number, denominator: number) {
  if (denominator === 0) return "No data";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const organisation = await requireOrganisationForSlug(orgSlug);
  const employeeList = await db
    .select({
      id: employees.id,
      active: employees.active,
      riskScore: employees.riskScore,
    })
    .from(employees)
    .where(eq(employees.organisationId, organisation.id));
  const campaignRows = await db
    .select({
      id: campaigns.id,
      targetId: campaignTargets.id,
      name: campaigns.name,
      status: campaigns.status,
      sentAt: campaignTargets.sentAt,
      clickedAt: campaignTargets.clickedAt,
      submittedAt: campaignTargets.submittedAt,
      reportedAt: campaignTargets.reportedAt,
      trainingCompletedAt: campaignTargets.trainingCompletedAt,
    })
    .from(campaigns)
    .leftJoin(campaignTargets, eq(campaignTargets.campaignId, campaigns.id))
    .where(eq(campaigns.organisationId, organisation.id));
  const activeEmployees = employeeList.filter((employee) => employee.active);
  const targets = campaignRows.filter((row) => row.targetId);
  const clicked = targets.filter((row) => row.clickedAt).length;
  const submitted = targets.filter((row) => row.submittedAt).length;
  const reported = targets.filter((row) => row.reportedAt).length;
  const trained = targets.filter((row) => row.trainingCompletedAt).length;
  const averageRisk =
    employeeList.length === 0
      ? null
      : Math.round(employeeList.reduce((total, employee) => total + employee.riskScore, 0) / employeeList.length);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-lg border border-[rgb(13_27_42_/_0.92)] bg-[var(--collie-navy)] text-[var(--collie-white)] shadow-[0_16px_40px_rgb(13_27_42_/_0.16)]">
        <div className="grid gap-0 lg:grid-cols-[1fr_360px]">
          <div className="p-6 sm:p-7">
            <Badge className="mb-5 bg-[var(--collie-orange)] text-[var(--collie-navy)]">
              Admin dashboard
            </Badge>
            <h1 className="max-w-2xl text-3xl font-semibold leading-tight tracking-normal">
              Run realistic simulations without making people feel small.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-primary-foreground/72">
              Track campaign outcomes, report behaviour, and training momentum from one calm operating view.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link
                href={`/${orgSlug}/campaigns`}
                className={cn(
                  buttonVariants(),
                  "bg-[var(--collie-orange)] text-[var(--collie-navy)] hover:bg-[color-mix(in_srgb,var(--collie-orange)_88%,var(--collie-white))]",
                )}
              >
                <Send className="size-4" />
                New campaign
              </Link>
              <Link
                href={`/${orgSlug}/employees`}
                className={cn(
                  buttonVariants({ variant: "ghost" }),
                  "border border-primary-foreground/18 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground",
                )}
              >
                Import employees
              </Link>
            </div>
          </div>
          <div className="border-t border-primary-foreground/14 bg-[rgb(56_189_248_/_0.10)] p-6 sm:p-7 lg:border-l lg:border-t-0">
            <p className="text-sm font-medium text-primary-foreground/72">Risk posture</p>
            <div className="mt-4 rounded-lg border border-primary-foreground/14 bg-primary-foreground/6 p-4">
              {averageRisk === null ? (
                <>
                  <p className="text-lg font-semibold">Not calculated yet</p>
                  <p className="mt-2 text-sm leading-6 text-primary-foreground/72">
                    Risk posture appears once employees have campaign or training history.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-5xl font-semibold leading-none">{averageRisk}</p>
                  <p className="mt-2 text-sm leading-6 text-primary-foreground/72">
                    Average score across {employeeList.length} employees. Lower is safer.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="grid overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Active employees", value: activeEmployees.length || "No data" },
          { label: "Click rate", value: rate(clicked, targets.length) },
          { label: "Submit rate", value: rate(submitted, targets.length) },
          { label: "Report rate", value: rate(reported, targets.length) },
          { label: "Training complete", value: rate(trained, targets.length) },
        ].map((metric) => (
          <div key={metric.label} className="border-b border-border p-4 last:border-b-0 sm:odd:border-r xl:border-b-0 xl:border-r xl:last:border-r-0">
            <p className="text-sm font-medium text-muted-foreground">{metric.label}</p>
            <div className="mt-3 text-2xl font-semibold tracking-normal">{metric.value}</div>
          </div>
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card className="bg-[var(--collie-white)]">
          <CardHeader>
            <CardTitle>90 day trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-72 items-center justify-center rounded-lg border border-dashed border-border bg-[var(--collie-cloud)] px-6 text-center">
              <p className="max-w-sm text-sm leading-6 text-muted-foreground">
                No trend data yet. Launch a campaign and complete training to start building a 90 day view.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[rgb(56_189_248_/_0.08)]">
          <CardHeader>
            <CardTitle>Setup checklist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-[var(--collie-blue)]" aria-hidden="true" />
                <span>Organisation profile created</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                {employeeList.length > 0 ? (
                  <CheckCircle2 className="size-4 text-[var(--collie-blue)]" aria-hidden="true" />
                ) : (
                  <Clock className="size-4" aria-hidden="true" />
                )}
                <span>Add employees</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                {campaignRows.length > 0 ? (
                  <CheckCircle2 className="size-4 text-[var(--collie-blue)]" aria-hidden="true" />
                ) : (
                  <Clock className="size-4" aria-hidden="true" />
                )}
                <span>Create a campaign</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                {organisation.resendApiKeyEncrypted ? (
                  <CheckCircle2 className="size-4 text-[var(--collie-blue)]" aria-hidden="true" />
                ) : (
                  <Clock className="size-4" aria-hidden="true" />
                )}
                <span>Add Resend API key</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                {organisation.senderFromAddress ? (
                  <CheckCircle2 className="size-4 text-[var(--collie-blue)]" aria-hidden="true" />
                ) : (
                  <Clock className="size-4" aria-hidden="true" />
                )}
                <span>Add sender From address</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle>Campaigns in motion</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-3 font-medium">Campaign</th>
                <th className="py-3 font-medium">Status</th>
                <th className="py-3 font-medium">Targets</th>
                <th className="py-3 font-medium">Click rate</th>
                <th className="py-3 font-medium">Report rate</th>
              </tr>
            </thead>
            <tbody>
              {campaignRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                    No campaigns yet. Draft your first campaign when employees and sending settings are ready.
                  </td>
                </tr>
              ) : (
                Array.from(new Map(campaignRows.map((campaign) => [campaign.id, campaign])).values()).map(
                  (campaign) => {
                    const campaignTargetsForRow = targets.filter((target) => target.id === campaign.id);

                    return (
                      <tr key={campaign.id} className="border-b last:border-b-0">
                        <td className="py-3 font-medium">{campaign.name}</td>
                        <td className="py-3">{campaign.status}</td>
                        <td className="py-3">{campaignTargetsForRow.length}</td>
                        <td className="py-3">
                          {rate(
                            campaignTargetsForRow.filter((target) => target.clickedAt).length,
                            campaignTargetsForRow.length,
                          )}
                        </td>
                        <td className="py-3">
                          {rate(
                            campaignTargetsForRow.filter((target) => target.reportedAt).length,
                            campaignTargetsForRow.length,
                          )}
                        </td>
                      </tr>
                    );
                  },
                )
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
