"use client";

import { createAuthClient } from "better-auth/react";
import { genericOAuthClient, magicLinkClient, twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL ?? "",
  plugins: [
    magicLinkClient(),
    genericOAuthClient(),
    // When a sign-in response carries `twoFactorRedirect: true` the plugin's
    // fetch hook fires this callback. We send the browser to the challenge
    // page, preserving any `next` query param the user arrived with.
    twoFactorClient({
      onTwoFactorRedirect() {
        if (typeof window !== "undefined") {
          const currentNext = new URLSearchParams(window.location.search).get("next");
          const target = currentNext?.startsWith("/")
            ? `/sign-in/two-factor?next=${encodeURIComponent(currentNext)}`
            : "/sign-in/two-factor";
          window.location.href = target;
        }
      },
    }),
  ],
});

export const { signIn, signUp, signOut, useSession, twoFactor } = authClient;
