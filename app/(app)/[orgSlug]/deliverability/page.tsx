import { AlertCircle, ExternalLink, Globe, Mail, Shield } from "lucide-react";
import Link from "next/link";

import { CopyButton } from "@/components/app/copy-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  buildAllowlistConfig,
  deriveSenderDomain,
  renderM365AdvancedDeliveryBlock,
  renderM365TransportRulePowerShell,
  type AllowlistConfig,
} from "@/lib/deliverability/allowlist";
import { requireOrganisationForSlug } from "@/lib/auth/organisation";

export const metadata = {
  title: "Deliverability allowlisting",
  description:
    "Generate Microsoft 365, Mimecast, and Proofpoint TAP allowlist rules so phishing simulation mail reaches the inbox.",
};

export default async function DeliverabilityPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const organisation = await requireOrganisationForSlug(orgSlug);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  const senderDomain = deriveSenderDomain(organisation.senderFromAddress);

  if (!organisation.senderFromAddress || !senderDomain) {
    return (
      <div className="space-y-6">
        <DeliverabilityHero />
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-[var(--collie-orange)]" aria-hidden="true" />
            <div className="space-y-3">
              <div>
                <h2 className="font-medium">Set a sender From address first</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  The allowlist guide is generated from your organisation&apos;s sender domain. Add the From address you
                  plan to use for simulation campaigns, then return here.
                </p>
              </div>
              <Link
                href={`/${orgSlug}/settings`}
                className={buttonVariants({ variant: "default", size: "default" })}
              >
                Open settings
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const config = buildAllowlistConfig({
    senderDomain,
    senderFromAddress: organisation.senderFromAddress,
    appUrl,
  });

  return (
    <div className="space-y-6">
      <DeliverabilityHero />
      <OrgValuesCard config={config} />
      <Microsoft365Card config={config} />
      <Microsoft365TransportRuleCard config={config} />
      <MimecastCard config={config} />
      <ProofpointCard config={config} />
      <FooterNote config={config} />
    </div>
  );
}

function DeliverabilityHero() {
  return (
    <div className="rounded-lg border border-border bg-[rgb(56_189_248_/_0.08)] p-5">
      <div className="flex items-start gap-3">
        <Shield className="mt-1 size-5 text-[var(--collie-orange)]" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Deliverability — allowlisting</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Phishing simulation mail is blocked or rewritten by Microsoft Defender Safe Links, Mimecast URL Protection,
            and Proofpoint TAP URL Defense unless you tell those gateways to let it through. The blocks below are
            generated from your organisation&apos;s sender domain and Collie&apos;s tracking endpoints. Use the copy
            buttons to paste each value straight into the relevant admin centre.
          </p>
        </div>
      </div>
    </div>
  );
}

function ValueRow({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description?: string;
}) {
  return (
    <div className="grid gap-2 rounded-lg border border-border bg-[var(--collie-cloud)] p-3 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-center">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {description ? <p className="mt-1 text-xs text-muted-foreground/80">{description}</p> : null}
      </div>
      <p className="min-w-0 break-all font-mono text-xs">{value}</p>
      <div className="md:justify-self-end">
        <CopyButton value={value} />
      </div>
    </div>
  );
}

function OrgValuesCard({ config }: { config: AllowlistConfig }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <Globe className="mt-1 size-5 text-[var(--collie-orange)]" aria-hidden="true" />
        <div className="flex-1">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-medium">Your organisation values</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                These values are referenced by every provider section below.
              </p>
            </div>
            <Badge variant="outline">Generated from settings</Badge>
          </div>

          <div className="mt-4 space-y-3">
            <ValueRow label="Sender domain" value={config.senderDomain} />
            <ValueRow label="Sender From address" value={config.senderFromAddress} />
            <ValueRow
              label="Click-tracking URL"
              value={`${config.trackingClickPrefix}*`}
              description="Wildcard match — paste exactly as shown."
            />
            <ValueRow
              label="Tracking pixel URL"
              value={`${config.trackingPixelPrefix}*`}
              description="Wildcard match — paste exactly as shown."
            />
            <ValueRow
              label="Tracking host"
              value={config.trackingDomain}
              description="The bare host portion of your Collie tracking URLs."
            />
          </div>

          <div className="mt-4 rounded-lg border border-border bg-[var(--collie-cloud)] p-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Resend sending IP ranges
                </p>
                <p className="mt-1 text-xs text-muted-foreground/80">
                  Source: Resend documentation. Last verified {config.resendIpRangesLastUpdated}.
                </p>
                <ul className="mt-2 space-y-1 font-mono text-xs">
                  {config.resendIpRanges.map((range) => (
                    <li key={range}>{range}</li>
                  ))}
                </ul>
              </div>
              <CopyButton value={config.resendIpRanges.join("\n")} label="Copy all IPs" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Microsoft365Card({ config }: { config: AllowlistConfig }) {
  const block = renderM365AdvancedDeliveryBlock(config);

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <Mail className="mt-1 size-5 text-[var(--collie-orange)]" aria-hidden="true" />
        <div className="flex-1">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-medium">Microsoft 365 — Advanced Delivery Policy</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Tells Defender for Office 365 that mail from these domains, IPs, and URLs is a sanctioned phishing
                simulation. Safe Links, Safe Attachments, ZAP, and Explorer are bypassed without weakening protection
                for real attackers.
              </p>
            </div>
            <Badge variant="outline">Verified {config.adminConsolePathsLastVerified}</Badge>
          </div>

          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
            <li>
              Sign in to the Microsoft Defender portal at{" "}
              <a
                href="https://security.microsoft.com"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
              >
                security.microsoft.com <ExternalLink className="size-3" aria-hidden="true" />
              </a>{" "}
              as a Security Administrator.
            </li>
            <li>
              Go to <span className="font-medium text-foreground">Email &amp; collaboration</span> →{" "}
              <span className="font-medium text-foreground">Policies &amp; rules</span> →{" "}
              <span className="font-medium text-foreground">Threat policies</span> → under{" "}
              <span className="font-medium text-foreground">Rules</span> choose{" "}
              <span className="font-medium text-foreground">Advanced delivery</span>.
            </li>
            <li>
              Open the <span className="font-medium text-foreground">Phishing simulation</span> tab and click{" "}
              <span className="font-medium text-foreground">Add</span> (or{" "}
              <span className="font-medium text-foreground">Edit</span> if a policy already exists).
            </li>
            <li>
              Paste the values below into <span className="font-medium text-foreground">Domain</span>,{" "}
              <span className="font-medium text-foreground">Sending IP</span>, and{" "}
              <span className="font-medium text-foreground">Simulation URLs</span>.
            </li>
            <li>Click Add, then Save. Defender shows the rule as Active within a few minutes.</li>
          </ol>

          <div className="mt-4 rounded-lg border border-border bg-[var(--collie-cloud)] p-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Paste into Phishing Simulation tab
              </p>
              <CopyButton value={block} label="Copy block" />
            </div>
            <pre className="mt-3 overflow-x-auto rounded-md bg-background px-3 py-3 font-mono text-xs leading-5">
              {block}
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

function Microsoft365TransportRuleCard({ config }: { config: AllowlistConfig }) {
  const powershell = renderM365TransportRulePowerShell(config);

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <Shield className="mt-1 size-5 text-[var(--collie-orange)]" aria-hidden="true" />
        <div className="flex-1">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-medium">Microsoft 365 — Safe Links bypass transport rule</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Optional but recommended. Sets{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                  X-MS-Exchange-Organization-SkipSafeLinksProcessing: 1
                </code>{" "}
                on inbound messages from the Resend egress ranges so Safe Links does not rewrite click-tracking URLs
                even on tenants where Advanced Delivery is unavailable.
              </p>
            </div>
            <Badge variant="outline">Verified {config.adminConsolePathsLastVerified}</Badge>
          </div>

          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
            <li>
              Install or update the ExchangeOnlineManagement PowerShell module:{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                Install-Module ExchangeOnlineManagement
              </code>
              .
            </li>
            <li>
              Connect with an Exchange Administrator account:{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                Connect-ExchangeOnline -UserPrincipalName admin@yourtenant.onmicrosoft.com
              </code>
              .
            </li>
            <li>Paste the rule below, then run it. The rule activates in Enforce mode immediately.</li>
            <li>
              Alternatively, recreate the equivalent rule in Exchange admin centre →{" "}
              <span className="font-medium text-foreground">Mail flow</span> →{" "}
              <span className="font-medium text-foreground">Rules</span> using the same conditions and actions.
            </li>
          </ol>

          <div className="mt-4 rounded-lg border border-border bg-[var(--collie-cloud)] p-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                PowerShell (Exchange Online)
              </p>
              <CopyButton value={powershell} label="Copy PowerShell" />
            </div>
            <pre className="mt-3 overflow-x-auto rounded-md bg-background px-3 py-3 font-mono text-xs leading-5">
              {powershell}
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

function MimecastCard({ config }: { config: AllowlistConfig }) {
  const wildcardClick = `${config.trackingClickPrefix}*`;
  const wildcardPixel = `${config.trackingPixelPrefix}*`;
  const senderPattern = `*@${config.senderDomain}`;

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <Mail className="mt-1 size-5 text-[var(--collie-orange)]" aria-hidden="true" />
        <div className="flex-1">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-medium">Mimecast — URL Protection, Attachment Protection, Permitted Senders</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Mimecast strips or rewrites simulation URLs unless the sending domain, IPs, and tracking URLs are
                explicitly bypassed. Configure three policies in the Mimecast Administration Console.
              </p>
            </div>
            <Badge variant="outline">Verified {config.adminConsolePathsLastVerified}</Badge>
          </div>

          <div className="mt-5 space-y-5">
            <div>
              <h3 className="text-sm font-medium text-foreground">1. URL Protection Bypass policy</h3>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
                <li>
                  In the Administration Console go to{" "}
                  <span className="font-medium text-foreground">Administration</span> →{" "}
                  <span className="font-medium text-foreground">Gateway</span> →{" "}
                  <span className="font-medium text-foreground">Policies</span>.
                </li>
                <li>
                  Find <span className="font-medium text-foreground">URL Protection Bypass</span> in the policy list,
                  then click <span className="font-medium text-foreground">New Policy</span>.
                </li>
                <li>
                  Name it <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">Collie phishing sim</code>{" "}
                  and set Bypass Type to <span className="font-medium text-foreground">Disable URL Protection</span>.
                </li>
                <li>
                  Under <span className="font-medium text-foreground">Email Addresses Based On</span> set From to the
                  sender pattern below; under Email Domains add your sender domain. Apply Everywhere with the widest
                  date range you are comfortable with.
                </li>
                <li>
                  Add the click and pixel URLs to{" "}
                  <span className="font-medium text-foreground">URL Protection — Managed URLs</span> as{" "}
                  <span className="font-medium text-foreground">Permit</span> entries (Administration → Gateway →
                  Policies → Managed URLs).
                </li>
              </ol>
            </div>

            <div>
              <h3 className="text-sm font-medium text-foreground">2. Attachment Protection Bypass policy</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Repeat the same steps for{" "}
                <span className="font-medium text-foreground">Attachment Protection Bypass</span> so attachment-based
                simulations are delivered unmodified.
              </p>
            </div>

            <div>
              <h3 className="text-sm font-medium text-foreground">3. Permitted Senders policy</h3>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
                <li>
                  Under <span className="font-medium text-foreground">Anti-Spoofing — Bypass</span> create a new policy
                  that permits the sender pattern from any source IP, then add the Resend ranges below to a Permitted
                  IP list (Administration → Gateway → Policies → Permitted Senders).
                </li>
                <li>Save and place above any conflicting spam or anti-spoofing policies.</li>
              </ol>
            </div>

            <div className="space-y-3">
              <ValueRow label="Sender pattern" value={senderPattern} />
              <ValueRow label="Click-tracking URL" value={wildcardClick} />
              <ValueRow label="Tracking pixel URL" value={wildcardPixel} />
              <div className="rounded-lg border border-border bg-[var(--collie-cloud)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Permitted source IPs
                  </p>
                  <CopyButton value={config.resendIpRanges.join("\n")} label="Copy all IPs" />
                </div>
                <ul className="mt-2 space-y-1 font-mono text-xs">
                  {config.resendIpRanges.map((range) => (
                    <li key={range}>{range}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProofpointCard({ config }: { config: AllowlistConfig }) {
  const wildcardClick = `${config.trackingClickPrefix}*`;
  const wildcardPixel = `${config.trackingPixelPrefix}*`;
  const senderPattern = `*@${config.senderDomain}`;

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <Mail className="mt-1 size-5 text-[var(--collie-orange)]" aria-hidden="true" />
        <div className="flex-1">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-medium">Proofpoint TAP — URL Defense bypass + Click Permit Policy</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Proofpoint URL Defense rewrites every link by default. A Click Permit Policy lets simulation clicks
                through to Collie&apos;s tracking endpoints unrewritten, while keeping URL Defense active for the rest
                of your mail flow.
              </p>
            </div>
            <Badge variant="outline">Verified {config.adminConsolePathsLastVerified}</Badge>
          </div>

          <div className="mt-5 space-y-5">
            <div>
              <h3 className="text-sm font-medium text-foreground">1. URL Defense bypass</h3>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
                <li>
                  Sign in to the TAP dashboard at{" "}
                  <a
                    href="https://threatinsight.proofpoint.com"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
                  >
                    threatinsight.proofpoint.com <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                  .
                </li>
                <li>
                  Go to <span className="font-medium text-foreground">Settings</span> →{" "}
                  <span className="font-medium text-foreground">URL Defense</span> →{" "}
                  <span className="font-medium text-foreground">URL Rewrite Exceptions</span>.
                </li>
                <li>
                  Add the click and pixel URLs below as exceptions so they are never rewritten on the way to your
                  users.
                </li>
              </ol>
            </div>

            <div>
              <h3 className="text-sm font-medium text-foreground">2. Click Permit Policy</h3>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
                <li>
                  Open <span className="font-medium text-foreground">Settings</span> →{" "}
                  <span className="font-medium text-foreground">URL Defense</span> →{" "}
                  <span className="font-medium text-foreground">Click Policies</span>.
                </li>
                <li>
                  Click <span className="font-medium text-foreground">Create Policy</span>, set Action to{" "}
                  <span className="font-medium text-foreground">Permit</span>, and name it{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">Collie phishing simulation</code>.
                </li>
                <li>Apply the policy to the sender pattern and the tracking URLs below. Save and enable.</li>
              </ol>
            </div>

            <div>
              <h3 className="text-sm font-medium text-foreground">3. PPS / Smart Send sender allowlist</h3>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
                <li>
                  If you also run Proofpoint Protection Server (PPS), open{" "}
                  <span className="font-medium text-foreground">System</span> →{" "}
                  <span className="font-medium text-foreground">Connection Management</span> →{" "}
                  <span className="font-medium text-foreground">Safe / Permitted Senders</span>.
                </li>
                <li>
                  Add the sender pattern and the Resend IP ranges below so PPS does not greylist or quarantine
                  simulation mail before TAP sees it.
                </li>
              </ol>
            </div>

            <div className="space-y-3">
              <ValueRow label="Sender pattern" value={senderPattern} />
              <ValueRow label="Click-tracking URL" value={wildcardClick} />
              <ValueRow label="Tracking pixel URL" value={wildcardPixel} />
              <div className="rounded-lg border border-border bg-[var(--collie-cloud)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Permitted source IPs
                  </p>
                  <CopyButton value={config.resendIpRanges.join("\n")} label="Copy all IPs" />
                </div>
                <ul className="mt-2 space-y-1 font-mono text-xs">
                  {config.resendIpRanges.map((range) => (
                    <li key={range}>{range}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FooterNote({ config }: { config: AllowlistConfig }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-4 text-xs leading-6 text-muted-foreground">
      Admin centre paths verified {config.adminConsolePathsLastVerified}. Resend egress IP ranges sourced from the
      Resend documentation (last reviewed {config.resendIpRangesLastUpdated}). Re-check both sources before each
      campaign cycle.
    </div>
  );
}
