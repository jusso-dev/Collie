import { and, asc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/lib/db/client";
import { employees } from "@/lib/db/schema";
import { authenticateScimRequest } from "@/lib/scim/auth";
import { scimError, scimJson } from "@/lib/scim/errors";
import { parseSimpleFilter } from "@/lib/scim/patch";
import {
  SCHEMA_LIST_RESPONSE,
  getScimBaseUrl,
  resolveDisplayNameParts,
  resolveUserEmail,
  scimUserFromEmployee,
  type ScimUserCreateInput,
} from "@/lib/scim/resources";

export const dynamic = "force-dynamic";

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 100;

export async function GET(request: NextRequest) {
  const auth = await authenticateScimRequest(request);
  if (!auth.ok) return scimError({ status: auth.status, detail: auth.detail });

  const url = request.nextUrl;
  const startIndex = clampInt(url.searchParams.get("startIndex"), 1, Number.MAX_SAFE_INTEGER, 1);
  const count = clampInt(url.searchParams.get("count"), 0, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const filter = parseSimpleFilter(url.searchParams.get("filter"));

  const whereClauses = [eq(employees.organisationId, auth.organisation.id)];
  if (filter) {
    if (filter.attribute === "username" || filter.attribute === "emails.value" || filter.attribute === "emails") {
      whereClauses.push(eq(employees.email, filter.value.toLowerCase()));
    } else if (filter.attribute === "externalid") {
      whereClauses.push(eq(employees.scimExternalId, filter.value));
    } else if (filter.attribute === "id") {
      whereClauses.push(eq(employees.id, filter.value));
    } else {
      return scimError({
        status: 400,
        detail: `Unsupported filter attribute "${filter.attribute}".`,
        scimType: "invalidFilter",
      });
    }
  }

  const rows = await db
    .select()
    .from(employees)
    .where(and(...whereClauses))
    .orderBy(asc(employees.email))
    .limit(count)
    .offset(startIndex - 1);

  const baseUrl = getScimBaseUrl(request.url);
  const totalResults = await countMatching(auth.organisation.id, filter);
  return scimJson({
    schemas: [SCHEMA_LIST_RESPONSE],
    totalResults,
    startIndex,
    itemsPerPage: rows.length,
    Resources: rows.map((row) => scimUserFromEmployee(row, { baseUrl })),
  });
}

export async function POST(request: NextRequest) {
  const auth = await authenticateScimRequest(request);
  if (!auth.ok) return scimError({ status: auth.status, detail: auth.detail });

  const body = (await request.json().catch(() => null)) as ScimUserCreateInput | null;
  if (!body || typeof body !== "object") {
    return scimError({ status: 400, detail: "Request body is not valid JSON.", scimType: "invalidSyntax" });
  }

  const email = resolveUserEmail(body);
  if (!email) {
    return scimError({
      status: 400,
      detail: "Could not resolve a work email from userName or emails.",
      scimType: "invalidValue",
    });
  }

  const { firstName, lastName } = resolveDisplayNameParts(body, email);
  const externalId = typeof body.externalId === "string" ? body.externalId.trim() : null;
  const active = typeof body.active === "boolean" ? body.active : true;

  const [existing] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.organisationId, auth.organisation.id), eq(employees.email, email)))
    .limit(1);

  if (existing) {
    return scimError({
      status: 409,
      detail: "A user with this userName already exists.",
      scimType: "uniqueness",
    });
  }

  const [created] = await db
    .insert(employees)
    .values({
      organisationId: auth.organisation.id,
      email,
      firstName,
      lastName,
      active,
      scimExternalId: externalId || null,
    })
    .returning();

  const baseUrl = getScimBaseUrl(request.url);
  return scimJson(scimUserFromEmployee(created, { baseUrl }), {
    status: 201,
    headers: { Location: `${baseUrl}/api/scim/v2/Users/${created.id}` },
  });
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (raw == null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

async function countMatching(
  organisationId: string,
  filter: ReturnType<typeof parseSimpleFilter>,
): Promise<number> {
  const where = [eq(employees.organisationId, organisationId)];
  if (filter) {
    if (filter.attribute === "username" || filter.attribute === "emails.value" || filter.attribute === "emails") {
      where.push(eq(employees.email, filter.value.toLowerCase()));
    } else if (filter.attribute === "externalid") {
      where.push(eq(employees.scimExternalId, filter.value));
    } else if (filter.attribute === "id") {
      where.push(eq(employees.id, filter.value));
    }
  }
  const rows = await db.select({ id: employees.id }).from(employees).where(and(...where));
  return rows.length;
}
