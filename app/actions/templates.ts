"use server";

import { and, eq, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";

import { requireOrganisationRoleForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { emailTemplates, trainingModules } from "@/lib/db/schema";
import { pathWithToast } from "@/lib/navigation/toast";

const templateSchema = z.object({
  orgSlug: z.string().min(1),
  templateId: z.string().optional(),
  name: z.string().trim().min(2).max(140),
  category: z.enum([
    "credential_harvest",
    "invoice_fraud",
    "ceo_impersonation",
    "qr_code",
    "callback",
    "package_delivery",
    "tax",
    "telecom",
    "document_share",
    "attachment_pdf",
    "attachment_html",
    "usb_drop",
    "oauth_consent",
    "mfa_push",
    "sms_lure",
    "vishing",
    "deepfake_exec",
  ]),
  deliveryChannel: z.enum(["email", "sms", "voice", "qr", "attachment", "usb"]).default("email"),
  difficulty: z.coerce.number().int().min(1).max(5),
  subject: z.string().trim().min(2).max(180),
  fromName: z.string().trim().min(2).max(120),
  fromEmailPattern: z.string().trim().min(3).max(180),
  htmlBody: z.string().trim().min(20),
  textBody: z.string().trim().min(5),
  language: z.string().trim().min(2).max(20),
  region: z.string().trim().min(2).max(20),
  linkedTrainingModuleId: z.string().optional(),
});

function valueFromForm(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function saveEmailTemplate(formData: FormData) {
  const data = templateSchema.parse({
    orgSlug: valueFromForm(formData, "orgSlug"),
    templateId: valueFromForm(formData, "templateId") || undefined,
    name: valueFromForm(formData, "name"),
    category: valueFromForm(formData, "category"),
    deliveryChannel: valueFromForm(formData, "deliveryChannel") || "email",
    difficulty: valueFromForm(formData, "difficulty"),
    subject: valueFromForm(formData, "subject"),
    fromName: valueFromForm(formData, "fromName"),
    fromEmailPattern: valueFromForm(formData, "fromEmailPattern"),
    htmlBody: valueFromForm(formData, "htmlBody"),
    textBody: valueFromForm(formData, "textBody"),
    language: valueFromForm(formData, "language") || "en-AU",
    region: valueFromForm(formData, "region") || "au",
    linkedTrainingModuleId: valueFromForm(formData, "linkedTrainingModuleId") || undefined,
  });
  const organisation = await requireOrganisationRoleForSlug(data.orgSlug, ["owner", "admin"]);

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

  const values = {
    organisationId: organisation.id,
    name: data.name,
    category: data.category,
    deliveryChannel: data.deliveryChannel,
    difficulty: data.difficulty,
    subject: data.subject,
    fromName: data.fromName,
    fromEmailPattern: data.fromEmailPattern,
    htmlBody: data.htmlBody,
    textBody: data.textBody,
    language: data.language,
    region: data.region,
    linkedTrainingModuleId: data.linkedTrainingModuleId ?? null,
    updatedAt: new Date(),
  };

  if (data.templateId) {
    const [existing] = await db
      .select({ organisationId: emailTemplates.organisationId })
      .from(emailTemplates)
      .where(
        and(
          eq(emailTemplates.id, data.templateId),
          or(eq(emailTemplates.organisationId, organisation.id), sql`${emailTemplates.organisationId} is null`),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new Error("Template is not available.");
    }

    if (existing.organisationId === organisation.id) {
      await db
        .update(emailTemplates)
        .set(values)
        .where(and(eq(emailTemplates.id, data.templateId), eq(emailTemplates.organisationId, organisation.id)));
    } else {
      await db.insert(emailTemplates).values(values);
    }
  } else {
    await db.insert(emailTemplates).values(values);
  }

  revalidatePath(`/${data.orgSlug}/templates`);
  revalidatePath(`/${data.orgSlug}/campaigns`);
  redirect(pathWithToast(`/${data.orgSlug}/templates`, "template-saved"), RedirectType.replace);
}

const deleteTemplateSchema = z.object({
  orgSlug: z.string().min(1),
  templateId: z.string().min(1),
});

export async function deleteEmailTemplate(formData: FormData) {
  const data = deleteTemplateSchema.parse({
    orgSlug: valueFromForm(formData, "orgSlug"),
    templateId: valueFromForm(formData, "templateId"),
  });
  const organisation = await requireOrganisationRoleForSlug(data.orgSlug, ["owner", "admin"]);

  const [template] = await db
    .select({ id: emailTemplates.id, name: emailTemplates.name, organisationId: emailTemplates.organisationId })
    .from(emailTemplates)
    .where(eq(emailTemplates.id, data.templateId))
    .limit(1);

  if (!template || template.organisationId !== organisation.id) {
    throw new Error("Only custom templates can be deleted.");
  }

  await db.delete(emailTemplates).where(and(eq(emailTemplates.id, data.templateId), eq(emailTemplates.organisationId, organisation.id)));

  revalidatePath(`/${data.orgSlug}/templates`);
  revalidatePath(`/${data.orgSlug}/campaigns`);
  redirect(pathWithToast(`/${data.orgSlug}/templates`, "template-deleted"), RedirectType.replace);
}
