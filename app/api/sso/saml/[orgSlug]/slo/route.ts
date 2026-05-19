import { NextRequest, NextResponse } from "next/server";

import { clearSamlSession } from "@/lib/auth/saml";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function logout(request: NextRequest) {
  const target = new URL("/signin", request.nextUrl.origin);
  const response = NextResponse.redirect(target);
  await clearSamlSession(request, response, request.nextUrl);
  return response;
}

export async function GET(request: NextRequest) {
  return logout(request);
}

export async function POST(request: NextRequest) {
  return logout(request);
}
