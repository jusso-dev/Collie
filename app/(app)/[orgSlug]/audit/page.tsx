import { and, desc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { auditLog, users } from "@/lib/db/schema";

const PAGE_SIZE = 50;

type SearchParams = {
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
  page?: string;
};

function formatDateTime(value: Date) {
  return value.toLocaleString("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function toDate(value: string | undefined, endOfDay = false): Date | null {
  if (!value) return null;
  const parsed = new Date(endOfDay ? `${value}T23:59:59.999` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildQueryString(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "" || value === null) continue;
    search.set(key, String(value));
  }
  const result = search.toString();
  return result ? `?${result}` : "";
}

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { orgSlug } = await params;
  const search = await searchParams;
  const organisation = await requireOrganisationForSlug(orgSlug);

  const actorFilter = search.actor?.trim() ?? "";
  const actionFilter = search.action?.trim() ?? "";
  const fromFilter = search.from?.trim() ?? "";
  const toFilter = search.to?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(search.page ?? "1", 10) || 1);
  const fromDate = toDate(fromFilter || undefined, false);
  const toDateValue = toDate(toFilter || undefined, true);

  const filters = [eq(auditLog.organisationId, organisation.id)];
  if (actionFilter) {
    filters.push(ilike(auditLog.action, `%${actionFilter}%`));
  }
  if (fromDate) {
    filters.push(gte(auditLog.createdAt, fromDate));
  }
  if (toDateValue) {
    filters.push(lte(auditLog.createdAt, toDateValue));
  }

  const actorJoinCondition = actorFilter
    ? sql`(${users.email} ilike ${`%${actorFilter}%`} or ${users.name} ilike ${`%${actorFilter}%`})`
    : null;

  let countQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLog)
    .$dynamic();
  if (actorJoinCondition) {
    countQuery = countQuery.innerJoin(users, and(eq(users.id, auditLog.actorUserId), actorJoinCondition));
  }
  const [{ count: totalRows }] = await countQuery.where(and(...filters));

  let rowsQuery = db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      resourceType: auditLog.resourceType,
      resourceId: auditLog.resourceId,
      metadata: auditLog.metadata,
      ipAddress: auditLog.ipAddress,
      userAgent: auditLog.userAgent,
      createdAt: auditLog.createdAt,
      actorUserId: auditLog.actorUserId,
      actorName: users.name,
      actorEmail: users.email,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .$dynamic();
  if (actorJoinCondition) {
    rowsQuery = rowsQuery.where(and(...filters, actorJoinCondition));
  } else {
    rowsQuery = rowsQuery.where(and(...filters));
  }

  const rows = await rowsQuery
    .orderBy(desc(auditLog.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const exportHref = `/${orgSlug}/audit/export.csv${buildQueryString({
    actor: actorFilter,
    action: actionFilter,
    from: fromFilter,
    to: toFilter,
  })}`;
  const prevHref = `/${orgSlug}/audit${buildQueryString({
    actor: actorFilter,
    action: actionFilter,
    from: fromFilter,
    to: toFilter,
    page: page > 1 ? page - 1 : undefined,
  })}`;
  const nextHref = `/${orgSlug}/audit${buildQueryString({
    actor: actorFilter,
    action: actionFilter,
    from: fromFilter,
    to: toFilter,
    page: page < totalPages ? page + 1 : undefined,
  })}`;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-[rgb(56_189_248_/_0.08)] p-5 md:flex md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Audit log</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Who did what, and when. Filter by actor, action, or date range, then export a signed CSV for your
            evidence pack.
          </p>
        </div>
        <Link href={exportHref} className={buttonVariants({ variant: "outline" })}>
          Export CSV
        </Link>
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <form className="grid gap-3 md:grid-cols-[1fr_1fr_160px_160px_auto] md:items-end" method="get">
          <div className="space-y-2">
            <Label htmlFor="audit-actor">Actor (name or email)</Label>
            <Input id="audit-actor" name="actor" defaultValue={actorFilter} placeholder="alex@acme.com" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audit-action">Action</Label>
            <Input id="audit-action" name="action" defaultValue={actionFilter} placeholder="campaign.launch" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audit-from">From</Label>
            <Input id="audit-from" name="from" type="date" defaultValue={fromFilter} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audit-to">To</Label>
            <Input id="audit-to" name="to" type="date" defaultValue={toFilter} />
          </div>
          <div className="flex gap-2">
            <Button type="submit">Apply filters</Button>
            <Link href={`/${orgSlug}/audit`} className={buttonVariants({ variant: "outline" })}>
              Reset
            </Link>
          </div>
        </form>
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3 pb-4">
          <div className="flex items-center gap-3">
            <h2 className="font-medium">Entries</h2>
            <Badge variant="outline">{totalRows} total</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Retention: {organisation.id ? "Configured per tenant" : "Default"} ·
            {" "}showing page {page} of {totalPages}
          </p>
        </div>
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No audit entries match these filters yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="border-b text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-3 pr-4 font-medium">When</th>
                  <th className="py-3 pr-4 font-medium">Actor</th>
                  <th className="py-3 pr-4 font-medium">Action</th>
                  <th className="py-3 pr-4 font-medium">Resource</th>
                  <th className="py-3 pr-4 font-medium">Metadata</th>
                  <th className="py-3 font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const metadataPreview = (() => {
                    if (!row.metadata || Object.keys(row.metadata).length === 0) return "—";
                    try {
                      return JSON.stringify(row.metadata);
                    } catch {
                      return "—";
                    }
                  })();

                  return (
                    <tr key={row.id} className="border-b align-top last:border-b-0">
                      <td className="py-3 pr-4 font-mono text-xs">{formatDateTime(row.createdAt)}</td>
                      <td className="py-3 pr-4">
                        {row.actorUserId ? (
                          <>
                            <div className="font-medium">{row.actorName ?? "Unknown user"}</div>
                            <div className="text-muted-foreground">{row.actorEmail ?? row.actorUserId}</div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">System</span>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <span className="rounded-md bg-[var(--collie-cloud)] px-2 py-1 font-mono text-xs">
                          {row.action}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="font-medium">{row.resourceType}</div>
                        {row.resourceId ? (
                          <div className="break-all font-mono text-xs text-muted-foreground">
                            {row.resourceId}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="max-w-[28rem] truncate font-mono text-xs text-muted-foreground" title={metadataPreview}>
                          {metadataPreview}
                        </div>
                      </td>
                      <td className="py-3 font-mono text-xs text-muted-foreground">{row.ipAddress ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-5 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Link
              href={prevHref}
              aria-disabled={page <= 1}
              className={buttonVariants({ variant: "outline" })}
              style={page <= 1 ? { pointerEvents: "none", opacity: 0.5 } : undefined}
            >
              Previous
            </Link>
            <Link
              href={nextHref}
              aria-disabled={page >= totalPages}
              className={buttonVariants({ variant: "outline" })}
              style={page >= totalPages ? { pointerEvents: "none", opacity: 0.5 } : undefined}
            >
              Next
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
