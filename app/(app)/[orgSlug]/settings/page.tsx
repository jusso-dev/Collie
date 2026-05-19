import {
  deleteSiemSoarEndpoint,
  dismissPendingApiKeyReveal,
  mintIngestApiKey,
  readPendingApiKeyReveal,
  recordTestSyncRun,
  revealIngestApiKey,
  revokeIngestApiKey,
  rotateSiemSoarSigningKey,
  rotateIngestApiKey,
  saveSiemSoarEndpoint,
} from "@/app/actions/integrations";
import { saveComplianceRetentionSettings, saveLrsSettings } from "@/app/actions/settings";
import {
  deleteSsoConfig,
  saveOidcSsoConfig,
  saveSamlSsoConfig,
  toggleSsoEnforcement,
} from "@/app/actions/sso";
import {
  cancelOrganisationInvitation,
  inviteOrganisationUser,
  issuePasswordResetLink,
  removeOrganisationUser,
  resetUserMfa,
  revokePasswordResetLink,
  setMfaRequirement,
  updateOrganisationUserRole,
} from "@/app/actions/team";
import { EmailSendingSettings } from "@/components/app/email-sending-settings";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScimTokenCard } from "@/components/settings/scim-token-card";
import { Textarea } from "@/components/ui/textarea";
import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { openTotpSecret } from "@/lib/auth/totp";
import { db } from "@/lib/db/client";
import {
  employeeSyncRuns,
  organisationInvitations,
  organisations,
  outboundEndpoints,
  ssoConfigurations,
  users,
  verifications,
} from "@/lib/db/schema";
import { buildCampaignReportAddress, buildOrganisationReportAddress } from "@/lib/email/reporting";
import { and, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";

const siemSoarConnectorOptions = [
  { value: "sentinel", label: "Microsoft Sentinel" },
  { value: "splunk_soar", label: "Splunk SOAR" },
  { value: "cortex_xsoar", label: "Cortex XSOAR" },
  { value: "servicenow_sir", label: "ServiceNow SIR" },
] as const;

const siemSoarFormatOptions = [
  { value: "json", label: "JSON" },
  { value: "cef", label: "CEF" },
  { value: "leef", label: "LEEF" },
] as const;

const sentinelCloudOptions = [
  { value: "public", label: "Azure public" },
  { value: "usgov", label: "Azure US Gov" },
  { value: "china", label: "Azure China" },
] as const;

const siemSoarEventOptions = [
  { value: "clicked", label: "Clicked" },
  { value: "submitted", label: "Submitted" },
  { value: "reported", label: "Reported" },
  { value: "real_mail_report", label: "Real-mail report" },
] as const;

function safeOpen(sealed: string | null): string | null {
  if (!sealed) return null;
  try {
    return openTotpSecret(sealed);
  } catch {
    return null;
  }
}

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const organisation = await requireOrganisationForSlug(orgSlug);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
  const reportMailbox = buildOrganisationReportAddress(orgSlug);
  const tokenisedReplyPattern = buildCampaignReportAddress("{token}");
  const teamMembers = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      active: users.active,
      mfaRequired: users.mfaRequired,
      mfaEnabled: users.mfaEnabled,
      mfaResetAt: users.mfaResetAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.organisationId, organisation.id))
    .orderBy(users.email);
  const invitations = await db
    .select({
      id: organisationInvitations.id,
      email: organisationInvitations.email,
      role: organisationInvitations.role,
      token: organisationInvitations.token,
      status: organisationInvitations.status,
      expiresAt: organisationInvitations.expiresAt,
      createdAt: organisationInvitations.createdAt,
    })
    .from(organisationInvitations)
    .where(and(eq(organisationInvitations.organisationId, organisation.id), eq(organisationInvitations.status, "pending")))
    .orderBy(desc(organisationInvitations.createdAt));
  const [scimState] = await db
    .select({
      scimTokenHash: organisations.scimTokenHash,
      scimTokenIssuedAt: organisations.scimTokenIssuedAt,
    })
    .from(organisations)
    .where(eq(organisations.id, organisation.id))
    .limit(1);
  const [lrsState] = await db
    .select({
      lrsEnabled: organisations.lrsEnabled,
      lrsEndpointUrl: organisations.lrsEndpointUrl,
      lrsUsernameEncrypted: organisations.lrsUsernameEncrypted,
      hasLrsPassword: sql<boolean>`${organisations.lrsPasswordEncrypted} is not null`,
    })
    .from(organisations)
    .where(eq(organisations.id, organisation.id))
    .limit(1);
  const resetLinks = await db
    .select({
      identifier: verifications.identifier,
      userId: verifications.value,
      expiresAt: verifications.expiresAt,
    })
    .from(verifications)
    .where(and(sql`${verifications.identifier} like 'reset-password:%'`, sql`${verifications.expiresAt} > now()`));
  const resetLinkByUser = new Map(
    resetLinks.map((link) => [
      link.userId,
      {
        href: `${appUrl}/reset-password?token=${link.identifier.replace("reset-password:", "")}`,
        expiresAt: link.expiresAt,
      },
    ]),
  );
  const [ssoConfig] = await db
    .select({
      id: ssoConfigurations.id,
      kind: ssoConfigurations.kind,
      oidcIssuerUrl: ssoConfigurations.oidcIssuerUrl,
      oidcClientId: ssoConfigurations.oidcClientId,
      hasOidcSecret: sql<boolean>`${ssoConfigurations.oidcClientSecretEncrypted} is not null`,
      samlEntityId: ssoConfigurations.samlEntityId,
      samlAcsUrl: ssoConfigurations.samlAcsUrl,
      samlIdpMetadata: ssoConfigurations.samlIdpMetadata,
      enforceSso: ssoConfigurations.enforceSso,
    })
    .from(ssoConfigurations)
    .where(eq(ssoConfigurations.organisationId, organisation.id))
    .limit(1);
  const ssoRedirectUri = `${appUrl}/api/auth/oauth2/callback/oidc-${organisation.id}`;

  const [apiKeyRow] = await db
    .select({
      apiKeyHash: organisations.apiKeyHash,
      apiKeyLast4: organisations.apiKeyLast4,
      apiKeyCreatedAt: organisations.apiKeyCreatedAt,
      siemSoarSigningKeyEncrypted: organisations.siemSoarSigningKeyEncrypted,
      siemSoarSigningKeyLast4: organisations.siemSoarSigningKeyLast4,
      siemSoarSigningKeyCreatedAt: organisations.siemSoarSigningKeyCreatedAt,
    })
    .from(organisations)
    .where(eq(organisations.id, organisation.id))
    .limit(1);
  const apiKeyMinted = Boolean(apiKeyRow?.apiKeyHash);
  const apiKeyLast4 = apiKeyRow?.apiKeyLast4 ?? null;
  const apiKeyCreatedAt = apiKeyRow?.apiKeyCreatedAt ?? null;
  const pendingApiKey = await readPendingApiKeyReveal(orgSlug);
  const siemSoarEndpoints = await db
    .select({
      id: outboundEndpoints.id,
      name: outboundEndpoints.name,
      connector: outboundEndpoints.connector,
      format: outboundEndpoints.format,
      url: outboundEndpoints.url,
      config: outboundEndpoints.config,
      enabled: outboundEndpoints.enabled,
      eventTypes: outboundEndpoints.eventTypes,
      maxAttempts: outboundEndpoints.maxAttempts,
      lastSuccessAt: outboundEndpoints.lastSuccessAt,
      lastFailureAt: outboundEndpoints.lastFailureAt,
      createdAt: outboundEndpoints.createdAt,
    })
    .from(outboundEndpoints)
    .where(eq(outboundEndpoints.organisationId, organisation.id))
    .orderBy(desc(outboundEndpoints.createdAt));
  const recentSyncRuns = await db
    .select({
      id: employeeSyncRuns.id,
      mode: employeeSyncRuns.mode,
      source: employeeSyncRuns.source,
      actorKeyLast4: employeeSyncRuns.actorKeyLast4,
      receivedCount: employeeSyncRuns.receivedCount,
      addedCount: employeeSyncRuns.addedCount,
      updatedCount: employeeSyncRuns.updatedCount,
      deactivatedCount: employeeSyncRuns.deactivatedCount,
      skippedCount: employeeSyncRuns.skippedCount,
      createdAt: employeeSyncRuns.createdAt,
    })
    .from(employeeSyncRuns)
    .where(eq(employeeSyncRuns.organisationId, organisation.id))
    .orderBy(desc(employeeSyncRuns.createdAt))
    .limit(8);
  const lastSync = recentSyncRuns[0] ?? null;
  const singleEndpoint = `${appUrl}/api/v1/employees`;
  const bulkEndpoint = `${appUrl}/api/v1/employees/bulk`;
  const dateFormatter = new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" });
  const siemSoarSigningKeyReady = Boolean(apiKeyRow?.siemSoarSigningKeyEncrypted);
  const siemSoarSigningKeyLast4 = apiKeyRow?.siemSoarSigningKeyLast4 ?? null;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-[rgb(56_189_248_/_0.08)] p-5">
        <h1 className="text-2xl font-semibold tracking-normal">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage organisation access, account security, and email sending credentials.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="font-medium">Team access</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Invite admins and viewers, reset access safely, and keep MFA requirements visible for this organisation.
            </p>
          </div>
          <Badge variant="outline">{teamMembers.length} users</Badge>
        </div>

        <form action={inviteOrganisationUser} className="mt-5 grid gap-3 md:grid-cols-[minmax(220px,1fr)_160px_auto]">
          <input type="hidden" name="orgSlug" value={orgSlug} />
          <div className="space-y-2">
            <Label htmlFor="invite-email">Work email</Label>
            <Input id="invite-email" name="email" type="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">Role</Label>
            <select
              id="invite-role"
              name="role"
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              defaultValue="admin"
            >
              <option value="admin">Admin</option>
              <option value="viewer">Viewer</option>
              <option value="owner">Owner</option>
            </select>
          </div>
          <div className="flex items-end">
            <Button type="submit">Invite user</Button>
          </div>
        </form>

        {invitations.length > 0 ? (
          <div className="mt-5 space-y-3">
            <h3 className="text-sm font-medium">Pending invites</h3>
            <div className="divide-y divide-border rounded-lg border border-border">
              {invitations.map((invitation) => {
                const inviteUrl = `${appUrl}/signup?invite=${invitation.token}`;

                return (
                  <div key={invitation.id} className="grid gap-3 p-3 lg:grid-cols-[minmax(220px,1fr)_minmax(280px,1.5fr)_auto] lg:items-center">
                    <div>
                      <div className="font-medium">{invitation.email}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {invitation.role} · expires {invitation.expiresAt.toLocaleDateString("en-AU")}
                      </div>
                    </div>
                    <div className="break-all rounded-lg bg-[var(--collie-cloud)] px-3 py-2 font-mono text-xs">{inviteUrl}</div>
                    <form action={cancelOrganisationInvitation}>
                      <input type="hidden" name="orgSlug" value={orgSlug} />
                      <input type="hidden" name="invitationId" value={invitation.id} />
                      <Button type="submit" variant="outline">Cancel</Button>
                    </form>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="border-b text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-3 font-medium">User</th>
                <th className="py-3 font-medium">Role</th>
                <th className="py-3 font-medium">MFA</th>
                <th className="py-3 font-medium">Password reset</th>
                <th className="py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {teamMembers.map((member) => {
                const resetLink = resetLinkByUser.get(member.id);

                return (
                  <tr key={member.id} className="border-b last:border-b-0">
                    <td className="py-3 pr-4">
                      <div className="font-medium">{member.name}</div>
                      <div className="text-muted-foreground">{member.email}</div>
                      {!member.active ? <Badge variant="outline" className="mt-2">Inactive</Badge> : null}
                    </td>
                    <td className="py-3 pr-4">
                      <form action={updateOrganisationUserRole} className="flex items-center gap-2">
                        <input type="hidden" name="orgSlug" value={orgSlug} />
                        <input type="hidden" name="userId" value={member.id} />
                        <select
                          name="role"
                          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                          defaultValue={member.role}
                        >
                          <option value="owner">Owner</option>
                          <option value="admin">Admin</option>
                          <option value="viewer">Viewer</option>
                        </select>
                        <Button type="submit" variant="outline">Save</Button>
                      </form>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={member.mfaRequired ? "default" : "outline"}>
                          {member.mfaRequired ? "Required" : "Optional"}
                        </Badge>
                        <Badge variant={member.mfaEnabled ? "default" : "outline"}>
                          {member.mfaEnabled ? "Enabled" : "Not enabled"}
                        </Badge>
                      </div>
                      {member.mfaResetAt ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Reset {member.mfaResetAt.toLocaleDateString("en-AU")}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4">
                      {resetLink ? (
                        <div className="space-y-2">
                          <div className="break-all rounded-lg bg-[var(--collie-cloud)] px-3 py-2 font-mono text-xs">
                            {resetLink.href}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Expires {resetLink.expiresAt.toLocaleTimeString("en-AU")}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">No active reset link</span>
                      )}
                    </td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-2">
                        <form action={issuePasswordResetLink}>
                          <input type="hidden" name="orgSlug" value={orgSlug} />
                          <input type="hidden" name="userId" value={member.id} />
                          <Button type="submit" variant="outline">Reset password</Button>
                        </form>
                        {resetLink ? (
                          <form action={revokePasswordResetLink}>
                            <input type="hidden" name="orgSlug" value={orgSlug} />
                            <input type="hidden" name="userId" value={member.id} />
                            <Button type="submit" variant="outline">Revoke reset</Button>
                          </form>
                        ) : null}
                        <form action={setMfaRequirement}>
                          <input type="hidden" name="orgSlug" value={orgSlug} />
                          <input type="hidden" name="userId" value={member.id} />
                          <input type="hidden" name="required" value={member.mfaRequired ? "false" : "true"} />
                          <Button type="submit" variant="outline">
                            {member.mfaRequired ? "Make MFA optional" : "Require MFA"}
                          </Button>
                        </form>
                        <form action={resetUserMfa}>
                          <input type="hidden" name="orgSlug" value={orgSlug} />
                          <input type="hidden" name="userId" value={member.id} />
                          <Button type="submit" variant="outline">Reset MFA</Button>
                        </form>
                        {member.id !== organisation.userId ? (
                          <form action={removeOrganisationUser}>
                            <input type="hidden" name="orgSlug" value={orgSlug} />
                            <input type="hidden" name="userId" value={member.id} />
                            <Button type="submit" variant="outline">Remove</Button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <EmailSendingSettings
        orgSlug={orgSlug}
        initialTransport={organisation.sendingTransport}
        senderFromAddress={organisation.senderFromAddress}
        hasResendKey={Boolean(organisation.resendApiKeyEncrypted)}
        smtpHost={organisation.smtpHost}
        smtpPort={organisation.smtpPort}
        smtpUsername={safeOpen(organisation.smtpUsernameEncrypted)}
        hasSmtpPassword={Boolean(organisation.smtpPasswordEncrypted)}
        smtpSecure={organisation.smtpSecure}
        smtpFromAddress={organisation.smtpFromAddress}
        testRecipientDefault={null}
      />
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="font-medium">Learning record store</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Send training lifecycle statements to an xAPI LRS when assignments start or complete.
            </p>
          </div>
          <Badge variant={lrsState?.lrsEnabled ? "default" : "outline"}>
            {lrsState?.lrsEnabled ? "xAPI enabled" : "xAPI off"}
          </Badge>
        </div>
        <form action={saveLrsSettings} className="mt-5 grid gap-4 lg:grid-cols-[minmax(240px,1fr)_minmax(160px,220px)_minmax(160px,220px)_auto] lg:items-end">
          <input type="hidden" name="orgSlug" value={orgSlug} />
          <input type="hidden" name="hasExistingUsername" value={lrsState?.lrsUsernameEncrypted ? "true" : "false"} />
          <input type="hidden" name="hasExistingPassword" value={lrsState?.hasLrsPassword ? "true" : "false"} />
          <div className="space-y-2">
            <Label htmlFor="lrs-endpoint-url">Endpoint URL</Label>
            <Input
              id="lrs-endpoint-url"
              name="lrsEndpointUrl"
              type="url"
              placeholder="https://lrs.example.com/xapi"
              defaultValue={lrsState?.lrsEndpointUrl ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lrs-username">Username</Label>
            <Input id="lrs-username" name="lrsUsername" defaultValue={safeOpen(lrsState?.lrsUsernameEncrypted ?? null) ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lrs-password">Password</Label>
            <Input
              id="lrs-password"
              name="lrsPassword"
              type="password"
              placeholder={lrsState?.hasLrsPassword ? "Keep existing" : ""}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="lrs-enabled" className="flex items-center gap-2 text-sm">
              <input id="lrs-enabled" name="lrsEnabled" type="checkbox" defaultChecked={Boolean(lrsState?.lrsEnabled)} />
              Enabled
            </label>
            <Button type="submit">Save LRS</Button>
          </div>
        </form>
      </div>
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="font-medium">Privacy retention</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Keep simulation aggregates while automatically clearing stored event metadata, IP addresses, and user agents.
            </p>
          </div>
          <Badge variant="outline">Daily sweep</Badge>
        </div>
        <form action={saveComplianceRetentionSettings} className="mt-5 grid gap-4 md:grid-cols-[minmax(180px,240px)_minmax(180px,240px)_auto] md:items-end">
          <input type="hidden" name="orgSlug" value={orgSlug} />
          <div className="space-y-2">
            <Label htmlFor="audit-retention-days">Event metadata days</Label>
            <Input
              id="audit-retention-days"
              name="auditRetentionDays"
              type="number"
              min={30}
              max={2555}
              defaultValue={organisation.auditRetentionDays}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-pii-scrub-days">IP and UA days</Label>
            <Input
              id="event-pii-scrub-days"
              name="eventPiiScrubDays"
              type="number"
              min={1}
              max={365}
              defaultValue={organisation.eventPiiScrubDays}
              required
            />
          </div>
          <Button type="submit">Save retention</Button>
        </form>
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-medium">Deliverability allowlist guide</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Per-provider rules for M365 Advanced Delivery, Mimecast, and Proofpoint TAP that stop simulation mail from being blocked or rewritten.
          </p>
        </div>
        <Link
          href={`/${orgSlug}/deliverability`}
          className={buttonVariants({ variant: "outline", size: "default" })}
        >
          Open allowlist guide
        </Link>
      </div>
      <ScimTokenCard
        orgSlug={orgSlug}
        endpointUrl={`${appUrl}/api/scim/v2`}
        hasToken={Boolean(scimState?.scimTokenHash)}
        issuedAt={scimState?.scimTokenIssuedAt ?? null}
      />

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="font-medium">Single sign-on</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Configure SAML 2.0 or OIDC identity. Both flows support SSO enforcement for password sign-in.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={ssoConfig ? "default" : "outline"}>
              {ssoConfig ? `${ssoConfig.kind.toUpperCase()} configured` : "Not configured"}
            </Badge>
            {ssoConfig ? (
              <Badge variant={ssoConfig.enforceSso ? "default" : "outline"}>
                {ssoConfig.enforceSso ? "SSO enforced" : "SSO optional"}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-border bg-[var(--collie-cloud)] p-3 text-xs">
          <p className="font-medium uppercase text-muted-foreground">OIDC redirect URI (register this with your IdP)</p>
          <p className="mt-2 break-all font-mono">{ssoRedirectUri}</p>
        </div>

        <form action={saveOidcSsoConfig} className="mt-5 grid gap-4 md:grid-cols-2">
          <input type="hidden" name="orgSlug" value={orgSlug} />
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="oidc-issuer-url">OIDC issuer URL</Label>
            <Input
              id="oidc-issuer-url"
              name="issuerUrl"
              type="url"
              placeholder="https://login.microsoftonline.com/<tenant-id>/v2.0"
              defaultValue={ssoConfig?.kind === "oidc" ? (ssoConfig.oidcIssuerUrl ?? "") : ""}
              required
            />
            <p className="text-xs text-muted-foreground">
              We fetch the discovery document at <span className="font-mono">{`<issuer>/.well-known/openid-configuration`}</span>.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="oidc-client-id">Client ID</Label>
            <Input
              id="oidc-client-id"
              name="clientId"
              defaultValue={ssoConfig?.kind === "oidc" ? (ssoConfig.oidcClientId ?? "") : ""}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="oidc-client-secret">Client secret</Label>
            <Input
              id="oidc-client-secret"
              name="clientSecret"
              type="password"
              placeholder={ssoConfig?.hasOidcSecret ? "•••••• (leave blank to keep current)" : ""}
              required={!ssoConfig?.hasOidcSecret}
            />
          </div>
          <div className="flex items-center gap-2 md:col-span-2">
            <input
              id="oidc-enforce"
              type="checkbox"
              name="enforceSso"
              value="true"
              defaultChecked={ssoConfig?.kind === "oidc" && ssoConfig.enforceSso}
              className="size-4 rounded border-input"
            />
            <Label htmlFor="oidc-enforce" className="text-sm font-normal">
              Require SSO for sign-in (blocks password sign-in for users in this organisation)
            </Label>
          </div>
          <div className="md:col-span-2">
            <Button type="submit">Save OIDC configuration</Button>
          </div>
        </form>

        <div className="mt-8 border-t border-border pt-5">
          <h3 className="text-sm font-medium">SAML 2.0</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Use the per-tenant ACS and metadata endpoints with your IdP, then paste the IdP metadata XML or URL here.
          </p>
          <form action={saveSamlSsoConfig} className="mt-3 grid gap-4 md:grid-cols-2">
            <input type="hidden" name="orgSlug" value={orgSlug} />
            <div className="space-y-2">
              <Label htmlFor="saml-entity-id">SP entity ID</Label>
              <Input
                id="saml-entity-id"
                name="entityId"
                defaultValue={ssoConfig?.kind === "saml" ? (ssoConfig.samlEntityId ?? "") : ""}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="saml-acs-url">ACS URL</Label>
              <Input
                id="saml-acs-url"
                name="acsUrl"
                type="url"
                defaultValue={ssoConfig?.kind === "saml" ? (ssoConfig.samlAcsUrl ?? "") : ""}
                required
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="saml-idp-metadata">IdP metadata (URL or XML)</Label>
              <Textarea
                id="saml-idp-metadata"
                name="idpMetadata"
                rows={5}
                defaultValue={ssoConfig?.kind === "saml" ? (ssoConfig.samlIdpMetadata ?? "") : ""}
                required
              />
            </div>
            <div className="flex items-center gap-2 md:col-span-2">
              <input
                id="saml-enforce"
                type="checkbox"
                name="enforceSso"
                value="true"
                defaultChecked={ssoConfig?.kind === "saml" && ssoConfig.enforceSso}
                className="size-4 rounded border-input"
              />
              <Label htmlFor="saml-enforce" className="text-sm font-normal">
                Require SSO for sign-in (blocks password sign-in for users in this organisation)
              </Label>
            </div>
            <div className="md:col-span-2">
              <Button type="submit" variant="outline">Save SAML metadata</Button>
            </div>
          </form>
        </div>

        {ssoConfig ? (
          <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-4">
            <form action={toggleSsoEnforcement}>
              <input type="hidden" name="orgSlug" value={orgSlug} />
              <input type="hidden" name="enforce" value={ssoConfig.enforceSso ? "false" : "true"} />
              <Button type="submit" variant="outline">
                {ssoConfig.enforceSso ? "Disable SSO enforcement" : "Enforce SSO for sign-in"}
              </Button>
            </form>
            <form action={deleteSsoConfig}>
              <input type="hidden" name="orgSlug" value={orgSlug} />
              <Button type="submit" variant="outline">Remove SSO configuration</Button>
            </form>
          </div>
        ) : null}
      </div>
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="font-medium">Mailbox ingestion</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Forward reported emails here from your existing security mailbox or report button. Collie matches forwarded
              campaign emails by token, original message headers, or the hidden report marker.
            </p>
          </div>
          <Badge variant="outline">Webhook ready</Badge>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          <div className="rounded-lg border border-border bg-[var(--collie-cloud)] p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">Forward reports to</p>
            <p className="mt-2 break-all font-mono text-xs">{reportMailbox}</p>
          </div>
          <div className="rounded-lg border border-border bg-[var(--collie-cloud)] p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">Webhook endpoint</p>
            <p className="mt-2 break-all font-mono text-xs">{appUrl}/api/webhooks/resend/inbound</p>
          </div>
          <div className="rounded-lg border border-border bg-[var(--collie-cloud)] p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">Campaign reply pattern</p>
            <p className="mt-2 break-all font-mono text-xs">{tokenisedReplyPattern}</p>
          </div>
        </div>
        <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
          <li>Create or enable a Resend receiving domain for `NEXT_PUBLIC_INBOUND_EMAIL_DOMAIN`.</li>
          <li>Add the `email.received` webhook in Resend using the endpoint above.</li>
          <li>Forward your existing report mailbox or report button destination to the Collie mailbox address.</li>
        </ol>
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="font-medium">SIEM/SOAR push</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Push simulation clicks, submissions, reports, and real-mail report clusters to your security tooling with
              tenant-scoped HMAC signing and durable retry.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={siemSoarEndpoints.some((endpoint) => endpoint.enabled) ? "default" : "outline"}>
              {siemSoarEndpoints.filter((endpoint) => endpoint.enabled).length} active
            </Badge>
            <Badge variant={siemSoarSigningKeyReady ? "default" : "outline"}>
              {siemSoarSigningKeyReady ? `Signing key ending ${siemSoarSigningKeyLast4}` : "No signing key"}
            </Badge>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-border bg-[var(--collie-cloud)] p-3 text-xs">
          <p className="font-medium uppercase text-muted-foreground">Signature header</p>
          <p className="mt-2 font-mono">X-Collie-Signature-256: sha256=&lt;hmac(timestamp.deliveryId.body)&gt;</p>
          <p className="mt-2 text-muted-foreground">
            Microsoft Sentinel uses Azure Monitor Logs Ingestion instead: configure the DCR endpoint, immutable DCR ID,
            stream name, and Entra app credentials.
          </p>
        </div>

        <form action={saveSiemSoarEndpoint} className="mt-5 grid gap-3 lg:grid-cols-[minmax(180px,1fr)_minmax(260px,2fr)_160px_110px_110px]">
          <input type="hidden" name="orgSlug" value={orgSlug} />
          <input type="hidden" name="enabled" value="true" />
          <div className="space-y-2">
            <Label htmlFor="siem-name">Name</Label>
            <Input id="siem-name" name="name" placeholder="Security operations" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="siem-url">Endpoint URL</Label>
            <Input id="siem-url" name="url" type="url" placeholder="https://example.com/collie" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="siem-connector">Connector</Label>
            <select
              id="siem-connector"
              name="connector"
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              defaultValue="sentinel"
            >
              {siemSoarConnectorOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="siem-format">Format</Label>
            <select
              id="siem-format"
              name="format"
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              defaultValue="json"
            >
              {siemSoarFormatOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="siem-attempts">Attempts</Label>
            <Input id="siem-attempts" name="maxAttempts" type="number" min={1} max={10} defaultValue={5} />
          </div>
          <div className="lg:col-span-5">
            <div className="flex flex-wrap gap-3">
              {siemSoarEventOptions.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="eventTypes"
                    value={option.value}
                    defaultChecked
                    className="size-4 rounded border-input"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-3 rounded-lg border border-border bg-[var(--collie-cloud)] p-3 lg:col-span-5 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="sentinel-cloud">Sentinel cloud</Label>
              <select
                id="sentinel-cloud"
                name="sentinelAzureCloud"
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                defaultValue="public"
              >
                {sentinelCloudOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sentinel-tenant">Tenant ID</Label>
              <Input id="sentinel-tenant" name="sentinelTenantId" placeholder="Entra directory tenant ID" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sentinel-client">Client ID</Label>
              <Input id="sentinel-client" name="sentinelClientId" placeholder="App registration client ID" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sentinel-secret">Client secret</Label>
              <Input id="sentinel-secret" name="sentinelClientSecret" type="password" placeholder="Required for Sentinel" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sentinel-dcr">DCR immutable ID</Label>
              <Input id="sentinel-dcr" name="sentinelDcrImmutableId" placeholder="dcr-..." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sentinel-stream">Stream name</Label>
              <Input id="sentinel-stream" name="sentinelStreamName" placeholder="Custom-Collie_CL" />
            </div>
          </div>
          <div className="lg:col-span-5">
            <Button type="submit">Add endpoint</Button>
          </div>
        </form>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <form action={rotateSiemSoarSigningKey}>
            <input type="hidden" name="orgSlug" value={orgSlug} />
            <Button type="submit" variant="outline">
              {siemSoarSigningKeyReady ? "Rotate signing key" : "Create signing key"}
            </Button>
          </form>
          {apiKeyRow?.siemSoarSigningKeyCreatedAt ? (
            <span className="text-xs text-muted-foreground">
              Last rotated {dateFormatter.format(apiKeyRow.siemSoarSigningKeyCreatedAt)}
            </span>
          ) : null}
        </div>

        {siemSoarEndpoints.length > 0 ? (
          <div className="mt-6 space-y-3">
            {siemSoarEndpoints.map((endpoint) => (
              <div key={endpoint.id} className="rounded-lg border border-border p-3">
                <form action={saveSiemSoarEndpoint} className="grid gap-3 lg:grid-cols-[minmax(180px,1fr)_minmax(260px,2fr)_160px_110px_110px_auto]">
                  <input type="hidden" name="orgSlug" value={orgSlug} />
                  <input type="hidden" name="endpointId" value={endpoint.id} />
                  <input
                    type="hidden"
                    name="sentinelHasExistingClientSecret"
                    value={endpoint.config.sentinel?.clientSecretEncrypted ? "true" : "false"}
                  />
                  <div className="space-y-2">
                    <Label htmlFor={`siem-name-${endpoint.id}`}>Name</Label>
                    <Input id={`siem-name-${endpoint.id}`} name="name" defaultValue={endpoint.name} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`siem-url-${endpoint.id}`}>Endpoint URL</Label>
                    <Input id={`siem-url-${endpoint.id}`} name="url" type="url" defaultValue={endpoint.url} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`siem-connector-${endpoint.id}`}>Connector</Label>
                    <select
                      id={`siem-connector-${endpoint.id}`}
                      name="connector"
                      className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      defaultValue={endpoint.connector}
                    >
                      {siemSoarConnectorOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`siem-format-${endpoint.id}`}>Format</Label>
                    <select
                      id={`siem-format-${endpoint.id}`}
                      name="format"
                      className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      defaultValue={endpoint.format}
                    >
                      {siemSoarFormatOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`siem-attempts-${endpoint.id}`}>Attempts</Label>
                    <Input
                      id={`siem-attempts-${endpoint.id}`}
                      name="maxAttempts"
                      type="number"
                      min={1}
                      max={10}
                      defaultValue={endpoint.maxAttempts}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button type="submit" variant="outline">Save</Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 lg:col-span-6">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="enabled"
                        value="true"
                        defaultChecked={endpoint.enabled}
                        className="size-4 rounded border-input"
                      />
                      Enabled
                    </label>
                    {siemSoarEventOptions.map((option) => (
                      <label key={option.value} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="eventTypes"
                          value={option.value}
                          defaultChecked={endpoint.eventTypes.includes(option.value)}
                          className="size-4 rounded border-input"
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                  <div className="grid gap-3 rounded-lg border border-border bg-[var(--collie-cloud)] p-3 lg:col-span-6 lg:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor={`sentinel-cloud-${endpoint.id}`}>Sentinel cloud</Label>
                      <select
                        id={`sentinel-cloud-${endpoint.id}`}
                        name="sentinelAzureCloud"
                        className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                        defaultValue={endpoint.config.sentinel?.azureCloud ?? "public"}
                      >
                        {sentinelCloudOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`sentinel-tenant-${endpoint.id}`}>Tenant ID</Label>
                      <Input
                        id={`sentinel-tenant-${endpoint.id}`}
                        name="sentinelTenantId"
                        defaultValue={endpoint.config.sentinel?.tenantId ?? ""}
                        placeholder="Entra directory tenant ID"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`sentinel-client-${endpoint.id}`}>Client ID</Label>
                      <Input
                        id={`sentinel-client-${endpoint.id}`}
                        name="sentinelClientId"
                        defaultValue={endpoint.config.sentinel?.clientId ?? ""}
                        placeholder="App registration client ID"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`sentinel-secret-${endpoint.id}`}>Client secret</Label>
                      <Input
                        id={`sentinel-secret-${endpoint.id}`}
                        name="sentinelClientSecret"
                        type="password"
                        placeholder={endpoint.config.sentinel?.clientSecretEncrypted ? "Stored; enter to rotate" : "Required for Sentinel"}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`sentinel-dcr-${endpoint.id}`}>DCR immutable ID</Label>
                      <Input
                        id={`sentinel-dcr-${endpoint.id}`}
                        name="sentinelDcrImmutableId"
                        defaultValue={endpoint.config.sentinel?.dcrImmutableId ?? ""}
                        placeholder="dcr-..."
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`sentinel-stream-${endpoint.id}`}>Stream name</Label>
                      <Input
                        id={`sentinel-stream-${endpoint.id}`}
                        name="sentinelStreamName"
                        defaultValue={endpoint.config.sentinel?.streamName ?? ""}
                        placeholder="Custom-Collie_CL"
                      />
                    </div>
                  </div>
                </form>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
                  <div>
                    <Badge variant={endpoint.enabled ? "default" : "outline"}>
                      {endpoint.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                    <span className="ml-2">
                      Last success {endpoint.lastSuccessAt ? dateFormatter.format(endpoint.lastSuccessAt) : "never"}
                    </span>
                    <span className="ml-2">
                      Last failure {endpoint.lastFailureAt ? dateFormatter.format(endpoint.lastFailureAt) : "never"}
                    </span>
                  </div>
                  <form action={deleteSiemSoarEndpoint}>
                    <input type="hidden" name="orgSlug" value={orgSlug} />
                    <input type="hidden" name="endpointId" value={endpoint.id} />
                    <Button type="submit" variant="outline">Delete</Button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">
            Add an endpoint to start queueing at-least-once deliveries for the selected event types.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="font-medium">Integrations — employee directory sync</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Pipe employees in from any HR system using a tenant-scoped API key. Send single upserts, bulk JSONL, or
              CSV bodies. Missing employees stay in the directory until you call the bulk endpoint with{" "}
              <code className="rounded bg-[var(--collie-cloud)] px-1 py-0.5 font-mono text-xs">mode=full</code>, which
              soft-deactivates anyone absent from the payload.
            </p>
          </div>
          <Badge variant={apiKeyMinted ? "default" : "outline"}>
            {apiKeyMinted ? `Key ending ${apiKeyLast4}` : "No key minted"}
          </Badge>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-[var(--collie-cloud)] p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">POST single employee</p>
            <p className="mt-2 break-all font-mono text-xs">{singleEndpoint}</p>
          </div>
          <div className="rounded-lg border border-border bg-[var(--collie-cloud)] p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">POST bulk (JSONL / CSV)</p>
            <p className="mt-2 break-all font-mono text-xs">{bulkEndpoint}?mode=incremental</p>
          </div>
        </div>

        {pendingApiKey ? (
          <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">Copy this API key now — it will not be shown again here.</p>
                <p className="break-all rounded-lg bg-card px-3 py-2 font-mono text-xs">{pendingApiKey}</p>
              </div>
              <form action={dismissPendingApiKeyReveal}>
                <input type="hidden" name="orgSlug" value={orgSlug} />
                <Button type="submit" variant="outline">
                  I&apos;ve copied it
                </Button>
              </form>
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {!apiKeyMinted ? (
            <form action={mintIngestApiKey}>
              <input type="hidden" name="orgSlug" value={orgSlug} />
              <Button type="submit">Mint API key</Button>
            </form>
          ) : (
            <>
              <form action={rotateIngestApiKey}>
                <input type="hidden" name="orgSlug" value={orgSlug} />
                <Button type="submit" variant="outline">Rotate API key</Button>
              </form>
              <form action={revealIngestApiKey}>
                <input type="hidden" name="orgSlug" value={orgSlug} />
                <Button type="submit" variant="outline">Reveal current key</Button>
              </form>
              <form action={revokeIngestApiKey}>
                <input type="hidden" name="orgSlug" value={orgSlug} />
                <Button type="submit" variant="outline">Revoke key</Button>
              </form>
              <form action={recordTestSyncRun}>
                <input type="hidden" name="orgSlug" value={orgSlug} />
                <Button type="submit" variant="outline">Test webhook</Button>
              </form>
            </>
          )}
          {apiKeyMinted && apiKeyCreatedAt ? (
            <span className="text-xs text-muted-foreground">
              Last minted {dateFormatter.format(apiKeyCreatedAt)}
            </span>
          ) : null}
        </div>

        <div className="mt-6 grid gap-3 lg:grid-cols-4">
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">Last sync</p>
            <p className="mt-2 text-sm">
              {lastSync ? dateFormatter.format(lastSync.createdAt) : "No syncs yet"}
            </p>
            {lastSync ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Mode {lastSync.mode} via {lastSync.source}
              </p>
            ) : null}
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">Added (last)</p>
            <p className="mt-2 text-2xl font-semibold">{lastSync?.addedCount ?? 0}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">Updated (last)</p>
            <p className="mt-2 text-2xl font-semibold">{lastSync?.updatedCount ?? 0}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">Deactivated (last)</p>
            <p className="mt-2 text-2xl font-semibold">{lastSync?.deactivatedCount ?? 0}</p>
          </div>
        </div>

        {recentSyncRuns.length > 0 ? (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 font-medium">When</th>
                  <th className="py-2 font-medium">Mode</th>
                  <th className="py-2 font-medium">Source</th>
                  <th className="py-2 font-medium">Received</th>
                  <th className="py-2 font-medium">Added</th>
                  <th className="py-2 font-medium">Updated</th>
                  <th className="py-2 font-medium">Deactivated</th>
                  <th className="py-2 font-medium">Skipped</th>
                </tr>
              </thead>
              <tbody>
                {recentSyncRuns.map((run) => (
                  <tr key={run.id} className="border-b last:border-b-0">
                    <td className="py-2 pr-4">{dateFormatter.format(run.createdAt)}</td>
                    <td className="py-2 pr-4">
                      <Badge variant="outline">{run.mode}</Badge>
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {run.source}
                      {run.actorKeyLast4 ? ` · ${run.actorKeyLast4}` : ""}
                    </td>
                    <td className="py-2 pr-4">{run.receivedCount}</td>
                    <td className="py-2 pr-4">{run.addedCount}</td>
                    <td className="py-2 pr-4">{run.updatedCount}</td>
                    <td className="py-2 pr-4">{run.deactivatedCount}</td>
                    <td className="py-2 pr-4">{run.skippedCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">
            Syncs from the API will appear here with added, updated, and deactivated counts.
          </p>
        )}
      </div>
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="font-medium">Outlook Phish Report add-in</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              One-click reporting from Outlook on the web, desktop, and mobile. Reports are deduplicated against
              active campaigns by token; anything unmatched lands in the real-mail triage queue.
            </p>
          </div>
          <Badge variant="outline">Microsoft 365</Badge>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-[var(--collie-cloud)] p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">Manifest URL</p>
            <p className="mt-2 break-all font-mono text-xs">{appUrl}/api/addin/outlook/manifest.xml</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Paste this URL into Microsoft 365 admin centre → Integrated apps → Upload custom apps.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-[var(--collie-cloud)] p-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">Ingest endpoint</p>
            <p className="mt-2 break-all font-mono text-xs">{appUrl}/api/addin/report</p>
            <p className="mt-2 text-xs text-muted-foreground">
              The add-in POSTs the message subject, headers, body, and attachment metadata here for triage.
            </p>
          </div>
        </div>
        <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
          <li>
            Sign into the{" "}
            <a
              href="https://admin.microsoft.com/Adminportal/Home#/Settings/IntegratedApps"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Microsoft 365 admin centre
            </a>{" "}
            with a global or apps admin role.
          </li>
          <li>Choose <strong>Integrated apps</strong> → <strong>Upload custom apps</strong> → <strong>Office Add-in</strong>.</li>
          <li>Select <strong>Provide link to manifest file</strong> and paste the manifest URL above.</li>
          <li>Deploy to the whole organisation or a pilot security group. End users see the &ldquo;Report phish&rdquo; button in the Outlook ribbon.</li>
          <li>For local testing, use Outlook → Get Add-ins → My add-ins → Add a custom add-in → Add from URL.</li>
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">
          Reporter email is taken from the signed-in mailbox profile and must match an active employee record for the report to be accepted.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="font-medium">Gmail &amp; Teams reporting</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              The Google Workspace add-on and Teams message extension are tracked as follow-up issues. Until they
              ship, Workspace users can forward suspicious mail to the mailbox above to land in the same triage queue.
            </p>
          </div>
          <Badge variant="outline">On the roadmap</Badge>
        </div>
      </div>
    </div>
  );
}
