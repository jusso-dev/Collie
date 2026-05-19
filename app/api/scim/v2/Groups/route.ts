import { and, asc, eq, inArray } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/lib/db/client";
import { employeeGroups, employees, groups } from "@/lib/db/schema";
import { authenticateScimRequest } from "@/lib/scim/auth";
import { scimError, scimJson } from "@/lib/scim/errors";
import { loadMembersForGroups } from "@/lib/scim/group-members";
import { parseSimpleFilter } from "@/lib/scim/patch";
import {
  SCHEMA_LIST_RESPONSE,
  getScimBaseUrl,
  scimGroupFromRow,
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

  const whereClauses = [eq(groups.organisationId, auth.organisation.id)];
  if (filter) {
    if (filter.attribute === "displayname") {
      whereClauses.push(eq(groups.name, filter.value));
    } else if (filter.attribute === "externalid") {
      whereClauses.push(eq(groups.scimExternalId, filter.value));
    } else if (filter.attribute === "id") {
      whereClauses.push(eq(groups.id, filter.value));
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
    .from(groups)
    .where(and(...whereClauses))
    .orderBy(asc(groups.name))
    .limit(count)
    .offset(startIndex - 1);

  const baseUrl = getScimBaseUrl(request.url);
  const members = await loadMembersForGroups(rows.map((row) => row.id));
  const totalResults = (await db.select({ id: groups.id }).from(groups).where(and(...whereClauses))).length;

  return scimJson({
    schemas: [SCHEMA_LIST_RESPONSE],
    totalResults,
    startIndex,
    itemsPerPage: rows.length,
    Resources: rows.map((row) => scimGroupFromRow(row, members.get(row.id) ?? [], { baseUrl })),
  });
}

export async function POST(request: NextRequest) {
  const auth = await authenticateScimRequest(request);
  if (!auth.ok) return scimError({ status: auth.status, detail: auth.detail });

  const body = (await request.json().catch(() => null)) as
    | { displayName?: string; externalId?: string; members?: Array<{ value?: string }> }
    | null;
  if (!body) return scimError({ status: 400, detail: "Request body is not valid JSON.", scimType: "invalidSyntax" });

  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (!displayName) {
    return scimError({ status: 400, detail: "displayName is required.", scimType: "invalidValue" });
  }
  const externalId = typeof body.externalId === "string" ? body.externalId.trim() : null;

  const [existing] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.organisationId, auth.organisation.id), eq(groups.name, displayName)))
    .limit(1);
  if (existing) {
    return scimError({ status: 409, detail: "A group with this displayName already exists.", scimType: "uniqueness" });
  }

  const [created] = await db
    .insert(groups)
    .values({
      organisationId: auth.organisation.id,
      name: displayName,
      scimExternalId: externalId || null,
    })
    .returning();

  const memberIds = (body.members ?? [])
    .map((entry) => (typeof entry?.value === "string" ? entry.value.trim() : ""))
    .filter(Boolean);

  if (memberIds.length > 0) {
    const validMembers = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.organisationId, auth.organisation.id), inArray(employees.id, memberIds)));
    if (validMembers.length > 0) {
      await db
        .insert(employeeGroups)
        .values(validMembers.map((member) => ({ groupId: created.id, employeeId: member.id })))
        .onConflictDoNothing();
    }
  }

  const baseUrl = getScimBaseUrl(request.url);
  const members = await loadMembersForGroups([created.id]);
  return scimJson(scimGroupFromRow(created, members.get(created.id) ?? [], { baseUrl }), {
    status: 201,
    headers: { Location: `${baseUrl}/api/scim/v2/Groups/${created.id}` },
  });
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (raw == null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}
