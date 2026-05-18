import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { getPostAuthRedirect } from "@/lib/auth/redirect";
import { getSession } from "@/lib/auth/session";

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

  const organisationId =
    "organisationId" in session.user ? (session.user.organisationId as string | null) : null;

  const redirectTo = await getPostAuthRedirect(organisationId);

  if (redirectTo === "/onboarding") {
    redirect(redirectTo);
  }

  if (!redirectTo.startsWith(`/${orgSlug}/`)) {
    redirect(redirectTo);
  }

  return <AppShell orgSlug={orgSlug}>{children}</AppShell>;
}
