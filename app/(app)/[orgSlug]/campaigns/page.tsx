import { and, count, desc, eq, or, sql } from "drizzle-orm";
import Link from "next/link";

import { createCampaign, launchCampaign, updateCampaignStatus } from "@/app/actions/campaigns";
import { FlashToast } from "@/components/app/flash-toast";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeExclusionRule } from "@/lib/campaigns/exclusion-rules";
import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import {
  campaignTargets,
  campaigns,
  emailTemplates,
  exclusionRules,
  groups,
  landingPages,
  employees,
} from "@/lib/db/schema";
import { buildCampaignTrackingUrls } from "@/lib/email/campaign-renderer";
import { trackingUrlWarning } from "@/lib/tracking/public-url";

export default async function CampaignsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const organisation = await requireOrganisationForSlug(orgSlug);
  const templates = await db
    .select({
      id: emailTemplates.id,
      name: emailTemplates.name,
      category: emailTemplates.category,
      difficulty: emailTemplates.difficulty,
    })
    .from(emailTemplates)
    .where(or(eq(emailTemplates.organisationId, organisation.id), sql`${emailTemplates.organisationId} is null`))
    .orderBy(emailTemplates.name);
  const landingPageOptions = await db
    .select({
      id: landingPages.id,
      name: landingPages.name,
      type: landingPages.type,
    })
    .from(landingPages)
    .where(or(eq(landingPages.organisationId, organisation.id), sql`${landingPages.organisationId} is null`))
    .orderBy(landingPages.name);
  const groupOptions = await db
    .select({
      id: groups.id,
      name: groups.name,
    })
    .from(groups)
    .where(eq(groups.organisationId, organisation.id))
    .orderBy(groups.name);
  const activeEmployees = await db
    .select({ value: count() })
    .from(employees)
    .where(and(eq(employees.organisationId, organisation.id), eq(employees.active, true)));
  const activeRules = await db
    .select({
      id: exclusionRules.id,
      name: exclusionRules.name,
      kind: exclusionRules.kind,
      parameters: exclusionRules.parameters,
    })
    .from(exclusionRules)
    .where(and(eq(exclusionRules.organisationId, organisation.id), eq(exclusionRules.active, true)))
    .orderBy(exclusionRules.name);
  const campaignList = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      status: campaigns.status,
      sendStrategy: campaigns.sendStrategy,
      createdAt: campaigns.createdAt,
      startAt: campaigns.startAt,
      endAt: campaigns.endAt,
      scheduleCron: campaigns.scheduleCron,
      templateName: emailTemplates.name,
      landingPageName: landingPages.name,
    })
    .from(campaigns)
    .leftJoin(emailTemplates, eq(emailTemplates.id, campaigns.emailTemplateId))
    .leftJoin(landingPages, eq(landingPages.id, campaigns.landingPageId))
    .where(eq(campaigns.organisationId, organisation.id))
    .orderBy(desc(campaigns.createdAt));
  const targetCounts = await Promise.all(
    campaignList.map(async (campaign) => {
      const rows = await db
        .select({
          id: campaignTargets.id,
          token: campaignTargets.uniqueToken,
          sentAt: campaignTargets.sentAt,
          openedAt: campaignTargets.openedAt,
          clickedAt: campaignTargets.clickedAt,
          submittedAt: campaignTargets.submittedAt,
          reportedAt: campaignTargets.reportedAt,
          trainingCompletedAt: campaignTargets.trainingCompletedAt,
          scheduledAt: campaignTargets.scheduledAt,
          email: employees.email,
          firstName: employees.firstName,
          lastName: employees.lastName,
        })
        .from(campaignTargets)
        .innerJoin(employees, eq(employees.id, campaignTargets.employeeId))
        .where(eq(campaignTargets.campaignId, campaign.id))
        .orderBy(employees.email);
      return [campaign.id, rows] as const;
    }),
  );
  const targetsByCampaign = new Map(targetCounts);
  const sendingConfigured =
    organisation.sendingTransport === "smtp"
      ? Boolean(
          organisation.smtpHost &&
            organisation.smtpPort &&
            (organisation.smtpFromAddress || organisation.senderFromAddress),
        )
      : Boolean(organisation.resendApiKeyEncrypted && organisation.senderFromAddress);
  const warning = trackingUrlWarning();

  return (
    <div className="space-y-6">
      <FlashToast />
      <div className="rounded-lg border border-border bg-[rgb(242_106_33_/_0.10)] p-5">
        <h1 className="text-2xl font-semibold tracking-normal">Campaign builder</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Create a simulation from a branded template. Each employee gets a unique click link and tracking pixel.
        </p>
      </div>

      {warning ? (
        <div className="rounded-lg border border-[rgb(242_106_33_/_0.36)] bg-[rgb(242_106_33_/_0.08)] p-4 text-sm leading-6">
          <p className="font-medium text-foreground">Open tracking needs a public URL</p>
          <p className="mt-1 text-muted-foreground">{warning}</p>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Create campaign</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createCampaign} className="space-y-4">
              <input type="hidden" name="orgSlug" value={orgSlug} />
              <div className="space-y-2">
                <Label htmlFor="name">Campaign name</Label>
                <Input id="name" name="name" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="emailTemplateId">Template</Label>
                <select
                  id="emailTemplateId"
                  name="emailTemplateId"
                  required
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="">Choose a template</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} (difficulty {template.difficulty})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sendStrategy">Send strategy</Label>
                <select
                  id="sendStrategy"
                  name="sendStrategy"
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  defaultValue="immediate"
                >
                  <option value="immediate">Immediate</option>
                  <option value="drip">Drip across the send window</option>
                  <option value="randomised_over_window">Randomised inside the send window</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="landingPageId">Landing page</Label>
                <select
                  id="landingPageId"
                  name="landingPageId"
                  required
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="">Choose a landing page</option>
                  {landingPageOptions.map((page) => (
                    <option key={page.id} value={page.id}>
                      {page.name} ({page.type.replaceAll("_", " ")})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="targetGroupId">Target</Label>
                <select
                  id="targetGroupId"
                  name="targetGroupId"
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  defaultValue="all"
                >
                  <option value="all">All active employees</option>
                  {groupOptions.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="startAt">Send window start</Label>
                  <Input id="startAt" name="startAt" type="datetime-local" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endAt">Send window end</Label>
                  <Input id="endAt" name="endAt" type="datetime-local" />
                </div>
              </div>
              <fieldset className="rounded-lg border border-border p-3">
                <legend className="px-1 text-xs font-medium uppercase text-muted-foreground">Working-hours window</legend>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="workingHoursStart">Earliest send (local)</Label>
                    <Input
                      id="workingHoursStart"
                      name="workingHoursStart"
                      type="time"
                      defaultValue="09:00"
                      step={900}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="workingHoursEnd">Latest send (local)</Label>
                    <Input id="workingHoursEnd" name="workingHoursEnd" type="time" defaultValue="17:00" step={900} />
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  <Label htmlFor="workingDays">Working days (ISO 1=Mon..7=Sun)</Label>
                  <Input id="workingDays" name="workingDays" defaultValue="1,2,3,4,5" />
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="respectEmployeeTimezone"
                    value="true"
                    defaultChecked
                    className="h-4 w-4 rounded border-input"
                  />
                  Respect each employee&apos;s timezone (clamp send to their local working hours)
                </label>
                <div className="mt-3 space-y-2">
                  <Label htmlFor="cooldownDays">Cooldown days (skip employees campaigned recently)</Label>
                  <Input
                    id="cooldownDays"
                    name="cooldownDays"
                    type="number"
                    min={0}
                    max={365}
                    step={1}
                    defaultValue={0}
                  />
                </div>
              </fieldset>
              <fieldset className="rounded-lg border border-border p-3">
                <legend className="px-1 text-xs font-medium uppercase text-muted-foreground">Cohort exclusion rules</legend>
                {activeRules.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No active rules. Add VIP, on-leave or new-hire rules on the Exclusions page.
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {activeRules.map((rule) => (
                      <label key={rule.id} className="flex items-start gap-2 text-sm">
                        <Checkbox
                          name="exclusionRuleIds"
                          value={rule.id}
                          defaultChecked
                        />
                        <span>
                          <span className="block font-medium">{rule.name}</span>
                          <span className="block text-muted-foreground">
                            {describeExclusionRule({
                              kind: rule.kind as "group" | "new_hire_days" | "role" | "tag",
                              parameters: rule.parameters ?? {},
                            })}
                          </span>
                        </span>
                      </label>
                    ))}
                    <p className="text-xs text-muted-foreground">
                      Selected rules are evaluated at target-build time and snapshotted onto the campaign. Later edits to rules don&apos;t retroactively reshape this cohort.
                    </p>
                  </div>
                )}
              </fieldset>
              <p className="text-xs leading-5 text-muted-foreground">
                Future start schedules each recipient inside the working-hours window in their own timezone. Send now still respects the window — out-of-hours targets are deferred to the next valid slot.
              </p>
              <p className="text-sm text-muted-foreground">
                Target group: {activeEmployees[0]?.value ?? 0} active employees.
              </p>
              <Button
                type="submit"
                disabled={(activeEmployees[0]?.value ?? 0) === 0 || templates.length === 0 || landingPageOptions.length === 0}
              >
                Create draft
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Campaigns</CardTitle>
          </CardHeader>
          <CardContent>
            {campaignList.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No campaigns yet. Add employees, choose a template, then create your first draft.
              </div>
            ) : (
              <div className="space-y-3">
                {campaignList.map((campaign) => (
                  <details key={campaign.id} className="rounded-lg border border-border bg-card p-4">
                    <summary className="cursor-pointer list-none">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h2 className="font-medium">{campaign.name}</h2>
                          <p className="text-sm text-muted-foreground">
                            {campaign.templateName ?? "Template removed"} · {campaign.landingPageName ?? "Landing page removed"} ·{" "}
                            {targetsByCampaign.get(campaign.id)?.length ?? 0} targets
                          </p>
                        </div>
                        <Badge variant="secondary">{campaign.status}</Badge>
                      </div>
                    </summary>
                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">Send strategy</dt>
                        <dd className="font-medium">{campaign.sendStrategy.replaceAll("_", " ")}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Created</dt>
                        <dd className="font-medium">{campaign.createdAt.toLocaleString("en-AU")}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Window start</dt>
                        <dd className="font-medium">{campaign.startAt?.toLocaleString("en-AU") ?? "Manual"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Window end</dt>
                        <dd className="font-medium">{campaign.endAt?.toLocaleString("en-AU") ?? "Not set"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Cron pattern</dt>
                        <dd className="font-mono text-xs font-medium">{campaign.scheduleCron ?? "Not scheduled"}</dd>
                      </div>
                    </dl>
                    <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-muted-foreground">
                        {sendingConfigured
                          ? `Sending from ${organisation.senderFromAddress}.`
                          : "Add a Resend API key and sender From address in Settings before launch."}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Link className={buttonVariants({ variant: "outline" })} href={`/${orgSlug}/campaigns/${campaign.id}`}>
                          View results
                        </Link>
                        <form action={launchCampaign}>
                          <input type="hidden" name="orgSlug" value={orgSlug} />
                          <input type="hidden" name="campaignId" value={campaign.id} />
                          <Button
                            type="submit"
                            disabled={!sendingConfigured || !["draft", "scheduled", "paused"].includes(campaign.status)}
                          >
                            Send now
                          </Button>
                        </form>
                        <form action={updateCampaignStatus}>
                          <input type="hidden" name="orgSlug" value={orgSlug} />
                          <input type="hidden" name="campaignId" value={campaign.id} />
                          <input type="hidden" name="status" value="completed" />
                          <Button type="submit" variant="outline" disabled={campaign.status === "completed"}>
                            Complete
                          </Button>
                        </form>
                        <form action={updateCampaignStatus}>
                          <input type="hidden" name="orgSlug" value={orgSlug} />
                          <input type="hidden" name="campaignId" value={campaign.id} />
                          <input type="hidden" name="status" value="cancelled" />
                          <Button type="submit" variant="outline" disabled={campaign.status === "cancelled"}>
                            Cancel
                          </Button>
                        </form>
                      </div>
                    </div>
                    <div className="mt-4 overflow-x-auto rounded-lg border border-border">
                      <table className="w-full min-w-[900px] text-left text-sm">
                        <thead className="border-b border-border bg-muted/50 text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 font-medium">Employee</th>
                            <th className="px-3 py-2 font-medium">Scheduled</th>
                            <th className="px-3 py-2 font-medium">Sent</th>
                            <th className="px-3 py-2 font-medium">Opened</th>
                            <th className="px-3 py-2 font-medium">Clicked</th>
                            <th className="px-3 py-2 font-medium">Reported</th>
                            <th className="px-3 py-2 font-medium">Tracking link</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {(targetsByCampaign.get(campaign.id) ?? []).map((target) => {
                            const tracking = buildCampaignTrackingUrls(target.token);

                            return (
                              <tr key={target.id}>
                                <td className="px-3 py-3">
                                  <div className="font-medium">
                                    {target.firstName} {target.lastName}
                                  </div>
                                  <div className="text-muted-foreground">{target.email}</div>
                                </td>
                                <td className="px-3 py-3">
                                  {target.scheduledAt ? target.scheduledAt.toLocaleString("en-AU") : "Manual"}
                                </td>
                                <td className="px-3 py-3">{target.sentAt ? "Yes" : "No"}</td>
                                <td className="px-3 py-3">{target.openedAt ? "Yes" : "No"}</td>
                                <td className="px-3 py-3">{target.clickedAt ? "Yes" : "No"}</td>
                                <td className="px-3 py-3">{target.reportedAt ? "Yes" : "No"}</td>
                                <td className="px-3 py-3">
                                  <a
                                    className="font-medium text-primary underline-offset-4 hover:underline"
                                    href={tracking.clickUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Open link
                                  </a>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
