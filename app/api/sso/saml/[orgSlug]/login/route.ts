import { NextRequest, NextResponse } from "next/server";

import { ensureSsoCacheLoaded, getCachedSsoByOrgSlug } from "@/lib/auth/sso";
import { buildSamlLoginRedirect, SamlError } from "@/lib/auth/saml";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ orgSlug: string }> };

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to start SAML sign-in.";
  const status = error instanceof SamlError ? error.status : 500;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest, context: Context) {
  const { orgSlug } = await context.params;
  await ensureSsoCacheLoaded();

  const entry = getCachedSsoByOrgSlug(orgSlug);
  if (!entry || entry.kind !== "saml" || !entry.saml) {
    return NextResponse.json({ error: "SAML is not configured for this organisation." }, { status: 404 });
  }

  try {
    const redirectUrl = await buildSamlLoginRedirect({
      entry,
      requestUrl: request.nextUrl,
      nextPath: request.nextUrl.searchParams.get("next"),
    });
    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    return errorResponse(error);
  }
}
