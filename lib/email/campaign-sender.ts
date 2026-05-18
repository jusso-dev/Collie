import { Resend } from "resend";

import { renderCampaignEmail } from "@/lib/email/campaign-renderer";

type CampaignSendInput = {
  apiKey: string;
  from: string;
  organisationName: string;
  template: {
    subject: string;
    htmlBody: string;
    textBody: string;
  };
  employee: {
    email: string;
    firstName: string;
    lastName: string;
    department?: string | null;
  };
  token: string;
};

export async function sendCampaignEmail(input: CampaignSendInput) {
  const rendered = renderCampaignEmail({
    organisationName: input.organisationName,
    template: input.template,
    employee: input.employee,
    token: input.token,
  });

  const resend = new Resend(input.apiKey);
  const response = await resend.emails.send({
    from: input.from,
    to: input.employee.email,
    replyTo: rendered.replyAddress,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    headers: rendered.headers,
  });

  if (response.error) {
    throw new Error(response.error.message);
  }

  return {
    messageId: response.data?.id ?? null,
    ...rendered,
  };
}
