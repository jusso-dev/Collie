import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { symmetricEncrypt } from "better-auth/crypto";
import { magicLink, genericOAuth, twoFactor } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import {
  buildOidcConfigsForBetterAuth,
  ensureSsoCacheLoaded,
  lookupTenantForEmail,
} from "@/lib/auth/sso";
import { openTotpSecret } from "@/lib/auth/totp";

/**
 * Per-tenant OIDC configurations live in Postgres so they can be managed
 * through the Settings UI. The genericOAuth plugin reads its providers from
 * `options.config` — `.find()` is invoked on every sign-in/callback, so a
 * Proxy backed by the in-memory cache lets us serve dynamic per-tenant configs
 * without restarting the server.
 */
const ssoConfigProxy = new Proxy([] as ReturnType<typeof buildOidcConfigsForBetterAuth>, {
  get(_target, prop) {
    if (prop === "find") {
      return (predicate: (config: ReturnType<typeof buildOidcConfigsForBetterAuth>[number]) => boolean) =>
        buildOidcConfigsForBetterAuth().find(predicate);
    }
    if (prop === "map") {
      return (mapper: (config: ReturnType<typeof buildOidcConfigsForBetterAuth>[number]) => unknown) =>
        buildOidcConfigsForBetterAuth().map(mapper);
    }
    if (prop === "filter") {
      return (predicate: (config: ReturnType<typeof buildOidcConfigsForBetterAuth>[number]) => boolean) =>
        buildOidcConfigsForBetterAuth().filter(predicate);
    }
    if (prop === "length") {
      return buildOidcConfigsForBetterAuth().length;
    }
    if (prop === Symbol.iterator) {
      const snapshot = buildOidcConfigsForBetterAuth();
      return snapshot[Symbol.iterator].bind(snapshot);
    }
    return Reflect.get([], prop);
  },
});

/**
 * Eager legacy-to-plugin migration. Users who enrolled via the pre-#27 TOTP
 * flow have `mfaEnabled=true` + `totpSecretEncrypted` set but no `two_factors`
 * row. On their next password sign-in we move the secret into the plugin's
 * table and flip `twoFactorEnabled=true` so the plugin's own after-hook (which
 * runs immediately after ours) issues the standard 2FA challenge.
 */
async function migrateLegacyTotpUser(
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
): Promise<void> {
  if (ctx.path !== "/sign-in/email" && ctx.path !== "/sign-in/username") return;
  const data = ctx.context.newSession;
  if (!data) return;
  if (data.user.twoFactorEnabled) return;

  const [row] = await db
    .select({
      id: schema.users.id,
      mfaEnabled: schema.users.mfaEnabled,
      totpSecretEncrypted: schema.users.totpSecretEncrypted,
    })
    .from(schema.users)
    .where(eq(schema.users.id, data.user.id))
    .limit(1);

  if (!row || !row.mfaEnabled || !row.totpSecretEncrypted) return;

  let legacySecret: string;
  try {
    legacySecret = openTotpSecret(row.totpSecretEncrypted);
  } catch (err) {
    console.error("MFA legacy migration failed: could not unseal TOTP secret", {
      userId: row.id,
      cause: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const encryptedSecret = await symmetricEncrypt({
    key: ctx.context.secretConfig,
    data: legacySecret,
  });

  await db.transaction(async (tx) => {
    await tx.delete(schema.twoFactors).where(eq(schema.twoFactors.userId, row.id));
    await tx.insert(schema.twoFactors).values({
      userId: row.id,
      secret: encryptedSecret,
      backupCodes: "",
      verified: true,
    });
    await tx
      .update(schema.users)
      .set({
        twoFactorEnabled: true,
        totpSecretEncrypted: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, row.id));
  });

  data.user.twoFactorEnabled = true;
}

export const auth = betterAuth({
  appName: "Collie",
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-only-collie-secret-change-me",
  baseURL: process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
    usePlural: true,
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 10,
  },
  user: {
    additionalFields: {
      organisationId: {
        type: "string",
        required: false,
        input: true,
      },
      role: {
        type: "string",
        required: false,
        input: true,
      },
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      // OIDC tenants own their email verification — trust the IdP and skip
      // requiring the local user to be email-verified before linking.
      requireLocalEmailVerified: false,
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Block password sign-in when the tenant has SSO enforcement enabled.
      if (ctx.path !== "/sign-in/email") return;
      const email =
        ctx.body && typeof ctx.body === "object" && "email" in ctx.body
          ? String((ctx.body as { email?: unknown }).email ?? "")
          : "";
      if (!email) return;

      const tenant = await lookupTenantForEmail(email);
      if (tenant?.enforceSso) {
        throw new APIError("FORBIDDEN", {
          code: "SSO_REQUIRED",
          message: "Single sign-on is required for this organisation. Use your SSO link to sign in.",
        });
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      await migrateLegacyTotpUser(ctx);
    }),
  },
  plugins: [
    twoFactor({
      issuer: "Collie",
    }),
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        console.info("Magic link requested", { email, url });
      },
    }),
    genericOAuth({
      config: ssoConfigProxy,
    }),
    nextCookies(),
  ],
});

export type Auth = typeof auth;

// Side-effect: warm the in-memory SSO cache as soon as this module is imported.
if (process.env.NODE_ENV !== "test" && process.env.NEXT_PHASE !== "phase-production-build") {
  void ensureSsoCacheLoaded().catch((error) => {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      console.error("Failed to warm SSO cache", error);
    }
  });
}
