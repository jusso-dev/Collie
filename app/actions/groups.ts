"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { employeeGroups, employees, groups } from "@/lib/db/schema";

const groupSchema = z.object({
  orgSlug: z.string().min(1),
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
    name: valueFromForm(formData, "name"),
    employeeIds: formData.getAll("employeeIds").filter((value): value is string => typeof value === "string"),
  });
  const organisation = await requireOrganisationForSlug(data.orgSlug);

  const [group] = await db
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
}

export async function deleteGroup(formData: FormData) {
  const orgSlug = valueFromForm(formData, "orgSlug");
  const groupId = valueFromForm(formData, "groupId");
  const organisation = await requireOrganisationForSlug(orgSlug);

  await db.delete(groups).where(and(eq(groups.id, groupId), eq(groups.organisationId, organisation.id)));

  revalidatePath(`/${orgSlug}/groups`);
  revalidatePath(`/${orgSlug}/campaigns`);
}
