import Link from "next/link";
import { Suspense } from "react";

import { CollieLogo } from "@/components/app/collie-logo";
import { SignInForm } from "@/components/app/sign-in-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SignInPage() {
  return (
    <main className="grid min-h-screen bg-[var(--collie-navy)] text-[var(--collie-white)] lg:grid-cols-[1fr_520px]">
      <section className="hidden flex-col justify-between p-10 lg:flex">
        <CollieLogo href="/" variant="dark" />
        <div className="max-w-xl">
          <p className="mb-4 text-sm font-medium text-primary-foreground/62">Train, do not trick</p>
          <h1 className="text-4xl font-semibold leading-tight tracking-normal">
            Practical awareness training for teams that deserve respect.
          </h1>
          <p className="mt-5 max-w-lg text-sm leading-6 text-primary-foreground/70">
            Keep simulations realistic, landing pages kind, and reporting clear enough for busy Australian teams.
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
              <CardTitle>Sign in to Collie</CardTitle>
              <CardDescription>Continue training your team with calm, practical security habits.</CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense fallback={<p className="text-sm text-muted-foreground">Loading sign in...</p>}>
                <SignInForm />
              </Suspense>
              <p className="mt-4 text-center text-sm text-muted-foreground">
                New to Collie?{" "}
                <Link className="font-medium text-primary underline-offset-4 hover:underline" href="/signup">
                  Create an account
                </Link>
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
