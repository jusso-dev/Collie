import { redirect } from "next/navigation";

import { getPostAuthRedirect } from "@/lib/auth/redirect";
import { getSession } from "@/lib/auth/session";

export default async function DashboardRedirectPage() {
  const session = await getSession();

  if (!session) {
    redirect("/signin?next=/dashboard");
  }

  const organisationId =
    "organisationId" in session.user ? (session.user.organisationId as string | null) : null;

  redirect(await getPostAuthRedirect(organisationId));
}
