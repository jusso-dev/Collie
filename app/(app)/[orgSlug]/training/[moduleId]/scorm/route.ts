import { and, eq, or, sql } from "drizzle-orm";

import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { trainingModules } from "@/lib/db/schema";
import { buildScorm12Package, scormPackageFilename } from "@/lib/training/scorm";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; moduleId: string }> },
) {
  const { orgSlug, moduleId } = await params;
  const organisation = await requireOrganisationForSlug(orgSlug);
  const [module] = await db
    .select()
    .from(trainingModules)
    .where(
      and(
        eq(trainingModules.id, moduleId),
        or(eq(trainingModules.organisationId, organisation.id), sql`${trainingModules.organisationId} is null`),
      ),
    )
    .limit(1);

  if (!module) {
    return new Response("Training module not found.", { status: 404 });
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
  const zip = buildScorm12Package({
    module,
    organisationName: organisation.name,
    activityBaseUrl: appUrl,
  });

  return new Response(zip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zip.byteLength),
      "Content-Disposition": `attachment; filename="${scormPackageFilename(module)}"`,
      "Cache-Control": "no-store",
    },
  });
}
