/**
 * Heuristics for distinguishing real human opens/clicks from
 * pre-fetchers like Apple Mail Privacy Protection (MPP), iCloud
 * Private Relay, headless browsers, and security-gateway URL scanners.
 *
 * Both Apple's MPP and most SEG link rewriters fetch tracking pixels and
 * click URLs before the recipient ever sees the message. Without
 * suppression they pollute open/click metrics and create false
 * "clicked_at" timestamps on campaign targets. We tag the underlying
 * events with `unverified: true` / `bot: true` so they remain available
 * for forensics, but we skip the `campaignTargets.openedAt` /
 * `clickedAt` write so dashboards only reflect human action.
 */

import { isIP } from "node:net";

const HEADLESS_PATTERNS = [
  /headlesschrome/i,
  /phantomjs/i,
  /slimerjs/i,
  /htmlunit/i,
  /puppeteer/i,
  /playwright/i,
  /selenium/i,
];

const SCANNER_AND_LIBRARY_PATTERNS = [
  /^curl\//i,
  /\bwget\//i,
  /python-requests/i,
  /python-urllib/i,
  /go-http-client/i,
  /okhttp/i,
  /java\/[0-9]/i,
  /node-fetch/i,
  /libwww-perl/i,
  /apachehttpclient/i,
  /^facebookexternalhit/i,
  /\bbingpreview\b/i,
  /\bslackbot\b/i,
  /\blinkpreview\b/i,
  /\burlresolver\b/i,
  /\burldefense\b/i,
  /proofpoint/i,
  /mimecast/i,
  /barracuda/i,
  /symantec/i,
  /\bbot\b/i,
  /\bcrawler\b/i,
  /\bspider\b/i,
];

const APPLE_MAIL_UA_PATTERN =
  /\bAppleWebKit\/[0-9.]+\s+\(KHTML, like Gecko\)\s*$/i;

/**
 * Conservative list of iCloud Private Relay egress CIDRs published by
 * Apple. The authoritative list lives at
 * https://mask-api.icloud.com/egress-ip-ranges.csv and changes regularly;
 * operators can refresh `APPLE_PRIVATE_RELAY_RANGES` from that CSV.
 * Until then, the snapshot below covers the most common ranges and is
 * better than the no-suppression baseline.
 */
const APPLE_PRIVATE_RELAY_RANGES_V4: ReadonlyArray<readonly [number, number]> = [
  parseCidrV4("172.224.224.0/24"),
  parseCidrV4("172.225.225.0/24"),
  parseCidrV4("104.28.0.0/14"),
  parseCidrV4("17.0.0.0/8"),
];

function parseCidrV4(cidr: string): readonly [number, number] {
  const [base, prefixStr] = cidr.split("/");
  const prefix = Number(prefixStr);
  const octets = base.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((value) => Number.isNaN(value))) {
    return [0, 0];
  }
  const ipInt =
    ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return [ipInt & mask, mask];
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((value) => Number.isNaN(value) || value < 0 || value > 255)) {
    return null;
  }
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

export function pickClientIp(forwarded: string | null | undefined): string | null {
  if (!forwarded) return null;
  const first = forwarded.split(",")[0]?.trim();
  return first && isIP(first) ? first : null;
}

export function isApplePrivacyRelayIp(ip: string | null | undefined): boolean {
  if (!ip || isIP(ip) !== 4) return false;
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  for (const [base, mask] of APPLE_PRIVATE_RELAY_RANGES_V4) {
    if ((value & mask) === base) return true;
  }
  return false;
}

export type MppDetection = {
  unverified: boolean;
  reason: string | null;
};

export function detectAppleMailPrivacyProtection(input: {
  userAgent: string | null | undefined;
  ip: string | null | undefined;
}): MppDetection {
  const ua = input.userAgent ?? "";
  if (isApplePrivacyRelayIp(input.ip)) {
    return { unverified: true, reason: "apple_private_relay_ip" };
  }
  if (APPLE_MAIL_UA_PATTERN.test(ua)) {
    return { unverified: true, reason: "apple_mail_ua" };
  }
  return { unverified: false, reason: null };
}

export type BotDetection = {
  bot: boolean;
  reason: string | null;
};

/**
 * Sends from a security gateway frequently fire within hundreds of ms of
 * the send completing. Any click that arrives faster than `prefetchMs`
 * (default 1500 ms) after `sentAt` is almost certainly a scanner.
 */
const DEFAULT_PREFETCH_MS = 1500;

export function detectBotClick(input: {
  userAgent: string | null | undefined;
  method: string;
  isBot?: boolean | undefined;
  sentAt?: Date | string | null | undefined;
  now?: Date;
  prefetchMs?: number;
}): BotDetection {
  const ua = input.userAgent ?? "";
  const method = (input.method ?? "GET").toUpperCase();

  if (method === "HEAD") {
    return { bot: true, reason: "head_request" };
  }
  if (input.isBot) {
    return { bot: true, reason: "ua_isbot" };
  }
  for (const pattern of HEADLESS_PATTERNS) {
    if (pattern.test(ua)) return { bot: true, reason: "headless_ua" };
  }
  for (const pattern of SCANNER_AND_LIBRARY_PATTERNS) {
    if (pattern.test(ua)) return { bot: true, reason: "scanner_ua" };
  }
  if (input.sentAt) {
    const sentAtDate = input.sentAt instanceof Date ? input.sentAt : new Date(input.sentAt);
    const now = input.now ?? new Date();
    const delta = now.getTime() - sentAtDate.getTime();
    const prefetchMs = input.prefetchMs ?? DEFAULT_PREFETCH_MS;
    if (Number.isFinite(delta) && delta >= 0 && delta < prefetchMs) {
      return { bot: true, reason: "prefetch_window" };
    }
  }
  return { bot: false, reason: null };
}
