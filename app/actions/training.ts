"use server";

import { and, eq, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { trainingModules } from "@/lib/db/schema";

const trainingSchema = z.object({
  orgSlug: z.string().min(1),
  moduleId: z.string().min(1),
  title: z.string().trim().min(2).max(140),
  description: z.string().trim().min(2).max(500),
  durationSeconds: z.coerce.number().int().min(30).max(3600),
  topic: z.string().trim().min(2).max(80),
  contentHtml: z.string().trim().min(2),
});

function valueFromForm(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function saveTrainingModule(formData: FormData) {
  const data = trainingSchema.parse({
    orgSlug: valueFromForm(formData, "orgSlug"),
    moduleId: valueFromForm(formData, "moduleId"),
    title: valueFromForm(formData, "title"),
    description: valueFromForm(formData, "description"),
    durationSeconds: valueFromForm(formData, "durationSeconds"),
    topic: valueFromForm(formData, "topic"),
    contentHtml: valueFromForm(formData, "contentHtml"),
  });
  const organisation = await requireOrganisationForSlug(data.orgSlug);

  const [module] = await db
    .select()
    .from(trainingModules)
    .where(
      and(
        eq(trainingModules.id, data.moduleId),
        or(eq(trainingModules.organisationId, organisation.id), sql`${trainingModules.organisationId} is null`),
      ),
    )
    .limit(1);

  if (!module) {
    throw new Error("Training module not found.");
  }

  if (module.organisationId === organisation.id) {
    await db
      .update(trainingModules)
      .set({
        title: data.title,
        description: data.description,
        durationSeconds: data.durationSeconds,
        topic: data.topic,
        contentHtml: data.contentHtml,
        updatedAt: new Date(),
      })
      .where(and(eq(trainingModules.id, module.id), eq(trainingModules.organisationId, organisation.id)));
  } else {
    await db.insert(trainingModules).values({
      organisationId: organisation.id,
      title: data.title,
      description: data.description,
      durationSeconds: data.durationSeconds,
      contentType: module.contentType,
      topic: data.topic,
      language: module.language,
      contentHtml: data.contentHtml,
      quiz: module.quiz,
    });
  }

  revalidatePath(`/${data.orgSlug}/training`);
}
