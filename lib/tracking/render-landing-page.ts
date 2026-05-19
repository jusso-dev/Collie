import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { campaignTargets, campaigns, emailTemplates, employees, landingPages, trainingModules } from "@/lib/db/schema";
import { inferBrandProfile, landingLogoMarkup } from "@/lib/email/brand-assets";
import { renderMfaPushPage } from "@/lib/tracking/mfa-push-page";
import { renderOAuthConsentPage, renderOAuthConsentTrainingPage } from "@/lib/tracking/oauth-consent-page";

type RenderLandingPageOptions = {
  mfaOutcome?: "approved" | "reported";
  submittedScenario?: string;
};

function replaceTokens(value: string, tokens: Record<string, string>) {
  return Object.entries(tokens).reduce(
    (output, [key, tokenValue]) => output.replaceAll(`{{${key}}}`, tokenValue),
    value,
  );
}

function extractTemplateLogoDomain(html?: string | null) {
  if (!html) return null;
  const match = html.match(/domain=([^"&]+)/i);
  if (!match?.[1]) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function extractTemplateBrandColour(html?: string | null) {
  if (!html) return null;
  const accentMatch = html.match(/height:\s*4px;\s*background:\s*(#[0-9a-f]{3,8}|rgb\([^)]+\))/i);
  if (accentMatch?.[1]) return accentMatch[1];
  const buttonMatch = html.match(/background:\s*(#[0-9a-f]{3,8}|rgb\([^)]+\));\s*border-radius:\s*6px/i);
  return buttonMatch?.[1] ?? null;
}

export async function renderLandingPageForToken(token: string, options: RenderLandingPageOptions = {}) {
  const [row] = await db
    .select({
      token: campaignTargets.uniqueToken,
      firstName: employees.firstName,
      lastName: employees.lastName,
      email: employees.email,
      department: employees.department,
      campaignName: campaigns.name,
      templateName: emailTemplates.name,
      templateFromName: emailTemplates.fromName,
      templateHtml: emailTemplates.htmlBody,
      landingHtml: landingPages.html,
      landingType: landingPages.type,
      trainingTitle: trainingModules.title,
      trainingDescription: trainingModules.description,
      trainingHtml: trainingModules.contentHtml,
    })
    .from(campaignTargets)
    .innerJoin(campaigns, eq(campaigns.id, campaignTargets.campaignId))
    .innerJoin(employees, eq(employees.id, campaignTargets.employeeId))
    .leftJoin(emailTemplates, eq(emailTemplates.id, campaigns.emailTemplateId))
    .leftJoin(landingPages, eq(landingPages.id, campaigns.landingPageId))
    .leftJoin(trainingModules, eq(trainingModules.id, landingPages.linkedTrainingModuleId))
    .where(and(eq(campaignTargets.uniqueToken, token)))
    .limit(1);

  const fallback = `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Collie training moment</title>
    <style>
      body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #fcfdff; color: #0d1b2a; }
      main { max-width: 760px; margin: 0 auto; padding: 72px 24px; }
      .eyebrow { color: #f26a21; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; font-size: 12px; }
      h1 { font-size: 38px; line-height: 1.05; margin: 12px 0 16px; }
      p { color: #334155; font-size: 18px; line-height: 1.6; }
      .lesson { margin-top: 28px; border: 1px solid rgb(100 116 139 / 26%); border-radius: 8px; padding: 20px; background: #f2f6fa; }
      strong { color: #0d1b2a; }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">Simulation training</div>
      <h1>Heads up, that email was a phishing simulation.</h1>
      <p>No harm done. Here is the short lesson that would have helped you spot it next time.</p>
      <div class="lesson">
        <strong>Look for pressure, mismatched links, and unexpected requests.</strong>
        <p>Real attackers often ask you to act quickly. Pause, check the sender, and report anything that feels off.</p>
      </div>
    </main>
  </body>
</html>`;

  if (!row?.landingHtml) {
    return fallback;
  }
  const brand = inferBrandProfile({
    name: row.templateName,
    brand: row.templateFromName,
    fromName: row.templateFromName,
    brandColour: extractTemplateBrandColour(row.templateHtml),
    logoDomain: extractTemplateLogoDomain(row.templateHtml),
  });
  const brandInput = {
    name: row.templateName,
    brand: row.templateFromName,
    fromName: row.templateFromName,
    brandColour: extractTemplateBrandColour(row.templateHtml),
    logoDomain: extractTemplateLogoDomain(row.templateHtml),
  };

  if (row.landingType === "mfa_push_simulator") {
    return renderMfaPushPage({
      firstName: row.firstName,
      email: row.email,
      campaignName: row.campaignName,
      brandName: brand.displayName,
      brandInitial: brand.initial,
      brandColour: brand.colour,
      brandLogo: landingLogoMarkup(brandInput),
      trainingTitle: row.trainingTitle ?? "Handling unexpected MFA prompts",
      trainingDescription:
        row.trainingDescription ?? "Only approve MFA prompts for sign-ins you started. Deny and report anything unexpected.",
      trainingHtml: row.trainingHtml ?? "",
      outcome: options.mfaOutcome,
    });
  }

  if (row.landingType === "oauth_consent") {
    const input = {
      token,
      firstName: row.firstName,
      recipientEmail: row.email,
      campaignName: row.campaignName,
      brandName: brand.displayName,
      brandColour: brand.colour,
      trainingTitle: row.trainingTitle,
      trainingDescription: row.trainingDescription,
      trainingHtml: row.trainingHtml,
    };

    return options.submittedScenario === "oauth_consent"
      ? renderOAuthConsentTrainingPage(input)
      : renderOAuthConsentPage(input);
  }

  return replaceTokens(row.landingHtml, {
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: `${row.firstName} ${row.lastName}`.trim(),
    recipientEmail: row.email,
    department: row.department ?? "",
    campaignName: row.campaignName,
    brandName: brand.displayName,
    brandInitial: brand.initial,
    brandColour: brand.colour,
    brandLogo: landingLogoMarkup(brandInput),
    brandLogoUrl: brand.logoUrl,
    token,
    trainingTitle: row.trainingTitle ?? "Spotting phishing pressure cues",
    trainingDescription: row.trainingDescription ?? "Pause, check the sender, inspect links, and report what feels off.",
    trainingHtml: row.trainingHtml ?? "",
  });
}
