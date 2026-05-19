"use server";

import { and, eq, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";

import { requireOrganisationRoleForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { trainingModules } from "@/lib/db/schema";
import { pathWithToast } from "@/lib/navigation/toast";
import { extractScormPackage } from "@/lib/training/scorm-import";

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
  const organisation = await requireOrganisationRoleForSlug(data.orgSlug, ["owner", "admin"]);

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
  redirect(pathWithToast(`/${data.orgSlug}/training`, "training-saved"), RedirectType.replace);
}

const importScormSchema = z.object({
  orgSlug: z.string().min(1),
});

type UploadedFile = {
  name?: string;
  size?: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

function uploadedFileFromForm(formData: FormData, key: string): UploadedFile | null {
  const value = formData.get(key);
  if (!value || typeof value !== "object" || !("arrayBuffer" in value)) return null;
  return value as UploadedFile;
}

export async function importScormModule(formData: FormData) {
  const data = importScormSchema.parse({
    orgSlug: valueFromForm(formData, "orgSlug"),
  });
  const upload = uploadedFileFromForm(formData, "scormPackage");

  if (!upload || !upload.size) {
    throw new Error("Choose a SCORM ZIP package to import.");
  }
  if (upload.size > 25 * 1024 * 1024) {
    throw new Error("SCORM package is too large. Keep imports under 25 MB.");
  }

  const organisation = await requireOrganisationRoleForSlug(data.orgSlug, ["owner", "admin"]);
  const imported = extractScormPackage(await upload.arrayBuffer());

  await db.insert(trainingModules).values({
    organisationId: organisation.id,
    title: imported.title,
    description: imported.description,
    durationSeconds: imported.durationSeconds,
    contentType: "interactive",
    topic: imported.topic,
    language: "en-AU",
    contentHtml: imported.contentHtml,
    quiz: [],
  });

  revalidatePath(`/${data.orgSlug}/training`);
  revalidatePath(`/${data.orgSlug}/templates`);
  revalidatePath(`/${data.orgSlug}/landing-pages`);
  revalidatePath(`/${data.orgSlug}/campaigns`);
  redirect(pathWithToast(`/${data.orgSlug}/training`, "training-imported"), RedirectType.replace);
}

const deleteTrainingSchema = z.object({
  orgSlug: z.string().min(1),
  moduleId: z.string().min(1),
});

export async function deleteTrainingModule(formData: FormData) {
  const data = deleteTrainingSchema.parse({
    orgSlug: valueFromForm(formData, "orgSlug"),
    moduleId: valueFromForm(formData, "moduleId"),
  });
  const organisation = await requireOrganisationRoleForSlug(data.orgSlug, ["owner", "admin"]);

  const [module] = await db
    .select({ id: trainingModules.id, organisationId: trainingModules.organisationId })
    .from(trainingModules)
    .where(eq(trainingModules.id, data.moduleId))
    .limit(1);

  if (!module || module.organisationId !== organisation.id) {
    throw new Error("Only custom training modules can be deleted.");
  }

  await db.delete(trainingModules).where(and(eq(trainingModules.id, data.moduleId), eq(trainingModules.organisationId, organisation.id)));

  revalidatePath(`/${data.orgSlug}/training`);
  revalidatePath(`/${data.orgSlug}/templates`);
  revalidatePath(`/${data.orgSlug}/landing-pages`);
  revalidatePath(`/${data.orgSlug}/campaigns`);
  redirect(pathWithToast(`/${data.orgSlug}/training`, "training-deleted"), RedirectType.replace);
}
