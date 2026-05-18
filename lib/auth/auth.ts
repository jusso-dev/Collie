import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";

import { db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";

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
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        console.info("Magic link requested", { email, url });
      },
    }),
    nextCookies(),
  ],
});

export type Auth = typeof auth;
