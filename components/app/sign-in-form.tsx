"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/auth/client";
import { discoverSsoForEmail } from "@/app/actions/sso";

const schema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(10, "Password must be at least 10 characters"),
});

type FormValues = z.infer<typeof schema>;

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const callbackURL = next?.startsWith("/") ? next : "/dashboard";
  const [serverError, setServerError] = useState<string | null>(null);
  const [ssoBusy, setSsoBusy] = useState(false);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function continueWithSso(email: string) {
    setServerError(null);
    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setServerError("Enter your work email to continue with SSO.");
      return;
    }
    setSsoBusy(true);
    try {
      const result = await discoverSsoForEmail({ email: trimmed });
      if (result.kind === "none") {
        setServerError("No SSO configuration found for that email. Use password sign-in or contact your admin.");
        return;
      }
      if (result.kind === "saml") {
        setServerError("SAML SSO is configured but the assertion handler is still being shipped. Use OIDC for now.");
        return;
      }
      const oauthResult = await signIn.oauth2({ providerId: result.providerId, callbackURL });
      if (oauthResult.error) {
        setServerError(oauthResult.error.message ?? "Unable to start SSO sign-in");
      }
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Unable to start SSO sign-in");
    } finally {
      setSsoBusy(false);
    }
  }

  async function onSubmit(values: FormValues) {
    setServerError(null);

    // Defense in depth: probe for an SSO requirement before submitting a
    // password. The server-side hook also rejects, but this keeps the UX clean.
    try {
      const discovery = await discoverSsoForEmail({ email: values.email });
      if (discovery.kind !== "none" && discovery.enforceSso) {
        if (discovery.kind === "oidc") {
          await continueWithSso(values.email);
          return;
        }
        setServerError("Single sign-on is required for this organisation. Contact your admin.");
        return;
      }
    } catch {
      // If discovery fails we still try the password flow — the server hook
      // remains authoritative.
    }

    const result = await signIn.email({
      email: values.email,
      password: values.password,
    });

    if (result.error) {
      setServerError(result.error.message ?? "Unable to sign in");
      return;
    }

    // BetterAuth's twoFactor plugin replies with `twoFactorRedirect: true`
    // when the user must complete a second factor before the session is
    // issued. The twoFactorClient plugin already navigates to the challenge
    // page via its onTwoFactorRedirect handler — bail out so we don't race it.
    const data = result.data as { twoFactorRedirect?: boolean } | null;
    if (data?.twoFactorRedirect) return;

    router.push(callbackURL);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" {...register("email")} />
        {errors.email ? <p className="text-xs text-destructive">{errors.email.message}</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" autoComplete="current-password" {...register("password")} />
        {errors.password ? <p className="text-xs text-destructive">{errors.password.message}</p> : null}
      </div>
      {serverError ? (
        <p className="text-sm text-destructive" aria-live="polite">
          {serverError}
        </p>
      ) : null}
      <Button className="w-full" type="submit" disabled={isSubmitting || ssoBusy}>
        {isSubmitting ? "Signing in..." : "Sign in"}
      </Button>
      <div className="relative my-2">
        <div className="absolute inset-0 flex items-center" aria-hidden>
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase tracking-wide text-muted-foreground">
          <span className="bg-card px-2">or</span>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={ssoBusy || isSubmitting}
        onClick={() => continueWithSso(getValues("email"))}
      >
        {ssoBusy ? "Redirecting to SSO..." : "Sign in with single sign-on"}
      </Button>
    </form>
  );
}
