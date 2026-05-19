"use client";

import { useActionState, useState } from "react";

import { saveSendingSettings, sendTransportTestEmail, type TransportTestResult } from "@/app/actions/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SendingTransport = "resend" | "smtp";

type Props = {
  orgSlug: string;
  initialTransport: SendingTransport;
  senderFromAddress: string | null;
  hasResendKey: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUsername: string | null;
  hasSmtpPassword: boolean;
  smtpSecure: boolean;
  smtpFromAddress: string | null;
  /** Existing default reply-to recipient for the test-send field. */
  testRecipientDefault: string | null;
};

export function EmailSendingSettings(props: Props) {
  const [transport, setTransport] = useState<SendingTransport>(props.initialTransport);
  const isConfigured =
    transport === "resend"
      ? props.hasResendKey && Boolean(props.senderFromAddress)
      : Boolean(props.smtpHost && props.smtpPort && props.smtpFromAddress);

  const [testState, runTestAction, isTestPending] = useActionState<TransportTestResult | null, FormData>(
    sendTransportTestEmail,
    null,
  );

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-medium">Email sending</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a transport for outbound simulation emails. Switch transports without losing your existing From address.
          </p>
        </div>
        <Badge variant={isConfigured ? "default" : "outline"}>
          {isConfigured ? "Configured" : "Not configured"}
        </Badge>
      </div>

      <form action={saveSendingSettings} className="mt-5 space-y-5">
        <input type="hidden" name="orgSlug" value={props.orgSlug} />

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Transport</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
                transport === "resend" ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <input
                type="radio"
                name="transport"
                value="resend"
                checked={transport === "resend"}
                onChange={() => setTransport("resend")}
                className="mt-0.5"
              />
              <div>
                <div className="font-medium">Resend</div>
                <div className="text-muted-foreground">
                  Fastest path to deliverability — Collie hosted, signed DKIM, click + open events.
                </div>
              </div>
            </label>
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
                transport === "smtp" ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <input
                type="radio"
                name="transport"
                value="smtp"
                checked={transport === "smtp"}
                onChange={() => setTransport("smtp")}
                className="mt-0.5"
              />
              <div>
                <div className="font-medium">SMTP relay</div>
                <div className="text-muted-foreground">
                  Use M365, Google Workspace, an on-prem MTA, or a regional ESP. STARTTLS enforced.
                </div>
              </div>
            </label>
          </div>
        </fieldset>

        <div className="space-y-2">
          <Label htmlFor="sender-from-address">Sender From address (Resend)</Label>
          <Input
            id="sender-from-address"
            name="senderFromAddress"
            type="email"
            defaultValue={props.senderFromAddress ?? ""}
            placeholder="security@your-domain.com"
          />
          <p className="text-xs text-muted-foreground">
            Used by the Resend transport. SMTP uses its own From below.
          </p>
        </div>

        {transport === "resend" ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="resend-api-key">Resend API key</Label>
              <Input
                id="resend-api-key"
                name="resendApiKey"
                type="password"
                autoComplete="off"
                placeholder={props.hasResendKey ? "Leave blank to keep existing key" : "re_..."}
              />
              <p className="text-xs text-muted-foreground">Stored encrypted. Leave blank to keep the existing key.</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="smtp-host">Host</Label>
              <Input id="smtp-host" name="smtpHost" defaultValue={props.smtpHost ?? ""} placeholder="smtp.your-relay.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-port">Port</Label>
              <Input
                id="smtp-port"
                name="smtpPort"
                type="number"
                inputMode="numeric"
                defaultValue={props.smtpPort ?? 587}
                min={1}
                max={65535}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-username">Username</Label>
              <Input
                id="smtp-username"
                name="smtpUsername"
                autoComplete="off"
                defaultValue={props.smtpUsername ?? ""}
                placeholder="apikey or relay user"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-password">Password</Label>
              <Input
                id="smtp-password"
                name="smtpPassword"
                type="password"
                autoComplete="new-password"
                placeholder={props.hasSmtpPassword ? "Leave blank to keep existing password" : "SMTP password"}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-from-address">SMTP From address</Label>
              <Input
                id="smtp-from-address"
                name="smtpFromAddress"
                type="email"
                defaultValue={props.smtpFromAddress ?? ""}
                placeholder="security@your-domain.com"
              />
            </div>
            <div className="flex items-center gap-3 self-end">
              <input
                id="smtp-secure"
                name="smtpSecure"
                type="checkbox"
                defaultChecked={props.smtpSecure}
                className="size-4 rounded border-input"
              />
              <Label htmlFor="smtp-secure" className="text-sm">
                Enforce STARTTLS / TLS (fail closed on bad cert)
              </Label>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <Button type="submit">Save email settings</Button>
        </div>
      </form>

      <div className="mt-6 rounded-lg border border-border bg-[var(--collie-cloud)] p-4">
        <h3 className="text-sm font-medium">Test send</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Sends a short deliverability check using the currently saved {transport === "smtp" ? "SMTP" : "Resend"} settings.
          Save first if you just changed credentials.
        </p>
        <form action={runTestAction} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <input type="hidden" name="orgSlug" value={props.orgSlug} />
          <div className="flex-1 space-y-2">
            <Label htmlFor="test-recipient">Send to</Label>
            <Input
              id="test-recipient"
              name="recipient"
              type="email"
              required
              defaultValue={props.testRecipientDefault ?? ""}
            />
          </div>
          <Button type="submit" variant="outline" disabled={isTestPending}>
            {isTestPending ? "Sending…" : "Send test"}
          </Button>
        </form>
        {testState ? (
          <div
            className={`mt-3 rounded-lg border p-3 text-sm ${
              testState.ok
                ? "border-[rgb(34_197_94_/_0.4)] bg-[rgb(34_197_94_/_0.08)]"
                : "border-[rgb(239_68_68_/_0.4)] bg-[rgb(239_68_68_/_0.08)]"
            }`}
          >
            {testState.ok ? (
              <>
                <span className="font-medium">Test sent via {testState.transport.toUpperCase()}.</span>{" "}
                {testState.messageId ? <span className="font-mono text-xs">id: {testState.messageId}</span> : null}
              </>
            ) : (
              <>
                <span className="font-medium">Test failed.</span> {testState.error}
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
