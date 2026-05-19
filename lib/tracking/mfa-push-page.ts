type MfaPushOutcome = "approved" | "reported";

export type MfaPushPageContext = {
  firstName: string;
  email: string;
  campaignName: string;
  brandName: string;
  brandInitial: string;
  brandColour: string;
  brandLogo: string;
  trainingTitle: string;
  trainingDescription: string;
  trainingHtml: string;
  outcome?: MfaPushOutcome;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function outcomeCopy(outcome: MfaPushOutcome) {
  if (outcome === "approved") {
    return {
      title: "That approval deserved a pause.",
      lead:
        "This was an MFA fatigue simulation. A real attacker may already know a password and keep sending prompts until someone approves one.",
      callout: "Treat unexpected MFA prompts as a sign-in attempt you did not start. Deny it, then report it.",
    };
  }

  return {
    title: "Good call: deny and report unexpected prompts.",
    lead:
      "This was an MFA fatigue simulation. Denying an unexpected prompt limits access, and reporting it gives your security team a chance to respond.",
    callout: "The safest response is to deny the prompt, report it, and change your password if you think it was exposed.",
  };
}

export function renderMfaPushPage(context: MfaPushPageContext) {
  const brandName = escapeHtml(context.brandName);
  const firstName = escapeHtml(context.firstName);
  const email = escapeHtml(context.email);
  const campaignName = escapeHtml(context.campaignName);
  const brandInitial = escapeHtml(context.brandInitial);
  const brandColour = context.brandColour;
  const trainingTitle = escapeHtml(context.trainingTitle);
  const trainingDescription = escapeHtml(context.trainingDescription);
  const promptRows = [
    { time: "Just now", location: "Sydney, AU", status: "Waiting for response" },
    { time: "2 min ago", location: "Sydney, AU", status: "Prompt resent" },
    { time: "4 min ago", location: "Melbourne, AU", status: "Unanswered" },
  ];

  const body = context.outcome
    ? (() => {
        const copy = outcomeCopy(context.outcome);

        return `<section class="lesson" aria-labelledby="lesson-title">
          <div class="eyebrow">Simulation training</div>
          <h1 id="lesson-title">${escapeHtml(copy.title)}</h1>
          <p class="lead">${escapeHtml(copy.lead)}</p>
          <div class="teaching-point">
            <strong>${escapeHtml(copy.callout)}</strong>
            <p>${trainingDescription}</p>
          </div>
          ${
            context.trainingHtml
              ? `<div class="training-content" aria-label="${trainingTitle}">${context.trainingHtml}</div>`
              : ""
          }
        </section>`;
      })()
    : `<section class="simulator" aria-labelledby="mfa-title">
        <div class="device" aria-label="MFA approval prompt">
          <div class="device-bar">
            <span>9:41</span>
            <span class="pill">SecureID</span>
          </div>
          <div class="push-card">
            <div class="app-mark" aria-hidden="true">${brandInitial}</div>
            <p class="caption">${brandName} sign-in request</p>
            <h1 id="mfa-title">Approve sign-in?</h1>
            <dl>
              <div><dt>Account</dt><dd>${email}</dd></div>
              <div><dt>Location</dt><dd>Sydney, AU</dd></div>
              <div><dt>Request</dt><dd>${campaignName}</dd></div>
            </dl>
            <form method="post" class="actions">
              <input type="hidden" name="scenario" value="mfa_fatigue" />
              <button class="approve" type="submit" name="mfaAction" value="approve">Approve</button>
              <button class="deny" type="submit" name="mfaAction" value="deny">Deny</button>
            </form>
            <form method="post">
              <input type="hidden" name="scenario" value="mfa_fatigue" />
              <button class="report" type="submit" name="mfaAction" value="report">Report unexpected prompt</button>
            </form>
          </div>
        </div>
        <aside class="context-panel" aria-label="Recent prompt sequence">
          <div class="brand">${context.brandLogo}<strong>${brandName}</strong></div>
          <p class="eyebrow">Repeated MFA prompts</p>
          <h2>${firstName}, confirm whether this sign-in was yours.</h2>
          <div class="prompt-list">
            ${promptRows
              .map(
                (row) => `<div class="prompt-row">
                  <span>${escapeHtml(row.time)}</span>
                  <strong>${escapeHtml(row.status)}</strong>
                  <small>${escapeHtml(row.location)}</small>
                </div>`,
              )
              .join("")}
          </div>
        </aside>
      </section>`;

  return `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${context.outcome ? "MFA fatigue training" : "Approve sign-in?"}</title>
    <style>
      :root {
        color-scheme: light;
        --ink: oklch(22% 0.036 252);
        --muted: oklch(48% 0.032 252);
        --surface: oklch(99% 0.006 252);
        --cloud: oklch(96% 0.015 246);
        --line: oklch(86% 0.018 246);
        --accent: ${brandColour};
        --safe: oklch(48% 0.13 145);
        --attention: oklch(64% 0.18 45);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--cloud);
        color: var(--ink);
      }
      main {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 32px 18px;
      }
      .simulator {
        width: min(960px, 100%);
        display: grid;
        grid-template-columns: minmax(300px, 390px) minmax(280px, 1fr);
        gap: 28px;
        align-items: center;
      }
      .device {
        border: 1px solid oklch(18% 0.02 252);
        border-radius: 34px;
        background: oklch(18% 0.02 252);
        padding: 12px;
        box-shadow: 0 24px 70px rgb(13 27 42 / 20%);
      }
      .device-bar {
        display: flex;
        justify-content: space-between;
        color: oklch(96% 0.01 252);
        font-size: 13px;
        padding: 10px 16px 12px;
      }
      .pill {
        border: 1px solid rgb(252 253 255 / 18%);
        border-radius: 999px;
        padding: 2px 8px;
      }
      .push-card {
        border-radius: 24px;
        background: var(--surface);
        padding: 26px;
      }
      .app-mark, .brand-mark {
        width: 44px;
        height: 44px;
        display: grid;
        place-items: center;
        border-radius: 10px;
        background: var(--accent);
        color: oklch(99% 0.006 252);
        font-weight: 800;
      }
      .caption, .eyebrow {
        margin: 16px 0 8px;
        color: var(--attention);
        font-size: 12px;
        font-weight: 800;
        letter-spacing: .08em;
        text-transform: uppercase;
      }
      h1, h2, p { margin-top: 0; }
      h1 {
        margin-bottom: 22px;
        font-size: 34px;
        line-height: 1.08;
        letter-spacing: 0;
      }
      h2 {
        max-width: 16ch;
        font-size: 30px;
        line-height: 1.12;
        letter-spacing: 0;
      }
      dl {
        display: grid;
        gap: 12px;
        margin: 0 0 22px;
      }
      dl div {
        display: flex;
        justify-content: space-between;
        gap: 18px;
        border-bottom: 1px solid var(--line);
        padding-bottom: 10px;
      }
      dt {
        color: var(--muted);
        font-size: 13px;
        font-weight: 650;
      }
      dd {
        margin: 0;
        text-align: right;
        font-size: 13px;
        font-weight: 700;
      }
      .actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      button {
        width: 100%;
        min-height: 44px;
        border: 1px solid transparent;
        border-radius: 8px;
        font: inherit;
        font-weight: 750;
        cursor: pointer;
      }
      button:focus-visible {
        outline: 3px solid oklch(72% 0.13 235);
        outline-offset: 2px;
      }
      .approve {
        background: var(--safe);
        color: oklch(99% 0.006 252);
      }
      .deny {
        background: var(--ink);
        color: oklch(99% 0.006 252);
      }
      .report {
        margin-top: 10px;
        background: transparent;
        border-color: var(--line);
        color: var(--ink);
      }
      .context-panel {
        padding: 22px 0;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 28px;
      }
      .brand img, .brand-logo {
        width: 44px;
        height: 44px;
        border-radius: 10px;
        border: 1px solid var(--line);
        object-fit: contain;
        background: var(--surface);
      }
      .prompt-list {
        display: grid;
        gap: 10px;
        margin-top: 24px;
      }
      .prompt-row {
        display: grid;
        grid-template-columns: 80px 1fr;
        gap: 4px 12px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: rgb(252 253 255 / 72%);
        padding: 12px;
      }
      .prompt-row span, .prompt-row small {
        color: var(--muted);
        font-size: 13px;
      }
      .prompt-row small {
        grid-column: 2;
      }
      .lesson {
        width: min(760px, 100%);
        border: 1px solid var(--line);
        border-radius: 10px;
        background: var(--surface);
        padding: 34px;
        box-shadow: 0 18px 48px rgb(13 27 42 / 10%);
      }
      .lead {
        max-width: 66ch;
        color: var(--muted);
        font-size: 18px;
        line-height: 1.6;
      }
      .teaching-point {
        margin-top: 24px;
        border: 1px solid rgb(46 125 50 / 24%);
        border-radius: 8px;
        background: rgb(46 125 50 / 8%);
        padding: 20px;
      }
      .teaching-point p, .training-content {
        color: var(--muted);
        line-height: 1.6;
      }
      .training-content {
        margin-top: 24px;
      }
      @media (max-width: 760px) {
        main { display: block; padding: 18px; }
        .simulator { grid-template-columns: 1fr; }
        .context-panel { padding: 0; }
        h1 { font-size: 30px; }
        h2 { max-width: 100%; font-size: 24px; }
        .lesson { padding: 24px; }
      }
    </style>
  </head>
  <body>
    <main>${body}</main>
  </body>
</html>`;
}
