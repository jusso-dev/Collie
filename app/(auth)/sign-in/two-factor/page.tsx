import Link from "next/link";
import { Suspense } from "react";

import { CollieLogo } from "@/components/app/collie-logo";
import { TwoFactorChallengeForm } from "@/components/app/two-factor-challenge-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function TwoFactorChallengePage() {
  return (
    <main className="grid min-h-screen bg-[var(--collie-navy)] text-[var(--collie-white)] lg:grid-cols-[1fr_520px]">
      <section className="hidden flex-col justify-between p-10 lg:flex">
        <CollieLogo href="/" variant="dark" />
        <div className="max-w-xl">
          <p className="mb-4 text-sm font-medium text-primary-foreground/62">One more step</p>
          <h1 className="text-4xl font-semibold leading-tight tracking-normal">
            Confirm it&apos;s you with a 6-digit code.
          </h1>
          <p className="mt-5 max-w-lg text-sm leading-6 text-primary-foreground/70">
            Open the authenticator app where you enrolled Collie and enter the code it shows now. If you&apos;ve lost
            access, ask your administrator to reset MFA on your account.
          </p>
        </div>
      </section>
      <div className="grid place-items-center bg-background px-4 py-10 text-foreground">
        <div className="w-full max-w-md space-y-6">
          <div className="lg:hidden">
            <CollieLogo href="/" />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Two-factor verification</CardTitle>
              <CardDescription>Enter the 6-digit code from your authenticator app, or a single-use backup code.</CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
                <TwoFactorChallengeForm />
              </Suspense>
              <p className="mt-4 text-center text-sm text-muted-foreground">
                Lost your authenticator?{" "}
                <Link className="font-medium text-primary underline-offset-4 hover:underline" href="/signin">
                  Sign in again
                </Link>
                {" "}and ask an admin to reset MFA.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
