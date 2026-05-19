"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { recordAudit } from "@/lib/audit/record";
import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { organisations } from "@/lib/db/schema";

const sendingSettingsSchema = z.object({
  orgSlug: z.string().min(1),
  resendApiKey: z.string().trim().min(8, "Enter a Resend API key"),
  senderFromAddress: z.string().trim().email("Enter a sender From address"),
});

function stringFromForm(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function saveSendingSettings(formData: FormData) {
  const data = sendingSettingsSchema.parse({
    orgSlug: stringFromForm(formData, "orgSlug"),
    resendApiKey: stringFromForm(formData, "resendApiKey"),
    senderFromAddress: stringFromForm(formData, "senderFromAddress"),
  });
  const organisation = await requireOrganisationForSlug(data.orgSlug);

  await db
    .update(organisations)
    .set({
      resendApiKeyEncrypted: data.resendApiKey,
      senderFromAddress: data.senderFromAddress,
      updatedAt: new Date(),
    })
    .where(eq(organisations.id, organisation.id));

  await recordAudit({
    organisationId: organisation.id,
    actorUserId: organisation.userId,
    action: "settings.save_sending",
    resourceType: "organisation",
    resourceId: organisation.id,
    metadata: { senderFromAddress: data.senderFromAddress },
  });

  revalidatePath(`/${data.orgSlug}/settings`);
  revalidatePath(`/${data.orgSlug}/campaigns`);
}
