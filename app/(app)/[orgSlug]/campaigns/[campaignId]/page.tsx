import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import Link from "next/link";

import { deleteCampaign, launchCampaign, markTargetEvent, updateCampaignStatus } from "@/app/actions/campaigns";
import { recordDeepfakeCampaignApproval, registerDeepfakeAsset } from "@/app/actions/deepfake";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import {
  campaignApprovals,
  campaignTargets,
  campaignVariants,
  campaigns,
  deepfakeAssets,
  emailTemplates,
  employees,
  events,
  landingPages,
  users,
} from "@/lib/db/schema";
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
      templateCategory: emailTemplates.category,
      landingPageName: landingPages.name,
      landingPageType: landingPages.type,
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

  const variantTemplates = alias(emailTemplates, "variant_template");
  const variants = await db
    .select({
      id: campaignVariants.id,
      templateId: campaignVariants.templateId,
      weight: campaignVariants.weight,
      templateName: variantTemplates.name,
    })
    .from(campaignVariants)
    .leftJoin(variantTemplates, eq(variantTemplates.id, campaignVariants.templateId))
    .where(eq(campaignVariants.campaignId, campaign.id))
    .orderBy(campaignVariants.createdAt);
  const targets = await db
    .select({
      id: campaignTargets.id,
      token: campaignTargets.uniqueToken,
      campaignVariantId: campaignTargets.campaignVariantId,
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
  const deepfakeAssetRows = await db
    .select({
      id: deepfakeAssets.id,
      executiveName: deepfakeAssets.executiveName,
      assetUrl: deepfakeAssets.assetUrl,
      watermark: deepfakeAssets.watermark,
      provenance: deepfakeAssets.provenance,
      status: deepfakeAssets.status,
      expiresAt: deepfakeAssets.expiresAt,
      createdAt: deepfakeAssets.createdAt,
    })
    .from(deepfakeAssets)
    .where(eq(deepfakeAssets.campaignId, campaign.id))
    .orderBy(desc(deepfakeAssets.createdAt));
  const approvalRows = await db
    .select({
      id: campaignApprovals.id,
      approverUserId: campaignApprovals.approverUserId,
      decision: campaignApprovals.decision,
      reason: campaignApprovals.reason,
      createdAt: campaignApprovals.createdAt,
      approverName: users.name,
      approverEmail: users.email,
      approverRole: users.role,
      approverActive: users.active,
    })
    .from(campaignApprovals)
    .innerJoin(users, eq(users.id, campaignApprovals.approverUserId))
    .where(and(eq(campaignApprovals.campaignId, campaign.id), eq(users.organisationId, organisation.id)))
    .orderBy(desc(campaignApprovals.createdAt));
  const [currentUser] = await db
    .select({ role: users.role, active: users.active })
    .from(users)
    .where(and(eq(users.id, organisation.userId), eq(users.organisationId, organisation.id)))
    .limit(1);
  const sent = targets.filter((target) => target.sentAt).length;
  const opened = targets.filter((target) => target.openedAt).length;
  const clicked = targets.filter((target) => target.clickedAt).length;
  const submitted = targets.filter((target) => target.submittedAt).length;
  const reported = targets.filter((target) => target.reportedAt).length;
  const variantById = new Map(variants.map((variant) => [variant.id, variant]));
  const variantSummaries = variants.map((variant) => {
    const variantTargets = targets.filter((target) => target.campaignVariantId === variant.id);

    return {
      id: variant.id,
      templateName: variant.templateName ?? "Template removed",
      weight: variant.weight,
      targetCount: variantTargets.length,
      clicked: variantTargets.filter((target) => target.clickedAt).length,
      reported: variantTargets.filter((target) => target.reportedAt).length,
      trainingComplete: variantTargets.filter((target) => target.trainingCompletedAt).length,
    };
  });
  const unassignedTargets = targets.filter(
    (target) => !target.campaignVariantId || !variantById.has(target.campaignVariantId),
  );
  if (unassignedTargets.length > 0) {
    variantSummaries.push({
      id: "default",
      templateName: campaign.templateName ?? "Default template",
      weight: 0,
      targetCount: unassignedTargets.length,
      clicked: unassignedTargets.filter((target) => target.clickedAt).length,
      reported: unassignedTargets.filter((target) => target.reportedAt).length,
      trainingComplete: unassignedTargets.filter((target) => target.trainingCompletedAt).length,
    });
  }
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
  const sendingConfigured =
    organisation.sendingTransport === "smtp"
      ? Boolean(
          organisation.smtpHost &&
            organisation.smtpPort &&
            organisation.smtpUsernameEncrypted &&
            organisation.smtpPasswordEncrypted &&
            (organisation.smtpFromAddress || organisation.senderFromAddress),
        )
      : Boolean(organisation.resendApiKeyEncrypted && organisation.senderFromAddress);
  const launchable = ["draft", "scheduled", "paused"].includes(campaign.status);
  const now = new Date();
  const isDeepfakeCampaign =
    campaign.templateCategory === "deepfake_exec" ||
    campaign.landingPageType === "deepfake_disclosure" ||
    deepfakeAssetRows.length > 0;
  const approvedApproverIds = new Set(
    approvalRows
      .filter(
        (approval) =>
          approval.decision === "approved" &&
          approval.approverActive &&
          ["owner", "admin"].includes(approval.approverRole),
      )
      .map((approval) => approval.approverUserId),
  );
  const approvedAssetCount = deepfakeAssetRows.filter(
    (asset) => asset.status === "approved" && asset.expiresAt.getTime() > now.getTime(),
  ).length;
  const canManageDeepfake = !!currentUser?.active && ["owner", "admin"].includes(currentUser.role);

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

      {isDeepfakeCampaign ? (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <CardTitle>Deepfake executive controls</CardTitle>
              <div className="flex flex-wrap gap-2">
                <Badge variant={approvedAssetCount > 0 ? "secondary" : "outline"}>
                  {approvedAssetCount > 0 ? "Asset approved" : "Asset pending"}
                </Badge>
                <Badge variant={approvedApproverIds.size >= 2 ? "secondary" : "outline"}>
                  {approvedApproverIds.size}/2 approvals
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {deepfakeAssetRows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                No deepfake asset has been registered for this campaign.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="border-b text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-3 font-medium">Executive</th>
                      <th className="py-3 font-medium">Status</th>
                      <th className="py-3 font-medium">Expires</th>
                      <th className="py-3 font-medium">Watermark</th>
                      <th className="py-3 font-medium">Asset</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deepfakeAssetRows.map((asset) => (
                      <tr key={asset.id} className="border-b last:border-b-0">
                        <td className="py-3 font-medium">{asset.executiveName}</td>
                        <td className="py-3">{asset.status.replaceAll("_", " ")}</td>
                        <td className="py-3">{asset.expiresAt.toLocaleString("en-AU")}</td>
                        <td className="max-w-[260px] truncate py-3 font-mono text-xs">{asset.watermark}</td>
                        <td className="py-3">
                          <a className="font-medium text-primary underline-offset-4 hover:underline" href={asset.assetUrl} target="_blank" rel="noreferrer">
                            Open asset
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {deepfakeAssetRows[0]?.provenance ? (
              <details className="rounded-lg border border-border p-3">
                <summary className="cursor-pointer text-sm font-medium">Latest provenance metadata</summary>
                <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-[var(--collie-cloud)] p-3 font-mono text-xs">
                  {JSON.stringify(deepfakeAssetRows[0].provenance, null, 2)}
                </pre>
              </details>
            ) : null}

            {approvalRows.length > 0 ? (
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                {approvalRows.map((approval) => (
                  <div key={approval.id} className="rounded-lg border border-border p-3">
                    <div className="font-medium">
                      {approval.approverName} <span className="text-muted-foreground">({approval.approverRole})</span>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      {approval.decision} · {approval.createdAt.toLocaleString("en-AU")}
                    </div>
                    {approval.reason ? <div className="mt-2 text-muted-foreground">{approval.reason}</div> : null}
                  </div>
                ))}
              </div>
            ) : null}

            {canManageDeepfake ? (
              <div className="grid gap-4 lg:grid-cols-[minmax(320px,1fr)_minmax(280px,0.8fr)]">
                <form action={registerDeepfakeAsset} className="grid gap-3 rounded-lg border border-border p-3">
                  <input type="hidden" name="orgSlug" value={orgSlug} />
                  <input type="hidden" name="campaignId" value={campaign.id} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="deepfakeExecutiveName">Executive name</Label>
                      <Input id="deepfakeExecutiveName" name="executiveName" required minLength={2} maxLength={140} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="deepfakeAssetUrl">Asset URL</Label>
                      <Input id="deepfakeAssetUrl" name="assetUrl" type="url" required />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="deepfakeSource">Source or consent reference</Label>
                    <Textarea id="deepfakeSource" name="source" maxLength={500} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="deepfakeSha">Content SHA-256</Label>
                    <Input id="deepfakeSha" name="contentSha256" pattern="[A-Fa-f0-9]{64}" />
                  </div>
                  <Button type="submit">Register asset</Button>
                </form>

                <div className="grid gap-3 rounded-lg border border-border p-3">
                  <form action={recordDeepfakeCampaignApproval} className="grid gap-3">
                    <input type="hidden" name="orgSlug" value={orgSlug} />
                    <input type="hidden" name="campaignId" value={campaign.id} />
                    <input type="hidden" name="decision" value="approved" />
                    <Textarea name="reason" placeholder="Approval note" maxLength={500} />
                    <Button type="submit" disabled={deepfakeAssetRows.length === 0}>
                      Approve
                    </Button>
                  </form>
                  <form action={recordDeepfakeCampaignApproval} className="grid gap-3">
                    <input type="hidden" name="orgSlug" value={orgSlug} />
                    <input type="hidden" name="campaignId" value={campaign.id} />
                    <input type="hidden" name="decision" value="rejected" />
                    <Textarea name="reason" placeholder="Rejection reason" maxLength={500} />
                    <Button type="submit" variant="outline" disabled={deepfakeAssetRows.length === 0}>
                      Reject
                    </Button>
                  </form>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
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

      {variantSummaries.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Template variants</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-3 font-medium">Template</th>
                  <th className="py-3 font-medium">Weight</th>
                  <th className="py-3 font-medium">Targets</th>
                  <th className="py-3 font-medium">Clicked</th>
                  <th className="py-3 font-medium">Reported</th>
                  <th className="py-3 font-medium">Training complete</th>
                </tr>
              </thead>
              <tbody>
                {variantSummaries.map((variant) => (
                  <tr key={variant.id} className="border-b last:border-b-0">
                    <td className="py-3 font-medium">{variant.templateName}</td>
                    <td className="py-3">{variant.weight > 0 ? variant.weight : "Default"}</td>
                    <td className="py-3">{variant.targetCount}</td>
                    <td className="py-3">
                      {variant.clicked} <span className="text-muted-foreground">({rate(variant.clicked, variant.targetCount)})</span>
                    </td>
                    <td className="py-3">
                      {variant.reported} <span className="text-muted-foreground">({rate(variant.reported, variant.targetCount)})</span>
                    </td>
                    <td className="py-3">
                      {variant.trainingComplete}{" "}
                      <span className="text-muted-foreground">({rate(variant.trainingComplete, variant.targetCount)})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

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
          <form action={launchCampaign}>
            <input type="hidden" name="orgSlug" value={orgSlug} />
            <input type="hidden" name="campaignId" value={campaign.id} />
            <input type="hidden" name="mode" value="sync" />
            <Button
              type="submit"
              disabled={!sendingConfigured || !launchable}
              title={
                sendingConfigured
                  ? "Send immediately from this request. Out-of-hours targets are still deferred to the next valid slot."
                  : "Configure sending in Settings before launch."
              }
            >
              Start now
            </Button>
          </form>
          <form action={launchCampaign}>
            <input type="hidden" name="orgSlug" value={orgSlug} />
            <input type="hidden" name="campaignId" value={campaign.id} />
            <input type="hidden" name="mode" value="async" />
            <Button
              type="submit"
              variant="outline"
              disabled={!sendingConfigured || !launchable}
              title={
                sendingConfigured
                  ? "Queue launch through Inngest. Retries, idempotency, and working-hours clamping all apply."
                  : "Configure sending in Settings before launch."
              }
            >
              Launch queued
            </Button>
          </form>
          <form action={updateCampaignStatus}>
            <input type="hidden" name="orgSlug" value={orgSlug} />
            <input type="hidden" name="campaignId" value={campaign.id} />
            <input type="hidden" name="status" value="completed" />
            <input type="hidden" name="returnTo" value={`/${orgSlug}/campaigns/${campaign.id}`} />
            <Button type="submit" variant="outline" disabled={campaign.status === "completed"}>
              Complete campaign
            </Button>
          </form>
          <form action={updateCampaignStatus}>
            <input type="hidden" name="orgSlug" value={orgSlug} />
            <input type="hidden" name="campaignId" value={campaign.id} />
            <input type="hidden" name="status" value="cancelled" />
            <input type="hidden" name="returnTo" value={`/${orgSlug}/campaigns/${campaign.id}`} />
            <Button type="submit" variant="outline" disabled={campaign.status === "cancelled"}>
              Cancel campaign
            </Button>
          </form>
          <form action={deleteCampaign}>
            <input type="hidden" name="orgSlug" value={orgSlug} />
            <input type="hidden" name="campaignId" value={campaign.id} />
            <Button type="submit" variant="outline">
              Delete campaign
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
                <th className="py-3 font-medium">Variant</th>
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
                    <td className="py-3">
                      {target.campaignVariantId
                        ? variantById.get(target.campaignVariantId)?.templateName ?? "Template removed"
                        : campaign.templateName ?? "Default"}
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
                          <input type="hidden" name="returnTo" value={`/${orgSlug}/campaigns/${campaign.id}`} />
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
