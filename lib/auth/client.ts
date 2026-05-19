"use client";

import { createAuthClient } from "better-auth/react";
import { magicLinkClient, genericOAuthClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL ?? "",
  plugins: [magicLinkClient(), genericOAuthClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
