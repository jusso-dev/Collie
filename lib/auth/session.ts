import { headers } from "next/headers";

import { auth } from "@/lib/auth/auth";

export async function getSession() {
  const hdrs = await headers();
  return auth.api.getSession({ headers: hdrs });
}

export async function requireSession() {
  const session = await getSession();

  if (!session) {
    throw new AuthRequiredAtRouteError();
  }

  return session;
}

export class AuthRequiredAtRouteError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "AuthRequiredAtRouteError";
  }
}
