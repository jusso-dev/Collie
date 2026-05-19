import { expect, test } from "@playwright/test";

import { buildCampaignTrackingUrls, renderCampaignEmail } from "@/lib/email/campaign-renderer";
import { qrDataUriFor, qrMatrixFor, qrModuleSize, qrPayloadLimit, qrSvgFor } from "@/lib/email/qr";
import {
  clickMetadata,
  clickSourceFromSearchParams,
  deviceFingerprintFor,
  isLikelyMobileUserAgent,
} from "@/lib/tracking/click-metadata";

test("QR renderer exposes source-tagged QR placeholders", () => {
  const urls = buildCampaignTrackingUrls("token-123");
  expect(urls.clickUrl).toMatch(/\/c\/token-123$/);
  expect(urls.qrUrl).toMatch(/\/c\/token-123\?source=qr$/);

  const rendered = renderCampaignEmail({
    organisationName: "Example Org",
    template: {
      subject: "Scan {{qrUrl}}",
      htmlBody: "<div>{{qrCode}}</div><a href=\"{{trackingQrUrl}}\">QR</a>",
      textBody: "QR: {{qrUrl}}",
    },
    employee: {
      email: "ari@example.test",
      firstName: "Ari",
      lastName: "Nguyen",
      department: "Finance",
    },
    token: "token-123",
  });

  expect(rendered.qrUrl).toBe(urls.qrUrl);
  expect(rendered.subject).toContain("?source=qr");
  expect(rendered.html).toContain("data:image/svg+xml");
  expect(rendered.html).toContain("?source=qr");
  expect(rendered.text).toContain("?source=qr");
});

test("QR SVG/data URI generation produces a stable version 8 matrix", () => {
  const payload = "https://mail.example.test/c/token-123?source=qr";
  const matrix = qrMatrixFor(payload);
  const svg = qrSvgFor(payload);
  const dataUri = qrDataUriFor(payload);

  expect(matrix).toHaveLength(qrModuleSize);
  expect(matrix[0]).toHaveLength(qrModuleSize);
  expect(svg).toContain(`viewBox="0 0 ${qrModuleSize + 8} ${qrModuleSize + 8}"`);
  expect(svg).toContain("shape-rendering=\"crispEdges\"");
  expect(dataUri).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
});

test("QR encoder rejects oversized payloads clearly", () => {
  expect(() => qrSvgFor("x".repeat(qrPayloadLimit + 1))).toThrow(/payload is too long/i);
});

test("QR click metadata records source, mobile heuristic, and fingerprint", () => {
  const mobileUserAgent =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
  const headers = new Headers({
    "user-agent": mobileUserAgent,
    "accept-language": "en-AU,en;q=0.9",
    "sec-ch-ua-mobile": "?1",
  });

  expect(clickSourceFromSearchParams(new URLSearchParams("source=qr"))).toBe("qr");
  expect(clickSourceFromSearchParams(new URLSearchParams("source=email"))).toBe("link");
  expect(isLikelyMobileUserAgent(mobileUserAgent)).toBe(true);
  expect(deviceFingerprintFor(headers)).toHaveLength(16);
  expect(clickMetadata({ source: "qr", headers })).toMatchObject({
    source: "qr",
    mobile: true,
  });
});
