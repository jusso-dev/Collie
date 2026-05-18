import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";

import { markTargetEvent, updateCampaignStatus } from "@/app/actions/campaigns";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { campaignTargets, campaigns, emailTemplates, employees, events, landingPages } from "@/lib/db/schema";
import { buildCampaignTrackingUrls } from "@/lib/email/campaign-renderer";
import { trackingUrlWarning } from "@/lib/tracking/public-url";

function rate(numerator: number, denominator: number) {
  if (denominator === 0) return "No data";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function submittedFields(metadata: Record<string, unknown> | null | undefined) {
  if (!isRecord(metadata)) return [];
  const fields = metadata.fields;
  if (!isRecord(fields)) return [];

  return Object.entries(fields).map(([name, value]) => ({
    name,
    value: typeof value === "string" && value.length > 0 ? value : "No value",
    sensitive: name.toLowerCase().includes("password") || value === "[provided]",
  }));
}

function formatEventType(eventType: string) {
  return eventType.replaceAll("_", " ");
}

export default async function CampaignResultsPage({
  params,
}: {
  params: Promise<{ orgSlug: string; campaignId: string }>;
}) {
  const { orgSlug, campaignId } = await params;
  const organisation = await requireOrganisationForSlug(orgSlug);
  const [campaign] = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      sendStrategy: campaigns.sendStrategy,
      startAt: campaigns.startAt,
      endAt: campaigns.endAt,
      scheduleCron: campaigns.scheduleCron,
      templateName: emailTemplates.name,
      landingPageName: landingPages.name,
    })
    .from(campaigns)
    .leftJoin(emailTemplates, eq(emailTemplates.id, campaigns.emailTemplateId))
    .leftJoin(landingPages, eq(landingPages.id, campaigns.landingPageId))
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.organisationId, organisation.id)))
    .limit(1);

  if (!campaign) {
    return (
      <div className="rounded-lg border border-border bg-card p-8">
        <h1 className="text-2xl font-semibold">Campaign not found</h1>
        <Link className={buttonVariants({ variant: "outline", className: "mt-4" })} href={`/${orgSlug}/campaigns`}>
          Back to campaigns
        </Link>
      </div>
    );
  }

  const targets = await db
    .select({
      id: campaignTargets.id,
      token: campaignTargets.uniqueToken,
      scheduledAt: campaignTargets.scheduledAt,
      sentAt: campaignTargets.sentAt,
      openedAt: campaignTargets.openedAt,
      clickedAt: campaignTargets.clickedAt,
      submittedAt: campaignTargets.submittedAt,
      reportedAt: campaignTargets.reportedAt,
      trainingCompletedAt: campaignTargets.trainingCompletedAt,
      email: employees.email,
      firstName: employees.firstName,
      lastName: employees.lastName,
      department: employees.department,
    })
    .from(campaignTargets)
    .innerJoin(employees, eq(employees.id, campaignTargets.employeeId))
    .where(eq(campaignTargets.campaignId, campaign.id))
    .orderBy(employees.email);
  const eventRows = await db
    .select({
      id: events.id,
      targetId: events.campaignTargetId,
      eventType: events.eventType,
      metadata: events.metadata,
      createdAt: events.createdAt,
    })
    .from(events)
    .innerJoin(campaignTargets, eq(campaignTargets.id, events.campaignTargetId))
    .where(eq(campaignTargets.campaignId, campaign.id))
    .orderBy(desc(events.createdAt));
  const sent = targets.filter((target) => target.sentAt).length;
  const opened = targets.filter((target) => target.openedAt).length;
  const clicked = targets.filter((target) => target.clickedAt).length;
  const submitted = targets.filter((target) => target.submittedAt).length;
  const reported = targets.filter((target) => target.reportedAt).length;
  const credentialSubmissions = eventRows
    .filter((event) => event.eventType === "submitted")
    .map((event) => {
      const target = targets.find((item) => item.id === event.targetId);

      return {
        ...event,
        target,
        fields: submittedFields(event.metadata),
      };
    });
  const warning = trackingUrlWarning();
  const liveRefreshEnabled = !["completed", "cancelled"].includes(campaign.status);

  return (
    <div className="space-y-6">
      <AutoRefresh enabled={liveRefreshEnabled} />
      <div className="rounded-lg border border-border bg-[rgb(242_106_33_/_0.10)] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <Link href={`/${orgSlug}/campaigns`} className="text-sm font-medium text-muted-foreground hover:text-foreground">
              Campaigns
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal">{campaign.name}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {campaign.templateName ?? "Template removed"} with {campaign.landingPageName ?? "no landing page"}.
            </p>
            {campaign.scheduleCron ? (
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                node-cron: {campaign.scheduleCron}
              </p>
            ) : null}
          </div>
          <Badge variant="secondary">{campaign.status}</Badge>
        </div>
      </div>

      {warning ? (
        <div className="rounded-lg border border-[rgb(242_106_33_/_0.36)] bg-[rgb(242_106_33_/_0.08)] p-4 text-sm leading-6">
          <p className="font-medium text-foreground">Open tracking needs a public URL</p>
          <p className="mt-1 text-muted-foreground">{warning}</p>
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {[
          ["Targets", String(targets.length)],
          ["Sent", rate(sent, targets.length)],
          ["Opened", rate(opened, targets.length)],
          ["Clicked", rate(clicked, targets.length)],
          ["Submitted", rate(submitted, targets.length)],
          ["Reported", rate(reported, targets.length)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader>
              <CardTitle>{label}</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{value}</CardContent>
          </Card>
        ))}
      </section>

      {credentialSubmissions.length > 0 ? (
        <section className="rounded-lg border border-[rgb(242_106_33_/_0.36)] bg-card p-4 shadow-[0_1px_0_rgb(13_27_42_/_0.04)]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[rgb(242_106_33)]">
                Credential submission alert
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-normal">
                {credentialSubmissions.length} recipient{credentialSubmissions.length === 1 ? "" : "s"} entered details
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Sensitive password values are not stored. Collie records that a password was provided, plus any non-sensitive fields.
              </p>
            </div>
            <Badge className="bg-[rgb(242_106_33)] text-white">
              {credentialSubmissions.length} submitted
            </Badge>
          </div>

          <div className="mt-4 divide-y divide-border rounded-lg border border-border">
            {credentialSubmissions.map((submission) => (
              <div key={submission.id} className="grid gap-3 p-3 lg:grid-cols-[minmax(220px,1fr)_minmax(320px,2fr)]">
                <div>
                  <div className="font-medium">
                    {submission.target
                      ? `${submission.target.firstName} ${submission.target.lastName}`.trim()
                      : "Unknown recipient"}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">{submission.target?.email ?? "No email available"}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {submission.createdAt.toLocaleString("en-AU", { timeZone: "Australia/Sydney" })}
                  </div>
                </div>
                <dl className="grid gap-2 sm:grid-cols-2">
                  {submission.fields.length > 0 ? (
                    submission.fields.map((field) => (
                      <div key={`${submission.id}-${field.name}`} className="rounded-lg bg-[var(--collie-cloud)] px-3 py-2">
                        <dt className="text-xs font-medium uppercase text-muted-foreground">{field.name}</dt>
                        <dd className="mt-1 break-all font-mono text-xs text-foreground">
                          {field.sensitive ? "Provided, value not stored" : field.value}
                        </dd>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg bg-[var(--collie-cloud)] px-3 py-2 text-sm text-muted-foreground">
                      No form fields were captured.
                    </div>
                  )}
                </dl>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Controls</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <form action={updateCampaignStatus}>
            <input type="hidden" name="orgSlug" value={orgSlug} />
            <input type="hidden" name="campaignId" value={campaign.id} />
            <input type="hidden" name="status" value="completed" />
            <Button type="submit" variant="outline" disabled={campaign.status === "completed"}>
              Complete campaign
            </Button>
          </form>
          <form action={updateCampaignStatus}>
            <input type="hidden" name="orgSlug" value={orgSlug} />
            <input type="hidden" name="campaignId" value={campaign.id} />
            <input type="hidden" name="status" value="cancelled" />
            <Button type="submit" variant="outline" disabled={campaign.status === "cancelled"}>
              Cancel campaign
            </Button>
          </form>
          <Link className={buttonVariants({ variant: "outline" })} href={`/${orgSlug}/reports/export`}>
            Export CSV
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recipients</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="border-b text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-3 font-medium">Employee</th>
                <th className="py-3 font-medium">Scheduled</th>
                <th className="py-3 font-medium">Sent</th>
                <th className="py-3 font-medium">Opened</th>
                <th className="py-3 font-medium">Clicked</th>
                <th className="py-3 font-medium">Submitted</th>
                <th className="py-3 font-medium">Reported</th>
                <th className="py-3 font-medium">Training</th>
                <th className="py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((target) => {
                const tracking = buildCampaignTrackingUrls(target.token);

                return (
                  <tr key={target.id} className="border-b last:border-b-0">
                    <td className="py-3">
                      <div className="font-medium">
                        {target.firstName} {target.lastName}
                      </div>
                      <div className="text-muted-foreground">
                        {target.email}
                        {target.department ? ` · ${target.department}` : ""}
                      </div>
                    </td>
                    <td className="py-3">{target.scheduledAt ? target.scheduledAt.toLocaleString("en-AU") : "Manual"}</td>
                    <td className="py-3">{target.sentAt ? "Yes" : "No"}</td>
                    <td className="py-3">{target.openedAt ? "Yes" : "No"}</td>
                    <td className="py-3">{target.clickedAt ? "Yes" : "No"}</td>
                    <td className="py-3">
                      {target.submittedAt ? (
                        <Badge className="bg-[rgb(242_106_33)] text-white">Submitted</Badge>
                      ) : (
                        "No"
                      )}
                    </td>
                    <td className="py-3">{target.reportedAt ? "Yes" : "No"}</td>
                    <td className="py-3">{target.trainingCompletedAt ? "Complete" : "Not complete"}</td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-2">
                        <a className="font-medium text-primary underline-offset-4 hover:underline" href={tracking.clickUrl} target="_blank" rel="noreferrer">
                          Open link
                        </a>
                        <form action={markTargetEvent}>
                          <input type="hidden" name="orgSlug" value={orgSlug} />
                          <input type="hidden" name="token" value={target.token} />
                          <input type="hidden" name="eventType" value="reported" />
                          <button className="font-medium text-primary underline-offset-4 hover:underline" type="submit">
                            Mark reported
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Event timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {eventRows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No events have been recorded for this campaign yet.
            </div>
          ) : (
            <ol className="space-y-3">
              {eventRows.map((event) => {
                const target = targets.find((item) => item.id === event.targetId);
                const fields = submittedFields(event.metadata);

                return (
                  <li key={event.id} className="rounded-lg border border-border p-3 text-sm">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <span className="font-medium">
                        {formatEventType(event.eventType)} · {target?.email ?? "Unknown recipient"}
                      </span>
                      <span className="text-muted-foreground">{event.createdAt.toLocaleString("en-AU")}</span>
                    </div>
                    {event.eventType === "submitted" && fields.length > 0 ? (
                      <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                        {fields.map((field) => (
                          <div key={`${event.id}-${field.name}`} className="rounded-lg bg-[var(--collie-cloud)] px-3 py-2">
                            <dt className="text-xs font-medium uppercase text-muted-foreground">{field.name}</dt>
                            <dd className="mt-1 break-all font-mono text-xs">
                              {field.sensitive ? "Provided, value not stored" : field.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : Object.keys(event.metadata ?? {}).length > 0 ? (
                      <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-[var(--collie-cloud)] p-2 font-mono text-xs">
                        {JSON.stringify(event.metadata, null, 2)}
                      </pre>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
