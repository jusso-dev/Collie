import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink, genericOAuth } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { createAuthMiddleware, APIError } from "better-auth/api";

import { db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import {
  buildOidcConfigsForBetterAuth,
  ensureSsoCacheLoaded,
  lookupTenantForEmail,
} from "@/lib/auth/sso";

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
      // The OIDC and magic-link flows use different endpoints, so this only
      // catches `/sign-in/email`.
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
  },
  plugins: [
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

// Side-effect: warm the in-memory SSO cache as soon as this module is imported
// at runtime. We skip during `next build` (no DB) and during static-page render.
if (process.env.NODE_ENV !== "test" && process.env.NEXT_PHASE !== "phase-production-build") {
  void ensureSsoCacheLoaded().catch((error) => {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      console.error("Failed to warm SSO cache", error);
    }
  });
}
