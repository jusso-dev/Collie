import { NextRequest, NextResponse } from "next/server";

import {
  attachSessionCookie,
  decodeRelayState,
  parseAndVerifySamlResponse,
  provisionSamlUserAndSession,
  SamlError,
} from "@/lib/auth/saml";
import { ensureSsoCacheLoaded, getCachedSsoByOrgSlug } from "@/lib/auth/sso";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ orgSlug: string }> };

function redirectWithError(request: NextRequest, message: string) {
  const url = new URL("/signin", request.nextUrl.origin);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url);
}

export async function POST(request: NextRequest, context: Context) {
  const { orgSlug } = await context.params;
  await ensureSsoCacheLoaded();

  const entry = getCachedSsoByOrgSlug(orgSlug);
  if (!entry || entry.kind !== "saml" || !entry.saml) {
    return redirectWithError(request, "SAML is not configured for this organisation.");
  }

  const form = await request.formData().catch(() => null);
  const samlResponse = form?.get("SAMLResponse");
  const relayStateValue = form?.get("RelayState");
  if (typeof samlResponse !== "string") {
    return redirectWithError(request, "The SAML response was missing.");
  }

  try {
    const relayState = decodeRelayState(typeof relayStateValue === "string" ? relayStateValue : null);
    const profile = await parseAndVerifySamlResponse({ samlResponse, entry, relayState });
    const session = await provisionSamlUserAndSession({ request, entry, profile });
    const response = NextResponse.redirect(new URL(relayState?.next ?? "/dashboard", request.nextUrl.origin));
    attachSessionCookie(response, session.token, request.nextUrl);
    return response;
  } catch (error) {
    console.warn("SAML ACS failed", {
      orgSlug,
      code: error instanceof SamlError ? error.code : "SAML_ACS_FAILED",
      message: error instanceof Error ? error.message : String(error),
    });
    return redirectWithError(request, error instanceof Error ? error.message : "Unable to complete SAML sign-in.");
  }
}

export async function GET() {
  return NextResponse.json({ error: "SAML ACS expects an HTTP POST." }, { status: 405 });
}
