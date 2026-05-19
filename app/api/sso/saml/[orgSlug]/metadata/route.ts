import { NextRequest, NextResponse } from "next/server";

import { buildSpMetadataXml, SamlError } from "@/lib/auth/saml";
import { ensureSsoCacheLoaded, getCachedSsoByOrgSlug } from "@/lib/auth/sso";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ orgSlug: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { orgSlug } = await context.params;
  await ensureSsoCacheLoaded();

  const entry = getCachedSsoByOrgSlug(orgSlug);
  if (!entry || entry.kind !== "saml" || !entry.saml) {
    return NextResponse.json({ error: "SAML is not configured for this organisation." }, { status: 404 });
  }

  try {
    const sloUrl = new URL(`/api/sso/saml/${encodeURIComponent(orgSlug)}/slo`, request.nextUrl.origin).toString();
    return new NextResponse(buildSpMetadataXml(entry, sloUrl), {
      headers: {
        "content-type": "application/samlmetadata+xml; charset=utf-8",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate SAML metadata.";
    const status = error instanceof SamlError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
