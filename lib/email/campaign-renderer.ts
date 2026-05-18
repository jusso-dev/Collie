import { buildCampaignReportAddress, buildReportMarker } from "@/lib/email/reporting";
import { publicAppUrl } from "@/lib/tracking/public-url";

type TemplateLike = {
  subject: string;
  htmlBody: string;
  textBody: string;
};

type EmployeeLike = {
  email: string;
  firstName: string;
  lastName: string;
  department?: string | null;
};

function appBaseUrl() {
  return publicAppUrl();
}

function replaceTokens(value: string, tokens: Record<string, string>) {
  return Object.entries(tokens).reduce(
    (output, [key, tokenValue]) => output.replaceAll(`{{${key}}}`, tokenValue),
    value,
  );
}

export function buildCampaignTrackingUrls(token: string) {
  const baseUrl = appBaseUrl();

  return {
    clickUrl: `${baseUrl}/c/${token}`,
    pixelUrl: `${baseUrl}/p/${token}.gif`,
    reportUrl: `${baseUrl}/api/report`,
    replyAddress: buildCampaignReportAddress(token),
  };
}

export function renderCampaignEmail(input: {
  organisationName: string;
  template: TemplateLike;
  employee: EmployeeLike;
  token: string;
}) {
  const urls = buildCampaignTrackingUrls(input.token);
  const tokens = {
    organisationName: input.organisationName,
    firstName: input.employee.firstName,
    lastName: input.employee.lastName,
    fullName: `${input.employee.firstName} ${input.employee.lastName}`.trim(),
    recipientEmail: input.employee.email,
    department: input.employee.department ?? "",
    trackingUrl: urls.clickUrl,
    trackingPixel: `<img src="${urls.pixelUrl}" width="1" height="1" alt="" style="display:none;border:0;height:1px;width:1px" />`,
    reportUrl: urls.reportUrl,
    replyAddress: urls.replyAddress,
    token: input.token,
    reportMarker: buildReportMarker(input.token),
  };

  const subject = replaceTokens(input.template.subject, tokens);
  let html = replaceTokens(input.template.htmlBody, tokens);
  const text = replaceTokens(input.template.textBody, tokens);

  if (!html.includes(urls.pixelUrl)) {
    html = `${html}\n${tokens.trackingPixel}`;
  }

  if (!html.includes(tokens.reportMarker)) {
    html = `${html}\n<!-- ${tokens.reportMarker} -->`;
  }

  return {
    subject,
    html,
    text: text.includes(tokens.reportMarker) ? text : `${text}\n\nReport marker: ${tokens.reportMarker}`,
    headers: {
      "X-Collie-Token": input.token,
      "X-Collie-Recipient": input.employee.email,
    },
    ...urls,
  };
}
