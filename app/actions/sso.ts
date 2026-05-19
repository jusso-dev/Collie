"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import {
  lookupTenantForEmail,
  refreshSsoCache,
} from "@/lib/auth/sso";
import { sealTotpSecret } from "@/lib/auth/totp";
import { db } from "@/lib/db/client";
import { ssoConfigurations, users } from "@/lib/db/schema";

function formValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function requireOrgAdmin(orgSlug: string) {
  const organisation = await requireOrganisationForSlug(orgSlug);
  const [currentUser] = await db
    .select({ role: users.role, active: users.active })
    .from(users)
    .where(and(eq(users.id, organisation.userId), eq(users.organisationId, organisation.id)))
    .limit(1);

  if (!currentUser?.active || !["owner", "admin"].includes(currentUser.role)) {
    throw new Error("Only owners and admins can manage SSO settings.");
  }

  return organisation;
}

const oidcSchema = z.object({
  orgSlug: z.string().min(1),
  issuerUrl: z.string().url("Provide the IdP issuer URL"),
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client secret is required").optional(),
  enforceSso: z.enum(["true", "false"]).default("false"),
});

export async function saveOidcSsoConfig(formData: FormData) {
  const data = oidcSchema.parse({
    orgSlug: formValue(formData, "orgSlug"),
    issuerUrl: formValue(formData, "issuerUrl"),
    clientId: formValue(formData, "clientId"),
    clientSecret: formValue(formData, "clientSecret") || undefined,
    enforceSso: formValue(formData, "enforceSso") || "false",
  });
  const organisation = await requireOrgAdmin(data.orgSlug);

  const [existing] = await db
    .select({
      id: ssoConfigurations.id,
      oidcClientSecretEncrypted: ssoConfigurations.oidcClientSecretEncrypted,
    })
    .from(ssoConfigurations)
    .where(eq(ssoConfigurations.organisationId, organisation.id))
    .limit(1);

  // Reuse the sealed secret when the admin leaves the secret field blank on edit.
  const sealedSecret = data.clientSecret
    ? sealTotpSecret(data.clientSecret)
    : existing?.oidcClientSecretEncrypted;

  if (!sealedSecret) {
    throw new Error("Provide the OIDC client secret to activate SSO.");
  }

  const now = new Date();
  if (existing) {
    await db
      .update(ssoConfigurations)
      .set({
        kind: "oidc",
        oidcIssuerUrl: data.issuerUrl,
        oidcClientId: data.clientId,
        oidcClientSecretEncrypted: sealedSecret,
        samlEntityId: null,
        samlAcsUrl: null,
        samlIdpMetadata: null,
        enforceSso: data.enforceSso === "true",
        updatedAt: now,
      })
      .where(eq(ssoConfigurations.id, existing.id));
  } else {
    await db.insert(ssoConfigurations).values({
      organisationId: organisation.id,
      kind: "oidc",
      oidcIssuerUrl: data.issuerUrl,
      oidcClientId: data.clientId,
      oidcClientSecretEncrypted: sealedSecret,
      enforceSso: data.enforceSso === "true",
    });
  }

  await refreshSsoCache();
  revalidatePath(`/${organisation.slug}/settings`);
}

const samlSchema = z.object({
  orgSlug: z.string().min(1),
  entityId: z.string().min(1, "Entity ID is required"),
  acsUrl: z.string().url("ACS URL must be a valid URL"),
  idpMetadata: z.string().min(1, "Paste the IdP metadata XML or discovery URL"),
  enforceSso: z.enum(["true", "false"]).default("false"),
});

export async function saveSamlSsoConfig(formData: FormData) {
  const data = samlSchema.parse({
    orgSlug: formValue(formData, "orgSlug"),
    entityId: formValue(formData, "entityId"),
    acsUrl: formValue(formData, "acsUrl"),
    idpMetadata: formValue(formData, "idpMetadata"),
    enforceSso: formValue(formData, "enforceSso") || "false",
  });
  const organisation = await requireOrgAdmin(data.orgSlug);

  const [existing] = await db
    .select({ id: ssoConfigurations.id })
    .from(ssoConfigurations)
    .where(eq(ssoConfigurations.organisationId, organisation.id))
    .limit(1);

  const now = new Date();
  if (existing) {
    await db
      .update(ssoConfigurations)
      .set({
        kind: "saml",
        samlEntityId: data.entityId,
        samlAcsUrl: data.acsUrl,
        samlIdpMetadata: data.idpMetadata,
        oidcIssuerUrl: null,
        oidcClientId: null,
        oidcClientSecretEncrypted: null,
        enforceSso: data.enforceSso === "true",
        updatedAt: now,
      })
      .where(eq(ssoConfigurations.id, existing.id));
  } else {
    await db.insert(ssoConfigurations).values({
      organisationId: organisation.id,
      kind: "saml",
      samlEntityId: data.entityId,
      samlAcsUrl: data.acsUrl,
      samlIdpMetadata: data.idpMetadata,
      enforceSso: data.enforceSso === "true",
    });
  }

  await refreshSsoCache();
  revalidatePath(`/${organisation.slug}/settings`);
}

const deleteSchema = z.object({ orgSlug: z.string().min(1) });

export async function deleteSsoConfig(formData: FormData) {
  const data = deleteSchema.parse({ orgSlug: formValue(formData, "orgSlug") });
  const organisation = await requireOrgAdmin(data.orgSlug);

  await db.delete(ssoConfigurations).where(eq(ssoConfigurations.organisationId, organisation.id));
  await refreshSsoCache();
  revalidatePath(`/${organisation.slug}/settings`);
}

const enforceSchema = z.object({
  orgSlug: z.string().min(1),
  enforce: z.enum(["true", "false"]),
});

export async function toggleSsoEnforcement(formData: FormData) {
  const data = enforceSchema.parse({
    orgSlug: formValue(formData, "orgSlug"),
    enforce: formValue(formData, "enforce"),
  });
  const organisation = await requireOrgAdmin(data.orgSlug);

  await db
    .update(ssoConfigurations)
    .set({ enforceSso: data.enforce === "true", updatedAt: new Date() })
    .where(eq(ssoConfigurations.organisationId, organisation.id));

  await refreshSsoCache();
  revalidatePath(`/${organisation.slug}/settings`);
}

/**
 * Public lookup used by the sign-in form to discover whether SSO is configured
 * for the supplied email and, if so, which provider to redirect to.
 */
export async function discoverSsoForEmail(input: { email: string }): Promise<
  | { kind: "none" }
  | {
      kind: "oidc";
      providerId: string;
      organisationId: string;
      enforceSso: boolean;
    }
  | {
      kind: "saml";
      organisationId: string;
      enforceSso: boolean;
    }
> {
  const email = z.string().email().parse(input.email.trim().toLowerCase());
  const tenant = await lookupTenantForEmail(email);
  if (!tenant) return { kind: "none" };
  if (tenant.kind === "oidc" && tenant.oidc) {
    return {
      kind: "oidc",
      providerId: tenant.oidc.providerId,
      organisationId: tenant.organisationId,
      enforceSso: tenant.enforceSso,
    };
  }
  if (tenant.kind === "saml" && tenant.saml) {
    return {
      kind: "saml",
      organisationId: tenant.organisationId,
      enforceSso: tenant.enforceSso,
    };
  }
  return { kind: "none" };
}
