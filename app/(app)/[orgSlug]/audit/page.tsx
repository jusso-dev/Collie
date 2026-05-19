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

function formatMetadata(value: unknown) {
  if (!value || (typeof value === "object" && Object.keys(value).length === 0)) return "{}";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
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
          <div className="divide-y divide-border rounded-lg border border-border">
            {rows.map((row) => {
              const metadata = formatMetadata(row.metadata);
              const actorLabel = row.actorUserId ? (row.actorName ?? row.actorEmail ?? "Unknown user") : "System";

              return (
                <details key={row.id} className="group">
                  <summary className="grid cursor-pointer list-none gap-3 p-4 hover:bg-[var(--collie-cloud)] md:grid-cols-[170px_minmax(180px,1fr)_minmax(160px,220px)_120px] md:items-center">
                    <div>
                      <div className="font-mono text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</div>
                      <div className="mt-1 font-medium">{actorLabel}</div>
                      {row.actorEmail && row.actorEmail !== actorLabel ? (
                        <div className="text-xs text-muted-foreground">{row.actorEmail}</div>
                      ) : null}
                    </div>
                    <div>
                      <span className="rounded-md bg-[var(--collie-cloud)] px-2 py-1 font-mono text-xs">
                        {row.action}
                      </span>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {row.resourceType}
                        {row.resourceId ? ` · ${row.resourceId.slice(0, 12)}` : ""}
                      </div>
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground">{metadata.replace(/\s+/g, " ")}</div>
                    <div className="text-sm font-medium text-primary">
                      <span className="group-open:hidden">View details</span>
                      <span className="hidden group-open:inline">Hide details</span>
                    </div>
                  </summary>
                  <div className="grid gap-4 border-t border-border bg-[var(--collie-cloud)] p-4 lg:grid-cols-[minmax(220px,0.8fr)_minmax(320px,1.2fr)]">
                    <dl className="grid gap-3 text-sm">
                      <div>
                        <dt className="text-xs font-medium uppercase text-muted-foreground">Resource</dt>
                        <dd className="mt-1 break-all font-mono text-xs">
                          {row.resourceType}
                          {row.resourceId ? `:${row.resourceId}` : ""}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium uppercase text-muted-foreground">Audit ID</dt>
                        <dd className="mt-1 break-all font-mono text-xs">{row.id}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium uppercase text-muted-foreground">IP address</dt>
                        <dd className="mt-1 font-mono text-xs">{row.ipAddress ?? "Not captured"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium uppercase text-muted-foreground">User agent</dt>
                        <dd className="mt-1 break-all font-mono text-xs">{row.userAgent ?? "Not captured"}</dd>
                      </div>
                    </dl>
                    <div>
                      <h3 className="text-sm font-medium">Metadata</h3>
                      <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-border bg-card p-3 font-mono text-xs">
                        {metadata}
                      </pre>
                    </div>
                  </div>
                </details>
              );
            })}
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
