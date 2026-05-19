"use server";

import { and, eq, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { landingPages, trainingModules } from "@/lib/db/schema";

const landingPageSchema = z.object({
  orgSlug: z.string().min(1),
  pageId: z.string().optional(),
  name: z.string().trim().min(2).max(120),
  type: z.enum([
    "credential_harvest",
    "attachment_warning",
    "training_redirect",
    "friendly_simulation",
    "mfa_push_simulator",
    "oauth_consent",
    "usb_drop",
    "voice_callback",
    "deepfake_disclosure",
  ]),
  html: z.string().trim().min(20),
  linkedTrainingModuleId: z.string().optional(),
});

function valueFromForm(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function saveLandingPage(formData: FormData) {
  const data = landingPageSchema.parse({
    orgSlug: valueFromForm(formData, "orgSlug"),
    pageId: valueFromForm(formData, "pageId") || undefined,
    name: valueFromForm(formData, "name"),
    type: valueFromForm(formData, "type"),
    html: valueFromForm(formData, "html"),
    linkedTrainingModuleId: valueFromForm(formData, "linkedTrainingModuleId") || undefined,
  });
  const organisation = await requireOrganisationForSlug(data.orgSlug);

  if (data.linkedTrainingModuleId) {
    const [training] = await db
      .select({ id: trainingModules.id })
      .from(trainingModules)
      .where(
        and(
          eq(trainingModules.id, data.linkedTrainingModuleId),
          or(eq(trainingModules.organisationId, organisation.id), sql`${trainingModules.organisationId} is null`),
        ),
      )
      .limit(1);

    if (!training) {
      throw new Error("Choose a valid training module.");
    }
  }

  if (data.pageId) {
    const [existing] = await db
      .select({ organisationId: landingPages.organisationId })
      .from(landingPages)
      .where(
        and(
          eq(landingPages.id, data.pageId),
          or(eq(landingPages.organisationId, organisation.id), sql`${landingPages.organisationId} is null`),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new Error("Landing page is not available.");
    }

    if (existing.organisationId === organisation.id) {
      await db
        .update(landingPages)
        .set({
          name: data.name,
          type: data.type,
          html: data.html,
          linkedTrainingModuleId: data.linkedTrainingModuleId ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(landingPages.id, data.pageId), eq(landingPages.organisationId, organisation.id)));
    } else {
      await db.insert(landingPages).values({
        organisationId: organisation.id,
        name: data.name,
        type: data.type,
        html: data.html,
        linkedTrainingModuleId: data.linkedTrainingModuleId ?? null,
      });
    }
  } else {
    await db.insert(landingPages).values({
      organisationId: organisation.id,
      name: data.name,
      type: data.type,
      html: data.html,
      linkedTrainingModuleId: data.linkedTrainingModuleId ?? null,
    });
  }

  revalidatePath(`/${data.orgSlug}/landing-pages`);
  revalidatePath(`/${data.orgSlug}/campaigns`);
}
