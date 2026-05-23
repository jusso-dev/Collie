import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { auditLog, organisations } from "@/lib/db/schema";

export const AUDIT_PURGE_DEFAULT_BATCH_SIZE = 10_000;
export const AUDIT_PURGE_MAX_BATCHES_PER_ORG = 1_000;

type CountRow = { count: number };

export type AuditPurgeOrgResult = {
  organisationId: string;
  retentionDays: number;
  cutoff: string;
  deleted: number;
  batches: number;
};

export type AuditPurgeRunResult = {
  organisationsProcessed: number;
  totalDeleted: number;
  perOrg: AuditPurgeOrgResult[];
  errors: string[];
};

function countFromResult(result: unknown): number {
  const rows = Array.isArray(result) ? (result as CountRow[]) : [];
  return Number(rows[0]?.count ?? 0);
}

async function deleteBatch(orgId: string, cutoff: Date, batchSize: number): Promise<number> {
  const result = await db.execute(sql`
    with target_rows as (
      select id
      from ${auditLog}
      where ${auditLog.organisationId} = ${orgId}
        and ${auditLog.createdAt} < ${cutoff}
      order by ${auditLog.createdAt}
      limit ${batchSize}
    ),
    deleted as (
      delete from ${auditLog}
      where ${auditLog.id} in (select id from target_rows)
      returning 1
    )
    select count(*)::int as count from deleted
  `);
  return countFromResult(result);
}

export async function purgeAuditLogsForOrganisation(
  orgId: string,
  retentionDays: number,
  options: { batchSize?: number; now?: Date } = {},
): Promise<AuditPurgeOrgResult> {
  const batchSize = options.batchSize ?? AUDIT_PURGE_DEFAULT_BATCH_SIZE;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  let batches = 0;
  let deleted = 0;

  while (batches < AUDIT_PURGE_MAX_BATCHES_PER_ORG) {
    const removed = await deleteBatch(orgId, cutoff, batchSize);
    batches += 1;
    deleted += removed;
    if (removed < batchSize) break;
  }

  return {
    organisationId: orgId,
    retentionDays,
    cutoff: cutoff.toISOString(),
    deleted,
    batches,
  };
}

export async function purgeExpiredAuditLogs(
  options: { batchSize?: number; now?: Date } = {},
): Promise<AuditPurgeRunResult> {
  const orgs = await db
    .select({
      id: organisations.id,
      retentionDays: organisations.auditRetentionDays,
    })
    .from(organisations);

  const perOrg: AuditPurgeOrgResult[] = [];
  const errors: string[] = [];
  let totalDeleted = 0;

  for (const org of orgs) {
    try {
      const result = await purgeAuditLogsForOrganisation(org.id, org.retentionDays, options);
      perOrg.push(result);
      totalDeleted += result.deleted;
      console.log(
        `[audit-purge] org=${org.id} retention=${org.retentionDays}d cutoff=${result.cutoff} deleted=${result.deleted} batches=${result.batches}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${org.id}: ${message}`);
      console.error(`[audit-purge] org=${org.id} failed: ${message}`);
    }
  }

  return {
    organisationsProcessed: perOrg.length,
    totalDeleted,
    perOrg,
    errors,
  };
}
