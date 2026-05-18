import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { emailTemplates, landingPages, templateCategory, trainingModules } from "@/lib/db/schema";
import { emailLogoMarkup } from "@/lib/email/brand-assets";

const phishingBasicsId = "training-phishing-basics";

type TemplateCategory = (typeof templateCategory.enumValues)[number];

type DemoTemplate = {
  name: string;
  category: TemplateCategory;
  difficulty: number;
  subject: string;
  fromName: string;
  fromEmailPattern: string;
  brand: string;
  brandColour: string;
  accentColour?: string;
  preheader: string;
  heading: string;
  body: string[];
  cta: string;
  footer: string;
};

function brandedEmail(template: DemoTemplate) {
  const accent = template.accentColour ?? template.brandColour;
  const logo = emailLogoMarkup(template);

  return `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${template.subject}</title>
  </head>
  <body style="margin:0;background:#eef3f8;color:#172033;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${template.preheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef3f8;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #d7dee8;border-radius:10px;overflow:hidden;box-shadow:0 10px 30px rgba(13,27,42,.08);">
            <tr>
              <td style="padding:18px 28px;border-bottom:1px solid #e5eaf0;background:#ffffff;">
                <table role="presentation" cellspacing="0" cellpadding="0" width="100%">
                  <tr>
                    <td width="48" style="vertical-align:middle;">${logo}</td>
                    <td style="vertical-align:middle;">
                      <div style="font-size:18px;font-weight:700;letter-spacing:.01em;color:#0d1b2a;">${template.brand}</div>
                      <div style="margin-top:4px;font-size:12px;color:#64748b;">${template.preheader}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="height:4px;background:${template.brandColour};font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:30px 28px 12px;background:#ffffff;">
                <p style="margin:0 0 14px;font-size:14px;color:#64748b;">Hi {{firstName}},</p>
                <h1 style="margin:0;color:#0d1b2a;font-size:26px;line-height:1.2;font-weight:700;">${template.heading}</h1>
                ${template.body
                  .map(
                    (paragraph) =>
                      `<p style="margin:18px 0 0;color:#334155;font-size:15px;line-height:1.65;">${paragraph}</p>`,
                  )
                  .join("")}
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:26px;">
                  <tr>
                    <td style="background:${accent};border-radius:6px;">
                      <a href="{{trackingUrl}}" style="display:inline-block;padding:13px 18px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">${template.cta}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:22px 0 0;color:#64748b;font-size:12px;line-height:1.55;">If the button does not work, paste this link into your browser:<br /><span style="color:#0d1b2a;word-break:break-all;">{{trackingUrl}}</span></p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px 28px;color:#64748b;font-size:12px;line-height:1.55;border-top:1px solid #e5eaf0;background:#fbfdff;">
                ${template.footer}<br />
                This message was sent to {{recipientEmail}}.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    {{trackingPixel}}
  </body>
</html>`;
}

function textEmail(template: DemoTemplate) {
  return [
    `Hi {{firstName}},`,
    "",
    template.heading,
    "",
    ...template.body,
    "",
    `${template.cta}: {{trackingUrl}}`,
    "",
    template.footer,
  ].join("\n");
}

const templates: DemoTemplate[] = [
  {
    name: "Harbour Parcel delivery update",
    category: "package_delivery",
    difficulty: 2,
    subject: "Delivery held: address confirmation needed",
    fromName: "Harbour Parcel",
    fromEmailPattern: "tracking@harbour-parcel.example",
    brand: "Harbour Parcel",
    brandColour: "#0d1b2a",
    accentColour: "#f26a21",
    preheader: "Your parcel needs an address check.",
    heading: "Your delivery is waiting on one detail",
    body: [
      "We could not complete delivery because the address on file needs confirmation.",
      "Confirm your delivery details today so the parcel can be released for the next run.",
    ],
    cta: "Confirm delivery details",
    footer: "Harbour Parcel delivery notifications",
  },
  {
    name: "Northstar Workspace password expiry",
    category: "credential_harvest",
    difficulty: 4,
    subject: "Workspace password expires today",
    fromName: "Northstar Workspace",
    fromEmailPattern: "security@northstar-workspace.example",
    brand: "Northstar Workspace",
    brandColour: "#2563eb",
    preheader: "Keep access to your work account.",
    heading: "Your password is due to expire",
    body: [
      "Your work account password is scheduled to expire today.",
      "Keep access to mail, chat, and shared files by confirming your password settings.",
    ],
    cta: "Keep account active",
    footer: "Northstar Workspace account services",
  },
  {
    name: "Bluegum Finance invoice shared",
    category: "invoice_fraud",
    difficulty: 3,
    subject: "Invoice INV-{{department}}-0426 shared with you",
    fromName: "Bluegum Finance",
    fromEmailPattern: "messaging@bluegum-finance.example",
    brand: "Bluegum Finance",
    brandColour: "#13b5ea",
    accentColour: "#0d1b2a",
    preheader: "A supplier invoice has been shared for review.",
    heading: "A new invoice is waiting",
    body: [
      "A supplier has shared an invoice with {{organisationName}} for review.",
      "Open the invoice summary and confirm whether the payment details match your records.",
    ],
    cta: "View invoice",
    footer: "Bluegum Finance document notifications",
  },
  {
    name: "Southern Cross Sign policy document",
    category: "document_share",
    difficulty: 2,
    subject: "Complete signature: policy acknowledgement",
    fromName: "Southern Cross Sign",
    fromEmailPattern: "documents@southern-cross-sign.example",
    brand: "Southern Cross Sign",
    brandColour: "#4c00ff",
    preheader: "A document is waiting for your signature.",
    heading: "Please review and sign",
    body: [
      "{{organisationName}} has sent a document for acknowledgement.",
      "Open the secure envelope to review the document and complete the signature request.",
    ],
    cta: "Review document",
    footer: "Southern Cross Sign notifications",
  },
  {
    name: "Outback Mobile bill overdue",
    category: "telecom",
    difficulty: 3,
    subject: "Your Outback Mobile bill needs payment",
    fromName: "Outback Mobile",
    fromEmailPattern: "billing@outback-mobile.example",
    brand: "Outback Mobile",
    brandColour: "#005eb8",
    accentColour: "#00a3e0",
    preheader: "Your latest bill is overdue.",
    heading: "Payment is needed to keep services active",
    body: [
      "We were unable to process the payment for your latest bill.",
      "Please review your billing account and update the payment method if needed.",
    ],
    cta: "View bill",
    footer: "Outback Mobile billing notifications",
  },
  {
    name: "People Team benefits QR update",
    category: "qr_code",
    difficulty: 4,
    subject: "Employee benefits enrolment QR code",
    fromName: "People Team",
    fromEmailPattern: "benefits@people-update.example",
    brand: "{{organisationName}} People",
    brandColour: "#4f6f52",
    accentColour: "#f26a21",
    preheader: "Scan or open your enrolment code.",
    heading: "Benefits enrolment closes this week",
    body: [
      "Your employee benefits profile needs a quick review before enrolment closes.",
      "Open the enrolment page to load your personal QR code and confirm your details.",
    ],
    cta: "Open enrolment QR",
    footer: "{{organisationName}} people operations",
  },
  {
    name: "Executive urgent transfer request",
    category: "ceo_impersonation",
    difficulty: 5,
    subject: "Need this handled before close of business",
    fromName: "Executive Office",
    fromEmailPattern: "office@executive-mail.example",
    brand: "{{organisationName}} Executive Office",
    brandColour: "#0d1b2a",
    accentColour: "#f26a21",
    preheader: "A private request needs quick handling.",
    heading: "Can you help with a time-sensitive payment?",
    body: [
      "I am in meetings and need this handled quietly before close of business.",
      "Open the payment note, confirm the supplier details, and reply once it is ready.",
    ],
    cta: "Open payment note",
    footer: "{{organisationName}} internal executive correspondence",
  },
  {
    name: "Office Printer scan attachment",
    category: "document_share",
    difficulty: 2,
    subject: "Scanned document from office printer",
    fromName: "Office Printer",
    fromEmailPattern: "scan@printer-message.example",
    brand: "Office Printer",
    brandColour: "#475569",
    accentColour: "#38bdf8",
    preheader: "A scanned document is ready.",
    heading: "Your scanned document is available",
    body: [
      "A document was scanned to your email from a shared office printer.",
      "Open the scan link to download the file.",
    ],
    cta: "Download scan",
    footer: "Shared printer services",
  },
];

async function main() {
  await db
    .insert(trainingModules)
    .values({
      id: phishingBasicsId,
      organisationId: null,
      title: "Spotting phishing pressure cues",
      description: "A short lesson on urgency, sender checks, and safe reporting.",
      durationSeconds: 180,
      contentType: "interactive",
      topic: "phishing",
      language: "en-AU",
      contentHtml:
        "<p>Pause before acting. Check the sender, inspect links, and report unexpected requests through the right channel.</p>",
      quiz: [
        {
          question: "What should you do before opening an unexpected link?",
          options: ["Check the sender and link destination", "Forward it broadly", "Reply with your password"],
          answer: 0,
        },
      ],
    })
    .onConflictDoUpdate({
      target: trainingModules.id,
      set: {
        title: sql`excluded.title`,
        description: sql`excluded.description`,
        durationSeconds: sql`excluded.duration_seconds`,
        contentType: sql`excluded.content_type`,
        topic: sql`excluded.topic`,
        language: sql`excluded.language`,
        contentHtml: sql`excluded.content_html`,
        quiz: sql`excluded.quiz`,
        updatedAt: new Date(),
      },
    });

  await db
    .insert(emailTemplates)
    .values(
      templates.map((template, index) => ({
        id: `system-template-${index + 1}`,
        organisationId: null,
        name: template.name,
        category: template.category,
        difficulty: template.difficulty,
        subject: template.subject,
        fromName: template.fromName,
        fromEmailPattern: template.fromEmailPattern,
        htmlBody: brandedEmail(template),
        textBody: textEmail(template),
        language: "en-AU",
        region: "global",
        linkedTrainingModuleId: phishingBasicsId,
      })),
    )
    .onConflictDoUpdate({
      target: emailTemplates.id,
      set: {
        name: sql`excluded.name`,
        category: sql`excluded.category`,
        difficulty: sql`excluded.difficulty`,
        subject: sql`excluded.subject`,
        fromName: sql`excluded.from_name`,
        fromEmailPattern: sql`excluded.from_email_pattern`,
        htmlBody: sql`excluded.html_body`,
        textBody: sql`excluded.text_body`,
        language: sql`excluded.language`,
        region: sql`excluded.region`,
        linkedTrainingModuleId: sql`excluded.linked_training_module_id`,
        updatedAt: new Date(),
      },
    });

  const friendlyLandingHtml = `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Collie training moment</title>
    <style>
      body { margin:0; font-family:Inter,Arial,sans-serif; background:#f2f6fa; color:#0d1b2a; }
      main { max-width:760px; margin:0 auto; padding:72px 24px; }
      .brand { display:flex; align-items:center; gap:12px; margin-bottom:28px; }
      .brand-logo { width:44px; height:44px; border-radius:9px; background:#fff; border:1px solid #d7dee8; object-fit:contain; }
      .brand-mark { width:44px; height:44px; display:grid; place-items:center; border-radius:9px; background:{{brandColour}}; color:#fff; font-weight:800; }
      .eyebrow { color:#f26a21; font-size:12px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
      h1 { margin:12px 0 16px; font-size:38px; line-height:1.05; }
      p { color:#334155; font-size:18px; line-height:1.6; }
      section { margin-top:28px; padding:20px; border:1px solid rgb(100 116 139 / 26%); border-radius:8px; background:#f2f6fa; }
    </style>
  </head>
  <body>
    <main>
      <div class="brand">
        {{brandLogo}}
        <strong>{{brandName}}</strong>
      </div>
      <div class="eyebrow">Simulation training</div>
      <h1>Heads up, that email was a phishing simulation.</h1>
      <p>No harm done. Here is what would have helped you spot it next time, {{firstName}}.</p>
      <section>
        <h2>{{trainingTitle}}</h2>
        <p>{{trainingDescription}}</p>
        {{trainingHtml}}
      </section>
    </main>
  </body>
</html>`;
  const credentialLandingHtml = `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Secure account check</title>
    <style>
      body { margin:0; font-family:Inter,Arial,sans-serif; background:#f2f6fa; color:#0d1b2a; }
      main { max-width:440px; margin:0 auto; padding:72px 24px; }
      form { border:1px solid rgb(100 116 139 / 26%); border-radius:8px; background:#fcfdff; overflow:hidden; box-shadow:0 18px 50px rgba(13,27,42,.12); }
      .topbar { height:5px; background:{{brandColour}}; }
      .content { padding:24px; }
      .brand { display:flex; align-items:center; gap:12px; margin-bottom:22px; }
      .brand-logo { width:42px; height:42px; border-radius:9px; border:1px solid #d7dee8; object-fit:contain; background:#fff; }
      .brand-mark { width:42px; height:42px; display:grid; place-items:center; border-radius:9px; background:{{brandColour}}; color:#fff; font-weight:800; }
      label { display:block; margin-top:16px; font-size:13px; color:#334155; }
      input { box-sizing:border-box; width:100%; margin-top:6px; border:1px solid #cbd5e1; border-radius:6px; padding:11px; font-size:15px; }
      button { margin-top:20px; width:100%; border:0; border-radius:6px; padding:12px; background:{{brandColour}}; color:#fcfdff; font-weight:700; }
    </style>
  </head>
  <body>
    <main>
      <form method="post" action="/c/{{token}}">
        <div class="topbar"></div>
        <div class="content">
          <div class="brand">
            {{brandLogo}}
            <strong>{{brandName}}</strong>
          </div>
          <h1>Confirm your account</h1>
          <p>Sign in to continue.</p>
          <label>Email<input name="email" type="email" value="{{recipientEmail}}" /></label>
          <label>Password<input name="password" type="password" /></label>
          <button type="submit">Continue</button>
        </div>
      </form>
    </main>
  </body>
</html>`;
  const attachmentLandingHtml = `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Attachment warning</title>
    <style>
      body { margin:0; font-family:Inter,Arial,sans-serif; background:#fcfdff; color:#0d1b2a; }
      main { max-width:720px; margin:0 auto; padding:72px 24px; }
      .brand { display:flex; align-items:center; gap:12px; margin-bottom:22px; }
      .brand-logo { width:42px; height:42px; border-radius:9px; border:1px solid #d7dee8; object-fit:contain; }
      .brand-mark { width:42px; height:42px; display:grid; place-items:center; border-radius:9px; background:{{brandColour}}; color:#fff; font-weight:800; }
      .panel { border:1px solid rgb(242 106 33 / 42%); border-radius:8px; background:rgb(242 106 33 / 8%); padding:24px; }
      p { color:#334155; line-height:1.6; }
    </style>
  </head>
  <body>
    <main>
      <div class="brand">
        {{brandLogo}}
        <strong>{{brandName}}</strong>
      </div>
      <div class="panel">
        <h1>That attachment deserved a pause.</h1>
        <p>This was a simulation. Unexpected documents, scans, and invoices are common entry points for real attacks.</p>
        <p>{{trainingDescription}}</p>
      </div>
    </main>
  </body>
</html>`;

  await db
    .insert(landingPages)
    .values([
      {
        id: "system-landing-friendly-training",
        organisationId: null,
        name: "Friendly simulation training",
        type: "friendly_simulation",
        html: friendlyLandingHtml,
        linkedTrainingModuleId: phishingBasicsId,
      },
      {
        id: "system-landing-account-check",
        organisationId: null,
        name: "Account sign-in check",
        type: "credential_harvest",
        html: credentialLandingHtml,
        linkedTrainingModuleId: phishingBasicsId,
      },
      {
        id: "system-landing-attachment-warning",
        organisationId: null,
        name: "Attachment warning",
        type: "attachment_warning",
        html: attachmentLandingHtml,
        linkedTrainingModuleId: phishingBasicsId,
      },
    ])
    .onConflictDoUpdate({
      target: landingPages.id,
      set: {
        name: sql`excluded.name`,
        type: sql`excluded.type`,
        html: sql`excluded.html`,
        linkedTrainingModuleId: sql`excluded.linked_training_module_id`,
        updatedAt: new Date(),
      },
    });

  console.info(`Seeded ${templates.length} fictional Collie demo templates and 3 landing pages.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => process.exit(0));
