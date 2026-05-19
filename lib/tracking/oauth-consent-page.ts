type ConsentProvider = "microsoft" | "google";

export type OAuthConsentPageInput = {
  token: string;
  firstName: string;
  recipientEmail: string;
  campaignName: string;
  brandName: string;
  brandColour: string;
  trainingTitle?: string | null;
  trainingDescription?: string | null;
  trainingHtml?: string | null;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeColour(value: string) {
  return /^#[0-9a-f]{3,8}$/i.test(value) || /^rgb\([0-9,\s.]+\/?[0-9.\s]*\)$/i.test(value) ? value : "#2563eb";
}

function inferProvider(input: OAuthConsentPageInput): ConsentProvider {
  const text = `${input.brandName} ${input.campaignName}`.toLowerCase();
  if (/\b(google|gmail|workspace|drive|docs|sheets)\b/.test(text)) {
    return "google";
  }
  return "microsoft";
}

function providerCopy(provider: ConsentProvider) {
  if (provider === "google") {
    return {
      title: "Sign in with Google",
      accountLabel: "Google Account",
      tenant: "Google Workspace",
      appName: "Workspace Document Sync",
      logo: '<div class="google-logo" aria-hidden="true">G</div>',
      scopes: ["Read your profile information", "View files shared with you", "Maintain access until you remove it"],
      button: "Allow",
      cancel: "Cancel",
      colour: "#1a73e8",
    };
  }

  return {
    title: "Microsoft",
    accountLabel: "Microsoft account",
    tenant: "Microsoft 365",
    appName: "Document Access",
    logo: '<div class="ms-logo" aria-hidden="true"><span></span><span></span><span></span><span></span></div>',
    scopes: ["Read your user profile", "Read files you can access", "Maintain access to data you have given it access to"],
    button: "Accept",
    cancel: "Cancel",
    colour: "#2563eb",
  };
}

function fallbackTrainingHtml() {
  return `<ul>
    <li>OAuth consent prompts can grant access without asking for your password.</li>
    <li>Check the app name, publisher, requested permissions, and whether the request was expected.</li>
    <li>Report unexpected consent prompts to your security or IT team before accepting.</li>
  </ul>`;
}

function trainingContent(input: OAuthConsentPageInput) {
  const title = input.trainingTitle || "Spotting consent-grant phishing";
  const description =
    input.trainingDescription ||
    "Attackers can use fake or malicious OAuth apps to request access to mail, files, and profile data without collecting a password.";

  return {
    title: escapeHtml(title),
    description: escapeHtml(description),
    html: input.trainingHtml?.trim() ? input.trainingHtml : fallbackTrainingHtml(),
  };
}

export function renderOAuthConsentPage(input: OAuthConsentPageInput) {
  const provider = inferProvider(input);
  const copy = providerCopy(provider);
  const brandColour = safeColour(input.brandColour);
  const escapedToken = encodeURIComponent(input.token);
  const escapedEmail = escapeHtml(input.recipientEmail);
  const escapedFirstName = escapeHtml(input.firstName);
  const escapedAppName = escapeHtml(copy.appName);
  const scopes = copy.scopes.map((scope) => `<li>${escapeHtml(scope)}</li>`).join("");

  return `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(copy.title)} consent</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; font-family: "Segoe UI", Roboto, Arial, sans-serif; background: #f6f8fb; color: #1f2937; }
      main { min-height: 100vh; display: grid; place-items: center; padding: 28px 16px; }
      .dialog { width: min(100%, 520px); background: #fff; border: 1px solid #d8dee8; box-shadow: 0 18px 55px rgba(15, 23, 42, .16); }
      .header { display: flex; align-items: center; gap: 14px; padding: 24px 28px 18px; border-bottom: 1px solid #edf0f5; }
      .ms-logo { width: 28px; height: 28px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 2px; }
      .ms-logo span:nth-child(1) { background: #f25022; }
      .ms-logo span:nth-child(2) { background: #7fba00; }
      .ms-logo span:nth-child(3) { background: #00a4ef; }
      .ms-logo span:nth-child(4) { background: #ffb900; }
      .google-logo { width: 32px; height: 32px; display: grid; place-items: center; border: 1px solid #dadce0; border-radius: 50%; color: #1a73e8; font-size: 20px; font-weight: 700; }
      .product { font-size: 18px; font-weight: 600; color: #111827; }
      .tenant { margin-top: 2px; font-size: 13px; color: #5f6b7a; }
      .content { padding: 26px 28px 10px; }
      h1 { margin: 0; font-size: 24px; line-height: 1.25; font-weight: 600; color: #111827; letter-spacing: 0; }
      p { margin: 14px 0 0; font-size: 14px; line-height: 1.55; color: #4b5563; }
      .account { margin-top: 20px; padding: 12px; border: 1px solid #d8dee8; background: #fbfcfe; display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 14px; }
      .account strong { display: block; color: #111827; font-weight: 600; }
      .account span { color: #5f6b7a; overflow-wrap: anywhere; }
      .permissions { margin: 22px 0 0; padding: 0; list-style: none; border-top: 1px solid #edf0f5; }
      .permissions li { padding: 13px 0 13px 26px; border-bottom: 1px solid #edf0f5; color: #374151; font-size: 14px; line-height: 1.45; position: relative; }
      .permissions li::before { content: ""; position: absolute; left: 1px; top: 17px; width: 13px; height: 13px; border: 2px solid ${brandColour}; border-radius: 50%; }
      .notice { margin-top: 18px; padding: 12px; border-left: 4px solid ${brandColour}; background: #f8fafc; font-size: 13px; line-height: 1.5; color: #475569; }
      .actions { display: flex; justify-content: flex-end; gap: 10px; padding: 22px 28px 26px; }
      button { min-width: 96px; border: 1px solid #cbd5e1; background: #fff; color: #111827; padding: 10px 16px; font-size: 14px; font-weight: 600; cursor: pointer; }
      button.primary { border-color: ${escapeHtml(copy.colour)}; background: ${escapeHtml(copy.colour)}; color: #fff; }
      @media (max-width: 560px) {
        main { align-items: stretch; padding: 0; }
        .dialog { min-height: 100vh; border: 0; box-shadow: none; }
        .header, .content, .actions { padding-left: 20px; padding-right: 20px; }
      }
    </style>
  </head>
  <body>
    <main>
      <form class="dialog" method="post" action="/c/${escapedToken}">
        <input type="hidden" name="scenario" value="oauth_consent" />
        <input type="hidden" name="provider" value="${provider}" />
        <input type="hidden" name="app_name" value="${escapedAppName}" />
        <input type="hidden" name="requested_scopes" value="${escapeHtml(copy.scopes.join(", "))}" />
        <div class="header">
          ${copy.logo}
          <div>
            <div class="product">${escapeHtml(copy.title)}</div>
            <div class="tenant">${escapeHtml(copy.tenant)}</div>
          </div>
        </div>
        <div class="content">
          <h1>${escapedAppName} wants access to your account</h1>
          <p>Hi ${escapedFirstName}, review the permissions requested before continuing.</p>
          <div class="account">
            <div>
              <strong>${escapeHtml(copy.accountLabel)}</strong>
              <span>${escapedEmail}</span>
            </div>
          </div>
          <ul class="permissions">${scopes}</ul>
          <div class="notice">Only accept app permissions when the app, publisher, and request are expected.</div>
        </div>
        <div class="actions">
          <button type="button">${escapeHtml(copy.cancel)}</button>
          <button class="primary" type="submit">${escapeHtml(copy.button)}</button>
        </div>
      </form>
    </main>
  </body>
</html>`;
}

export function renderOAuthConsentTrainingPage(input: OAuthConsentPageInput) {
  const training = trainingContent(input);

  return `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Consent-grant phishing training</title>
    <style>
      body { margin: 0; font-family: Inter, Arial, sans-serif; background: #f2f6fa; color: #0d1b2a; }
      main { max-width: 780px; margin: 0 auto; padding: 72px 24px; }
      .eyebrow { color: #f26a21; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      h1 { margin: 12px 0 16px; font-size: 38px; line-height: 1.08; letter-spacing: 0; }
      p, li { color: #334155; font-size: 18px; line-height: 1.6; }
      section { margin-top: 28px; padding: 22px; border: 1px solid rgb(100 116 139 / 26%); border-radius: 8px; background: #fcfdff; }
      section h2 { margin-top: 0; }
      a { color: #0d5bd7; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">Simulation training</div>
      <h1>That consent prompt was part of a phishing simulation.</h1>
      <p>No real OAuth grant was created, and no account token was issued.</p>
      <section>
        <h2>${training.title}</h2>
        <p>${training.description}</p>
        ${training.html}
      </section>
    </main>
  </body>
</html>`;
}
