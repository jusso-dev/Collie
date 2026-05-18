import Link from "next/link";
import { Suspense } from "react";

import { CollieLogo } from "@/components/app/collie-logo";
import { SignUpForm } from "@/components/app/sign-up-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db/client";
import { organisationInvitations, organisations } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite: inviteToken = "" } = await searchParams;
  const [invite] = inviteToken
    ? await db
        .select({
          token: organisationInvitations.token,
          email: organisationInvitations.email,
          role: organisationInvitations.role,
          organisationName: organisations.name,
        })
        .from(organisationInvitations)
        .innerJoin(organisations, eq(organisations.id, organisationInvitations.organisationId))
        .where(
          and(
            eq(organisationInvitations.token, inviteToken),
            eq(organisationInvitations.status, "pending"),
            sql`${organisationInvitations.expiresAt} > now()`,
          ),
        )
        .limit(1)
    : [];

  return (
    <main className="grid min-h-screen bg-[var(--collie-navy)] text-[var(--collie-white)] lg:grid-cols-[1fr_520px]">
      <section className="hidden flex-col justify-between p-10 lg:flex">
        <CollieLogo href="/" variant="dark" />
        <div className="max-w-xl">
          <p className="mb-4 text-sm font-medium text-primary-foreground/62">Australian-built by default</p>
          <h1 className="text-4xl font-semibold leading-tight tracking-normal">
            Start with CSV, Resend, and a calmer first campaign.
          </h1>
          <p className="mt-5 max-w-lg text-sm leading-6 text-primary-foreground/70">
            Add a Resend API key and sender From address when you are ready to send.
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
              <CardTitle>{invite ? `Join ${invite.organisationName}` : "Create your organisation"}</CardTitle>
              <CardDescription>
                {invite
                  ? `Create your account with ${invite.email} to accept this ${invite.role} invite.`
                  : "Start with email and password. Email sending can be configured in settings."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense fallback={<p className="text-sm text-muted-foreground">Loading account setup...</p>}>
                <SignUpForm invite={invite ?? null} />
              </Suspense>
              <p className="mt-4 text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link className="font-medium text-primary underline-offset-4 hover:underline" href="/signin">
                  Sign in
                </Link>
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
