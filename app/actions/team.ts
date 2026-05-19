"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hashPassword } from "better-auth/crypto";

import { recordAudit } from "@/lib/audit/record";
import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { accounts, organisationInvitations, organisations, sessions, users, verifications } from "@/lib/db/schema";

const roles = ["owner", "admin", "viewer"] as const;

function formValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function normaliseEmail(email: string) {
  return email.trim().toLowerCase();
}

async function requireTeamManager(orgSlug: string) {
  const organisation = await requireOrganisationForSlug(orgSlug);
  const [currentUser] = await db
    .select({ role: users.role, active: users.active })
    .from(users)
    .where(and(eq(users.id, organisation.userId), eq(users.organisationId, organisation.id)))
    .limit(1);

  if (!currentUser?.active || !["owner", "admin"].includes(currentUser.role)) {
    throw new Error("Only owners and admins can manage organisation access.");
  }

  return { ...organisation, currentUserRole: currentUser.role };
}

async function ensureOwnerRemains(organisationId: string, userId: string) {
  const [target] = await db
    .select({ role: users.role })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organisationId, organisationId)))
    .limit(1);

  if (target?.role !== "owner") return;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.organisationId, organisationId), eq(users.role, "owner"), eq(users.active, true), ne(users.id, userId)));

  if (count < 1) {
    throw new Error("Add another owner before changing or removing the only owner.");
  }
}

const inviteSchema = z.object({
  orgSlug: z.string().min(1),
  email: z.string().email(),
  role: z.enum(roles).default("admin"),
});

export async function inviteOrganisationUser(formData: FormData) {
  const data = inviteSchema.parse({
    orgSlug: formValue(formData, "orgSlug"),
    email: normaliseEmail(formValue(formData, "email")),
    role: formValue(formData, "role") || "admin",
  });
  const organisation = await requireTeamManager(data.orgSlug);

  const [existingUser] = await db
    .select({ organisationId: users.organisationId })
    .from(users)
    .where(eq(users.email, data.email))
    .limit(1);

  if (existingUser?.organisationId === organisation.id) {
    throw new Error("That user is already part of this organisation.");
  }

  if (existingUser?.organisationId && existingUser.organisationId !== organisation.id) {
    throw new Error("That email is already attached to another organisation.");
  }

  await db
    .update(organisationInvitations)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(organisationInvitations.organisationId, organisation.id),
        eq(organisationInvitations.email, data.email),
        eq(organisationInvitations.status, "pending"),
      ),
    );

  const [invitation] = await db
    .insert(organisationInvitations)
    .values({
      organisationId: organisation.id,
      email: data.email,
      role: data.role,
      token: crypto.randomBytes(24).toString("base64url"),
      invitedBy: organisation.userId,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
    })
    .returning({ id: organisationInvitations.id });

  await recordAudit({
    organisationId: organisation.id,
    actorUserId: organisation.userId,
    action: "organisation_user.invite",
    resourceType: "organisation_invitation",
    resourceId: invitation?.id ?? null,
    metadata: { email: data.email, role: data.role },
  });

  revalidatePath(`/${data.orgSlug}/settings`);
}

const invitationSchema = z.object({ token: z.string().min(16) });

export async function acceptOrganisationInvitation(input: z.infer<typeof invitationSchema>) {
  const { token } = invitationSchema.parse(input);
  const session = await requireSession();

  const [invitation] = await db
    .select({
      id: organisationInvitations.id,
      organisationId: organisationInvitations.organisationId,
      email: organisationInvitations.email,
      role: organisationInvitations.role,
      status: organisationInvitations.status,
      expiresAt: organisationInvitations.expiresAt,
      orgSlug: organisations.slug,
    })
    .from(organisationInvitations)
    .innerJoin(organisations, eq(organisations.id, organisationInvitations.organisationId))
    .where(eq(organisationInvitations.token, token))
    .limit(1);

  if (!invitation || invitation.status !== "pending" || invitation.expiresAt.getTime() < Date.now()) {
    throw new Error("This invite link is no longer valid.");
  }

  if (normaliseEmail(session.user.email) !== invitation.email) {
    throw new Error("Sign up with the invited email address to join this organisation.");
  }

  await db
    .update(users)
    .set({
      organisationId: invitation.organisationId,
      role: invitation.role,
      active: true,
      updatedAt: new Date(),
    })
    .where(eq(users.id, session.user.id));

  await db
    .update(organisationInvitations)
    .set({ status: "accepted", acceptedAt: new Date(), updatedAt: new Date() })
    .where(eq(organisationInvitations.id, invitation.id));

  revalidatePath(`/${invitation.orgSlug}/settings`);
  return { slug: invitation.orgSlug };
}

const userActionSchema = z.object({
  orgSlug: z.string().min(1),
  userId: z.string().min(1),
});

export async function issuePasswordResetLink(formData: FormData) {
  const data = userActionSchema.parse({
    orgSlug: formValue(formData, "orgSlug"),
    userId: formValue(formData, "userId"),
  });
  const organisation = await requireTeamManager(data.orgSlug);
  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, data.userId), eq(users.organisationId, organisation.id)))
    .limit(1);

  if (!target) {
    throw new Error("Choose a valid organisation user.");
  }

  const token = crypto.randomBytes(24).toString("base64url");
  await db.delete(verifications).where(and(sql`${verifications.identifier} like 'reset-password:%'`, eq(verifications.value, data.userId)));
  await db.insert(verifications).values({
    id: crypto.randomBytes(12).toString("base64url"),
    identifier: `reset-password:${token}`,
    value: data.userId,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 2),
  });

  revalidatePath(`/${data.orgSlug}/settings`);
}

export async function revokePasswordResetLink(formData: FormData) {
  const data = userActionSchema.parse({
    orgSlug: formValue(formData, "orgSlug"),
    userId: formValue(formData, "userId"),
  });
  const organisation = await requireTeamManager(data.orgSlug);
  await db.delete(verifications).where(and(sql`${verifications.identifier} like 'reset-password:%'`, eq(verifications.value, data.userId)));
  revalidatePath(`/${organisation.slug}/settings`);
}

const roleSchema = userActionSchema.extend({ role: z.enum(roles) });

export async function updateOrganisationUserRole(formData: FormData) {
  const data = roleSchema.parse({
    orgSlug: formValue(formData, "orgSlug"),
    userId: formValue(formData, "userId"),
    role: formValue(formData, "role"),
  });
  const organisation = await requireTeamManager(data.orgSlug);

  if (organisation.currentUserRole !== "owner") {
    throw new Error("Only owners can change team roles.");
  }

  if (data.role !== "owner") {
    await ensureOwnerRemains(organisation.id, data.userId);
  }

  await db
    .update(users)
    .set({ role: data.role, updatedAt: new Date() })
    .where(and(eq(users.id, data.userId), eq(users.organisationId, organisation.id)));

  await recordAudit({
    organisationId: organisation.id,
    actorUserId: organisation.userId,
    action: "organisation_user.update_role",
    resourceType: "user",
    resourceId: data.userId,
    metadata: { role: data.role },
  });

  revalidatePath(`/${data.orgSlug}/settings`);
}

export async function removeOrganisationUser(formData: FormData) {
  const data = userActionSchema.parse({
    orgSlug: formValue(formData, "orgSlug"),
    userId: formValue(formData, "userId"),
  });
  const organisation = await requireTeamManager(data.orgSlug);

  if (organisation.currentUserRole !== "owner") {
    throw new Error("Only owners can remove team members.");
  }

  if (data.userId === organisation.userId) {
    throw new Error("You cannot remove your own account from the organisation.");
  }

  await ensureOwnerRemains(organisation.id, data.userId);
  await db
    .update(users)
    .set({ organisationId: null, role: "viewer", active: true, mfaRequired: false, updatedAt: new Date() })
    .where(and(eq(users.id, data.userId), eq(users.organisationId, organisation.id)));
  await db.delete(sessions).where(eq(sessions.userId, data.userId));

  await recordAudit({
    organisationId: organisation.id,
    actorUserId: organisation.userId,
    action: "organisation_user.remove",
    resourceType: "user",
    resourceId: data.userId,
  });

  revalidatePath(`/${data.orgSlug}/settings`);
}

const mfaSchema = userActionSchema.extend({ required: z.enum(["true", "false"]) });

export async function setMfaRequirement(formData: FormData) {
  const data = mfaSchema.parse({
    orgSlug: formValue(formData, "orgSlug"),
    userId: formValue(formData, "userId"),
    required: formValue(formData, "required"),
  });
  const organisation = await requireTeamManager(data.orgSlug);

  await db
    .update(users)
    .set({ mfaRequired: data.required === "true", updatedAt: new Date() })
    .where(and(eq(users.id, data.userId), eq(users.organisationId, organisation.id)));

  await recordAudit({
    organisationId: organisation.id,
    actorUserId: organisation.userId,
    action: "mfa.set_requirement",
    resourceType: "user",
    resourceId: data.userId,
    metadata: { required: data.required === "true" },
  });

  revalidatePath(`/${data.orgSlug}/settings`);
}

export async function resetUserMfa(formData: FormData) {
  const data = userActionSchema.parse({
    orgSlug: formValue(formData, "orgSlug"),
    userId: formValue(formData, "userId"),
  });
  const organisation = await requireTeamManager(data.orgSlug);
  const now = new Date();

  await db
    .update(users)
    .set({ mfaEnabled: false, mfaResetAt: now, updatedAt: now })
    .where(and(eq(users.id, data.userId), eq(users.organisationId, organisation.id)));
  await db.delete(sessions).where(eq(sessions.userId, data.userId));

  await recordAudit({
    organisationId: organisation.id,
    actorUserId: organisation.userId,
    action: "mfa.reset",
    resourceType: "user",
    resourceId: data.userId,
  });

  revalidatePath(`/${data.orgSlug}/settings`);
}

const cancelInviteSchema = z.object({
  orgSlug: z.string().min(1),
  invitationId: z.string().min(1),
});

export async function cancelOrganisationInvitation(formData: FormData) {
  const data = cancelInviteSchema.parse({
    orgSlug: formValue(formData, "orgSlug"),
    invitationId: formValue(formData, "invitationId"),
  });
  const organisation = await requireTeamManager(data.orgSlug);

  await db
    .update(organisationInvitations)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(organisationInvitations.id, data.invitationId), eq(organisationInvitations.organisationId, organisation.id)));

  await recordAudit({
    organisationId: organisation.id,
    actorUserId: organisation.userId,
    action: "organisation_user.cancel_invite",
    resourceType: "organisation_invitation",
    resourceId: data.invitationId,
  });

  revalidatePath(`/${data.orgSlug}/settings`);
}

const resetPasswordSchema = z
  .object({
    token: z.string().min(16),
    password: z.string().min(10, "Use at least 10 characters"),
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    path: ["confirm"],
    message: "Passwords do not match.",
  });

export async function resetPasswordWithToken(formData: FormData) {
  const data = resetPasswordSchema.parse({
    token: formValue(formData, "token"),
    password: formValue(formData, "password"),
    confirm: formValue(formData, "confirm"),
  });
  const identifier = `reset-password:${data.token}`;
  const [verification] = await db
    .select({ id: verifications.id, value: verifications.value, expiresAt: verifications.expiresAt })
    .from(verifications)
    .where(eq(verifications.identifier, identifier))
    .limit(1);

  if (!verification || verification.expiresAt.getTime() < Date.now()) {
    throw new Error("This reset link is no longer valid.");
  }

  const hashedPassword = await hashPassword(data.password);
  const [existingAccount] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, verification.value), eq(accounts.providerId, "credential")))
    .limit(1);

  if (existingAccount) {
    await db
      .update(accounts)
      .set({ password: hashedPassword, updatedAt: new Date() })
      .where(eq(accounts.id, existingAccount.id));
  } else {
    await db.insert(accounts).values({
      id: crypto.randomBytes(16).toString("base64url"),
      accountId: verification.value,
      providerId: "credential",
      userId: verification.value,
      password: hashedPassword,
    });
  }

  await db.delete(verifications).where(eq(verifications.id, verification.id));
  await db.delete(sessions).where(eq(sessions.userId, verification.value));

  redirect("/signin?reset=complete");
}
