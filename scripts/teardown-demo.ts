import { inArray, or, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { organisations, users } from "@/lib/db/schema";

async function main() {
  const demoOrganisations = await db
    .select({
      id: organisations.id,
      name: organisations.name,
      slug: organisations.slug,
    })
    .from(organisations)
    .where(
      or(
        eq(organisations.slug, "demo"),
        eq(organisations.slug, "demo-au"),
        eq(organisations.name, "Demo AU"),
      ),
    );

  if (demoOrganisations.length === 0) {
    console.info("No legacy demo organisations found.");
    return;
  }

  const organisationIds = demoOrganisations.map((organisation) => organisation.id);

  await db.delete(users).where(inArray(users.organisationId, organisationIds));
  await db.delete(organisations).where(inArray(organisations.id, organisationIds));

  console.info(
    `Removed ${demoOrganisations.length} legacy demo organisation${demoOrganisations.length === 1 ? "" : "s"}.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => process.exit(0));
