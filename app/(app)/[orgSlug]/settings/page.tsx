import {
  dismissPendingApiKeyReveal,
  mintIngestApiKey,
  readPendingApiKeyReveal,
  recordTestSyncRun,
  revealIngestApiKey,
  revokeIngestApiKey,
  rotateIngestApiKey,
} from "@/app/actions/integrations";
import { saveSendingSettings } from "@/app/actions/settings";
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
  ssoConfigurations,
  users,
  verifications,
} from "@/lib/db/schema";
import { buildCampaignReportAddress, buildOrganisationReportAddress } from "@/lib/email/reporting";
import { and, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";

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
    })
    .from(organisations)
    .where(eq(organisations.id, organisation.id))
    .limit(1);
  const apiKeyMinted = Boolean(apiKeyRow?.apiKeyHash);
  const apiKeyLast4 = apiKeyRow?.apiKeyLast4 ?? null;
  const apiKeyCreatedAt = apiKeyRow?.apiKeyCreatedAt ?? null;
  const pendingApiKey = await readPendingApiKeyReveal(orgSlug);
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
              Configure SAML 2.0 or OIDC identity. OIDC is wired end-to-end today; SAML metadata is captured here and the assertion handler ships in a follow-up.
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
          <h3 className="text-sm font-medium">SAML 2.0 (assertion handler shipping next)</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Capture your IdP metadata so we can scaffold the per-tenant ACS endpoint. Tenants that need SSO today should use the OIDC tab above.
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
                Require SSO for sign-in (active once the SAML assertion handler ships)
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
