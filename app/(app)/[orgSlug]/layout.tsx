import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { getPostAuthRedirect } from "@/lib/auth/redirect";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

export default async function OrganisationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const session = await getSession();

  if (!session) {
    redirect(`/signin?next=/${orgSlug}/dashboard`);
  }

  const [user] = await db
    .select({
      organisationId: users.organisationId,
      mfaRequired: users.mfaRequired,
      mfaEnabled: users.mfaEnabled,
      active: users.active,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!user?.active) {
    redirect("/signin?inactive=1");
  }

  if (user.mfaRequired && !user.mfaEnabled) {
    redirect("/security/mfa-setup");
  }

  const redirectTo = await getPostAuthRedirect(user.organisationId);

  if (redirectTo === "/onboarding") {
    redirect(redirectTo);
  }

  if (!redirectTo.startsWith(`/${orgSlug}/`)) {
    redirect(redirectTo);
  }

  return <AppShell orgSlug={orgSlug}>{children}</AppShell>;
}
