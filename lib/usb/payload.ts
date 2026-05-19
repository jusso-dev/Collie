import { publicAppUrl } from "@/lib/tracking/public-url";

export type UsbTrainingRedirectPayload = {
  filename: string;
  contentType: "text/html";
  content: string;
  metadata: {
    kind: "usb_drop";
    filename: string;
    contentType: "text/html";
    trainingRedirectUrl: string;
    stampedAt: string;
    safeSimulation: true;
  };
};

type UsbPayloadInput = {
  token: string;
  campaignName: string;
  organisationName: string;
  stampedAt?: Date;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function trainingRedirectUrl(token: string) {
  return `${publicAppUrl()}/c/${encodeURIComponent(token)}?source=usb`;
}

export function buildUsbTrainingRedirectPayload(input: UsbPayloadInput): UsbTrainingRedirectPayload {
  const stampedAt = (input.stampedAt ?? new Date()).toISOString();
  const redirectUrl = trainingRedirectUrl(input.token);
  const filename = "collie-training-redirect.html";
  const content = `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="0; url=${escapeHtml(redirectUrl)}" />
    <title>Training redirect</title>
  </head>
  <body>
    <main>
      <h1>Training redirect</h1>
      <p>This USB-drop simulation payload redirects only to Collie training.</p>
      <p><a href="${escapeHtml(redirectUrl)}">Open training</a></p>
      <p>Organisation: ${escapeHtml(input.organisationName)}</p>
      <p>Campaign: ${escapeHtml(input.campaignName)}</p>
      <p>Simulation token: ${escapeHtml(input.token)}</p>
      <p>Stamped at: ${escapeHtml(stampedAt)}</p>
    </main>
  </body>
</html>`;

  return {
    filename,
    contentType: "text/html",
    content,
    metadata: {
      kind: "usb_drop",
      filename,
      contentType: "text/html",
      trainingRedirectUrl: redirectUrl,
      stampedAt,
      safeSimulation: true,
    },
  };
}
