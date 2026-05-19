"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";

import { requireOrganisationRoleForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { employees, employeeSyncRuns } from "@/lib/db/schema";
import { ingestEmployees, parseEmployeesCsv } from "@/lib/employees/ingest";
import { pathWithToast } from "@/lib/navigation/toast";

const employeeSchema = z.object({
  orgSlug: z.string().min(1),
  email: z.string().email(),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  department: z.string().trim().optional(),
  managerEmail: z.string().trim().optional(),
  language: z.string().trim().optional(),
  timezone: z.string().trim().optional(),
});

type EmployeeInput = z.infer<typeof employeeSchema>;

function valueFromForm(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function parseEmployee(formData: FormData): EmployeeInput {
  return employeeSchema.parse({
    orgSlug: valueFromForm(formData, "orgSlug"),
    email: valueFromForm(formData, "email").toLowerCase(),
    firstName: valueFromForm(formData, "firstName"),
    lastName: valueFromForm(formData, "lastName"),
    department: valueFromForm(formData, "department") || undefined,
    managerEmail: valueFromForm(formData, "managerEmail") || undefined,
    language: valueFromForm(formData, "language") || undefined,
    timezone: valueFromForm(formData, "timezone") || undefined,
  });
}

export async function createEmployee(formData: FormData) {
  const data = parseEmployee(formData);
  const organisation = await requireOrganisationRoleForSlug(data.orgSlug, ["owner", "admin"]);

  await db
    .insert(employees)
    .values({
      organisationId: organisation.id,
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      department: data.department || null,
      managerEmail: data.managerEmail || null,
      language: data.language || "en-AU",
      timezone: data.timezone || "Australia/Sydney",
    })
    .onConflictDoUpdate({
      target: [employees.organisationId, employees.email],
      set: {
        firstName: data.firstName,
        lastName: data.lastName,
        department: data.department || null,
        managerEmail: data.managerEmail || null,
        language: data.language || "en-AU",
        timezone: data.timezone || "Australia/Sydney",
        active: true,
        updatedAt: new Date(),
      },
    });

  revalidatePath(`/${data.orgSlug}/employees`);
  revalidatePath(`/${data.orgSlug}/dashboard`);
  redirect(pathWithToast(`/${data.orgSlug}/employees`, "employee-saved"), RedirectType.replace);
}

export async function importEmployeesCsv(formData: FormData) {
  const orgSlug = valueFromForm(formData, "orgSlug");
  const csv = valueFromForm(formData, "csv");
  const organisation = await requireOrganisationRoleForSlug(orgSlug, ["owner", "admin"]);

  const { rows, errors } = parseEmployeesCsv(csv);

  if (rows.length === 0) {
    throw new Error(errors[0]?.reason ?? "No employees with email addresses were found in the CSV.");
  }

  const result = await ingestEmployees({
    organisationId: organisation.id,
    mode: "bulk_incremental",
    rows,
    parseErrors: errors,
  });

  await db.insert(employeeSyncRuns).values({
    organisationId: organisation.id,
    mode: "bulk_incremental",
    source: "ui_csv_upload",
    actorKeyLast4: null,
    receivedCount: result.received,
    addedCount: result.added,
    updatedCount: result.updated,
    deactivatedCount: result.deactivated,
    skippedCount: result.skipped,
    errors: result.errors.slice(0, 50),
  });

  revalidatePath(`/${orgSlug}/employees`);
  revalidatePath(`/${orgSlug}/dashboard`);
  revalidatePath(`/${orgSlug}/settings`);
  redirect(pathWithToast(`/${orgSlug}/employees`, "employees-imported"), RedirectType.replace);
}

export async function setEmployeeActive(formData: FormData) {
  const orgSlug = valueFromForm(formData, "orgSlug");
  const employeeId = valueFromForm(formData, "employeeId");
  const active = valueFromForm(formData, "active") === "true";
  const organisation = await requireOrganisationRoleForSlug(orgSlug, ["owner", "admin"]);

  await db
    .update(employees)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(employees.id, employeeId), eq(employees.organisationId, organisation.id)));

  revalidatePath(`/${orgSlug}/employees`);
  revalidatePath(`/${orgSlug}/dashboard`);
  redirect(pathWithToast(`/${orgSlug}/employees`, "employee-status"), RedirectType.replace);
}

const exclusionSchema = z.object({
  orgSlug: z.string().min(1),
  employeeId: z.string().min(1),
  excluded: z.enum(["true", "false"]),
  reason: z.string().trim().max(280).optional(),
  until: z.string().optional(),
});

export async function setEmployeeExclusion(formData: FormData) {
  const data = exclusionSchema.parse({
    orgSlug: valueFromForm(formData, "orgSlug"),
    employeeId: valueFromForm(formData, "employeeId"),
    excluded: valueFromForm(formData, "excluded") || "true",
    reason: valueFromForm(formData, "reason") || undefined,
    until: valueFromForm(formData, "until") || undefined,
  });
  const organisation = await requireOrganisationRoleForSlug(data.orgSlug, ["owner", "admin"]);
  const excluded = data.excluded === "true";

  let until: Date | null = null;
  if (excluded && data.until) {
    const parsed = new Date(data.until);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("Choose a valid exclusion-until date.");
    }
    until = parsed;
  }

  await db
    .update(employees)
    .set({
      excluded,
      exclusionReason: excluded ? data.reason ?? null : null,
      excludedUntil: until,
      updatedAt: new Date(),
    })
    .where(and(eq(employees.id, data.employeeId), eq(employees.organisationId, organisation.id)));

  revalidatePath(`/${data.orgSlug}/employees`);
  revalidatePath(`/${data.orgSlug}/campaigns`);
  redirect(pathWithToast(`/${data.orgSlug}/employees`, "employee-exclusion"), RedirectType.replace);
}
