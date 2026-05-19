import { and, eq, ne } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/lib/db/client";
import { employees } from "@/lib/db/schema";
import { authenticateScimRequest } from "@/lib/scim/auth";
import { scimError, scimJson } from "@/lib/scim/errors";
import { applyUserPatch, type ScimPatchEnvelope } from "@/lib/scim/patch";
import {
  getScimBaseUrl,
  resolveDisplayNameParts,
  resolveUserEmail,
  scimUserFromEmployee,
  type ScimUserCreateInput,
} from "@/lib/scim/resources";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/scim/v2/Users/[id]">) {
  const auth = await authenticateScimRequest(request);
  if (!auth.ok) return scimError({ status: auth.status, detail: auth.detail });
  const { id } = await ctx.params;

  const [row] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, id), eq(employees.organisationId, auth.organisation.id)))
    .limit(1);

  if (!row) return scimError({ status: 404, detail: "User not found." });

  const baseUrl = getScimBaseUrl(request.url);
  return scimJson(scimUserFromEmployee(row, { baseUrl }));
}

export async function PUT(request: NextRequest, ctx: RouteContext<"/api/scim/v2/Users/[id]">) {
  const auth = await authenticateScimRequest(request);
  if (!auth.ok) return scimError({ status: auth.status, detail: auth.detail });
  const { id } = await ctx.params;

  const body = (await request.json().catch(() => null)) as ScimUserCreateInput | null;
  if (!body) return scimError({ status: 400, detail: "Request body is not valid JSON.", scimType: "invalidSyntax" });

  const [existing] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, id), eq(employees.organisationId, auth.organisation.id)))
    .limit(1);
  if (!existing) return scimError({ status: 404, detail: "User not found." });

  const email = resolveUserEmail(body) ?? existing.email;
  const { firstName, lastName } = resolveDisplayNameParts(body, email);
  const externalId = typeof body.externalId === "string" ? body.externalId.trim() : existing.scimExternalId;
  const active = typeof body.active === "boolean" ? body.active : existing.active;

  if (email !== existing.email) {
    const [collision] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          eq(employees.organisationId, auth.organisation.id),
          eq(employees.email, email),
          ne(employees.id, existing.id),
        ),
      )
      .limit(1);
    if (collision) {
      return scimError({
        status: 409,
        detail: "Another user already uses this userName.",
        scimType: "uniqueness",
      });
    }
  }

  const [updated] = await db
    .update(employees)
    .set({
      email,
      firstName,
      lastName,
      active,
      scimExternalId: externalId || null,
      updatedAt: new Date(),
    })
    .where(and(eq(employees.id, id), eq(employees.organisationId, auth.organisation.id)))
    .returning();

  const baseUrl = getScimBaseUrl(request.url);
  return scimJson(scimUserFromEmployee(updated, { baseUrl }));
}

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/scim/v2/Users/[id]">) {
  const auth = await authenticateScimRequest(request);
  if (!auth.ok) return scimError({ status: auth.status, detail: auth.detail });
  const { id } = await ctx.params;

  const body = (await request.json().catch(() => null)) as ScimPatchEnvelope | null;
  if (!body || !Array.isArray(body.Operations)) {
    return scimError({ status: 400, detail: "PATCH envelope is missing Operations.", scimType: "invalidSyntax" });
  }

  const [existing] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, id), eq(employees.organisationId, auth.organisation.id)))
    .limit(1);
  if (!existing) return scimError({ status: 404, detail: "User not found." });

  const diff = applyUserPatch(body);

  if (diff.email && diff.email !== existing.email) {
    const [collision] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          eq(employees.organisationId, auth.organisation.id),
          eq(employees.email, diff.email),
          ne(employees.id, existing.id),
        ),
      )
      .limit(1);
    if (collision) {
      return scimError({
        status: 409,
        detail: "Another user already uses this userName.",
        scimType: "uniqueness",
      });
    }
  }

  const [updated] = await db
    .update(employees)
    .set({
      ...(diff.email !== undefined ? { email: diff.email } : {}),
      ...(diff.firstName !== undefined ? { firstName: diff.firstName } : {}),
      ...(diff.lastName !== undefined ? { lastName: diff.lastName } : {}),
      ...(diff.active !== undefined ? { active: diff.active } : {}),
      ...(diff.externalId !== undefined ? { scimExternalId: diff.externalId } : {}),
      ...(diff.department !== undefined ? { department: diff.department } : {}),
      ...(diff.managerEmail !== undefined ? { managerEmail: diff.managerEmail } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(employees.id, id), eq(employees.organisationId, auth.organisation.id)))
    .returning();

  const baseUrl = getScimBaseUrl(request.url);
  return scimJson(scimUserFromEmployee(updated, { baseUrl }));
}

export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/scim/v2/Users/[id]">) {
  const auth = await authenticateScimRequest(request);
  if (!auth.ok) return scimError({ status: auth.status, detail: auth.detail });
  const { id } = await ctx.params;

  // Soft delete to preserve campaign/event history for reporting (issue #2 AC).
  const result = await db
    .update(employees)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(employees.id, id), eq(employees.organisationId, auth.organisation.id)))
    .returning({ id: employees.id });

  if (result.length === 0) return scimError({ status: 404, detail: "User not found." });
  return new Response(null, { status: 204 });
}
