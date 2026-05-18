import { NextRequest } from "next/server";

import { recordTrackingEvent } from "@/lib/tracking/record-event";

const transparentGif = Uint8Array.from([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 33, 249,
  4, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59,
]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string[] }> },
) {
  const { token } = await params;
  const trackingToken = token.join("/").replace(/\.gif$/, "");

  await recordTrackingEvent({
    token: trackingToken,
    eventType: "opened",
    ipAddress: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  });

  return new Response(transparentGif, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
