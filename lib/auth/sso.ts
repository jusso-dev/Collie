import { eq } from "drizzle-orm";

import { openTotpSecret } from "@/lib/auth/totp";
import { db } from "@/lib/db/client";
import { organisations, ssoConfigurations } from "@/lib/db/schema";

/**
 * Per-tenant Single Sign-On configuration. We persist OIDC client credentials
 * and SAML metadata per organisation. Client secrets are sealed at rest using
 * the same AES-GCM wrapper as TOTP secrets.
 */
export type SsoCacheEntry = {
  organisationId: string;
  organisationSlug: string;
  kind: "oidc" | "saml";
  enforceSso: boolean;
  oidc: {
    providerId: string;
    issuerUrl: string;
    clientId: string;
    clientSecret: string;
    discoveryUrl: string;
  } | null;
  saml: {
    entityId: string;
    acsUrl: string;
    idpMetadata: string;
  } | null;
};

const cache = new Map<string, SsoCacheEntry>();
const cacheByProviderId = new Map<string, SsoCacheEntry>();
const cacheByOrgSlug = new Map<string, SsoCacheEntry>();
let lastLoadedAt = 0;
let loadingPromise: Promise<void> | null = null;

const CACHE_TTL_MS = 30_000;

export function buildOidcProviderId(organisationId: string): string {
  return `oidc-${organisationId}`;
}

function buildDiscoveryUrl(issuerUrl: string): string {
  // Standard OIDC discovery document. Tenants supply the issuer URL only;
  // the well-known suffix is universal across compliant providers.
  const trimmed = issuerUrl.replace(/\/$/, "");
  return `${trimmed}/.well-known/openid-configuration`;
}

function buildEntry(row: {
  id: string;
  organisationId: string;
  organisationSlug: string;
  kind: "oidc" | "saml";
  enforceSso: boolean;
  oidcIssuerUrl: string | null;
  oidcClientId: string | null;
  oidcClientSecretEncrypted: string | null;
  samlEntityId: string | null;
  samlAcsUrl: string | null;
  samlIdpMetadata: string | null;
}): SsoCacheEntry {
  let oidc: SsoCacheEntry["oidc"] = null;
  if (row.kind === "oidc" && row.oidcIssuerUrl && row.oidcClientId && row.oidcClientSecretEncrypted) {
    let clientSecret = "";
    try {
      clientSecret = openTotpSecret(row.oidcClientSecretEncrypted);
    } catch (error) {
      console.error("Failed to unseal OIDC client secret", { organisationId: row.organisationId, error });
    }
    oidc = {
      providerId: buildOidcProviderId(row.organisationId),
      issuerUrl: row.oidcIssuerUrl,
      clientId: row.oidcClientId,
      clientSecret,
      discoveryUrl: buildDiscoveryUrl(row.oidcIssuerUrl),
    };
  }

  const saml: SsoCacheEntry["saml"] =
    row.kind === "saml" && row.samlEntityId && row.samlAcsUrl
      ? {
          entityId: row.samlEntityId,
          acsUrl: row.samlAcsUrl,
          idpMetadata: row.samlIdpMetadata ?? "",
        }
      : null;

  return {
    organisationId: row.organisationId,
    organisationSlug: row.organisationSlug,
    kind: row.kind,
    enforceSso: row.enforceSso,
    oidc,
    saml,
  };
}

async function loadCacheNow(): Promise<void> {
  const rows = await db
    .select({
      id: ssoConfigurations.id,
      organisationId: ssoConfigurations.organisationId,
      organisationSlug: organisations.slug,
      kind: ssoConfigurations.kind,
      enforceSso: ssoConfigurations.enforceSso,
      oidcIssuerUrl: ssoConfigurations.oidcIssuerUrl,
      oidcClientId: ssoConfigurations.oidcClientId,
      oidcClientSecretEncrypted: ssoConfigurations.oidcClientSecretEncrypted,
      samlEntityId: ssoConfigurations.samlEntityId,
      samlAcsUrl: ssoConfigurations.samlAcsUrl,
      samlIdpMetadata: ssoConfigurations.samlIdpMetadata,
    })
    .from(ssoConfigurations)
    .innerJoin(organisations, eq(organisations.id, ssoConfigurations.organisationId));

  cache.clear();
  cacheByProviderId.clear();
  cacheByOrgSlug.clear();

  for (const row of rows) {
    const entry = buildEntry(row);
    cache.set(entry.organisationId, entry);
    cacheByOrgSlug.set(entry.organisationSlug, entry);
    if (entry.oidc) {
      cacheByProviderId.set(entry.oidc.providerId, entry);
    }
  }

  lastLoadedAt = Date.now();
}

export async function ensureSsoCacheLoaded(): Promise<void> {
  if (Date.now() - lastLoadedAt < CACHE_TTL_MS && cache.size >= 0 && lastLoadedAt > 0) return;
  if (loadingPromise) {
    await loadingPromise;
    return;
  }
  loadingPromise = loadCacheNow().finally(() => {
    loadingPromise = null;
  });
  await loadingPromise;
}

export async function refreshSsoCache(): Promise<void> {
  loadingPromise = loadCacheNow().finally(() => {
    loadingPromise = null;
  });
  await loadingPromise;
}

export function getCachedSsoByOrganisationId(organisationId: string): SsoCacheEntry | null {
  return cache.get(organisationId) ?? null;
}

export function getCachedSsoByProviderId(providerId: string): SsoCacheEntry | null {
  return cacheByProviderId.get(providerId) ?? null;
}

export function getCachedSsoByOrgSlug(orgSlug: string): SsoCacheEntry | null {
  return cacheByOrgSlug.get(orgSlug) ?? null;
}

export function listCachedOidcProviderIds(): string[] {
  return Array.from(cacheByProviderId.keys());
}

export function buildOidcConfigsForBetterAuth() {
  return Array.from(cacheByProviderId.values())
    .filter((entry) => entry.oidc !== null)
    .map((entry) => {
      const oidc = entry.oidc!;
      return {
        providerId: oidc.providerId,
        discoveryUrl: oidc.discoveryUrl,
        clientId: oidc.clientId,
        clientSecret: oidc.clientSecret,
        scopes: ["openid", "email", "profile"],
        pkce: true,
        // Stamp the joining user with this tenant on JIT user creation.
        mapProfileToUser: (profile: Record<string, unknown>) => {
          const email =
            typeof profile.email === "string" ? (profile.email as string).toLowerCase() : undefined;
          const name =
            typeof profile.name === "string"
              ? (profile.name as string)
              : email
                ? email.split("@")[0]
                : "Unknown";
          return {
            email,
            name,
            organisationId: entry.organisationId,
            role: "viewer",
          };
        },
      };
    });
}

export async function lookupTenantForEmail(email: string): Promise<SsoCacheEntry | null> {
  await ensureSsoCacheLoaded();
  const normalised = email.trim().toLowerCase();
  if (!normalised.includes("@")) return null;

  // Match by an existing user row first — that's the source of truth for tenancy.
  const { users } = await import("@/lib/db/schema");
  const [existing] = await db
    .select({ organisationId: users.organisationId })
    .from(users)
    .where(eq(users.email, normalised))
    .limit(1);

  if (existing?.organisationId) {
    const entry = getCachedSsoByOrganisationId(existing.organisationId);
    if (entry) return entry;
  }
  return null;
}
