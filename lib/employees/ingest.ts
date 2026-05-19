import { and, eq, inArray, notInArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { employees } from "@/lib/db/schema";

export type EmployeeIngestRow = {
  email: string;
  firstName: string;
  lastName: string;
  department: string | null;
  managerEmail: string | null;
  language: string;
  timezone: string;
};

export type EmployeeIngestInput = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  department?: string | null;
  managerEmail?: string | null;
  language?: string | null;
  timezone?: string | null;
};

export type IngestError = { index?: number; email?: string; reason: string };

export type IngestResult = {
  received: number;
  added: number;
  updated: number;
  deactivated: number;
  skipped: number;
  errors: IngestError[];
};

export type IngestMode = "single" | "bulk_incremental" | "bulk_full";

const DEFAULT_LANGUAGE = "en-AU";
const DEFAULT_TIMEZONE = "Australia/Sydney";

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function nameFromEmail(email: string) {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  const firstName = parts[0] ? parts[0][0].toUpperCase() + parts[0].slice(1) : "Employee";
  const lastName = parts[1] ? parts[1][0].toUpperCase() + parts[1].slice(1) : "Imported";
  return { firstName, lastName };
}

function trimOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.toString().trim();
  return trimmed.length ? trimmed : null;
}

export function normaliseEmployeeRow(input: EmployeeIngestInput): EmployeeIngestRow | null {
  const email = (input.email ?? "").toString().trim().toLowerCase();
  if (!email || !isLikelyEmail(email)) return null;
  const fallback = nameFromEmail(email);
  const firstName = (input.firstName ?? "")?.toString().trim() || fallback.firstName;
  const lastName = (input.lastName ?? "")?.toString().trim() || fallback.lastName;
  const department = trimOrNull(input.department);
  const managerRaw = trimOrNull(input.managerEmail);
  const managerEmail = managerRaw ? managerRaw.toLowerCase() : null;
  const language = trimOrNull(input.language) || DEFAULT_LANGUAGE;
  const timezone = trimOrNull(input.timezone) || DEFAULT_TIMEZONE;

  return { email, firstName, lastName, department, managerEmail, language, timezone };
}

function parseCsvLine(line: string): string[] {
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

export function normaliseCsvHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pickHeader(row: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = row[normaliseCsvHeader(key)];
    if (value) return value.trim();
  }
  return "";
}

export function parseEmployeesCsv(csv: string): { rows: EmployeeIngestInput[]; errors: IngestError[] } {
  const errors: IngestError[] = [];
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return { rows: [], errors: [{ reason: "CSV needs a header row and at least one data row." }] };
  }

  const headers = parseCsvLine(lines[0]).map(normaliseCsvHeader);
  const rows: EmployeeIngestInput[] = [];

  lines.slice(1).forEach((line, idx) => {
    const cells = parseCsvLine(line);
    const row = headers.reduce<Record<string, string>>((acc, header, columnIndex) => {
      acc[header] = cells[columnIndex] ?? "";
      return acc;
    }, {});

    const email = pickHeader(row, "email", "work email").toLowerCase();
    if (!email) {
      errors.push({ index: idx + 1, reason: "Row missing email column." });
      return;
    }

    rows.push({
      email,
      firstName: pickHeader(row, "first_name", "first name", "firstname"),
      lastName: pickHeader(row, "last_name", "last name", "lastname"),
      department: pickHeader(row, "department") || null,
      managerEmail: pickHeader(row, "manager_email", "manager email", "manageremail") || null,
      language: pickHeader(row, "language") || null,
      timezone: pickHeader(row, "timezone") || null,
    });
  });

  return { rows, errors };
}

export function parseEmployeesJsonl(body: string): { rows: EmployeeIngestInput[]; errors: IngestError[] } {
  const errors: IngestError[] = [];
  const rows: EmployeeIngestInput[] = [];

  body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, idx) => {
      try {
        const parsed = JSON.parse(line) as EmployeeIngestInput;
        rows.push(parsed);
      } catch {
        errors.push({ index: idx, reason: "Line is not valid JSON." });
      }
    });

  return { rows, errors };
}

/**
 * Apply a batch of employee rows to the database for one organisation.
 *
 * - `single`: upsert one row only; never deactivate anything.
 * - `bulk_incremental`: upsert each row; do not touch absent records.
 * - `bulk_full`: upsert each row; soft-deactivate (`active=false`) every employee
 *   in the organisation whose email is not present in this payload.
 */
export async function ingestEmployees(input: {
  organisationId: string;
  mode: IngestMode;
  rows: EmployeeIngestInput[];
  parseErrors?: IngestError[];
}): Promise<IngestResult> {
  const { organisationId, mode, rows } = input;
  const parseErrors = input.parseErrors ?? [];
  const result: IngestResult = {
    received: rows.length,
    added: 0,
    updated: 0,
    deactivated: 0,
    skipped: 0,
    errors: [...parseErrors],
  };

  const normalisedByEmail = new Map<string, EmployeeIngestRow>();
  rows.forEach((row, idx) => {
    const normalised = normaliseEmployeeRow(row);
    if (!normalised) {
      result.skipped += 1;
      result.errors.push({ index: idx, email: row?.email, reason: "Row missing a valid email." });
      return;
    }
    // Deduplicate by email — last write wins.
    normalisedByEmail.set(normalised.email, normalised);
  });

  const incomingEmails = [...normalisedByEmail.keys()];

  const existingRows = incomingEmails.length
    ? await db
        .select({ email: employees.email })
        .from(employees)
        .where(and(eq(employees.organisationId, organisationId), inArray(employees.email, incomingEmails)))
    : [];
  const existingSet = new Set(existingRows.map((row) => row.email));

  for (const value of normalisedByEmail.values()) {
    try {
      await db
        .insert(employees)
        .values({
          organisationId,
          email: value.email,
          firstName: value.firstName,
          lastName: value.lastName,
          department: value.department,
          managerEmail: value.managerEmail,
          language: value.language,
          timezone: value.timezone,
        })
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

      if (existingSet.has(value.email)) {
        result.updated += 1;
      } else {
        result.added += 1;
      }
    } catch (error) {
      result.errors.push({
        email: value.email,
        reason: error instanceof Error ? error.message : "Database write failed.",
      });
    }
  }

  if (mode === "bulk_full") {
    const baseCondition = and(eq(employees.organisationId, organisationId), eq(employees.active, true));
    const whereClause = incomingEmails.length
      ? and(baseCondition, notInArray(employees.email, incomingEmails))
      : baseCondition;

    const deactivated = await db
      .update(employees)
      .set({ active: false, updatedAt: new Date() })
      .where(whereClause)
      .returning({ id: employees.id });
    result.deactivated = deactivated.length;
  }

  return result;
}
