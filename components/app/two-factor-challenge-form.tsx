"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { twoFactor } from "@/lib/auth/client";

const totpSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$|^\d{3}\s\d{3}$/u, "Enter the 6-digit code from your authenticator."),
});

// Backup codes are issued in the form `xxxxx-xxxxx` (5 chars, dash, 5 chars)
// by BetterAuth's twoFactor plugin. We accept any non-empty trimmed string of
// reasonable length to avoid blocking legitimate codes that future revisions
// of the plugin might format differently.
const backupSchema = z.object({
  code: z.string().trim().min(6, "Enter a backup code from when you enrolled.").max(64),
});

type Mode = "totp" | "backup";

export function TwoFactorChallengeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const [mode, setMode] = useState<Mode>("totp");
  const [serverError, setServerError] = useState<string | null>(null);

  const totpForm = useForm<{ code: string }>({ resolver: zodResolver(totpSchema) });
  const backupForm = useForm<{ code: string }>({ resolver: zodResolver(backupSchema) });

  async function onSubmitTotp(values: { code: string }) {
    setServerError(null);
    const result = await twoFactor.verifyTotp({ code: values.code.replace(/\s+/g, "") });
    if (result.error) {
      setServerError(result.error.message ?? "That code did not match.");
      return;
    }
    finish();
  }

  async function onSubmitBackup(values: { code: string }) {
    setServerError(null);
    const result = await twoFactor.verifyBackupCode({ code: values.code.trim() });
    if (result.error) {
      setServerError(result.error.message ?? "That backup code did not match.");
      return;
    }
    finish();
  }

  function finish() {
    const target = next?.startsWith("/") ? next : "/dashboard";
    router.push(target);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {mode === "totp" ? (
        <form onSubmit={totpForm.handleSubmit(onSubmitTotp)} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="code">6-digit code</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={7}
              {...totpForm.register("code")}
            />
            {totpForm.formState.errors.code ? (
              <p className="text-xs text-destructive">{totpForm.formState.errors.code.message}</p>
            ) : null}
          </div>
          {serverError ? (
            <p className="text-sm text-destructive" aria-live="polite">
              {serverError}
            </p>
          ) : null}
          <Button className="w-full" type="submit" disabled={totpForm.formState.isSubmitting}>
            {totpForm.formState.isSubmitting ? "Verifying..." : "Verify and continue"}
          </Button>
        </form>
      ) : (
        <form onSubmit={backupForm.handleSubmit(onSubmitBackup)} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="backup-code">Backup code</Label>
            <Input
              id="backup-code"
              autoComplete="off"
              autoFocus
              spellCheck={false}
              {...backupForm.register("code")}
            />
            {backupForm.formState.errors.code ? (
              <p className="text-xs text-destructive">{backupForm.formState.errors.code.message}</p>
            ) : null}
          </div>
          {serverError ? (
            <p className="text-sm text-destructive" aria-live="polite">
              {serverError}
            </p>
          ) : null}
          <Button className="w-full" type="submit" disabled={backupForm.formState.isSubmitting}>
            {backupForm.formState.isSubmitting ? "Verifying..." : "Use backup code"}
          </Button>
        </form>
      )}
      <button
        type="button"
        className="text-xs font-medium text-muted-foreground underline-offset-4 hover:underline"
        onClick={() => {
          setServerError(null);
          setMode((current) => (current === "totp" ? "backup" : "totp"));
        }}
      >
        {mode === "totp" ? "Use a backup code instead" : "Back to authenticator code"}
      </button>
    </div>
  );
}
