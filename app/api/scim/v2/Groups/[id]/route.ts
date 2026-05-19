import { and, eq, inArray } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/lib/db/client";
import { employeeGroups, employees, groups } from "@/lib/db/schema";
import { authenticateScimRequest } from "@/lib/scim/auth";
import { scimError, scimJson } from "@/lib/scim/errors";
import { loadMembersForGroups } from "@/lib/scim/group-members";
import { applyGroupPatch, type ScimPatchEnvelope } from "@/lib/scim/patch";
import { getScimBaseUrl, scimGroupFromRow } from "@/lib/scim/resources";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/scim/v2/Groups/[id]">) {
  const auth = await authenticateScimRequest(request);
  if (!auth.ok) return scimError({ status: auth.status, detail: auth.detail });
  const { id } = await ctx.params;

  const [row] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.id, id), eq(groups.organisationId, auth.organisation.id)))
    .limit(1);
  if (!row) return scimError({ status: 404, detail: "Group not found." });

  const members = await loadMembersForGroups([row.id]);
  const baseUrl = getScimBaseUrl(request.url);
  return scimJson(scimGroupFromRow(row, members.get(row.id) ?? [], { baseUrl }));
}

export async function PUT(request: NextRequest, ctx: RouteContext<"/api/scim/v2/Groups/[id]">) {
  const auth = await authenticateScimRequest(request);
  if (!auth.ok) return scimError({ status: auth.status, detail: auth.detail });
  const { id } = await ctx.params;

  const body = (await request.json().catch(() => null)) as
    | { displayName?: string; externalId?: string; members?: Array<{ value?: string }> }
    | null;
  if (!body) return scimError({ status: 400, detail: "Request body is not valid JSON.", scimType: "invalidSyntax" });

  const [existing] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.id, id), eq(groups.organisationId, auth.organisation.id)))
    .limit(1);
  if (!existing) return scimError({ status: 404, detail: "Group not found." });

  const displayName = typeof body.displayName === "string" && body.displayName.trim()
    ? body.displayName.trim()
    : existing.name;
  const externalId = typeof body.externalId === "string" ? body.externalId.trim() : existing.scimExternalId;

  const [updated] = await db
    .update(groups)
    .set({ name: displayName, scimExternalId: externalId || null, updatedAt: new Date() })
    .where(and(eq(groups.id, id), eq(groups.organisationId, auth.organisation.id)))
    .returning();

  const memberIds = Array.isArray(body.members)
    ? body.members.map((entry) => (typeof entry?.value === "string" ? entry.value.trim() : "")).filter(Boolean)
    : null;

  if (memberIds) {
    await replaceMembers(auth.organisation.id, updated.id, memberIds);
  }

  const members = await loadMembersForGroups([updated.id]);
  const baseUrl = getScimBaseUrl(request.url);
  return scimJson(scimGroupFromRow(updated, members.get(updated.id) ?? [], { baseUrl }));
}

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/scim/v2/Groups/[id]">) {
  const auth = await authenticateScimRequest(request);
  if (!auth.ok) return scimError({ status: auth.status, detail: auth.detail });
  const { id } = await ctx.params;

  const body = (await request.json().catch(() => null)) as ScimPatchEnvelope | null;
  if (!body || !Array.isArray(body.Operations)) {
    return scimError({ status: 400, detail: "PATCH envelope is missing Operations.", scimType: "invalidSyntax" });
  }

  const [existing] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.id, id), eq(groups.organisationId, auth.organisation.id)))
    .limit(1);
  if (!existing) return scimError({ status: 404, detail: "Group not found." });

  const diff = applyGroupPatch(body);

  const [updated] = await db
    .update(groups)
    .set({
      ...(diff.displayName ? { name: diff.displayName } : {}),
      ...(diff.externalId !== undefined ? { scimExternalId: diff.externalId } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(groups.id, id), eq(groups.organisationId, auth.organisation.id)))
    .returning();

  if (diff.replaceMembers !== undefined) {
    await replaceMembers(auth.organisation.id, updated.id, diff.replaceMembers);
  } else {
    if (diff.addMembers.length > 0) {
      const valid = await db
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.organisationId, auth.organisation.id), inArray(employees.id, diff.addMembers)));
      if (valid.length > 0) {
        await db
          .insert(employeeGroups)
          .values(valid.map((member) => ({ groupId: updated.id, employeeId: member.id })))
          .onConflictDoNothing();
      }
    }
    if (diff.removeMembers.length > 0) {
      await db
        .delete(employeeGroups)
        .where(and(eq(employeeGroups.groupId, updated.id), inArray(employeeGroups.employeeId, diff.removeMembers)));
    }
  }

  const members = await loadMembersForGroups([updated.id]);
  const baseUrl = getScimBaseUrl(request.url);
  return scimJson(scimGroupFromRow(updated, members.get(updated.id) ?? [], { baseUrl }));
}

export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/scim/v2/Groups/[id]">) {
  const auth = await authenticateScimRequest(request);
  if (!auth.ok) return scimError({ status: auth.status, detail: auth.detail });
  const { id } = await ctx.params;

  const result = await db
    .delete(groups)
    .where(and(eq(groups.id, id), eq(groups.organisationId, auth.organisation.id)))
    .returning({ id: groups.id });
  if (result.length === 0) return scimError({ status: 404, detail: "Group not found." });
  return new Response(null, { status: 204 });
}

async function replaceMembers(organisationId: string, groupId: string, memberIds: string[]): Promise<void> {
  await db.delete(employeeGroups).where(eq(employeeGroups.groupId, groupId));
  if (memberIds.length === 0) return;
  const valid = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.organisationId, organisationId), inArray(employees.id, memberIds)));
  if (valid.length === 0) return;
  await db
    .insert(employeeGroups)
    .values(valid.map((member) => ({ groupId, employeeId: member.id })));
}
