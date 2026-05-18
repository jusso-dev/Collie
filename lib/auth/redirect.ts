import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { organisations } from "@/lib/db/schema";

export async function getPostAuthRedirect(organisationId?: string | null) {
  if (!organisationId) {
    return "/onboarding";
  }

  const [organisation] = await db
    .select({ slug: organisations.slug })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);

  return organisation ? `/${organisation.slug}/dashboard` : "/onboarding";
}
