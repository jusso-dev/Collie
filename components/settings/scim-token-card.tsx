"use client";

import { useState, useTransition } from "react";

import { rotateScimToken, revokeScimToken } from "@/app/actions/scim";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ScimTokenCardProps {
  orgSlug: string;
  endpointUrl: string;
  hasToken: boolean;
  issuedAt: Date | null;
}

/**
 * Settings card for the SCIM bearer token. Mints/rotates the token through a
 * server action and shows the plaintext exactly once — refreshing the page or
 * minting again replaces it.
 */
export function ScimTokenCard({ orgSlug, endpointUrl, hasToken, issuedAt }: ScimTokenCardProps) {
  const [pending, startTransition] = useTransition();
  const [latestToken, setLatestToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleRotate() {
    setError(null);
    const formData = new FormData();
    formData.set("orgSlug", orgSlug);
    startTransition(async () => {
      try {
        const result = await rotateScimToken(formData);
        setLatestToken(result.plaintext);
        window.dispatchEvent(new CustomEvent("collie:toast", { detail: { toast: "scim-token-rotated" } }));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not mint a SCIM token.");
      }
    });
  }

  function handleRevoke() {
    setError(null);
    const formData = new FormData();
    formData.set("orgSlug", orgSlug);
    startTransition(async () => {
      try {
        await revokeScimToken(formData);
        setLatestToken(null);
        window.dispatchEvent(new CustomEvent("collie:toast", { detail: { toast: "scim-token-revoked" } }));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not revoke the SCIM token.");
      }
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="font-medium">Directory provisioning (SCIM 2.0)</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Wire Entra ID, Okta, or Google Workspace to keep employees and groups in sync. Minting a new token
            invalidates the previous one immediately.
          </p>
        </div>
        <Badge variant={hasToken ? "default" : "outline"}>
          {hasToken ? "Provisioning enabled" : "Not configured"}
        </Badge>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-[var(--collie-cloud)] p-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">SCIM endpoint</p>
          <p className="mt-2 break-all font-mono text-xs">{endpointUrl}</p>
        </div>
        <div className="rounded-lg border border-border bg-[var(--collie-cloud)] p-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">Token status</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {hasToken
              ? issuedAt
                ? `Active since ${issuedAt.toLocaleString("en-AU")}`
                : "Active"
              : "No bearer token issued yet."}
          </p>
        </div>
      </div>

      {latestToken ? (
        <div className="mt-5 rounded-lg border border-[rgb(56_189_248_/_0.6)] bg-[rgb(56_189_248_/_0.12)] p-4">
          <p className="text-sm font-medium">New SCIM token (shown once)</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Copy this token into your IdP&apos;s Enterprise App secret field. Refreshing the page removes it
            from view — Collie only stores an encrypted copy.
          </p>
          <p className="mt-3 break-all rounded bg-card px-3 py-2 font-mono text-xs">{latestToken}</p>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="button" onClick={handleRotate} disabled={pending}>
          {hasToken ? "Rotate SCIM token" : "Mint SCIM token"}
        </Button>
        {hasToken ? (
          <Button type="button" variant="outline" onClick={handleRevoke} disabled={pending}>
            Revoke token
          </Button>
        ) : null}
      </div>

      <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
        <li>In Entra ID / Okta / Google Workspace, create a SCIM 2.0 Enterprise App.</li>
        <li>Tenant URL: <code className="font-mono text-xs">{endpointUrl}</code></li>
        <li>Secret token: the value shown above when you mint or rotate.</li>
        <li>Map <code>userPrincipalName</code> → <code>userName</code>, <code>givenName</code> → <code>name.givenName</code>, <code>surname</code> → <code>name.familyName</code>.</li>
        <li>De-provisioning soft-deletes employees so historical campaign reports stay intact.</li>
      </ol>
    </div>
  );
}
