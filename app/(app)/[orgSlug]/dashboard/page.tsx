import { ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, Clock, Send } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { getRiskDashboardData, parseCohortSort } from "@/lib/risk/dashboard";
import { cn } from "@/lib/utils";

function percent(value: number | null) {
  return value === null ? "No data" : `${value}%`;
}

function score(value: number | null) {
  return value === null ? "No data" : value.toFixed(1);
}

function delta(value: number | null) {
  if (value === null) return "No history";
  if (value === 0) return "0.0";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function riskTone(value: number | null) {
  if (value === null) return "bg-muted text-muted-foreground";
  if (value >= 65) return "bg-red-50 text-red-700";
  if (value >= 45) return "bg-amber-50 text-amber-700";
  return "bg-emerald-50 text-emerald-700";
}

function deltaIcon(value: number | null) {
  if (value === null || value === 0) return <ArrowUpDown className="size-4" aria-hidden="true" />;
  return value > 0 ? (
    <ArrowUp className="size-4 text-red-600" aria-hidden="true" />
  ) : (
    <ArrowDown className="size-4 text-emerald-600" aria-hidden="true" />
  );
}

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ cohortSort?: string | string[] }>;
}) {
  const { orgSlug } = await params;
  const { cohortSort: rawCohortSort } = await searchParams;
  const cohortSort = parseCohortSort(rawCohortSort);
  const organisation = await requireOrganisationForSlug(orgSlug);
  const dashboard = await getRiskDashboardData(organisation, cohortSort);
  const transportConfigured =
    organisation.sendingTransport === "smtp"
      ? Boolean(organisation.smtpHost && organisation.smtpPort && organisation.smtpFromAddress)
      : Boolean(organisation.resendApiKeyEncrypted);
  const fromAddressConfigured =
    organisation.sendingTransport === "smtp"
      ? Boolean(organisation.smtpFromAddress || organisation.senderFromAddress)
      : Boolean(organisation.senderFromAddress);
  const sortHref =
    cohortSort === "riskDeltaDesc"
      ? `/${orgSlug}/dashboard?cohortSort=riskDeltaAsc`
      : `/${orgSlug}/dashboard?cohortSort=riskDeltaDesc`;

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-lg border border-[rgb(13_27_42_/_0.92)] bg-[var(--collie-navy)] text-[var(--collie-white)] shadow-[0_16px_40px_rgb(13_27_42_/_0.16)]">
        <div className="grid gap-0 lg:grid-cols-[1fr_380px]">
          <div className="p-6 sm:p-7">
            <Badge className="mb-5 bg-[var(--collie-orange)] text-[var(--collie-navy)]">
              Human risk dashboard
            </Badge>
            <h1 className="max-w-2xl text-3xl font-semibold leading-tight tracking-normal">
              Org, cohort, and industry benchmark view.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-primary-foreground/72">
              Weighted risk posture, phishing-prone percentage, cohort rollups, and trend deltas from campaign outcomes.
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
            <p className="text-sm font-medium text-primary-foreground/72">Human Risk Score</p>
            <div className="mt-4 rounded-lg border border-primary-foreground/14 bg-primary-foreground/6 p-4">
              <p className="text-5xl font-semibold leading-none">{score(dashboard.humanRiskScore)}</p>
              <p className="mt-2 text-sm leading-6 text-primary-foreground/72">
                Weighted across {dashboard.employees.active} active employees. Lower is safer.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Active employees", value: dashboard.employees.active || "No data" },
          { label: "Click rate", value: percent(dashboard.outcomes.clickRate) },
          { label: "Submit rate", value: percent(dashboard.outcomes.submitRate) },
          { label: "Report rate", value: percent(dashboard.outcomes.reportRate) },
          { label: "Training complete", value: percent(dashboard.outcomes.trainingCompleteRate) },
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
            <CardTitle>30 / 90 / 180 day trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-3">
              {dashboard.trend.map((point) => (
                <div key={point.days} className="rounded-lg border border-border bg-[var(--collie-cloud)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-muted-foreground">{point.days} days</p>
                    {deltaIcon(point.delta)}
                  </div>
                  <p className="mt-3 text-3xl font-semibold tracking-normal">{delta(point.delta)}</p>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    Baseline {score(point.baselineScore)} with {point.eventCount} events observed.
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[rgb(56_189_248_/_0.08)]">
          <CardHeader>
            <CardTitle>Industry benchmark</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Organisation PPP</p>
              <p className="mt-2 text-3xl font-semibold tracking-normal">{percent(dashboard.outcomes.orgPpp)}</p>
            </div>
            {dashboard.benchmark ? (
              <div className="rounded-lg border border-border bg-background p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">
                    {dashboard.benchmark.industry} / {dashboard.benchmark.employeeCountBand}
                  </span>
                  <Badge variant="secondary">n={dashboard.benchmark.sampleSize}</Badge>
                </div>
                <p className="mt-3 text-2xl font-semibold">{dashboard.benchmark.medianPpp}% median PPP</p>
                <p className="mt-2 text-muted-foreground">
                  {dashboard.benchmark.delta === null
                    ? "No org PPP comparison yet."
                    : `${dashboard.benchmark.delta > 0 ? "+" : ""}${dashboard.benchmark.delta} points vs benchmark.`}
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                No benchmark row matches this organisation yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card">
        <CardHeader className="md:flex-row md:items-center md:justify-between">
          <CardTitle>Cohort risk rollups</CardTitle>
          <Link href={sortHref} className={cn(buttonVariants({ variant: "outline" }), "h-9")}>
            <ArrowUpDown className="size-4" />
            Sort risk delta
          </Link>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[840px] text-left text-sm">
            <thead className="border-b text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-3 font-medium">Cohort</th>
                <th className="py-3 font-medium">Employees</th>
                <th className="py-3 font-medium">Avg risk</th>
                <th className="py-3 font-medium">90d delta</th>
                <th className="py-3 font-medium">PPP</th>
                <th className="py-3 font-medium">Report rate</th>
                <th className="py-3 font-medium">Targets</th>
                <th className="py-3 font-medium">90d events</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.cohorts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                    Add active employees to build department, manager, region, and timezone cohorts.
                  </td>
                </tr>
              ) : (
                dashboard.cohorts.map((cohort) => (
                  <tr key={`${cohort.type}-${cohort.value}`} className="border-b last:border-b-0">
                    <td className="py-3 pr-4">
                      <div className="font-medium">{cohort.value}</div>
                      <div className="text-muted-foreground">{cohort.type}</div>
                    </td>
                    <td className="py-3">{cohort.employeeCount}</td>
                    <td className="py-3">
                      <span className={cn("rounded px-2 py-1 text-xs font-medium", riskTone(cohort.averageRisk))}>
                        {score(cohort.averageRisk)}
                      </span>
                    </td>
                    <td className="py-3">
                      <span className="inline-flex items-center gap-1">
                        {deltaIcon(cohort.riskDelta90)}
                        {delta(cohort.riskDelta90)}
                      </span>
                    </td>
                    <td className="py-3">{percent(cohort.ppp)}</td>
                    <td className="py-3">{percent(cohort.reportRate)}</td>
                    <td className="py-3">{cohort.sentTargets}</td>
                    <td className="py-3">{cohort.eventsLast90}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
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
                {dashboard.campaigns.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                      No campaigns yet. Draft your first campaign when employees and sending settings are ready.
                    </td>
                  </tr>
                ) : (
                  dashboard.campaigns.map((campaign) => (
                    <tr key={campaign.id} className="border-b last:border-b-0">
                      <td className="py-3 font-medium">{campaign.name}</td>
                      <td className="py-3">{campaign.status}</td>
                      <td className="py-3">{campaign.targets}</td>
                      <td className="py-3">{percent(campaign.clickRate)}</td>
                      <td className="py-3">{percent(campaign.reportRate)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
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
                {dashboard.employees.total > 0 ? (
                  <CheckCircle2 className="size-4 text-[var(--collie-blue)]" aria-hidden="true" />
                ) : (
                  <Clock className="size-4" aria-hidden="true" />
                )}
                <span>Add employees</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                {dashboard.campaigns.length > 0 ? (
                  <CheckCircle2 className="size-4 text-[var(--collie-blue)]" aria-hidden="true" />
                ) : (
                  <Clock className="size-4" aria-hidden="true" />
                )}
                <span>Create a campaign</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                {transportConfigured ? (
                  <CheckCircle2 className="size-4 text-[var(--collie-blue)]" aria-hidden="true" />
                ) : (
                  <Clock className="size-4" aria-hidden="true" />
                )}
                <span>
                  {organisation.sendingTransport === "smtp" ? "Configure SMTP relay" : "Add Resend API key"}
                </span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                {fromAddressConfigured ? (
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
    </div>
  );
}
