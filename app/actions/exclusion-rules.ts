"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";

import { requireOrganisationRoleForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { exclusionRules, groups, type ExclusionRuleParameters } from "@/lib/db/schema";
import { pathWithToast } from "@/lib/navigation/toast";

const ruleKindSchema = z.enum(["group", "new_hire_days", "role", "tag"]);

const baseSchema = z.object({
  orgSlug: z.string().min(1),
  name: z.string().trim().min(2).max(120),
  kind: ruleKindSchema,
  groupId: z.string().trim().optional(),
  days: z.string().trim().optional(),
  active: z.string().trim().optional(),
});

function valueFromForm(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function buildParameters(input: {
  organisationId: string;
  kind: z.infer<typeof ruleKindSchema>;
  groupId?: string;
  days?: string;
}): Promise<ExclusionRuleParameters> {
  switch (input.kind) {
    case "group": {
      const groupId = input.groupId ?? "";
      if (!groupId) throw new Error("Choose the group this rule should exclude.");
      const [group] = await db
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.id, groupId), eq(groups.organisationId, input.organisationId)))
        .limit(1);
      if (!group) throw new Error("That group is not available for this organisation.");
      return { groupId: group.id };
    }
    case "new_hire_days": {
      const days = Number(input.days ?? "");
      if (!Number.isFinite(days) || days <= 0 || days > 365) {
        throw new Error("New-hire window must be a whole number between 1 and 365 days.");
      }
      return { days: Math.floor(days), sinceField: "createdAt" };
    }
    case "role":
    case "tag":
      // Placeholders - no parameters needed yet.
      return { values: [] };
  }
}

export async function createExclusionRule(formData: FormData) {
  const data = baseSchema.parse({
    orgSlug: valueFromForm(formData, "orgSlug"),
    name: valueFromForm(formData, "name"),
    kind: valueFromForm(formData, "kind"),
    groupId: valueFromForm(formData, "groupId") || undefined,
    days: valueFromForm(formData, "days") || undefined,
    active: valueFromForm(formData, "active") || undefined,
  });
  const organisation = await requireOrganisationRoleForSlug(data.orgSlug, ["owner", "admin"]);
  const parameters = await buildParameters({
    organisationId: organisation.id,
    kind: data.kind,
    groupId: data.groupId,
    days: data.days,
  });

  await db.insert(exclusionRules).values({
    organisationId: organisation.id,
    name: data.name,
    kind: data.kind,
    parameters,
    active: data.active !== "false",
  });

  revalidatePath(`/${data.orgSlug}/exclusions`);
  revalidatePath(`/${data.orgSlug}/campaigns`);
  redirect(pathWithToast(`/${data.orgSlug}/exclusions`, "exclusion-saved"), RedirectType.replace);
}

const toggleSchema = z.object({
  orgSlug: z.string().min(1),
  ruleId: z.string().min(1),
  active: z.enum(["true", "false"]),
});

export async function setExclusionRuleActive(formData: FormData) {
  const data = toggleSchema.parse({
    orgSlug: valueFromForm(formData, "orgSlug"),
    ruleId: valueFromForm(formData, "ruleId"),
    active: valueFromForm(formData, "active") || "true",
  });
  const organisation = await requireOrganisationRoleForSlug(data.orgSlug, ["owner", "admin"]);

  await db
    .update(exclusionRules)
    .set({ active: data.active === "true", updatedAt: new Date() })
    .where(and(eq(exclusionRules.id, data.ruleId), eq(exclusionRules.organisationId, organisation.id)));

  revalidatePath(`/${data.orgSlug}/exclusions`);
  revalidatePath(`/${data.orgSlug}/campaigns`);
  redirect(pathWithToast(`/${data.orgSlug}/exclusions`, "exclusion-status"), RedirectType.replace);
}

const deleteSchema = z.object({
  orgSlug: z.string().min(1),
  ruleId: z.string().min(1),
});

export async function deleteExclusionRule(formData: FormData) {
  const data = deleteSchema.parse({
    orgSlug: valueFromForm(formData, "orgSlug"),
    ruleId: valueFromForm(formData, "ruleId"),
  });
  const organisation = await requireOrganisationRoleForSlug(data.orgSlug, ["owner", "admin"]);

  await db
    .delete(exclusionRules)
    .where(and(eq(exclusionRules.id, data.ruleId), eq(exclusionRules.organisationId, organisation.id)));

  revalidatePath(`/${data.orgSlug}/exclusions`);
  revalidatePath(`/${data.orgSlug}/campaigns`);
  redirect(pathWithToast(`/${data.orgSlug}/exclusions`, "exclusion-deleted"), RedirectType.replace);
}
