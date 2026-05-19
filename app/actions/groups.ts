"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";

import { requireOrganisationRoleForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { employeeGroups, employees, groups } from "@/lib/db/schema";
import { pathWithToast } from "@/lib/navigation/toast";

const groupSchema = z.object({
  orgSlug: z.string().min(1),
  groupId: z.string().optional(),
  name: z.string().trim().min(2).max(100),
  employeeIds: z.array(z.string()).default([]),
});

function valueFromForm(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function saveGroup(formData: FormData) {
  const data = groupSchema.parse({
    orgSlug: valueFromForm(formData, "orgSlug"),
    groupId: valueFromForm(formData, "groupId") || undefined,
    name: valueFromForm(formData, "name"),
    employeeIds: formData.getAll("employeeIds").filter((value): value is string => typeof value === "string"),
  });
  const organisation = await requireOrganisationRoleForSlug(data.orgSlug, ["owner", "admin"]);

  const [group] = data.groupId
    ? await db
        .update(groups)
        .set({ name: data.name, updatedAt: new Date() })
        .where(and(eq(groups.id, data.groupId), eq(groups.organisationId, organisation.id)))
        .returning({ id: groups.id })
    : await db
        .insert(groups)
        .values({
          organisationId: organisation.id,
          name: data.name,
        })
        .onConflictDoUpdate({
          target: [groups.organisationId, groups.name],
          set: {
            updatedAt: new Date(),
          },
        })
        .returning({ id: groups.id });

  if (!group) {
    throw new Error("Group not found.");
  }

  await db.delete(employeeGroups).where(eq(employeeGroups.groupId, group.id));

  if (data.employeeIds.length > 0) {
    const validEmployees = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.organisationId, organisation.id), inArray(employees.id, data.employeeIds)));

    if (validEmployees.length > 0) {
      await db.insert(employeeGroups).values(
        validEmployees.map((employee) => ({
          groupId: group.id,
          employeeId: employee.id,
        })),
      );
    }
  }

  revalidatePath(`/${data.orgSlug}/groups`);
  revalidatePath(`/${data.orgSlug}/campaigns`);
  redirect(pathWithToast(`/${data.orgSlug}/groups`, "group-saved"), RedirectType.replace);
}

export async function deleteGroup(formData: FormData) {
  const orgSlug = valueFromForm(formData, "orgSlug");
  const groupId = valueFromForm(formData, "groupId");
  const organisation = await requireOrganisationRoleForSlug(orgSlug, ["owner", "admin"]);

  await db.delete(groups).where(and(eq(groups.id, groupId), eq(groups.organisationId, organisation.id)));

  revalidatePath(`/${orgSlug}/groups`);
  revalidatePath(`/${orgSlug}/campaigns`);
  redirect(pathWithToast(`/${orgSlug}/groups`, "group-deleted"), RedirectType.replace);
}
