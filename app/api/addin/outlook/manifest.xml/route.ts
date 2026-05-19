import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { publicAppUrl } from "@/lib/tracking/public-url";

export const dynamic = "force-dynamic";

const MANIFEST_PLACEHOLDER = "https://collie.local";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  // Allow ?host=https://my.example to override (handy when proxying).
  const hostOverride = url.searchParams.get("host");
  const appUrl = (hostOverride && /^https:\/\/[^\s]+$/i.test(hostOverride) ? hostOverride : publicAppUrl()).replace(
    /\/$/,
    "",
  );

  const manifestPath = path.join(process.cwd(), "public", "addins", "outlook", "manifest.xml");
  const raw = await readFile(manifestPath, "utf8");
  const rendered = raw.replaceAll(MANIFEST_PLACEHOLDER, appUrl);

  return new NextResponse(rendered, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": 'inline; filename="collie-outlook-manifest.xml"',
      "Cache-Control": "no-store",
    },
  });
}
