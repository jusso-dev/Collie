import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { eq, like } from "drizzle-orm";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

import { sealTotpSecret } from "@/lib/auth/totp";
import { db, sql as dbSql } from "@/lib/db/client";
import {
  campaignTargets,
  campaigns,
  emailTemplates,
  employeeGroups,
  employees,
  events,
  groups,
  landingPages,
  organisations,
  trainingModules,
  users,
} from "@/lib/db/schema";
import { renderCampaignEmail } from "@/lib/email/campaign-renderer";
import { renderLandingPageForToken } from "@/lib/tracking/render-landing-page";

const screenshotsDir = resolve("docs/assets/screenshots");
const baseUrl = (process.env.README_SCREENSHOT_BASE_URL ?? "http://localhost:3107").replace(/\/$/, "");
const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const email = `readme-capture-${runId}@example.test`;
const password = "readme-capture-password";
const organisationName = `Readme Capture ${runId}`;
const organisationSlug = `readme-capture-${runId.toLowerCase()}`;

type SeedResult = {
  organisationId: string;
  organisationSlug: string;
  campaignId: string;
  token: string;
  emailHtml: string;
  landingHtml: string;
};

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;

  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    const value = valueParts.join("=").trim().replace(/^["']|["']$/g, "");
    process.env[key.trim()] ??= value;
  }
}

function ensureBaseEnv() {
  loadEnvFile(resolve(".env"));
  process.env.BETTER_AUTH_URL = baseUrl;
  process.env.NEXT_PUBLIC_BETTER_AUTH_URL = baseUrl;
  process.env.NEXT_PUBLIC_APP_URL = baseUrl;
}

async function waitForServer(url: string) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
    }
  }

  throw new Error(`Timed out waiting for ${url}`);
}

function startServer() {
  if (process.env.README_SCREENSHOT_BASE_URL) {
    return null;
  }

  const port = new URL(baseUrl).port || "3107";
  const child = spawn("pnpm", ["exec", "next", "dev", "-p", port], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (chunk: Buffer) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  return child;
}

async function cleanupReadmeData() {
  const staleOrgs = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(like(organisations.slug, "readme-capture-%"));

  for (const organisation of staleOrgs) {
    await db.delete(organisations).where(eq(organisations.id, organisation.id));
  }

  await db.delete(users).where(like(users.email, "readme-capture-%@example.test"));
}

async function signUp(page: Page) {
  await page.goto(`${baseUrl}/signup`);
  await page.getByLabel("Your name").fill("Readme Capture Admin");
  await page.getByLabel("Organisation name").fill(organisationName);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });
}

function brandedEmailHtml() {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#0d1b2a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6fa;padding:28px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fcfdff;border:1px solid #d8e0ea;border-radius:10px;overflow:hidden;">
            <tr><td style="height:4px;background:#f26a21;font-size:0;line-height:0;">&nbsp;</td></tr>
            <tr>
              <td style="padding:24px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="vertical-align:middle;width:48px;">
                      <span style="display:inline-flex;width:42px;height:42px;border-radius:8px;background:#0d1b2a;color:#fcfdff;align-items:center;justify-content:center;font-size:14px;font-weight:700;">HP</span>
                    </td>
                    <td style="vertical-align:middle;">
                      <div style="font-size:18px;font-weight:700;color:#0d1b2a;">Harbour Parcel</div>
                      <div style="font-size:12px;color:#64748b;">Delivery notifications</div>
                    </td>
                  </tr>
                </table>
                <h1 style="font-size:22px;line-height:1.25;margin:28px 0 10px;color:#0d1b2a;">Action required for delivery {{firstName}}</h1>
                <p style="font-size:15px;line-height:1.6;margin:0 0 18px;color:#334155;">A parcel addressed to {{organisationName}} is waiting for delivery preference confirmation.</p>
                <a href="{{trackingUrl}}" style="display:inline-block;background:#f26a21;color:#0d1b2a;text-decoration:none;font-weight:700;border-radius:7px;padding:12px 18px;">Choose delivery option</a>
                <p style="font-size:12px;line-height:1.6;margin:24px 0 0;color:#64748b;">If this message looks suspicious, forward it to {{replyAddress}}.</p>
                {{trackingPixel}}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function brandedLandingHtml() {
  return `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{{brandName}} delivery preferences</title>
    <style>
      body { margin:0; font-family:Inter, Arial, sans-serif; background:#f3f6fa; color:#0d1b2a; }
      .topbar { height:5px; background:{{brandColour}}; }
      main { min-height:calc(100vh - 5px); display:grid; place-items:center; padding:40px 20px; }
      .panel { width:min(440px, 100%); background:#fcfdff; border:1px solid rgba(100,116,139,.26); border-radius:10px; padding:28px; box-shadow:0 22px 70px rgba(13,27,42,.14); }
      .brand { display:flex; align-items:center; gap:12px; margin-bottom:22px; }
      .brand-mark { width:42px; height:42px; display:grid; place-items:center; border-radius:9px; background:{{brandColour}}; color:#fff; font-weight:800; }
      .brand-logo { width:42px; height:42px; object-fit:contain; border-radius:9px; border:1px solid rgba(100,116,139,.2); background:#fff; }
      h1 { font-size:24px; line-height:1.2; margin:0 0 10px; }
      p { color:#64748b; line-height:1.6; margin:0 0 18px; }
      label { display:block; font-size:13px; font-weight:700; margin-top:14px; }
      input { width:100%; box-sizing:border-box; margin-top:7px; border:1px solid rgba(100,116,139,.34); border-radius:7px; padding:11px; font-size:15px; }
      button { margin-top:20px; width:100%; border:0; border-radius:7px; padding:12px; background:{{brandColour}}; color:#fcfdff; font-weight:800; }
      .hint { margin-top:18px; font-size:12px; }
    </style>
  </head>
  <body>
    <div class="topbar"></div>
    <main>
      <section class="panel">
        <div class="brand">{{brandLogo}}<strong>{{brandName}}</strong></div>
        <h1>Confirm delivery preference</h1>
        <p>Sign in to choose a safe delivery time for {{recipientEmail}}.</p>
        <form method="post">
          <label for="email">Email address</label>
          <input id="email" name="email" type="email" value="{{recipientEmail}}" />
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" />
          <button type="submit">Continue</button>
        </form>
        <p class="hint">Collie records that a password was provided, not the password value.</p>
      </section>
    </main>
  </body>
</html>`;
}

async function seedProductData(): Promise<SeedResult> {
  const [organisation] = await db
    .select({ id: organisations.id, slug: organisations.slug })
    .from(organisations)
    .where(eq(organisations.slug, organisationSlug))
    .limit(1);

  if (!organisation) {
    throw new Error(`Expected ${organisationSlug} to exist after sign up.`);
  }

  await db
    .update(organisations)
    .set({
      resendApiKeyEncrypted: sealTotpSecret("re_readme_capture_fake_key"),
      senderFromAddress: "Collie Training <training@example.test>",
      updatedAt: new Date(),
    })
    .where(eq(organisations.id, organisation.id));

  const [training] = await db
    .insert(trainingModules)
    .values({
      id: randomUUID(),
      organisationId: organisation.id,
      title: "Spotting parcel delivery pressure",
      description: "Check sender domains, urgency, and links before signing in.",
      durationSeconds: 180,
      contentType: "interactive",
      topic: "phishing",
      contentHtml: "<p>Pause on urgent delivery requests. Check the sender, inspect the link, and report anything that feels off.</p>",
      quiz: [
        {
          question: "What should you check before opening a delivery link?",
          options: ["Sender and URL", "Button colour", "Email length"],
          answer: 0,
        },
      ],
    })
    .returning({ id: trainingModules.id });

  const [template] = await db
    .insert(emailTemplates)
    .values({
      id: randomUUID(),
      organisationId: organisation.id,
      name: "Harbour Parcel delivery preference",
      category: "package_delivery",
      difficulty: 3,
      subject: "Delivery preference needed for {{firstName}}",
      fromName: "Harbour Parcel",
      fromEmailPattern: "updates@harbour-parcel.example",
      htmlBody: brandedEmailHtml(),
      textBody:
        "Harbour Parcel delivery preference is waiting. Open {{trackingUrl}} or report suspicious mail to {{replyAddress}}. {{reportMarker}}",
      language: "en-AU",
      region: "au",
      linkedTrainingModuleId: training.id,
    })
    .returning({ id: emailTemplates.id });

  const [landing] = await db
    .insert(landingPages)
    .values({
      id: randomUUID(),
      organisationId: organisation.id,
      name: "Harbour Parcel delivery preference",
      type: "credential_harvest",
      html: brandedLandingHtml(),
      linkedTrainingModuleId: training.id,
    })
    .returning({ id: landingPages.id });

  const employeeRows = await db
    .insert(employees)
    .values([
      {
        id: randomUUID(),
        organisationId: organisation.id,
        email: "mia.chen@example.test",
        firstName: "Mia",
        lastName: "Chen",
        department: "Finance",
        managerEmail: "manager@example.test",
        riskScore: 38,
        lastTrainedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
      {
        id: randomUUID(),
        organisationId: organisation.id,
        email: "noah.patel@example.test",
        firstName: "Noah",
        lastName: "Patel",
        department: "Operations",
        managerEmail: "manager@example.test",
        riskScore: 54,
      },
      {
        id: randomUUID(),
        organisationId: organisation.id,
        email: "ava.wilson@example.test",
        firstName: "Ava",
        lastName: "Wilson",
        department: "People",
        managerEmail: "manager@example.test",
        riskScore: 42,
      },
    ])
    .returning({ id: employees.id, email: employees.email, firstName: employees.firstName, lastName: employees.lastName, department: employees.department });

  const [group] = await db
    .insert(groups)
    .values({ id: randomUUID(), organisationId: organisation.id, name: "Quarterly baseline" })
    .returning({ id: groups.id });

  await db.insert(employeeGroups).values(employeeRows.map((employee) => ({ employeeId: employee.id, groupId: group.id })));

  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  const [campaign] = await db
    .insert(campaigns)
    .values({
      id: randomUUID(),
      organisationId: organisation.id,
      name: "Quarterly parcel delivery baseline",
      status: "running",
      emailTemplateId: template.id,
      landingPageId: landing.id,
      targetGroupIds: [group.id],
      sendStrategy: "randomised_over_window",
      startAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
      endAt: new Date(Date.now() + 20 * 60 * 60 * 1000),
      scheduleCron: "*/15 * * * *",
      createdBy: owner?.id,
    })
    .returning({ id: campaigns.id });

  const targetRows = await db
    .insert(campaignTargets)
    .values(
      employeeRows.map((employee, index) => ({
        id: randomUUID(),
        campaignId: campaign.id,
        employeeId: employee.id,
        uniqueToken: `readme-${randomUUID().replaceAll("-", "")}`,
        scheduledAt: new Date(Date.now() + index * 15 * 60 * 1000),
        sentAt: new Date(Date.now() - (90 - index * 12) * 60 * 1000),
        openedAt: index < 2 ? new Date(Date.now() - (80 - index * 12) * 60 * 1000) : null,
        clickedAt: index === 0 ? new Date(Date.now() - 55 * 60 * 1000) : null,
        submittedAt: index === 0 ? new Date(Date.now() - 51 * 60 * 1000) : null,
        reportedAt: index === 1 ? new Date(Date.now() - 62 * 60 * 1000) : null,
        trainingCompletedAt: index === 0 ? new Date(Date.now() - 42 * 60 * 1000) : null,
      })),
    )
    .returning({ id: campaignTargets.id, token: campaignTargets.uniqueToken, employeeId: campaignTargets.employeeId });

  const eventValues = [
    { targetId: targetRows[0].id, eventType: "sent" as const, offsetMinutes: 90, metadata: { provider: "readme-capture" } },
    { targetId: targetRows[0].id, eventType: "opened" as const, offsetMinutes: 80, metadata: { source: "pixel" } },
    { targetId: targetRows[0].id, eventType: "clicked" as const, offsetMinutes: 55, metadata: { source: "link" } },
    {
      targetId: targetRows[0].id,
      eventType: "submitted" as const,
      offsetMinutes: 51,
      metadata: { source: "landing_page_form", fields: { email: "mia.chen@example.test", password: "[provided]" } },
    },
    { targetId: targetRows[0].id, eventType: "trained" as const, offsetMinutes: 42, metadata: { module: "parcel-delivery-pressure" } },
    { targetId: targetRows[1].id, eventType: "sent" as const, offsetMinutes: 78, metadata: { provider: "readme-capture" } },
    { targetId: targetRows[1].id, eventType: "opened" as const, offsetMinutes: 68, metadata: { source: "pixel" } },
    { targetId: targetRows[1].id, eventType: "reported" as const, offsetMinutes: 62, metadata: { source: "inbound_report" } },
    { targetId: targetRows[2].id, eventType: "sent" as const, offsetMinutes: 65, metadata: { provider: "readme-capture" } },
  ];

  await db.insert(events).values(
    eventValues.map((event) => ({
      id: randomUUID(),
      campaignTargetId: event.targetId,
      eventType: event.eventType,
      metadata: event.metadata,
      ipAddress: "203.0.113.24",
      userAgent: "ReadmeScreenshotBot/1.0",
      createdAt: new Date(Date.now() - event.offsetMinutes * 60 * 1000),
    })),
  );

  const firstEmployee = employeeRows[0];
  const token = targetRows[0].token;
  const emailRender = renderCampaignEmail({
    organisationName,
    template: {
      subject: "Delivery preference needed for {{firstName}}",
      htmlBody: brandedEmailHtml(),
      textBody: "Open {{trackingUrl}}",
    },
    employee: firstEmployee,
    token,
  });

  return {
    organisationId: organisation.id,
    organisationSlug: organisation.slug,
    campaignId: campaign.id,
    token,
    emailHtml: emailRender.html,
    landingHtml: await renderLandingPageForToken(token),
  };
}

async function screenshot(page: Page, path: string) {
  await page.screenshot({ path, fullPage: true });
}

async function captureProductScreenshots(context: BrowserContext, seed: SeedResult) {
  mkdirSync(screenshotsDir, { recursive: true });

  const appPage = await context.newPage();
  await appPage.setViewportSize({ width: 1440, height: 980 });
  await appPage.goto(`${baseUrl}/${seed.organisationSlug}/dashboard`);
  await appPage.waitForLoadState("networkidle");
  await screenshot(appPage, resolve(screenshotsDir, "dashboard.png"));

  await appPage.goto(`${baseUrl}/${seed.organisationSlug}/campaigns/${seed.campaignId}`);
  await appPage.waitForLoadState("networkidle");
  await screenshot(appPage, resolve(screenshotsDir, "campaign-results.png"));

  await appPage.goto(`${baseUrl}/${seed.organisationSlug}/templates`);
  await appPage
    .locator("details")
    .filter({ hasText: "Harbour Parcel delivery preference" })
    .first()
    .evaluate((element) => {
      (element as HTMLDetailsElement).open = true;
    });
  await appPage.waitForLoadState("networkidle");
  await screenshot(appPage, resolve(screenshotsDir, "template-preview.png"));

  const emailPage = await context.newPage();
  await emailPage.setViewportSize({ width: 900, height: 900 });
  await emailPage.setContent(seed.emailHtml, { waitUntil: "networkidle" });
  await screenshot(emailPage, resolve(screenshotsDir, "rendered-email.png"));
  writeFileSync(resolve(screenshotsDir, "rendered-email.html"), seed.emailHtml);

  const landingPage = await context.newPage();
  await landingPage.setViewportSize({ width: 1100, height: 900 });
  await landingPage.goto(`${baseUrl}/c/${seed.token}`);
  await landingPage.waitForLoadState("networkidle");
  await screenshot(landingPage, resolve(screenshotsDir, "rendered-landing-page.png"));
  writeFileSync(resolve(screenshotsDir, "rendered-landing-page.html"), await landingPage.content());
}

async function main() {
  ensureBaseEnv();
  mkdirSync(dirname(resolve(screenshotsDir, "dashboard.png")), { recursive: true });

  let server: ChildProcess | null = null;
  let browser: Browser | null = null;

  try {
    await cleanupReadmeData();
    server = startServer();
    await waitForServer(`${baseUrl}/signup`);

    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1365, height: 920 } });
    const page = await context.newPage();
    await signUp(page);
    const seed = await seedProductData();
    await captureProductScreenshots(page.context(), seed);
  } finally {
    if (browser) await browser.close();
    await cleanupReadmeData();
    await dbSql.end();
    if (server) {
      server.kill("SIGTERM");
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
