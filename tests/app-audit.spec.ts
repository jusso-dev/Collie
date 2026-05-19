import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const runId = Date.now().toString();
const userName = `Playwright Audit ${runId}`;
const email = `playwright-audit-${runId}@example.test`;
const password = "password1234";
const organisationName = `Audit Tenant ${runId}`;

let orgSlug = "";

const forbiddenFreshTenantText = [
  "Demo AU",
  "7.8%",
  "22.4%",
  "73%",
  "68%",
  "average score",
  "baseline",
  "W1",
  "W2",
  "W3",
  "W4",
  "W5",
  "training@example.com.au",
  "Acme Pty Ltd",
];

async function assertFreshTenantPage(page: Page) {
  await expect(page.locator("body")).toBeVisible();
  const text = await page.locator("body").innerText();

  for (const forbidden of forbiddenFreshTenantText) {
    expect(text, `Unexpected placeholder/demo text: ${forbidden}`).not.toContain(forbidden);
  }

  const placeholderText = await page.locator("input[placeholder], textarea[placeholder]").evaluateAll((nodes) =>
    nodes
      .map((node) => node.getAttribute("placeholder")?.trim() ?? "")
      .filter(Boolean),
  );

  for (const placeholder of placeholderText) {
    for (const forbidden of forbiddenFreshTenantText) {
      expect(placeholder, `Fresh tenant placeholder should not show example data: ${forbidden}`).not.toContain(forbidden);
    }
  }
}

async function cleanupAuditData() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;

  const sql = postgres(databaseUrl, { prepare: false });

  try {
    await sql.begin(async (tx) => {
      await tx`delete from users where email = ${email}`;
      await tx`delete from organisations where name = ${organisationName}`;
    });
  } finally {
    await sql.end();
  }
}

test.describe.serial("Collie fresh tenant audit", () => {
  test.afterAll(async () => {
    await cleanupAuditData();
  });

  test("fresh tenant product workflows work end to end", async ({ page, context }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto("/signup");

    await page.getByLabel("Your name").fill(userName);
    await page.getByLabel("Organisation name").fill(organisationName);
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/audit-tenant-\d+\/dashboard$/);
    orgSlug = new URL(page.url()).pathname.split("/")[1];

    await expect(page.getByText("No data").first()).toBeVisible();
    await expect(page.getByText("No history").first()).toBeVisible();
    await assertFreshTenantPage(page);

    await page.goto(`/${orgSlug}/dashboard`);

    await page.getByRole("link", { name: "New campaign" }).click();
    await expect(page).toHaveURL(`/${orgSlug}/campaigns`);
    await expect(page.getByRole("heading", { name: "Campaign builder" })).toBeVisible();

    await page.goto(`/${orgSlug}/dashboard`);
    await page.getByRole("link", { name: "Import employees" }).click();
    await expect(page).toHaveURL(`/${orgSlug}/employees`);
    await expect(page.getByRole("heading", { name: "Employees" })).toBeVisible();

    await page.goto(`/${orgSlug}/employees`);
    await page.getByLabel("First name").fill("Ari");
    await page.getByLabel("Last name").fill("Nguyen");
    await page.getByLabel("Work email").fill(`ari-${runId}@example.test`);
    await page.getByLabel("Department").fill("Finance");
    await page.getByRole("button", { name: "Add employee" }).click();
    await expect(page.getByText("Ari Nguyen")).toBeVisible();

    await page.getByLabel("CSV employee import").fill(
      `email,first_name,last_name,department\nkai-${runId}@example.test,Kai,Patel,Operations`,
    );
    await page.getByRole("button", { name: "Import CSV" }).click();
    await expect(page.getByText("Kai Patel")).toBeVisible();

    await page.getByRole("button", { name: "Deactivate" }).first().click();
    await expect(page.getByText("Inactive", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Reactivate" }).first().click();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();

    await page.goto(`/${orgSlug}/groups`);
    await expect(page.getByRole("heading", { name: "Groups" })).toBeVisible();
    await page.getByLabel("Group name").fill(`Finance cohort ${runId}`);
    await page.locator("[data-slot='checkbox']:not([data-disabled])").first().click();
    await page.getByRole("button", { name: "Save group" }).click();
    await expect(page.getByText(`Finance cohort ${runId}`)).toBeVisible();

    await page.goto(`/${orgSlug}/landing-pages`);
    await expect(page.getByRole("heading", { name: "Landing pages" })).toBeVisible();
    await page.locator("details > summary").first().click();
    await expect(page.getByText("Preview").first()).toBeVisible();

    await page.goto(`/${orgSlug}/campaigns`);
    await page.getByLabel("Campaign name").fill(`Invoice review ${runId}`);
    const templateValue = await page.locator("select[name='emailTemplateId'] option").nth(1).getAttribute("value");
    expect(templateValue).toBeTruthy();
    await page.locator("select[name='emailTemplateId']").selectOption(templateValue!);
    const credentialLandingValue = await page
      .locator("select[name='landingPageId'] option", { hasText: "Account sign-in check" })
      .getAttribute("value");
    expect(credentialLandingValue).toBeTruthy();
    await page.locator("select[name='landingPageId']").selectOption(credentialLandingValue!);
    await page.locator("select[name='targetGroupId']").selectOption({ label: `Finance cohort ${runId}` });
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page.getByText(`Invoice review ${runId}`)).toBeVisible();
    await expect(page.getByText("1 targets")).toBeVisible();
    const campaignDetails = page.locator("details", { hasText: `Invoice review ${runId}` });
    await campaignDetails.locator("summary").click();
    await campaignDetails.getByRole("link", { name: "View results" }).click();
    await expect(page.getByRole("heading", { name: `Invoice review ${runId}` })).toBeVisible();
    const trackingHref = await page.getByRole("link", { name: "Open link" }).first().getAttribute("href");
    expect(trackingHref).toBeTruthy();
    const pixelHref = trackingHref!.replace("/c/", "/p/") + ".gif";
    const pixelResponse = await page.request.get(pixelHref);
    expect(pixelResponse.ok()).toBeTruthy();
    const trackingPage = await context.newPage();
    await trackingPage.goto(trackingHref!);
    await expect(trackingPage.getByRole("heading", { name: "Confirm your account" })).toBeVisible();
    await trackingPage.locator("input[name='email']").fill(`ari-${runId}@example.test`);
    await trackingPage.locator("input[name='password']").fill("not-a-real-password");
    await trackingPage.getByRole("button", { name: "Continue" }).click();
    await expect(trackingPage.getByRole("heading", { name: "Confirm your account" })).toBeVisible();
    await trackingPage.close();
    await page.reload();
    await expect(page.getByText("Credential submission alert")).toBeVisible();
    await expect(page.getByText(`ari-${runId}@example.test`).first()).toBeVisible();
    await expect(page.getByText("Provided, value not stored").first()).toBeVisible();
    const token = trackingHref!.split("/c/")[1];
    const inboundResponse = await page.request.post("/api/webhooks/resend/inbound", {
      data: {
        type: "email.received",
        data: {
          email_id: `received-${runId}`,
          from: `ari-${runId}@example.test`,
          to: [`report+${token}@reports.localhost`],
          subject: `Fwd: Invoice review ${runId}`,
          text: `Forwarded report for collie-token:${token}`,
        },
      },
    });
    expect(inboundResponse.ok()).toBeTruthy();

    await page.goto(`/${orgSlug}/templates`);
    await page.locator("details > summary").first().click();
    await expect(page.getByText("Inbox preview").first()).toBeVisible();

    await page.goto(`/${orgSlug}/training`);
    await page.locator("details > summary").first().click();
    await expect(page.getByText("Lesson preview").first()).toBeVisible();
    const trainingTitle = `Pressure cues ${runId}`;
    await page.getByLabel("Title").first().fill(trainingTitle);
    await page.getByRole("button", { name: "Create custom copy" }).click();
    await expect(page.getByText(trainingTitle)).toBeVisible();
    await page.getByText(trainingTitle).click();
    await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();

    await page.goto(`/${orgSlug}/reports`);
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
    await expect(page.getByText("1").first()).toBeVisible();
    await expect(page.getByText("Opened")).toBeVisible();
    await expect(page.getByText("Clicked")).toBeVisible();
    await expect(page.getByText("Yes").first()).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("campaign-report.csv");
    const eventDownloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export events" }).click();
    const eventDownload = await eventDownloadPromise;
    expect(eventDownload.suggestedFilename()).toContain("raw-events.csv");

    const pages = [
      { path: "dashboard", heading: "Org, cohort, and industry benchmark view." },
      { path: "employees", heading: "Employees" },
      { path: "groups", heading: "Groups" },
      { path: "campaigns", heading: "Campaign builder" },
      { path: "templates", heading: "Template library" },
      { path: "landing-pages", heading: "Landing pages" },
      { path: "training", heading: "Training modules" },
      { path: "reports", heading: "Reports" },
      { path: "settings", heading: "Settings" },
    ];

    for (const route of pages) {
      await page.goto(`/${orgSlug}/${route.path}`);
      await expect(page.getByRole("heading", { name: route.heading })).toBeVisible();
      await assertFreshTenantPage(page);
    }

    expect(errors).toEqual([]);

    await page.goto(`/${orgSlug}/dashboard`);
    await page.getByRole("button", { name: /Admin/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/signin$/);
  });
});
