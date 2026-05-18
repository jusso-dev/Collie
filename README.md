# Collie

<p align="center">
  <img src="docs/assets/collie-logo-readme.png" alt="Collie, herd your humans to safer habits" width="920" />
</p>

Collie is a modern phishing simulation and security awareness training platform for Australian and APAC organisations.

The product principle is simple: train, do not trick. Collie treats missed cues as teachable moments, not gotcha screens. Admins get enough detail to improve risk posture, while employees get calm, direct coaching.

## Product Screenshots

These screenshots are generated from a temporary fake tenant by `pnpm screenshots:readme`. The script signs up a fake admin, seeds fake employees, a fake campaign, rendered email HTML, and a rendered landing page, captures screenshots, then deletes the fake tenant from Postgres.

<details>
  <summary><strong>Dashboard</strong></summary>

  <br />

  <img src="docs/assets/screenshots/dashboard.png" alt="Collie dashboard" />
</details>

<details>
  <summary><strong>Campaign results</strong></summary>

  <br />

  <img src="docs/assets/screenshots/campaign-results.png" alt="Collie campaign results" />
</details>

<details>
  <summary><strong>Template preview</strong></summary>

  <br />

  <img src="docs/assets/screenshots/template-preview.png" alt="Collie template preview" />
</details>

<details>
  <summary><strong>Rendered simulation email</strong></summary>

  <br />

  <img src="docs/assets/screenshots/rendered-email.png" alt="Rendered phishing simulation email" />
</details>

<details>
  <summary><strong>Rendered landing page</strong></summary>

  <br />

  <img src="docs/assets/screenshots/rendered-landing-page.png" alt="Rendered campaign landing page" />
</details>

The rendered HTML captured for the email and landing page is also saved under `docs/assets/screenshots/rendered-email.html` and `docs/assets/screenshots/rendered-landing-page.html`.

## What Collie Does

- Creates isolated organisation tenants with admin users, invitations, role management, password reset flows, and MFA requirement controls.
- Manages employees with manual entry, CSV import, groups, departments, managers, timezones, soft deactivation, and risk scores.
- Provides phishing simulation email templates, landing page templates, and short training modules.
- Builds campaigns with a template, landing page, target group, send strategy, optional node-cron schedule, and per-recipient tracking token.
- Sends simulation emails through Resend using the organisation's API key and sender From address.
- Tracks sent, opened, clicked, submitted, reported, trained, bounced, and complained events.
- Records credential form submissions without storing password values.
- Matches reported emails through inbound report markers and tokenised report addresses.
- Shows dashboards, campaign results, report exports, template previews, landing page previews, and training module editing.

## Brand System

Collie uses a restrained product palette:

| Name | Hex | Use |
| --- | --- | --- |
| Deep Navy | `#0D1B2A` | Primary text, logo outline, dark UI |
| Collie White | `#FCFDFF` | App background and clean surfaces |
| Outback Orange | `#F26A21` | Calls to action, phishing hook accents |
| Collie Blue | `#1E3A8A` | Trust, navigation, charting |
| Water Blue | `#38BDF8` | Supporting accents and focus states |
| Slate | `#64748B` | Muted text and borders |

Australian spelling is intentional throughout the app. Use `organisation`, not `organization`.

## Stack

- Next.js 16 App Router and React 19
- TypeScript strict mode
- BetterAuth for email/password auth
- Drizzle ORM with PostgreSQL
- Tailwind CSS v4 and shadcn/ui
- React Email style HTML rendering for campaign templates
- Resend for outbound simulation delivery and inbound report handling
- node-cron for local scheduled campaign dispatch
- Playwright for product audit and README screenshot capture

## Local Development

Prerequisites:

- Node.js 20+
- pnpm
- Docker, if you want the local Postgres workflow below

Create the database:

```bash
docker run --name collie-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=collie \
  -p 5432:5432 \
  -d postgres:16
```

Install and configure:

```bash
pnpm install
cp example.env .env
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The default local database URL is:

```bash
DATABASE_URL="postgres://postgres:postgres@localhost:5432/collie"
```

`scripts/seed.ts` creates safe system training content, fictional demo email templates, and generic landing pages. It does not create a demo organisation, employees, or campaigns.

## Environment Variables

Use `example.env` as the source of truth.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string used by Drizzle |
| `BETTER_AUTH_SECRET` | BetterAuth signing secret |
| `BETTER_AUTH_URL` | Local or deployed app URL for auth callbacks |
| `NEXT_PUBLIC_BETTER_AUTH_URL` | Browser-visible auth URL |
| `NEXT_PUBLIC_APP_URL` | Public tracking URL used in campaign links and pixels |
| `RESEND_API_KEY` | Default transactional key for local development |
| `NEXT_PUBLIC_INBOUND_EMAIL_DOMAIN` | Domain used to build report-by-forwarding addresses |

Open tracking only works in Gmail, Outlook, and other remote mail clients when `NEXT_PUBLIC_APP_URL` is a public HTTPS URL. A localhost pixel cannot be fetched by a remote mail client.

## Database Commands

```bash
pnpm db:generate      # create a Drizzle migration from schema changes
pnpm db:migrate       # apply migrations
pnpm db:push          # push schema directly during early local work
pnpm db:seed          # seed safe fictional templates and training content
pnpm db:teardown-demo # remove old demo/demo-au tenants if they exist
```

## Screenshot Capture

Generate the README screenshots with:

```bash
pnpm screenshots:readme
```

By default the script starts Next on `http://localhost:3107`, signs up `readme-capture-<timestamp>@example.test`, seeds fake data, captures screenshots, writes rendered HTML files, and deletes all rows matching `readme-capture-*`.

To use an already running app:

```bash
README_SCREENSHOT_BASE_URL="http://localhost:3000" pnpm screenshots:readme
```

The cleanup is intentionally narrow. It deletes only organisations with slugs beginning `readme-capture-` and users with emails beginning `readme-capture-` at `example.test`.

## Private Brand Template Pack

The public repository intentionally does not ship ready-to-send impersonation templates or credential-style landing pages for real brands.

Realistic Australian and APAC brand templates live in the private repository:

```text
/Users/justinmiddler/code-projects/Collie-brandtemplates
```

That private pack contains:

- realistic email template seed data
- real brand colour mappings
- real favicon/logo domain mappings
- realistic landing page template HTML
- install instructions for verified defensive users

The public app can render those private templates locally because landing pages now infer the brand colour and logo domain from the selected email template HTML. For example, a private Australia Post template that includes the AusPost favicon domain and red brand accent will render a matching landing page without adding real-brand impersonation mappings to the public repository.

Access to the private pack should be limited to verified defensive use. Ask requesters for their organisation, work email, intended training use case, and confirmation that they are authorised to run simulations for the target organisation.

Do not commit real-brand phishing templates, real-brand credential landing pages, or private brand logo mappings to this public repository.

## Campaign Tracking Model

Every campaign target receives a unique opaque token.

- Click URL: `/c/{token}`
- Open pixel: `/p/{token}.gif`
- Report endpoint: `/api/report`
- Report marker: embedded into email HTML and plain text
- Reply/report address: generated from the token and inbound report domain

When a recipient opens a pixel, clicks a link, submits a form, reports an email, or completes training, Collie appends an event row and updates the campaign target summary columns. Events are the source of truth for reporting.

Credential-style landing pages record non-sensitive form fields and replace password values with `[provided]`.

## Scheduling

Campaigns support:

- immediate sends
- drip sends
- randomised send windows
- optional node-cron expressions while keeping simple date and time pickers in the UI

Local node-cron scheduling is useful for development and small deployments. For horizontally scaled production, move campaign dispatch to a single worker or a managed background job runner so a campaign is not sent by multiple app instances.

## Useful Routes

- `/signup`
- `/signin`
- `/dashboard`
- `/{orgSlug}/dashboard`
- `/{orgSlug}/employees`
- `/{orgSlug}/groups`
- `/{orgSlug}/campaigns`
- `/{orgSlug}/campaigns/{campaignId}`
- `/{orgSlug}/templates`
- `/{orgSlug}/landing-pages`
- `/{orgSlug}/training`
- `/{orgSlug}/reports`
- `/{orgSlug}/settings`
- `/c/{token}`
- `/p/{token}.gif`
- `/api/report`

## Safety Notes

Collie is for authorised security awareness training. Use it only for organisations and recipients where you have explicit permission.

The default public seed data is fictional by design. Realistic brand templates and landing pages belong in the private verified template pack, not in this repository.

## Verification

Useful checks before pushing:

```bash
pnpm lint
pnpm build
pnpm test:e2e
pnpm screenshots:readme
```
