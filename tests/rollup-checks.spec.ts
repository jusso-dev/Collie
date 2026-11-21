import { expect, test } from "@playwright/test";

import { purgeAuditLogsForOrganisation } from "@/lib/audit/purge";
import { openTotpSecret, sealTotpSecret } from "@/lib/auth/totp";
import { getTransportForOrganisation } from "@/lib/email/campaign-sender";
import {
  detectAppleMailPrivacyProtection,
  detectBotClick,
  isApplePrivacyRelayIp,
  pickClientIp,
} from "@/lib/tracking/bot-detection";

test("bot-detection identifies Apple MPP UAs, relay CIDRs, and IPv4-mapped IPv6", () => {
  expect(pickClientIp("172.224.224.10, 10.0.0.1")).toBe("172.224.224.10");
  expect(pickClientIp("::ffff:17.58.10.1, 10.0.0.1")).toBe("17.58.10.1");
  expect(pickClientIp("[::ffff:104.28.1.5]:443")).toBe("104.28.1.5");
  expect(pickClientIp("203.0.113.5:54321")).toBe("203.0.113.5");
  expect(pickClientIp("not-an-ip")).toBeNull();

  expect(isApplePrivacyRelayIp("172.224.224.42")).toBe(true);
  expect(isApplePrivacyRelayIp("::ffff:17.1.2.3")).toBe(true);
  expect(isApplePrivacyRelayIp("203.0.113.42")).toBe(false);

  expect(
    detectAppleMailPrivacyProtection({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
      ip: "203.0.113.42",
    }),
  ).toEqual({ unverified: true, reason: "apple_mail_ua" });

  expect(
    detectAppleMailPrivacyProtection({
      userAgent: "Mozilla/5.0",
      ip: "203.0.113.42",
    }),
  ).toEqual({ unverified: true, reason: "apple_mail_ua" });

  expect(
    detectAppleMailPrivacyProtection({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      ip: "203.0.113.42",
      method: "HEAD",
    }),
  ).toEqual({ unverified: true, reason: "head_request" });

  expect(
    detectAppleMailPrivacyProtection({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      ip: "203.0.113.42",
      method: "GET",
    }),
  ).toEqual({ unverified: false, reason: null });
});

test("bot-detection identifies HEAD, scanner UAs, headless UAs, and prefetch-window clicks", () => {
  const sentAt = new Date("2026-05-23T12:00:00.000Z");

  expect(
    detectBotClick({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0",
      method: "HEAD",
      sentAt,
      now: new Date("2026-05-23T12:05:00.000Z"),
    }),
  ).toEqual({ bot: true, reason: "head_request" });

  expect(
    detectBotClick({
      userAgent: "Mozilla/5.0 Proofpoint URLDefense/1.0",
      method: "GET",
      sentAt,
      now: new Date("2026-05-23T12:05:00.000Z"),
    }),
  ).toEqual({ bot: true, reason: "scanner_ua" });

  expect(
    detectBotClick({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/125.0.0.0",
      method: "GET",
      sentAt,
      now: new Date("2026-05-23T12:05:00.000Z"),
    }),
  ).toEqual({ bot: true, reason: "headless_ua" });

  expect(
    detectBotClick({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0",
      method: "GET",
      sentAt,
      now: new Date("2026-05-23T12:00:00.800Z"),
    }),
  ).toEqual({ bot: true, reason: "prefetch_window" });

  expect(
    detectBotClick({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0",
      method: "GET",
      sentAt,
      now: new Date("2026-05-23T12:00:10.000Z"),
    }),
  ).toEqual({ bot: false, reason: null });
});

test("Resend transport fails closed on unsealed or malformed keys and accepts sealed keys", async () => {
  const sealed = sealTotpSecret("re_test_valid_key_123456");
  expect(openTotpSecret(sealed)).toBe("re_test_valid_key_123456");

  const transport = getTransportForOrganisation({
    name: "Acme",
    sendingTransport: "resend",
    senderFromAddress: "security@example.test",
    resendApiKeyEncrypted: sealed,
    smtpHost: null,
    smtpPort: null,
    smtpUsernameEncrypted: null,
    smtpPasswordEncrypted: null,
    smtpSecure: true,
    smtpFromAddress: null,
  });
  await expect(transport.verify()).resolves.toBeUndefined();

  expect(() =>
    getTransportForOrganisation({
      name: "Acme",
      sendingTransport: "resend",
      senderFromAddress: "security@example.test",
      resendApiKeyEncrypted: "re_plaintext_legacy_key",
      smtpHost: null,
      smtpPort: null,
      smtpUsernameEncrypted: null,
      smtpPasswordEncrypted: null,
      smtpSecure: true,
      smtpFromAddress: null,
    }),
  ).toThrow();

  expect(() => openTotpSecret("short")).toThrow(/malformed/i);
});

test("purgeAuditLogsForOrganisation rejects invalid retentionDays or batchSize before touching DB", async () => {
  await expect(purgeAuditLogsForOrganisation("org-1", 0)).rejects.toThrow(/retentionDays/i);
  await expect(purgeAuditLogsForOrganisation("org-1", -7)).rejects.toThrow(/retentionDays/i);
  await expect(purgeAuditLogsForOrganisation("org-1", Number.NaN)).rejects.toThrow(/retentionDays/i);
  await expect(purgeAuditLogsForOrganisation("org-1", 30, { batchSize: 0 })).rejects.toThrow(/batchSize/i);
});
