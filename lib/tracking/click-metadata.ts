import { createHash } from "node:crypto";

export type ClickSource = "link" | "qr";

export type ClickDeviceDetails = {
  browser?: string;
  browserVersion?: string;
  deviceModel?: string;
  deviceType?: string;
  deviceVendor?: string;
  engine?: string;
  os?: string;
  osVersion?: string;
  cpu?: string;
  isBot?: boolean;
};

const mobileUserAgentPattern =
  /android|blackberry|iemobile|ipad|iphone|ipod|kindle|mobile|opera mini|phone|silk|tablet|webos/i;

function valueFromHeaders(headers: Headers, key: string) {
  return headers.get(key)?.trim() ?? "";
}

export function clickSourceFromSearchParams(searchParams: URLSearchParams): ClickSource {
  return searchParams.get("source") === "qr" ? "qr" : "link";
}

export function isLikelyMobileUserAgent(userAgent: string | null | undefined) {
  return mobileUserAgentPattern.test(userAgent ?? "");
}

export function fingerprintHeaders(headers: Headers) {
  return [
    valueFromHeaders(headers, "user-agent"),
    valueFromHeaders(headers, "accept-language"),
    valueFromHeaders(headers, "sec-ch-ua"),
    valueFromHeaders(headers, "sec-ch-ua-mobile"),
    valueFromHeaders(headers, "sec-ch-ua-platform"),
  ].join("\n");
}

export function deviceFingerprintFor(headers: Headers) {
  return createHash("sha256").update(fingerprintHeaders(headers)).digest("hex").slice(0, 16);
}

export function clickMetadata(input: {
  source: ClickSource;
  headers: Headers;
  device?: ClickDeviceDetails;
}) {
  const userAgent = input.headers.get("user-agent");
  return {
    source: input.source,
    mobile: isLikelyMobileUserAgent(userAgent),
    deviceFingerprint: deviceFingerprintFor(input.headers),
    device: input.device ?? {},
  };
}
