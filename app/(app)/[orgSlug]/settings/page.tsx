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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { openTotpSecret } from "@/lib/auth/totp";
import { db } from "@/lib/db/client";
import { organisationInvitations, users, verifications } from "@/lib/db/schema";
import { buildCampaignReportAddress, buildOrganisationReportAddress } from "@/lib/email/reporting";
import { and, desc, eq, sql } from "drizzle-orm";

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
    </div>
  );
}
