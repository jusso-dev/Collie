/**
 * Allowlist configuration helpers for phishing-simulation deliverability.
 *
 * Phishing simulation mail is otherwise blocked or rewritten by:
 *   - Microsoft 365 Defender for Office 365 (Safe Links, Safe Attachments, ZAP)
 *   - Mimecast URL Protection / Attachment Protection
 *   - Proofpoint TAP URL Defense / Click Permit
 *
 * The constants below feed the per-organisation guide rendered at
 *   /[orgSlug]/deliverability
 *
 * Snapshot dates are surfaced in the UI so administrators can tell whether
 * the documented admin-centre paths and IP ranges are still current.
 */

/**
 * Resend documented egress IP ranges for outbound SMTP.
 *
 * Source: https://resend.com/docs/dashboard/domains/ip-address
 * (Resend "Sending IP addresses" documentation — verified 05-2026.)
 *
 * These are the CIDR blocks Resend publishes for customers who need to
 * allowlist outbound sending IPs at their inbound mail gateway. Update
 * `RESEND_IP_RANGES_LAST_UPDATED` whenever the upstream list changes.
 */
export const RESEND_IP_RANGES: readonly string[] = [
  "54.240.32.0/19",
  "44.215.236.0/24",
  "44.215.237.0/24",
  "44.215.238.0/24",
  "44.215.239.0/24",
] as const;

export const RESEND_IP_RANGES_LAST_UPDATED = "2026-05" as const;

/**
 * Microsoft admin-centre / Mimecast / Proofpoint navigation paths verified
 * against the live consoles in May 2026. Surfaced in the UI so admins can
 * see when the snapshot was last reviewed.
 */
export const ADMIN_CONSOLE_PATHS_LAST_VERIFIED = "05-2026" as const;

export type AllowlistInputs = {
  /** Organisation sender domain extracted from `organisations.sender_from_address`. */
  senderDomain: string;
  /** Full sender From address, used verbatim in some provider rules. */
  senderFromAddress: string;
  /** Public app URL with no trailing slash (e.g. https://collie.example). */
  appUrl: string;
};

export type AllowlistConfig = {
  senderDomain: string;
  senderFromAddress: string;
  trackingClickPrefix: string;
  trackingPixelPrefix: string;
  trackingDomain: string;
  resendIpRanges: readonly string[];
  resendIpRangesLastUpdated: string;
  adminConsolePathsLastVerified: string;
};

/**
 * Derives all values the allowlist guide needs from organisation + env input.
 *
 * Pure — no DB or network calls, safe to render in a server component.
 */
export function buildAllowlistConfig(inputs: AllowlistInputs): AllowlistConfig {
  const appUrl = inputs.appUrl.replace(/\/$/, "");
  let trackingDomain = "";

  try {
    trackingDomain = new URL(appUrl).host;
  } catch {
    // Fall back to a sanitised string so the UI still renders if appUrl is malformed.
    trackingDomain = appUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }

  return {
    senderDomain: inputs.senderDomain,
    senderFromAddress: inputs.senderFromAddress,
    trackingClickPrefix: `${appUrl}/c/`,
    trackingPixelPrefix: `${appUrl}/p/`,
    trackingDomain,
    resendIpRanges: RESEND_IP_RANGES,
    resendIpRangesLastUpdated: RESEND_IP_RANGES_LAST_UPDATED,
    adminConsolePathsLastVerified: ADMIN_CONSOLE_PATHS_LAST_VERIFIED,
  };
}

/**
 * Extracts the right-hand side of `local@domain`, lowercased.
 * Returns null for malformed input so callers can prompt the admin to
 * configure a sender From address first.
 */
export function deriveSenderDomain(senderFromAddress: string | null | undefined): string | null {
  if (!senderFromAddress) return null;
  const at = senderFromAddress.lastIndexOf("@");
  if (at <= 0 || at === senderFromAddress.length - 1) return null;
  return senderFromAddress.slice(at + 1).trim().toLowerCase() || null;
}

/**
 * Renders the Microsoft 365 Advanced Delivery "Phishing Simulation" tab
 * payload as a single block. Administrators paste each list into the
 * Defender portal — see https://learn.microsoft.com/defender-office-365/advanced-delivery-policy-configure
 */
export function renderM365AdvancedDeliveryBlock(config: AllowlistConfig): string {
  const lines = [
    "# Microsoft 365 Advanced Delivery — Phishing Simulation",
    `# Snapshot verified ${config.adminConsolePathsLastVerified}`,
    "",
    "Sending domains:",
    `  - ${config.senderDomain}`,
    "",
    "Sending IPs (Resend egress):",
    ...config.resendIpRanges.map((range) => `  - ${range}`),
    "",
    "Simulation URLs:",
    `  - ${config.trackingClickPrefix}*`,
    `  - ${config.trackingPixelPrefix}*`,
  ];
  return lines.join("\n");
}

/**
 * PowerShell snippet for the supporting Exchange Online transport rule
 * that disables Safe Links rewriting for inbound mail from the simulation IPs.
 * See:
 *   https://learn.microsoft.com/exchange/security-and-compliance/mail-flow-rules/mail-flow-rules
 *   https://learn.microsoft.com/defender-office-365/safe-links-about
 */
export function renderM365TransportRulePowerShell(config: AllowlistConfig): string {
  const ipList = config.resendIpRanges.map((range) => `"${range}"`).join(",");
  return [
    "# Run after Connect-ExchangeOnline.",
    `# Snapshot verified ${config.adminConsolePathsLastVerified}.`,
    "New-TransportRule -Name \"Collie phishing simulation - bypass SafeLinks\" \\",
    `  -SenderIpRanges ${ipList} \\`,
    `  -FromAddressMatchesPatterns \"@${config.senderDomain}$\" \\`,
    "  -SetHeaderName \"X-MS-Exchange-Organization-SkipSafeLinksProcessing\" \\",
    "  -SetHeaderValue \"1\" \\",
    "  -StopRuleProcessing $false \\",
    "  -Mode Enforce",
  ].join("\n");
}
