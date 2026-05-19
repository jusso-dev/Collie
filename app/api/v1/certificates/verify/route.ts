import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { verifyCertificatePackage } from "@/lib/training/certificates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const verificationSchema = z.object({
  certificate: z.unknown(),
  signature: z.string().min(32),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = verificationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Expected { certificate, signature }." },
      { status: 400 },
    );
  }

  const result = await verifyCertificatePackage(parsed.data);

  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }

  return NextResponse.json(result);
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    documentation: "POST { certificate: <certificate JSON>, signature: <base64url Ed25519 signature> }",
  });
}
