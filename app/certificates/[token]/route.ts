import { NextResponse, type NextRequest } from "next/server";

import { certificatePackageForDownloadToken, renderCertificatePdf } from "@/lib/training/certificates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const pkg = await certificatePackageForDownloadToken(token);

  if (!pkg) {
    return NextResponse.json({ error: "Certificate download token is invalid or revoked." }, { status: 404 });
  }

  if (request.nextUrl.searchParams.get("format") === "json") {
    return NextResponse.json(pkg, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  const pdf = renderCertificatePdf(pkg);

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `inline; filename="collie-certificate-${pkg.certificate.certificateId}.pdf"`,
      "Content-Length": pdf.byteLength.toString(),
      "Content-Type": "application/pdf",
    },
  });
}
