"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { employees } from "@/lib/db/schema";

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
  const organisation = await requireOrganisationForSlug(data.orgSlug);

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
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];

    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      quoted = !quoted;
      continue;
    }

    if (character === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }

    cell += character;
  }

  cells.push(cell.trim());
  return cells;
}

function normaliseHeader(header: string) {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getCell(row: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = row[normaliseHeader(key)];
    if (value) return value.trim();
  }

  return "";
}

function nameFromEmail(email: string) {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  const firstName = parts[0] ? parts[0][0].toUpperCase() + parts[0].slice(1) : "Employee";
  const lastName = parts[1] ? parts[1][0].toUpperCase() + parts[1].slice(1) : "Imported";

  return { firstName, lastName };
}

export async function importEmployeesCsv(formData: FormData) {
  const orgSlug = valueFromForm(formData, "orgSlug");
  const csv = valueFromForm(formData, "csv");
  const organisation = await requireOrganisationForSlug(orgSlug);
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("CSV import needs a header row and at least one employee.");
  }

  const headers = parseCsvLine(lines[0]).map(normaliseHeader);
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = cells[index] ?? "";
      return row;
    }, {});
  });

  const values = rows
    .map((row) => {
      const email = getCell(row, "email", "work email").toLowerCase();
      if (!email) return null;

      const fallback = nameFromEmail(email);
      const firstName = getCell(row, "first_name", "first name", "firstName") || fallback.firstName;
      const lastName = getCell(row, "last_name", "last name", "lastName") || fallback.lastName;

      return {
        organisationId: organisation.id,
        email,
        firstName,
        lastName,
        department: getCell(row, "department") || null,
        managerEmail: getCell(row, "manager_email", "manager email", "managerEmail") || null,
        language: getCell(row, "language") || "en-AU",
        timezone: getCell(row, "timezone") || "Australia/Sydney",
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (values.length === 0) {
    throw new Error("No employees with email addresses were found in the CSV.");
  }

  for (const value of values) {
    await db
      .insert(employees)
      .values(value)
      .onConflictDoUpdate({
        target: [employees.organisationId, employees.email],
        set: {
          firstName: value.firstName,
          lastName: value.lastName,
          department: value.department,
          managerEmail: value.managerEmail,
          language: value.language,
          timezone: value.timezone,
          active: true,
          updatedAt: new Date(),
        },
      });
  }

  revalidatePath(`/${orgSlug}/employees`);
  revalidatePath(`/${orgSlug}/dashboard`);
}

export async function setEmployeeActive(formData: FormData) {
  const orgSlug = valueFromForm(formData, "orgSlug");
  const employeeId = valueFromForm(formData, "employeeId");
  const active = valueFromForm(formData, "active") === "true";
  const organisation = await requireOrganisationForSlug(orgSlug);

  await db
    .update(employees)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(employees.id, employeeId), eq(employees.organisationId, organisation.id)));

  revalidatePath(`/${orgSlug}/employees`);
  revalidatePath(`/${orgSlug}/dashboard`);
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
  const organisation = await requireOrganisationForSlug(data.orgSlug);
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
}
