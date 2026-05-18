import { and, eq, SQL } from "drizzle-orm";
import { AnyPgColumn } from "drizzle-orm/pg-core";
import { headers } from "next/headers";

import { auth } from "@/lib/auth/auth";

type TenantScopedTable = {
  organisationId: AnyPgColumn;
};

export class TenantAccessError extends Error {
  constructor(message = "No organisation is available for this session.") {
    super(message);
    this.name = "TenantAccessError";
  }
}

export async function getSessionOrganisationId() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return session?.user && "organisationId" in session.user
    ? (session.user.organisationId as string | null)
    : null;
}

export async function requireOrganisationId() {
  const organisationId = await getSessionOrganisationId();

  if (!organisationId) {
    throw new TenantAccessError();
  }

  return organisationId;
}

export function tenantWhere<TTable extends TenantScopedTable>(
  table: TTable,
  organisationId: string,
  clause?: SQL,
) {
  const scoped = eq(table.organisationId, organisationId);
  return clause ? and(scoped, clause) : scoped;
}

export function withTenant(organisationId: string) {
  return {
    where<TTable extends TenantScopedTable>(table: TTable, clause?: SQL) {
      return tenantWhere(table, organisationId, clause);
    },
  };
}
