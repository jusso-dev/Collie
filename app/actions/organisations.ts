"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import crypto from "node:crypto";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { organisations, users } from "@/lib/db/schema";

const createSchema = z.object({
  name: z.string().trim().min(2, "Enter your organisation name").max(120),
});

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function createUniqueSlug(name: string) {
  const baseSlug = slugify(name) || crypto.randomBytes(4).toString("hex");

  for (let index = 0; index < 50; index += 1) {
    const slug = index === 0 ? baseSlug : `${baseSlug}-${index + 1}`;
    const [existing] = await db
      .select({ id: organisations.id })
      .from(organisations)
      .where(eq(organisations.slug, slug))
      .limit(1);

    if (!existing) {
      return slug;
    }
  }

  return `${baseSlug}-${crypto.randomBytes(4).toString("hex")}`;
}

export async function createOrganisation(input: z.infer<typeof createSchema>) {
  const session = await requireSession();
  const data = createSchema.parse(input);

  const currentOrganisationId =
    "organisationId" in session.user ? (session.user.organisationId as string | null) : null;

  if (currentOrganisationId) {
    const [organisation] = await db
      .select({ slug: organisations.slug })
      .from(organisations)
      .where(eq(organisations.id, currentOrganisationId))
      .limit(1);

    if (organisation) {
      return { slug: organisation.slug };
    }
  }

  const slug = await createUniqueSlug(data.name);
  const [organisation] = await db
    .insert(organisations)
    .values({
      name: data.name,
      slug,
      plan: "trial",
      dataRegion: "au",
    })
    .returning({ id: organisations.id, slug: organisations.slug });

  await db
    .update(users)
    .set({
      organisationId: organisation.id,
      role: "owner",
      updatedAt: new Date(),
    })
    .where(eq(users.id, session.user.id));

  revalidatePath("/dashboard");

  return { slug: organisation.slug };
}
