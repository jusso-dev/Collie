function inboundDomain() {
  return process.env.NEXT_PUBLIC_INBOUND_EMAIL_DOMAIN?.trim() || "collie-reports.local";
}

function safeMailboxPart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/^-+|-+$/g, "") || "organisation";
}

export function buildCampaignReportAddress(token: string) {
  return `report+${token}@${inboundDomain()}`;
}

export function buildOrganisationReportAddress(orgSlug: string) {
  return `reports+${safeMailboxPart(orgSlug)}@${inboundDomain()}`;
}

export function buildReportMarker(token: string) {
  return `collie-token:${token}`;
}
